/**
 * Trello Shopping List App
 * Version: 2.1.0 (2026-01-16)
 *
 * Board Structure:
 * - List 1: "Todos los Productos" (All products as cards)
 * - List 2: "Lista Activa" (Products currently on shopping list)
 *
 * Labels:
 * - Location labels (rooms/zones): green, blue, purple colors
 * - Store labels: orange, red, yellow colors
 *
 * Moving a card from "Todos" to "Lista Activa" = adding to shopping list
 * Moving back = removing from shopping list
 */

// Configuration Seed (File A) - Initial default values, used only on first launch
const CONFIG_SEED = {
    listNames: {
        allProducts: 'Todos los Productos',
        activeList: 'Lista Activa'
    },
    stores: [
        { name: 'Mercadona', color: 'orange', icon: '🛒' },
        { name: 'Fruteria', color: 'lime', icon: '🍎' },
        { name: 'Farmacia', color: 'red', icon: '💊' },
        { name: 'Carniceria', color: 'pink', icon: '🥩' },
        { name: 'Pescadería', color: 'sky', icon: '🐟' },
        { name: 'Caprabo', color: 'yellow', icon: '🛍️' }
    ],
    locations: [
        // Cocina
        { name: 'Mueble Café', color: 'green' },
        { name: 'Mueble Especias', color: 'green' },
        { name: 'Despensa Cajones', color: 'green' },
        { name: 'Debajo Pica', color: 'green' },
        { name: 'Armario Lavadora', color: 'green' },
        { name: 'Cajonera Cafetera', color: 'green' },
        { name: 'Congeladores', color: 'sky' },
        { name: 'Nevera', color: 'sky' },
        // Comedor
        { name: 'Despensa Nuclear', color: 'blue' },
        // Lavabo
        { name: 'Lavabo', color: 'purple' }
    ]
};

class TrelloShoppingApp {
    constructor() {
        console.log('🚀 TrelloShoppingApp inicializando...');

        // Cloudflare Worker URL for image proxy (bypasses CORS)
        // Deploy your own worker using worker.js - see CLOUDFLARE_SETUP.md
        this.workerUrl = 'https://proxy1cors.tonizrives.workers.dev';

        this.apiKey = localStorage.getItem('trello_api_key') || '';
        this.apiToken = localStorage.getItem('trello_api_token') || '';
        this.selectedBoardId = localStorage.getItem('trello_board_id') || '';

        console.log('📦 Estado inicial:', {
            hasApiKey: !!this.apiKey,
            hasToken: !!this.apiToken,
            hasBoardId: !!this.selectedBoardId
        });

        this.board = null;
        this.lists = [];
        this.allProductsList = null;
        this.activeList = null;
        this.cards = [];
        this.labels = [];

        // Load configuration (File B) - Active config from localStorage, or copy from seed if first time
        this.config = this.loadConfig();

        // New state for card-based navigation
        this.currentView = 'stores'; // 'stores', 'detail', or 'shopping'
        this.currentStore = null;
        this.selectedStore = null; // For shopping mode
        this.searchQuery = '';
        this.searchTimeout = null; // For debouncing search

        // Cache for image blob URLs
        this.imageCache = new Map();

        // Recent products tracking (last 10 marked as purchased)
        this.recentProducts = this.loadRecentProducts();

        this.init();
    }

    // Load recent products from localStorage
    loadRecentProducts() {
        const saved = localStorage.getItem('recent_products');
        if (saved) {
            try {
                return JSON.parse(saved);
            } catch (error) {
                return [];
            }
        }
        return [];
    }

    // Save recent products to localStorage
    saveRecentProducts() {
        localStorage.setItem('recent_products', JSON.stringify(this.recentProducts));
    }

    // Add product to recent list (when marked as purchased)
    addToRecentProducts(cardId) {
        const timestamp = Date.now();
        // Remove if already exists
        this.recentProducts = this.recentProducts.filter(item => item.cardId !== cardId);
        // Add to beginning
        this.recentProducts.unshift({ cardId, timestamp });
        // Keep only last 10
        this.recentProducts = this.recentProducts.slice(0, 10);
        this.saveRecentProducts();
    }

    // Load active config (File B) from localStorage, or initialize from seed (File A) if first time
    loadConfig() {
        const savedConfig = localStorage.getItem('app_config');
        
        if (savedConfig) {
            try {
                console.log('📁 Cargando configuración activa (File B)');
                return JSON.parse(savedConfig);
            } catch (error) {
                console.error('Error parsing config, using seed:', error);
            }
        }
        
        // First time: copy seed (File A) to active config (File B)
        console.log('🌱 Primera vez: inicializando desde configuración seed (File A → File B)');
        const config = JSON.parse(JSON.stringify(CONFIG_SEED)); // Deep copy
        this.saveConfig(config);
        return config;
    }

    // Save active config (File B) to localStorage
    saveConfig(config) {
        localStorage.setItem('app_config', JSON.stringify(config));
        console.log('💾 Configuración guardada (File B)');
    }

    // Get array of store names from active config
    getStoreNames() {
        return this.config.stores.map(s => s.name);
    }

    // Get store icon from active config
    getStoreIcon(storeName) {
        const store = this.config.stores.find(s => s.name === storeName);
        return store?.icon || '🏪';
    }

    // Normalize string for accent-insensitive search
    normalizeString(str) {
        return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    }

    async init() {
        console.log('🔧 init() llamado');

        // Check for URL params auto-login (for iOS Shortcuts integration)
        this.checkUrlParamsLogin();

        this.bindEvents();
        this.loadTheme();

        if (this.apiKey && this.apiToken) {
            console.log('✅ Credenciales encontradas en localStorage');
            if (this.selectedBoardId) {
                console.log('📋 Cargando tablero:', this.selectedBoardId);
                await this.loadBoard();
            } else {
                console.log('📋 Cargando lista de tableros...');
                await this.loadBoards();
            }
        } else {
            console.log('❌ No hay credenciales - mostrando pantalla de login');
        }
    }

    // Check URL hash for auto-login (useful for iOS Shortcuts)
    // Using hash fragment is MORE SECURE than query params because:
    // - Hash fragments are NOT sent to servers (no server logs)
    // - Hash fragments are NOT included in Referer headers
    // Usage: https://yoursite.com/#key=YOUR_API_KEY&token=YOUR_TOKEN&board=OPTIONAL_BOARD_ID
    checkUrlParamsLogin() {
        // Parse hash fragment (everything after #)
        const hash = window.location.hash.substring(1); // Remove the #
        console.log('🔍 Checking URL hash:', hash ? 'found hash' : 'no hash');
        if (!hash) return;

        const hashParams = new URLSearchParams(hash);
        const key = hashParams.get('key');
        const token = hashParams.get('token');
        const boardId = hashParams.get('board');

        console.log('🔍 Parsed params - key:', key ? 'present' : 'missing', 'token:', token ? 'present' : 'missing');

        if (key && token) {
            console.log('🔑 Auto-login via URL hash - setting credentials');
            this.apiKey = key;
            this.apiToken = token;
            localStorage.setItem('trello_api_key', key);
            localStorage.setItem('trello_api_token', token);

            if (boardId) {
                this.selectedBoardId = boardId;
                localStorage.setItem('trello_board_id', boardId);
                console.log('🔑 Board ID also set:', boardId);
            }

            // Clean URL - remove hash (credentials never left the browser anyway)
            window.history.replaceState({}, document.title, window.location.pathname);
            console.log('🔑 URL cleaned, credentials saved to localStorage');
        }
    }

    bindEvents() {
        // Use passive listeners for better scroll performance
        const passiveOpts = { passive: true };

        // Login form submission
        document.getElementById('login-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleLogin();
        });

        // Board selection
        document.getElementById('create-board-btn')?.addEventListener('click', () => this.createNewBoard());

        // Main app
        document.getElementById('theme-toggle')?.addEventListener('click', () => this.toggleTheme());
        document.getElementById('refresh-btn')?.addEventListener('click', () => this.refresh());
        document.getElementById('detail-refresh-btn')?.addEventListener('click', () => this.refresh());
        document.getElementById('settings-btn')?.addEventListener('click', () => this.showSettings());

        // Navigation
        document.getElementById('back-to-stores-btn')?.addEventListener('click', () => this.showStoreCards());
        document.getElementById('shopping-mode-btn')?.addEventListener('click', () => this.showShoppingMode());

        // Enter key on inputs
        document.getElementById('api-key').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') document.getElementById('api-token').focus();
        });
        document.getElementById('api-token').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleLogin();
        });

        // Add product modal
        document.getElementById('add-product-detail-btn')?.addEventListener('click', () => this.openAddModal());
        document.getElementById('modal-close')?.addEventListener('click', () => this.closeAddModal());
        document.getElementById('add-modal')?.addEventListener('click', (e) => {
            if (e.target.id === 'add-modal') this.closeAddModal();
        });
        document.getElementById('create-product-btn')?.addEventListener('click', () => this.createProduct());
        document.getElementById('product-name')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.createProduct();
        });

        // Passive scroll listeners for smooth scrolling
        document.addEventListener('touchstart', () => {}, passiveOpts);
        document.addEventListener('touchmove', () => {}, passiveOpts);

        // Keyboard dismissal - tap outside input to close keyboard
        document.addEventListener('touchstart', (e) => {
            const activeElement = document.activeElement;
            if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
                // If tap is not on an input/textarea, blur to dismiss keyboard
                if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
                    activeElement.blur();
                }
            }
        });

        // Show/hide "Done" button when keyboard is active
        this.setupKeyboardDoneButton();
    }

    setupKeyboardDoneButton() {
        // Create the done button (hidden by default)
        const doneBtn = document.createElement('button');
        doneBtn.id = 'keyboard-done-btn';
        doneBtn.textContent = 'Hecho';
        doneBtn.style.cssText = `
            position: fixed;
            top: 12px;
            right: 12px;
            z-index: 1000;
            padding: 8px 16px;
            background: var(--primary);
            color: white;
            border: none;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 600;
            display: none;
            cursor: pointer;
            -webkit-tap-highlight-color: transparent;
        `;
        document.body.appendChild(doneBtn);

        // Use touchend for better mobile response (works on both iOS and Android)
        doneBtn.addEventListener('touchend', (e) => {
            e.preventDefault();
            document.activeElement?.blur();
        });
        doneBtn.addEventListener('click', () => {
            document.activeElement?.blur();
        });

        // Show button when input is focused
        document.addEventListener('focusin', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                doneBtn.style.display = 'block';
            }
        });

        // Hide button when input loses focus
        document.addEventListener('focusout', (e) => {
            // Small delay to allow clicking the done button
            setTimeout(() => {
                const active = document.activeElement;
                if (active?.tagName !== 'INPUT' && active?.tagName !== 'TEXTAREA') {
                    doneBtn.style.display = 'none';
                }
            }, 150);
        });

        // Handle Android keyboard visibility via visualViewport API
        if (window.visualViewport) {
            window.visualViewport.addEventListener('resize', () => {
                const keyboardVisible = window.visualViewport.height < window.innerHeight * 0.75;
                if (!keyboardVisible) {
                    doneBtn.style.display = 'none';
                }
            });
        }
    }

    // Modal state
    selectedLabels = new Set();

    // ==================== API Methods ====================

    async trelloFetch(endpoint, options = {}) {
        const url = new URL(`https://api.trello.com/1${endpoint}`);
        url.searchParams.append('key', this.apiKey);
        url.searchParams.append('token', this.apiToken);

        console.log(`🌐 Trello API: ${options.method || 'GET'} ${endpoint}`);

        try {
            const response = await fetch(url.toString(), {
                ...options,
                headers: {
                    'Content-Type': 'application/json',
                    ...options.headers
                }
            });

            console.log(`📡 Respuesta: ${response.status} ${response.statusText}`);

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`❌ Error de API:`, errorText);

                if (response.status === 401) {
                    this.logout();
                    throw new Error('Sesión expirada');
                }
                throw new Error(`Error ${response.status}: ${errorText}`);
            }

            const data = await response.json();
            console.log(`✅ Datos recibidos:`, data);
            return data;
        } catch (error) {
            console.error(`💥 Error en fetch:`, error);
            throw error;
        }
    }

    async getBoards() {
        return this.trelloFetch('/members/me/boards?fields=name,url,prefs');
    }

    async getBoard(boardId) {
        return this.trelloFetch(`/boards/${boardId}?fields=name,url,prefs`);
    }

    async getLists(boardId) {
        return this.trelloFetch(`/boards/${boardId}/lists?fields=name,pos`);
    }

    async getCards(boardId) {
        return this.trelloFetch(`/boards/${boardId}/cards?fields=name,idList,idLabels,pos,desc&attachments=true&attachment_fields=url,name,mimeType,previews`);
    }

    async getCardAttachments(cardId) {
        return this.trelloFetch(`/cards/${cardId}/attachments?fields=all`);
    }

    async getLabels(boardId) {
        return this.trelloFetch(`/boards/${boardId}/labels?fields=name,color`);
    }

    async createBoard(name) {
        return this.trelloFetch('/boards', {
            method: 'POST',
            body: JSON.stringify({
                name,
                defaultLists: false
            })
        });
    }

    async createList(boardId, name, pos) {
        return this.trelloFetch('/lists', {
            method: 'POST',
            body: JSON.stringify({
                name,
                idBoard: boardId,
                pos
            })
        });
    }

    async createLabel(boardId, name, color) {
        return this.trelloFetch('/labels', {
            method: 'POST',
            body: JSON.stringify({
                name,
                color,
                idBoard: boardId
            })
        });
    }

    async createCard(listId, name, labelIds = [], desc = '') {
        return this.trelloFetch('/cards', {
            method: 'POST',
            body: JSON.stringify({
                name,
                idList: listId,
                idLabels: labelIds,
                desc
            })
        });
    }

    async moveCard(cardId, listId) {
        return this.trelloFetch(`/cards/${cardId}`, {
            method: 'PUT',
            body: JSON.stringify({
                idList: listId
            })
        });
    }

    async updateCardLabels(cardId, labelIds) {
        return this.trelloFetch(`/cards/${cardId}/idLabels`, {
            method: 'PUT',
            body: JSON.stringify({
                value: labelIds.join(',')
            })
        });
    }

    async addAttachmentToCard(cardId, file) {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('key', this.apiKey);
        formData.append('token', this.apiToken);

        const response = await fetch(`https://api.trello.com/1/cards/${cardId}/attachments`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            throw new Error('Error subiendo imagen');
        }

        return response.json();
    }

    async setCoverImage(cardId, attachmentId) {
        return this.trelloFetch(`/cards/${cardId}`, {
            method: 'PUT',
            body: JSON.stringify({
                idAttachmentCover: attachmentId
            })
        });
    }

    // ==================== Authentication ====================

    async handleLogin() {
        console.log('🔐 handleLogin() llamado');

        const apiKey = document.getElementById('api-key').value.trim();
        const apiToken = document.getElementById('api-token').value.trim();

        console.log('📝 Credenciales:', {
            apiKeyLength: apiKey.length,
            tokenLength: apiToken.length
        });

        if (!apiKey || !apiToken) {
            this.showToast('Por favor introduce API Key y Token');
            return;
        }

        this.apiKey = apiKey;
        this.apiToken = apiToken;

        try {
            console.log('🧪 Probando credenciales...');
            // Test the credentials
            await this.getBoards();

            console.log('✅ Credenciales válidas, guardando...');
            // Save credentials
            localStorage.setItem('trello_api_key', apiKey);
            localStorage.setItem('trello_api_token', apiToken);

            await this.loadBoards();
        } catch (error) {
            console.error('❌ Error de autenticación:', error);
            this.showToast('Error de autenticación: ' + error.message);
        }
    }

    logout() {
        localStorage.removeItem('trello_api_key');
        localStorage.removeItem('trello_api_token');
        localStorage.removeItem('trello_board_id');
        location.reload();
    }

    // ==================== Board Management ====================

    async loadBoards() {
        this.showScreen('board-selector');
        const boardsList = document.getElementById('boards-list');
        boardsList.innerHTML = '<div class="loading"><div class="spinner"></div><p>Cargando tableros...</p></div>';

        try {
            const boards = await this.getBoards();

            if (boards.length === 0) {
                boardsList.innerHTML = `
                    <div class="empty-state">
                        <div class="icon">📋</div>
                        <p>No tienes tableros</p>
                        <button class="login-btn" onclick="app.createNewBoard()">Crear Tablero</button>
                    </div>
                `;
                return;
            }

            boardsList.innerHTML = boards.map(board => `
                <div class="board-option" data-board-id="${board.id}">
                    <div class="board-color" style="background: ${board.prefs?.backgroundColor || '#0079BF'}"></div>
                    <div class="board-name">${board.name}</div>
                </div>
            `).join('');

            boardsList.querySelectorAll('.board-option').forEach(option => {
                option.addEventListener('click', () => this.selectBoard(option.dataset.boardId));
            });

        } catch (error) {
            boardsList.innerHTML = `<div class="empty-state"><p>Error: ${error.message}</p></div>`;
        }
    }

    async selectBoard(boardId) {
        this.selectedBoardId = boardId;
        localStorage.setItem('trello_board_id', boardId);
        await this.loadBoard();
    }

    async loadBoard() {
        this.showScreen('main-app');

        try {
            // Load board data
            const [board, lists, cards, labels] = await Promise.all([
                this.getBoard(this.selectedBoardId),
                this.getLists(this.selectedBoardId),
                this.getCards(this.selectedBoardId),
                this.getLabels(this.selectedBoardId)
            ]);

            this.board = board;
            this.lists = lists;
            this.cards = cards;
            this.labels = labels;

            // Find or create the required lists
            this.allProductsList = lists.find(l => l.name === this.config.listNames.allProducts);
            this.activeList = lists.find(l => l.name === this.config.listNames.activeList);

            if (!this.allProductsList || !this.activeList) {
                await this.setupBoardStructure();
            }

            this.showStoreCards();

        } catch (error) {
            this.showToast('Error cargando tablero: ' + error.message);
        }
    }

    async setupBoardStructure() {
        // Create required lists if they don't exist
        if (!this.allProductsList) {
            this.allProductsList = await this.createList(this.selectedBoardId, this.config.listNames.allProducts, 1);
            this.lists.push(this.allProductsList);
        }

        if (!this.activeList) {
            this.activeList = await this.createList(this.selectedBoardId, this.config.listNames.activeList, 2);
            this.lists.push(this.activeList);
        }

        // Create default location labels if none exist
        const locationLabels = this.labels.filter(l => ['green', 'blue', 'purple', 'sky', 'lime', 'pink'].includes(l.color));

        if (locationLabels.length === 0) {
            for (const loc of this.config.locations) {
                const label = await this.createLabel(this.selectedBoardId, loc.name, loc.color);
                this.labels.push(label);
            }
        }

        // Create default store labels if none exist
        const storeLabels = this.labels.filter(l => ['orange', 'red', 'yellow', 'black'].includes(l.color));

        if (storeLabels.length === 0) {
            for (const store of this.config.stores) {
                const label = await this.createLabel(this.selectedBoardId, store.name, store.color);
                this.labels.push(label);
            }
        }
    }

    async createNewBoard() {
        const name = prompt('Nombre del tablero:', 'Lista de Compras');
        if (!name) return;

        try {
            const board = await this.createBoard(name);
            await this.selectBoard(board.id);
        } catch (error) {
            this.showToast('Error creando tablero: ' + error.message);
        }
    }

    // ==================== Rendering ====================

    showScreen(screenId) {
        ['login-screen', 'board-selector', 'main-app'].forEach(id => {
            document.getElementById(id).classList.toggle('hidden', id !== screenId);
        });
    }

    showStoreCards() {
        this.currentView = 'stores';
        this.searchQuery = '';
        
        document.getElementById('store-cards-view').classList.remove('hidden');
        document.getElementById('store-detail-view').classList.add('hidden');
        document.getElementById('shopping-mode-view').classList.add('hidden');
        
        // Scroll to top when returning to main view
        window.scrollTo(0, 0);
        
        this.renderStoreCards();
    }

    showStoreDetail(storeLabel) {
        this.currentView = 'detail';
        this.currentStore = storeLabel;
        this.searchQuery = '';

        document.getElementById('store-cards-view').classList.add('hidden');
        document.getElementById('shopping-mode-view').classList.add('hidden');
        document.getElementById('store-detail-view').classList.remove('hidden');

        document.getElementById('store-detail-title').textContent = storeLabel.name;

        this.renderStoreDetail(storeLabel);
    }

    renderStoreCards() {
        const container = document.getElementById('store-cards-container');
        
        if (!this.activeList) {
            container.innerHTML = '<div class="loading"><div class="spinner"></div><p>Configurando listas...</p></div>';
            return;
        }

        // Get store labels
        const storeNames = this.getStoreNames();
        const storeLabels = this.labels.filter(l => storeNames.includes(l.name));

        if (storeLabels.length === 0) {
            container.innerHTML = '<div class="empty-state"><p>No hay tiendas configuradas</p></div>';
            return;
        }

        // Count products per store in active list and total
        const storeCounts = {};
        const storeTotals = {};
        storeLabels.forEach(label => {
            // Count active products (in Lista Activa)
            const activeCount = this.cards.filter(c => 
                c.idList === this.activeList.id && 
                c.idLabels.includes(label.id)
            ).length;
            
            // Count total products (in any list with this store label)
            const totalCount = this.cards.filter(c => 
                c.idLabels.includes(label.id)
            ).length;
            
            storeCounts[label.id] = activeCount;
            storeTotals[label.id] = totalCount;
        });

        // Sort stores by active products count (descending)
        const sortedStoreLabels = [...storeLabels].sort((a, b) => {
            return storeCounts[b.id] - storeCounts[a.id];
        });

        let html = sortedStoreLabels.map(label => {
            const activeCount = storeCounts[label.id];
            const totalCount = storeTotals[label.id];
            const icon = this.getStoreIcon(label.name);
            const countText = totalCount === 1 ? `${activeCount}/1 producto` : `${activeCount}/${totalCount} productos`;

            return `
                <div class="store-card" data-store-id="${label.id}" style="border-left: 4px solid #${label.color};">
                    <div class="store-card-content">
                        <div class="store-card-name">${label.name}</div>
                        <div class="store-card-count">${countText}</div>
                    </div>
                    <div class="store-card-icon">${icon}</div>
                </div>
            `;
        }).join('');

        container.innerHTML = html;

        // Add click handlers
        container.querySelectorAll('.store-card').forEach(card => {
            card.addEventListener('click', () => {
                const storeId = card.dataset.storeId;
                const storeLabel = storeLabels.find(l => l.id === storeId);
                if (storeLabel) {
                    this.showStoreDetail(storeLabel);
                }
            });
        });
    }

    renderStoreDetail(storeLabel) {
        const container = document.getElementById('products-container');
        
        if (!this.activeList || !this.allProductsList) {
            container.innerHTML = '<div class="loading"><div class="spinner"></div><p>Cargando productos...</p></div>';
            return;
        }

        // Get all cards for this store (both active and available)
        const allStoreCards = this.cards.filter(c => c.idLabels.includes(storeLabel.id));
        
        // Group into active and available (active list is never filtered)
        const activeCards = allStoreCards.filter(c => c.idList === this.activeList.id);
        
        // Filter available cards by search query (prefix match, accent-insensitive)
        let availableCards = allStoreCards.filter(c => c.idList === this.allProductsList.id);
        if (this.searchQuery) {
            const query = this.normalizeString(this.searchQuery.trim());
            availableCards = availableCards.filter(c => {
                const name = this.normalizeString(c.name);
                // Match if any word in the product name starts with the query
                const words = name.split(/\s+/);
                return words.some(word => word.startsWith(query));
            });
        }

        if (activeCards.length === 0 && availableCards.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="icon">🔍</div>
                    <p>${this.searchQuery ? 'No se encontraron productos' : 'No hay productos para esta tienda'}</p>
                </div>
            `;
            return;
        }

        let html = '';

        // Active products section (always show, even if empty)
        html += `
            <div class="products-section">
                <div class="products-section-title">En lista (${activeCards.length})</div>
                ${activeCards.length > 0 ? activeCards.map(card => this.renderDetailProduct(card, true)).join('') : ''}
            </div>
        `;

        // Search input between "En lista" and available products
        html += `
            <div class="search-container-inline">
                <input type="text" class="search-input" id="product-search-inline" placeholder="Buscar producto..." value="${this.searchQuery || ''}">
                <button type="button" class="search-clear-btn ${this.searchQuery ? 'visible' : ''}" id="search-clear-btn" aria-label="Limpiar búsqueda"></button>
            </div>
        `;

        // Available products section - ordered as STACK (most recently removed first)
        if (availableCards.length > 0) {
            // Sort available cards: most recently added to recentProducts appears first
            const sortedAvailableCards = [...availableCards].sort((a, b) => {
                const aIndex = this.recentProducts.findIndex(item => item.cardId === a.id);
                const bIndex = this.recentProducts.findIndex(item => item.cardId === b.id);

                // If both are in recent, sort by index (lower index = more recent)
                if (aIndex !== -1 && bIndex !== -1) {
                    return aIndex - bIndex;
                }
                // If only a is in recent, it goes first
                if (aIndex !== -1) return -1;
                // If only b is in recent, it goes first
                if (bIndex !== -1) return 1;
                // Neither in recent, maintain original order
                return 0;
            });

            html += `
                <div class="products-section">
                    <div class="products-section-title">Disponibles (${sortedAvailableCards.length})</div>
                    ${sortedAvailableCards.map(card => this.renderDetailProduct(card, false)).join('')}
                </div>
            `;
        } else if (this.searchQuery) {
            html += `
                <div class="empty-state" style="padding: 40px 20px;">
                    <p style="color: var(--text-muted);">No se encontraron productos</p>
                </div>
            `;
        }

        container.innerHTML = html;

        // Bind search input event
        const searchInput = document.getElementById('product-search-inline');
        const clearBtn = document.getElementById('search-clear-btn');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                const value = e.target.value;
                clearTimeout(this.searchTimeout);
                this.searchQuery = value;
                // Toggle clear button visibility
                if (clearBtn) {
                    clearBtn.classList.toggle('visible', value.length > 0);
                }
                this.searchTimeout = setTimeout(() => {
                    this.renderStoreDetail(this.currentStore);
                    // Re-focus and set cursor position
                    const newInput = document.getElementById('product-search-inline');
                    if (newInput) {
                        newInput.focus();
                        newInput.setSelectionRange(value.length, value.length);
                    }
                }, 300);
            });
        }

        // Bind clear button event
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                this.searchQuery = '';
                this.renderStoreDetail(this.currentStore);
                const newInput = document.getElementById('product-search-inline');
                if (newInput) {
                    newInput.focus();
                }
            });
        }

        // Add click handlers for products (check if click is on info button)
        container.querySelectorAll('.detail-product').forEach(productDiv => {
            productDiv.addEventListener('click', (e) => {
                // Don't toggle if clicking on info button
                if (e.target.closest('.product-info-btn')) {
                    return;
                }
                const cardId = productDiv.dataset.cardId;
                this.toggleProduct(cardId);
            });
        });

        // Add info button handlers
        container.querySelectorAll('.product-info-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const cardId = btn.dataset.cardId;
                this.showProductDetail(cardId);
            });
        });

        // Load thumbnails asynchronously to avoid ORB blocking
        this.loadProductThumbnails();
    }

    getRecentStoreProducts(storeId, availableCards) {
        // Get recent products that belong to this store and are available (not in active list)
        const recentIds = this.recentProducts.map(item => item.cardId);
        const recentStoreCards = [];
        
        for (const item of this.recentProducts) {
            const card = availableCards.find(c => c.id === item.cardId && c.idLabels.includes(storeId));
            if (card) {
                recentStoreCards.push(card);
            }
            // Limit to 5 recent products
            if (recentStoreCards.length >= 5) break;
        }
        
        return recentStoreCards;
    }

    renderDetailProduct(card, isActive) {
        const descText = card.desc ? card.desc.substring(0, 60) + (card.desc.length > 60 ? '...' : '') : '';

        // Check if card has image attachment
        const imageAttachment = card.attachments?.find(a => a.mimeType?.startsWith('image/'));

        // Only show icon if there's an image
        let iconHtml = '';
        if (imageAttachment) {
            iconHtml = `<div class="detail-product-icon has-image"><img data-thumb-card-id="${card.id}" alt="${card.name}" loading="lazy"></div>`;
        }

        const infoButton = `<button class="product-info-btn" data-card-id="${card.id}">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="20" height="20">
                  <circle cx="50" cy="50" r="42" fill="none" stroke="currentColor" stroke-width="12"/>
                  <circle cx="50" cy="28" r="7" fill="currentColor"/>
                  <rect x="44" y="42" width="12" height="35" rx="2" fill="currentColor"/>
                </svg>
              </button>`;

        return `
            <div class="detail-product ${isActive ? 'checked' : ''}" data-card-id="${card.id}">
                <div class="detail-product-checkbox"></div>
                ${iconHtml}
                <div class="detail-product-info">
                    <div class="detail-product-name">${card.name}</div>
                    ${descText ? `<div class="detail-product-desc">${descText}</div>` : ''}
                </div>
                ${infoButton}
            </div>
        `;
    }

    // Load thumbnails for product list after rendering
    loadProductThumbnails() {
        const thumbImages = document.querySelectorAll('img[data-thumb-card-id]');
        thumbImages.forEach(async (imgElement) => {
            const cardId = imgElement.dataset.thumbCardId;
            const card = this.cards.find(c => c.id === cardId);
            if (!card) return;

            const imageAttachment = card.attachments?.find(a => a.mimeType?.startsWith('image/'));
            if (!imageAttachment) return;

            const url = this.getAttachmentUrl(imageAttachment);
            if (url) {
                await this.loadImageWithOAuth(imgElement, url);
            } else {
                imgElement.style.display = 'none';
            }
        });
    }

    // Get the best URL from an attachment and add auth credentials
    getAttachmentUrl(attachment) {
        if (!attachment) return null;

        let url = null;

        // Prefer previews (they're optimized for display)
        if (attachment.previews && attachment.previews.length > 0) {
            const preview = attachment.previews.find(p => p.width >= 300 && p.width <= 600)
                         || attachment.previews[attachment.previews.length - 1];
            if (preview?.url) {
                url = preview.url;
            }
        }

        // Fallback to main URL
        if (!url && attachment.url) {
            url = attachment.url;
        }

        if (!url) return null;

        // Add auth credentials if not present
        if (!url.includes('token=')) {
            const separator = url.includes('?') ? '&' : '?';
            url = `${url}${separator}key=${this.apiKey}&token=${this.apiToken}`;
        }

        return url;
    }

    // Fetch image using your Cloudflare Worker proxy
    async fetchImageWithOAuth(url) {
        if (!url) return null;

        // Check cache first
        if (this.imageCache.has(url)) {
            return this.imageCache.get(url);
        }

        // Check if worker URL is configured
        if (this.workerUrl.includes('YOUR_USERNAME')) {
            console.warn('⚠️ Cloudflare Worker not configured. Images will not load.');
            console.warn('📖 See CLOUDFLARE_SETUP.md for instructions');
            return null;
        }

        try {
            // Debug: check if URL has credentials
            console.log('📷 Fetching:', url.substring(0, 100), '...has token:', url.includes('token='));
            
            // Use your Cloudflare Worker as proxy
            const proxyUrl = `${this.workerUrl}?url=${encodeURIComponent(url)}`;
            
            const response = await fetch(proxyUrl, {
                method: 'GET',
                headers: {
                    'Accept': 'image/*'
                }
            });
            
            if (response.ok) {
                const blob = await response.blob();
                
                if (blob.size > 0) {
                    const blobUrl = URL.createObjectURL(blob);
                    this.imageCache.set(url, blobUrl);
                    console.log('✅ Image loaded via worker');
                    return blobUrl;
                }
            } else {
                console.error('❌ Worker returned error:', response.status);
                const errorText = await response.text();
                console.error('Error details:', errorText);
            }
        } catch (error) {
            console.error('💥 Worker error:', error.message);
        }

        return null;
    }

    // Load image into an img element using OAuth
    async loadImageWithOAuth(imgElement, url) {
        if (!imgElement || !url) return;

        const blobUrl = await this.fetchImageWithOAuth(url);
        if (blobUrl) {
            imgElement.src = blobUrl;
        } else {
            imgElement.style.display = 'none';
        }
    }

    async showProductDetail(cardId) {
        const card = this.cards.find(c => c.id === cardId);
        if (!card) return;

        this.currentEditingCard = card;

        const modal = document.getElementById('product-detail-modal');
        const content = document.getElementById('product-detail-content');

        modal.classList.remove('hidden');
        content.innerHTML = '<div class="loading"><div class="spinner"></div><p>Cargando...</p></div>';

        try {
            // Fetch all attachments for this card
            const attachments = await this.getCardAttachments(cardId);
            const images = attachments.filter(a => a.mimeType?.startsWith('image/'));
            this.currentCardImages = images;

            const locationLabels = this.labels.filter(l =>
                card.idLabels.includes(l.id) &&
                !['Mercadona', 'Fruteria', 'Farmacia', 'Carniceria', 'Caprabo'].includes(l.name)
            );
            const storeLabels = this.labels.filter(l =>
                card.idLabels.includes(l.id) &&
                ['Mercadona', 'Fruteria', 'Farmacia', 'Carniceria', 'Caprabo'].includes(l.name)
            );

            let imagesHtml = '';
            if (images.length > 0) {
                imagesHtml = `
                    <div class="product-detail-images">
                        ${images.map((img, index) => `
                            <div class="product-detail-image">
                                <img data-image-index="${index}" alt="${card.name}" loading="lazy">
                                <div class="image-loading-spinner"></div>
                            </div>
                        `).join('')}
                    </div>
                `;
            }

            content.innerHTML = `
                <div class="product-detail-header">
                    <h3>${card.name}</h3>
                    <button class="modal-close" onclick="app.closeProductDetail()">&times;</button>
                </div>
                ${imagesHtml}
                <div class="product-detail-info">
                    ${locationLabels.length > 0 ? `
                        <div class="product-detail-section">
                            <span class="product-detail-label">📍 Ubicación</span>
                            <div class="product-detail-tags">
                                ${locationLabels.map(l => `<span class="product-tag" style="background: ${this.getLabelColorHex(l.color)}">${l.name}</span>`).join('')}
                            </div>
                        </div>
                    ` : ''}
                    ${storeLabels.length > 0 ? `
                        <div class="product-detail-section">
                            <span class="product-detail-label">🏪 Tiendas</span>
                            <div class="product-detail-tags">
                                ${storeLabels.map(l => `<span class="product-tag" style="background: ${this.getLabelColorHex(l.color)}">${l.name}</span>`).join('')}
                            </div>
                        </div>
                    ` : ''}
                    <div class="product-detail-section">
                        <span class="product-detail-label">📝 Notas</span>
                        ${card.desc ? `<p class="product-detail-desc">${card.desc}</p>` : '<p class="product-detail-desc empty">Sin notas</p>'}
                    </div>
                </div>
                <div class="product-detail-actions">
                    <button class="edit-product-btn" onclick="app.openEditMode('${cardId}')">✏️ Editar</button>
                    <button class="delete-product-btn" onclick="app.confirmDeleteProduct('${cardId}')">🗑️ Eliminar</button>
                </div>
            `;

            // Load images with OAuth after HTML is rendered
            this.loadDetailImages(images);
        } catch (error) {
            content.innerHTML = `<div class="empty-state"><p>Error: ${error.message}</p></div>`;
        }
    }

    // Load detail images using OAuth
    async loadDetailImages(images) {
        for (let i = 0; i < images.length; i++) {
            const imgElement = document.querySelector(`img[data-image-index="${i}"]`);
            if (!imgElement) continue;

            const url = this.getAttachmentUrl(images[i]);
            if (url) {
                const blobUrl = await this.fetchImageWithOAuth(url);
                if (blobUrl) {
                    imgElement.src = blobUrl;
                    imgElement.parentElement?.querySelector('.image-loading-spinner')?.remove();
                } else {
                    imgElement.parentElement.style.display = 'none';
                }
            } else {
                imgElement.parentElement.style.display = 'none';
            }
        }
    }

    openEditMode(cardId) {
        const card = this.cards.find(c => c.id === cardId);
        if (!card) return;

        // Store selected labels for editing
        this.editSelectedLabels = new Set(card.idLabels);

        const content = document.getElementById('product-detail-content');
        const images = this.currentCardImages || [];

        let imagesEditHtml = '';
        if (images.length > 0) {
            imagesEditHtml = `
                <div class="product-edit-images">
                    ${images.map((img, index) => `
                        <div class="product-edit-image" data-attachment-id="${img.id}">
                            <img data-edit-image-index="${index}" alt="${card.name}">
                            <button class="image-delete-btn" onclick="app.deleteAttachment('${cardId}', '${img.id}')">&times;</button>
                        </div>
                    `).join('')}
                </div>
            `;
        }

        content.innerHTML = `
            <div class="product-detail-header">
                <h3>Editar producto</h3>
                <button class="modal-close" onclick="app.closeProductDetail()">&times;</button>
            </div>
            <div class="product-edit-form">
                <div class="modal-section">
                    <div class="modal-section-title">Nombre</div>
                    <input type="text" id="edit-product-name" class="modal-input" value="${card.name}" placeholder="Nombre del producto">
                </div>
                <div class="modal-section">
                    <div class="modal-section-title">Fotos</div>
                    ${imagesEditHtml}
                    <div class="image-upload-area edit-mode" id="edit-image-upload-area">
                        <input type="file" id="edit-product-image" accept="image/*" hidden>
                        <div class="image-upload-placeholder">
                            <span class="image-upload-icon">➕</span>
                            <span class="image-upload-text">Añadir foto</span>
                        </div>
                    </div>
                </div>
                <div class="modal-section">
                    <div class="modal-section-title">Ubicación</div>
                    <div class="label-picker" id="edit-location-picker"></div>
                </div>
                <div class="modal-section">
                    <div class="modal-section-title">Tiendas</div>
                    <div class="label-picker" id="edit-store-picker"></div>
                </div>
                <div class="modal-section">
                    <div class="modal-section-title">Notas</div>
                    <textarea id="edit-product-desc" class="modal-input modal-textarea" placeholder="Añade notas sobre el producto...">${card.desc || ''}</textarea>
                </div>
                <div class="product-edit-actions">
                    <button class="modal-btn secondary" onclick="app.showProductDetail('${cardId}')">Cancelar</button>
                    <button class="modal-btn" id="save-edit-btn" onclick="app.saveProductEdit('${cardId}')">Guardar</button>
                </div>
            </div>
        `;

        // Load images with OAuth
        this.loadEditImages(images);

        // Setup image upload for edit mode
        this.setupEditImageUpload(cardId);

        // Render label pickers for edit mode
        this.renderEditLabelPickers(card);
    }

    renderEditLabelPickers(card) {
        const locationPicker = document.getElementById('edit-location-picker');
        const storePicker = document.getElementById('edit-store-picker');

        const storeNames = this.getStoreNames();
        const storeLabels = this.labels.filter(l => storeNames.includes(l.name));
        const locationLabels = this.labels.filter(l => !storeNames.includes(l.name));

        locationPicker.innerHTML = locationLabels.map(label => {
            const isSelected = card.idLabels.includes(label.id);
            return `
                <label class="label-option label-${label.color} ${isSelected ? 'selected' : ''}">
                    <input type="checkbox" class="edit-label-checkbox" value="${label.id}" ${isSelected ? 'checked' : ''}>
                    <span>${label.name}</span>
                </label>
            `;
        }).join('');

        storePicker.innerHTML = storeLabels.map(label => {
            const isSelected = card.idLabels.includes(label.id);
            return `
                <label class="label-option label-${label.color} ${isSelected ? 'selected' : ''}">
                    <input type="checkbox" class="edit-label-checkbox" value="${label.id}" ${isSelected ? 'checked' : ''}>
                    <span>${label.name}</span>
                </label>
            `;
        }).join('');

        // Add change listeners
        document.querySelectorAll('.edit-label-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    this.editSelectedLabels.add(e.target.value);
                    e.target.closest('.label-option').classList.add('selected');
                } else {
                    this.editSelectedLabels.delete(e.target.value);
                    e.target.closest('.label-option').classList.remove('selected');
                }
            });
        });
    }

    // Load edit mode images using OAuth
    async loadEditImages(images) {
        for (let i = 0; i < images.length; i++) {
            const imgElement = document.querySelector(`img[data-edit-image-index="${i}"]`);
            if (!imgElement) continue;

            const url = this.getAttachmentUrl(images[i]);
            if (url) {
                const blobUrl = await this.fetchImageWithOAuth(url);
                if (blobUrl) {
                    imgElement.src = blobUrl;
                } else {
                    imgElement.parentElement.style.display = 'none';
                }
            } else {
                imgElement.parentElement.style.display = 'none';
            }
        }
    }

    setupEditImageUpload(cardId) {
        const uploadArea = document.getElementById('edit-image-upload-area');
        const imageInput = document.getElementById('edit-product-image');

        uploadArea.onclick = () => imageInput.click();

        imageInput.onchange = async (e) => {
            const file = e.target.files[0];
            if (file) {
                try {
                    uploadArea.innerHTML = '<div class="image-upload-placeholder"><span class="image-upload-icon">⏳</span><span class="image-upload-text">Subiendo...</span></div>';
                    await this.addAttachmentToCard(cardId, file);

                    // Reload card with new attachments
                    const updatedCard = await this.trelloFetch(`/cards/${cardId}?fields=name,idList,idLabels,pos,desc&attachments=true&attachment_fields=url,name,mimeType`);
                    const cardIndex = this.cards.findIndex(c => c.id === cardId);
                    if (cardIndex !== -1) {
                        this.cards[cardIndex] = updatedCard;
                    }

                    this.showToast('Imagen añadida');
                    this.openEditMode(cardId);
                } catch (error) {
                    this.showToast('Error subiendo imagen: ' + error.message);
                    uploadArea.innerHTML = '<div class="image-upload-placeholder"><span class="image-upload-icon">➕</span><span class="image-upload-text">Añadir foto</span></div>';
                }
            }
        };
    }

    async deleteAttachment(cardId, attachmentId) {
        if (!confirm('¿Eliminar esta imagen?')) return;

        try {
            await this.trelloFetch(`/cards/${cardId}/attachments/${attachmentId}`, { method: 'DELETE' });

            // Reload card
            const updatedCard = await this.trelloFetch(`/cards/${cardId}?fields=name,idList,idLabels,pos,desc&attachments=true&attachment_fields=url,name,mimeType`);
            const cardIndex = this.cards.findIndex(c => c.id === cardId);
            if (cardIndex !== -1) {
                this.cards[cardIndex] = updatedCard;
            }

            this.showToast('Imagen eliminada');
            this.openEditMode(cardId);
        } catch (error) {
            this.showToast('Error: ' + error.message);
        }
    }



    async saveProductEdit(cardId) {
        const nameInput = document.getElementById('edit-product-name').value.trim();
        const descInput = document.getElementById('edit-product-desc').value.trim();
        const btn = document.getElementById('save-edit-btn');
        const newLabels = Array.from(this.editSelectedLabels);

        if (!nameInput) {
            this.showToast('El nombre no puede estar vacío');
            return;
        }

        btn.disabled = true;
        btn.textContent = 'Guardando...';

        try {
            // Update name, description and labels
            await this.trelloFetch(`/cards/${cardId}`, {
                method: 'PUT',
                body: JSON.stringify({
                    name: nameInput,
                    desc: descInput,
                    idLabels: newLabels
                })
            });

            // Update local card
            const card = this.cards.find(c => c.id === cardId);
            if (card) {
                card.name = nameInput;
                card.desc = descInput;
                card.idLabels = newLabels;
            }

            this.showToast('Guardado');
            this.showProductDetail(cardId);

            // Re-render current view to update
            if (this.currentView === 'detail') {
                this.renderStoreDetail(this.currentStore);
            } else if (this.currentView === 'stores') {
                this.renderStoreCards();
            }
        } catch (error) {
            this.showToast('Error: ' + error.message);
        } finally {
            btn.disabled = false;
            btn.textContent = 'Guardar';
        }
    }

    closeProductDetail() {
        document.getElementById('product-detail-modal').classList.add('hidden');
    }

    async toggleProduct(cardId) {
        const card = this.cards.find(c => c.id === cardId);
        if (!card) return;

        const targetListId = card.idList === this.activeList.id
            ? this.allProductsList.id
            : this.activeList.id;

        // Optimistic update - update UI immediately
        const previousListId = card.idList;
        const wasActive = previousListId === this.activeList.id;
        card.idList = targetListId;

        // If removing from active list, add to recent products so it appears first
        if (wasActive) {
            this.addToRecentProducts(cardId);
        }

        // Use requestAnimationFrame for smoother rendering
        requestAnimationFrame(() => {
            this.renderStoreDetail(this.currentStore);
        });

        try {
            await this.moveCard(cardId, targetListId);
        } catch (error) {
            // Rollback on error
            card.idList = previousListId;
            requestAnimationFrame(() => {
                this.renderStoreDetail(this.currentStore);
            });
            this.showToast('Error: ' + error.message);
        }
    }

    refresh() {
        if (this.currentView === 'stores') {
            this.loadBoard();
        } else if (this.currentView === 'detail') {
            this.loadBoard().then(() => {
                if (this.currentStore) {
                    const storeLabel = this.labels.find(l => l.id === this.currentStore.id);
                    if (storeLabel) {
                        this.showStoreDetail(storeLabel);
                    }
                }
            });
        } else if (this.currentView === 'shopping') {
            this.loadBoard().then(() => {
                this.showShoppingMode();
            });
        }
    }

    showShoppingMode() {
        this.currentView = 'shopping';
        this.selectedStore = null;
        
        document.getElementById('store-cards-view').classList.add('hidden');
        document.getElementById('store-detail-view').classList.add('hidden');
        document.getElementById('shopping-mode-view').classList.remove('hidden');
        
        this.renderShoppingMode();
    }

    renderShoppingMode() {
        const container = document.getElementById('shopping-mode-container');

        // If no store selected, show store selector
        if (!this.selectedStore) {
            this.renderStoreSelector(container);
            return;
        }

        // Store is selected, show shopping view
        this.renderShoppingView(container);
    }

    renderStoreSelector(container) {
        const storeNames = this.getStoreNames();
        const storeLabels = this.labels.filter(l => storeNames.includes(l.name));

        let html = `
            <div class="shopping-selector-view">
                <div class="shopping-selector-header">
                    <button class="back-button" id="back-from-shopping">← Listas</button>
                    <h2>Ir de Compras</h2>
                </div>
                <div class="shopping-selector-content">
                    <div class="shopping-selector-title">
                        <span class="shopping-selector-icon">🛒</span>
                        <h3>¿Dónde vas a comprar?</h3>
                    </div>
                    <div class="shopping-store-grid">
        `;

        storeLabels.forEach(store => {
            const icon = this.getStoreIcon(store.name);
            html += `
                <button class="shopping-store-card" data-store-id="${store.id}">
                    <div class="shopping-store-icon" style="background: ${this.getLabelColorHex(store.color)}20; color: ${this.getLabelColorHex(store.color)}">
                        ${icon}
                    </div>
                    <span class="shopping-store-name">${store.name}</span>
                </button>
            `;
        });

        html += `
                    </div>
                </div>
            </div>
        `;

        container.innerHTML = html;

        // Bind click events
        document.getElementById('back-from-shopping')?.addEventListener('click', () => {
            this.showStoreCards();
        });

        container.querySelectorAll('.shopping-store-card').forEach(btn => {
            btn.addEventListener('click', () => {
                const storeId = btn.dataset.storeId;
                this.selectedStore = this.labels.find(l => l.id === storeId);
                this.renderShoppingMode();
            });
        });
    }

    renderShoppingView(container) {
        // Get all products for this store
        const storeProducts = this.cards.filter(c => c.idLabels.includes(this.selectedStore.id));
        const activeStoreProducts = storeProducts.filter(c => c.idList === this.activeList?.id);

        // Get location labels (excluding store names), sorted alphabetically
        const storeNames = this.getStoreNames();
        const locationLabels = this.labels
            .filter(l => !storeNames.includes(l.name))
            .sort((a, b) => a.name.localeCompare(b.name, 'es'));

        const storeIcon = this.getStoreIcon(this.selectedStore.name);

        let html = `
            <div class="shopping-view">
                <div class="shopping-header">
                    <button class="back-button" id="back-to-shopping-stores">← Cambiar tienda</button>
                    <div class="shopping-title">
                        <span>${storeIcon}</span>
                        <strong>${this.selectedStore.name}</strong>
                    </div>
                </div>

                <div class="shopping-active-list">
                    <h3>📋 En tu lista (${activeStoreProducts.length})</h3>
        `;

        if (activeStoreProducts.length > 0) {
            html += '<div class="shopping-products">';
            activeStoreProducts.forEach(card => {
                html += this.renderShoppingProduct(card, true);
            });
            html += '</div>';
        } else {
            html += '<p class="empty-message">No hay productos de esta tienda en tu lista</p>';
        }

        html += '</div>';

        // Group all store products by location
        html += '<div class="shopping-locations"><h3>🏠 Revisar por ubicación</h3>';

        locationLabels.forEach(location => {
            const locationProducts = storeProducts.filter(c => c.idLabels.includes(location.id));
            
            if (locationProducts.length > 0) {
                const inList = locationProducts.filter(c => c.idList === this.activeList?.id).length;
                
                html += `
                    <div class="location-section">
                        <div class="location-header" style="background: ${this.getLabelColorHex(location.color)}">
                            ${location.name}
                            <span class="count">${inList}/${locationProducts.length}</span>
                        </div>
                        <div class="shopping-products">
                            ${locationProducts.map(card => this.renderShoppingProduct(card, card.idList === this.activeList?.id)).join('')}
                        </div>
                    </div>
                `;
            }
        });

        html += '</div></div>';

        container.innerHTML = html;

        // Bind events
        document.getElementById('back-to-shopping-stores')?.addEventListener('click', () => {
            this.selectedStore = null;
            window.scrollTo(0, 0);
            this.renderShoppingMode();
        });

        container.querySelectorAll('.shopping-product').forEach(productEl => {
            productEl.addEventListener('click', () => this.toggleCardActive(productEl.dataset.cardId));
        });
    }

    renderShoppingProduct(card, isInList) {
        return `
            <div class="shopping-product ${isInList ? 'in-list' : ''}" data-card-id="${card.id}">
                <div class="product-checkbox ${isInList ? 'checked' : ''}"></div>
                <div class="product-name">${card.name}</div>
            </div>
        `;
    }

    // ==================== Actions ====================

    async toggleCardActive(cardId) {
        const card = this.cards.find(c => c.id === cardId);
        if (!card) return;

        const isCurrentlyActive = card.idList === this.activeList?.id;
        const targetList = isCurrentlyActive ? this.allProductsList : this.activeList;

        // Optimistic update - update UI immediately
        const previousListId = card.idList;
        card.idList = targetList.id;

        // Re-render immediately with requestAnimationFrame
        requestAnimationFrame(() => {
            if (this.currentView === 'stores') {
                this.renderStoreCards();
            } else if (this.currentView === 'detail') {
                this.renderStoreDetail(this.currentStore);
            } else if (this.currentView === 'shopping') {
                this.renderShoppingView(document.getElementById('shopping-mode-container'));
            }
        });

        try {
            await this.moveCard(cardId, targetList.id);
        } catch (error) {
            // Rollback on error
            card.idList = previousListId;
            requestAnimationFrame(() => {
                if (this.currentView === 'stores') {
                    this.renderStoreCards();
                } else if (this.currentView === 'detail') {
                    this.renderStoreDetail(this.currentStore);
                } else if (this.currentView === 'shopping') {
                    this.renderShoppingView(document.getElementById('shopping-mode-container'));
                }
            });
            this.showToast('Error: ' + error.message);
            return;
        }

        const action = isCurrentlyActive ? 'quitado de' : 'añadido a';
        
        // Track when marking as purchased (moving to allProductsList)
        if (isCurrentlyActive) {
            this.addToRecentProducts(cardId);
        }
        
        this.showToast(`${card.name} ${action} la lista`);
    }

    showSettings() {
        // Create settings modal dynamically
        const existingModal = document.getElementById('settings-modal');
        if (existingModal) existingModal.remove();

        const modal = document.createElement('div');
        modal.id = 'settings-modal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal">
                <div class="modal-header">
                    <h3 class="modal-title">Ajustes</h3>
                    <button class="modal-close" id="settings-close">×</button>
                </div>

                <div class="settings-options">
                    <button class="settings-option" id="settings-config-stores">
                        <span class="settings-option-icon">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="white" viewBox="0 0 16 16">
                                <path d="M2.97 1.35A1 1 0 0 1 3.73 1h8.54a1 1 0 0 1 .76.35l2.609 3.044A1.5 1.5 0 0 1 16 5.37v.255a2.375 2.375 0 0 1-4.25 1.458A2.371 2.371 0 0 1 9.875 8 2.37 2.37 0 0 1 8 7.083 2.37 2.37 0 0 1 6.125 8a2.37 2.37 0 0 1-1.875-.917A2.375 2.375 0 0 1 0 5.625V5.37a1.5 1.5 0 0 1 .361-.976l2.61-3.045zm1.78 4.275a1.375 1.375 0 0 0 2.75 0 .5.5 0 0 1 1 0 1.375 1.375 0 0 0 2.75 0 .5.5 0 0 1 1 0 1.375 1.375 0 1 0 2.75 0V5.37a.5.5 0 0 0-.12-.325L12.27 2H3.73L1.12 5.045A.5.5 0 0 0 1 5.37v.255a1.375 1.375 0 0 0 2.75 0 .5.5 0 0 1 1 0zM1.5 8.5A.5.5 0 0 1 2 9v6h1v-5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v5h6V9a.5.5 0 0 1 1 0v6h.5a.5.5 0 0 1 0 1H.5a.5.5 0 0 1 0-1H1V9a.5.5 0 0 1 .5-.5zM4 15h3v-5H4v5zm5-5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1v-3zm3 0h-2v3h2v-3z"/>
                            </svg>
                        </span>
                        <div class="settings-option-text">
                            <strong>Gestionar tiendas</strong>
                            <span>Añadir, editar o eliminar tiendas</span>
                        </div>
                    </button>

                    <button class="settings-option" id="settings-config-locations">
                        <span class="settings-option-icon">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="white" viewBox="0 0 16 16">
                                <path d="M8 16s6-5.686 6-10A6 6 0 0 0 2 6c0 4.314 6 10 6 10zm0-7a3 3 0 1 1 0-6 3 3 0 0 1 0 6z"/>
                            </svg>
                        </span>
                        <div class="settings-option-text">
                            <strong>Gestionar ubicaciones</strong>
                            <span>Añadir, editar o eliminar ubicaciones</span>
                        </div>
                    </button>

                    <button class="settings-option" id="settings-import-export">
                        <span class="settings-option-icon">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="white" viewBox="0 0 16 16">
                                <path d="M8.186 1.113a.5.5 0 0 0-.372 0L1.846 3.5 8 5.961 14.154 3.5 8.186 1.113zM15 4.239l-6.5 2.6v7.922l6.5-2.6V4.24zM7.5 14.762V6.838L1 4.239v7.923l6.5 2.6zM7.443.184a1.5 1.5 0 0 1 1.114 0l7.129 2.852A.5.5 0 0 1 16 3.5v8.662a1 1 0 0 1-.629.928l-7.185 2.874a.5.5 0 0 1-.372 0L.63 13.09a1 1 0 0 1-.630-.928V3.5a.5.5 0 0 1 .314-.464L7.443.184z"/>
                            </svg>
                        </span>
                        <div class="settings-option-text">
                            <strong>Importar / Exportar</strong>
                            <span>Importar o exportar productos en JSON</span>
                        </div>
                    </button>

                    <button class="settings-option danger" id="settings-logout">
                        <span class="settings-option-icon">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="white" viewBox="0 0 16 16">
                                <path fill-rule="evenodd" d="M10 12.5a.5.5 0 0 1-.5.5h-8a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5h8a.5.5 0 0 1 .5.5v2a.5.5 0 0 0 1 0v-2A1.5 1.5 0 0 0 9.5 2h-8A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h8a1.5 1.5 0 0 0 1.5-1.5v-2a.5.5 0 0 0-1 0v2z"/>
                                <path fill-rule="evenodd" d="M15.854 8.354a.5.5 0 0 0 0-.708l-3-3a.5.5 0 0 0-.708.708L14.293 7.5H5.5a.5.5 0 0 0 0 1h8.793l-2.147 2.146a.5.5 0 0 0 .708.708l3-3z"/>
                            </svg>
                        </span>
                        <div class="settings-option-text">
                            <strong>Cerrar sesión</strong>
                            <span>Desconectar de Trello</span>
                        </div>
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Bind events
        document.getElementById('settings-close').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        document.getElementById('settings-import-export').addEventListener('click', () => {
            modal.remove();
            this.showImportExportModal();
        });

        document.getElementById('settings-config-stores').addEventListener('click', () => {
            modal.remove();
            this.showConfigStoresModal();
        });

        document.getElementById('settings-config-locations').addEventListener('click', () => {
            modal.remove();
            this.showConfigLocationsModal();
        });

        document.getElementById('settings-logout').addEventListener('click', () => {
            modal.remove();
            this.logout();
        });
    }

    // ==================== Delete All Products ====================

    confirmDeleteAllProducts() {
        const modal = document.createElement('div');
        modal.id = 'delete-all-modal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal" style="max-width: 400px;">
                <div class="modal-header">
                    <h3 class="modal-title">⚠️ Confirmar borrado</h3>
                    <button class="modal-close" id="delete-all-close">×</button>
                </div>

                <div class="modal-section">
                    <p style="color: var(--text-secondary); font-size: 15px; line-height: 1.6; margin-bottom: 16px;">
                        ¿Estás seguro de que quieres <strong style="color: var(--danger);">borrar TODOS los productos</strong>?
                    </p>
                    <p style="color: var(--text-muted); font-size: 14px; line-height: 1.6; margin-bottom: 20px;">
                        Se eliminarán ${this.cards.length} productos del tablero.
                        <br><br>
                        <strong>Esta acción no se puede deshacer.</strong>
                    </p>

                    <div style="display: flex; gap: 12px; margin-top: 24px;">
                        <button class="btn btn-secondary" id="cancel-delete-all" style="flex: 1;">Cancelar</button>
                        <button class="btn btn-danger" id="confirm-delete-all" style="flex: 1;">Borrar todo</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        document.getElementById('delete-all-close').addEventListener('click', () => modal.remove());
        document.getElementById('cancel-delete-all').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        document.getElementById('confirm-delete-all').addEventListener('click', async () => {
            modal.remove();
            await this.deleteAllProducts();
        });
    }

    async deleteAllProducts() {
        try {
            this.showToast('Borrando productos...');

            let deleted = 0;
            let failed = 0;

            // Delete all cards
            for (const card of this.cards) {
                try {
                    await this.trelloFetch(`/cards/${card.id}`, {
                        method: 'DELETE'
                    });
                    deleted++;
                } catch (error) {
                    console.error(`Error borrando ${card.name}:`, error);
                    failed++;
                }
            }

            // Clear local cache
            this.cards = [];

            let message = `✅ ${deleted} productos eliminados`;
            if (failed > 0) {
                message += ` | ❌ ${failed} fallaron`;
            }

            this.showToast(message);

            // Refresh view
            if (this.currentView === 'stores') {
                this.renderStoreCards();
            } else if (this.currentView === 'detail') {
                this.renderStoreDetail(this.currentStore);
            } else if (this.currentView === 'shopping') {
                this.renderShoppingMode();
            }

        } catch (error) {
            this.showToast('❌ Error: ' + error.message);
            console.error('Error en deleteAllProducts:', error);
        }
    }

    // ==================== Delete Single Product ====================

    confirmDeleteProduct(cardId) {
        const card = this.cards.find(c => c.id === cardId);
        if (!card) {
            this.showToast('Producto no encontrado');
            return;
        }

        const modal = document.createElement('div');
        modal.id = 'delete-product-modal';
        modal.className = 'modal-overlay';
        modal.style.zIndex = '400'; // Above product detail modal (z-index: 300)
        modal.innerHTML = `
            <div class="modal" style="max-width: 400px;">
                <div class="modal-header">
                    <h3 class="modal-title">Confirmar eliminación</h3>
                    <button class="modal-close" id="delete-product-close">×</button>
                </div>

                <div class="modal-section">
                    <p style="color: var(--text-secondary); font-size: 15px; line-height: 1.6; margin-bottom: 16px;">
                        ¿Estás seguro de que quieres eliminar <strong style="color: var(--text);">"${card.name}"</strong>?
                    </p>
                    <p style="color: var(--text-muted); font-size: 14px; line-height: 1.6; margin-bottom: 20px;">
                        Esta acción no se puede deshacer.
                    </p>

                    <div style="display: flex; gap: 12px; margin-top: 24px;">
                        <button class="btn btn-secondary" id="cancel-delete-product" style="flex: 1;">Cancelar</button>
                        <button class="btn" id="confirm-delete-product" style="flex: 1; background: var(--danger);">Eliminar</button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        document.getElementById('delete-product-close').addEventListener('click', () => modal.remove());
        document.getElementById('cancel-delete-product').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        document.getElementById('confirm-delete-product').addEventListener('click', async () => {
            const confirmBtn = document.getElementById('confirm-delete-product');
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Eliminando...';
            await this.deleteProduct(cardId);
            modal.remove();
        });
    }

    async deleteProduct(cardId) {
        try {
            const card = this.cards.find(c => c.id === cardId);
            if (!card) {
                this.showToast('❌ Producto no encontrado');
                return;
            }

            const productName = card.name;

            // Delete card from Trello
            await this.trelloFetch(`/cards/${cardId}`, {
                method: 'DELETE'
            });

            // Remove from local cache
            this.cards = this.cards.filter(c => c.id !== cardId);

            this.showToast(`✅ "${productName}" eliminado`);

            // Close detail modal if open
            const detailModal = document.getElementById('product-detail-modal');
            if (detailModal) {
                detailModal.classList.add('hidden');
            }

            // Refresh view
            if (this.currentView === 'stores') {
                this.renderStoreCards();
            } else if (this.currentView === 'detail') {
                this.renderStoreDetail(this.currentStore);
            } else if (this.currentView === 'shopping') {
                this.renderShoppingMode();
            }

        } catch (error) {
            this.showToast('❌ Error eliminando: ' + error.message);
            console.error('Error en deleteProduct:', error);
        }
    }

    // ==================== Add Product Modal ====================

    openAddModal() {
        this.selectedLabels.clear();
        document.getElementById('product-name').value = '';
        document.getElementById('product-description').value = '';
        document.getElementById('add-modal').classList.remove('hidden');

        // Reset image upload area
        const uploadArea = document.getElementById('image-upload-area');
        const imageInput = document.getElementById('product-image');
        const preview = document.getElementById('image-preview');

        imageInput.value = '';
        preview.innerHTML = '';
        preview.classList.remove('has-image');
        uploadArea.classList.remove('has-image');

        // Render label pickers
        this.renderLabelPickers();

        // Setup image upload handlers
        this.setupImageUpload();

        // Focus input
        setTimeout(() => document.getElementById('product-name').focus(), 100);
    }



    setupImageUpload() {
        const uploadArea = document.getElementById('image-upload-area');
        const imageInput = document.getElementById('product-image');
        const preview = document.getElementById('image-preview');

        // Click to open file picker
        uploadArea.onclick = (e) => {
            if (e.target.classList.contains('image-preview-remove')) return;
            imageInput.click();
        };

        // Handle file selection
        imageInput.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                this.showImagePreview(file);
            }
        };
    }

    showImagePreview(file) {
        const uploadArea = document.getElementById('image-upload-area');
        const preview = document.getElementById('image-preview');

        const reader = new FileReader();
        reader.onload = (e) => {
            preview.innerHTML = `
                <img src="${e.target.result}" alt="Preview">
                <button type="button" class="image-preview-remove" onclick="event.stopPropagation(); app.removeImagePreview()">✕</button>
            `;
            preview.classList.add('has-image');
            uploadArea.classList.add('has-image');
        };
        reader.readAsDataURL(file);
    }

    removeImagePreview() {
        const uploadArea = document.getElementById('image-upload-area');
        const imageInput = document.getElementById('product-image');
        const preview = document.getElementById('image-preview');

        imageInput.value = '';
        preview.innerHTML = '';
        preview.classList.remove('has-image');
        uploadArea.classList.remove('has-image');
    }

    closeAddModal() {
        document.getElementById('add-modal').classList.add('hidden');
    }

    renderLabelPickers() {
        const locationPicker = document.getElementById('location-picker');
        const storePicker = document.getElementById('store-picker');

        const storeNames = this.getStoreNames();
        const storeLabels = this.labels.filter(l => storeNames.includes(l.name));
        const locationLabels = this.labels.filter(l => !storeNames.includes(l.name));

        locationPicker.innerHTML = locationLabels.map(label => `
            <label class="label-option label-${label.color}">
                <input type="checkbox" class="label-checkbox" value="${label.id}">
                <span>${label.name}</span>
            </label>
        `).join('');

        storePicker.innerHTML = storeLabels.map(label => `
            <label class="label-option label-${label.color}">
                <input type="checkbox" class="label-checkbox" value="${label.id}">
                <span>${label.name}</span>
            </label>
        `).join('');

        // Simple change listeners on checkboxes
        document.querySelectorAll('.label-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                if (e.target.checked) {
                    this.selectedLabels.add(e.target.value);
                    e.target.closest('.label-option').classList.add('selected');
                } else {
                    this.selectedLabels.delete(e.target.value);
                    e.target.closest('.label-option').classList.remove('selected');
                }
            });
        });
    }

    async createProduct() {
        const name = document.getElementById('product-name').value.trim();
        const descriptionInput = document.getElementById('product-description').value.trim();
        const imageInput = document.getElementById('product-image');
        const imageFile = imageInput.files[0];
        const btn = document.getElementById('create-product-btn');

        if (!name) {
            this.showToast('Introduce un nombre para el producto');
            return;
        }

        // Enforce at least one shopping list tag (store label)
        const storeNames = this.getStoreNames();
        const selectedStoreLabels = Array.from(this.selectedLabels).filter(labelId => {
            const label = this.labels.find(l => l.id === labelId);
            return label && storeNames.includes(label.name);
        });
        if (selectedStoreLabels.length === 0) {
            this.showToast('Selecciona al menos una tienda');
            return;
        }

        btn.disabled = true;
        btn.textContent = 'Creando...';

        try {
            // Create card in "Todos los Productos" list
            const card = await this.createCard(
                this.allProductsList.id,
                name,
                Array.from(this.selectedLabels),
                descriptionInput
            );

            // If image selected, upload it
            if (imageFile) {
                btn.textContent = 'Subiendo imagen...';
                await this.addAttachmentToCard(card.id, imageFile);

                // Reload card with attachments
                const updatedCard = await this.trelloFetch(`/cards/${card.id}?fields=name,idList,idLabels,pos,desc&attachments=true&attachment_fields=url,name,mimeType`);
                this.cards.push(updatedCard);
            } else {
                this.cards.push(card);
            }

            this.closeAddModal();
            this.resetAddModal();

            // Re-render current view
            if (this.currentView === 'stores') {
                this.showStoreCards();
            } else if (this.currentView === 'detail') {
                this.renderStoreDetail(this.currentStore);
            } else if (this.currentView === 'shopping') {
                this.renderShoppingView(document.getElementById('shopping-mode-container'));
            }

            this.showToast(`"${name}" creado`);

        } catch (error) {
            console.error('Error creando producto:', error);
            this.showToast('Error: ' + error.message);
        } finally {
            // Always reset button state
            btn.disabled = false;
            btn.textContent = 'Crear Producto';
        }
    }

    resetAddModal() {
        this.selectedLabels.clear();
        document.getElementById('product-name').value = '';
        document.getElementById('product-description').value = '';

        // Reset image
        const uploadArea = document.getElementById('image-upload-area');
        const imageInput = document.getElementById('product-image');
        const preview = document.getElementById('image-preview');
        if (imageInput) imageInput.value = '';
        if (preview) {
            preview.innerHTML = '';
            preview.classList.remove('has-image');
        }
        if (uploadArea) uploadArea.classList.remove('has-image');

        // Re-render label pickers to clear selections
        this.renderLabelPickers();
    }

    // ==================== Import/Export ====================

    /**
     * Export format:
     * {
     *   "version": 1,
     *   "exported": "2024-01-15T10:30:00Z",
     *   "products": [
     *     {
     *       "name": "Leche entera",
     *       "desc": "Marca Central Lechera, 1L",
     *       "stores": ["Mercadona", "Caprabo"],
     *       "locations": ["Nevera"],
     *       "inList": false
     *     }
     *   ]
     * }
     */

    exportProducts() {
        const storeNames = this.getStoreNames();

        const products = this.cards.map(card => {
            const cardLabels = this.labels.filter(l => card.idLabels.includes(l.id));
            const stores = cardLabels.filter(l => storeNames.includes(l.name)).map(l => ({
                name: l.name,
                color: l.color
            }));
            const locations = cardLabels.filter(l => !storeNames.includes(l.name)).map(l => ({
                name: l.name,
                color: l.color
            }));

            // Export image URLs if available
            const images = [];
            if (card.attachments && card.attachments.length > 0) {
                images.push(...card.attachments
                    .filter(att => att.mimeType && att.mimeType.startsWith('image/'))
                    .map(att => att.url)
                );
            }

            return {
                name: card.name,
                desc: card.desc || '',
                stores,
                locations,
                images,
                inList: card.idList === this.activeList?.id
            };
        });

        const exportData = {
            version: 2,
            exported: new Date().toISOString(),
            products,
            // Export available stores and locations for reference
            availableStores: this.config.stores.map(s => ({
                name: s.name,
                color: s.color,
                icon: s.icon
            })),
            availableLocations: this.config.locations.map(l => ({
                name: l.name,
                color: l.color
            }))
        };

        // Download as JSON file
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `shopping-list-export-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);

        this.showToast(`Exportados ${products.length} productos`);
    }

    async importProducts(file) {
        try {
            const text = await file.text();
            const data = JSON.parse(text);

            if (!data.version || !data.products || !Array.isArray(data.products)) {
                throw new Error('Formato de archivo inválido. Debe contener "version" y "products"');
            }

            const storeNames = this.getStoreNames();
            let imported = 0;
            let skipped = 0;
            let labelsCreated = 0;

            this.showToast('Importando productos...');

            for (const product of data.products) {
                // Check if product already exists (by name)
                const exists = this.cards.some(c => c.name.toLowerCase() === product.name.toLowerCase());
                if (exists) {
                    skipped++;
                    continue;
                }

                // Find or create label IDs for stores and locations
                const labelIds = [];

                // Handle stores (format: [{name, color}] or just [name])
                const stores = product.stores || [];
                for (const store of stores) {
                    const storeName = typeof store === 'string' ? store : store.name;
                    const storeColor = typeof store === 'object' ? store.color : 'orange';
                    
                    let label = this.labels.find(l => l.name === storeName);
                    
                    // Create label if it doesn't exist
                    if (!label) {
                        try {
                            label = await this.createLabel(this.selectedBoardId, storeName, storeColor || 'orange');
                            this.labels.push(label);
                            labelsCreated++;
                        } catch (error) {
                            console.warn(`No se pudo crear label "${storeName}":`, error);
                            continue;
                        }
                    }
                    
                    if (label) labelIds.push(label.id);
                }

                // Handle locations (format: [{name, color}] or just [name])
                const locations = product.locations || [];
                for (const location of locations) {
                    const locationName = typeof location === 'string' ? location : location.name;
                    const locationColor = typeof location === 'object' ? location.color : 'green';
                    
                    let label = this.labels.find(l => l.name === locationName);
                    
                    // Create label if it doesn't exist
                    if (!label) {
                        try {
                            label = await this.createLabel(this.selectedBoardId, locationName, locationColor || 'green');
                            this.labels.push(label);
                            labelsCreated++;
                        } catch (error) {
                            console.warn(`No se pudo crear label "${locationName}":`, error);
                            continue;
                        }
                    }
                    
                    if (label) labelIds.push(label.id);
                }

                // Create card in appropriate list
                const targetList = product.inList ? this.activeList : this.allProductsList;
                const card = await this.createCard(targetList.id, product.name, labelIds, product.desc || '');
                
                // Add images if available (URLs from export)
                if (product.images && Array.isArray(product.images) && product.images.length > 0) {
                    // Note: Can't directly upload from URLs to Trello without downloading first
                    // This is a limitation - images would need to be handled separately
                    console.log(`Producto "${product.name}" tiene ${product.images.length} imagen(es) - las imágenes deben añadirse manualmente`);
                }
                
                this.cards.push(card);
                imported++;
            }

            let message = `✅ Importados: ${imported}`;
            if (skipped > 0) message += ` | Omitidos (duplicados): ${skipped}`;
            if (labelsCreated > 0) message += ` | Labels creados: ${labelsCreated}`;
            
            this.showToast(message);

            // Refresh view
            if (this.currentView === 'stores') {
                this.renderStoreCards();
            } else if (this.currentView === 'detail') {
                this.renderStoreDetail(this.currentStore);
            }

        } catch (error) {
            this.showToast('❌ Error importando: ' + error.message);
            console.error('Error en importación:', error);
        }
    }

    showImportExportModal() {
        // Create modal dynamically
        const existingModal = document.getElementById('import-export-modal');
        if (existingModal) existingModal.remove();

        const modal = document.createElement('div');
        modal.id = 'import-export-modal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal">
                <div class="modal-header">
                    <button class="back-button" id="back-to-settings-import-export">← Atrás</button>
                    <h3 class="modal-title">Importar / Exportar</h3>
                    <button class="modal-close" id="import-export-close">×</button>
                </div>

                <div class="modal-section">
                    <div class="modal-section-title">Exportar productos</div>
                    <p style="color: var(--text-secondary); font-size: 14px; margin-bottom: 12px;">
                        Descarga todos tus productos en formato JSON incluyendo:<br>
                        • Nombre y descripción<br>
                        • Tiendas y ubicaciones (con colores)<br>
                        • URLs de imágenes<br>
                        • Configuración de labels disponibles
                    </p>
                    <button class="btn btn-primary" id="export-btn">📥 Exportar JSON</button>
                </div>

                <div class="modal-section" style="margin-top: 24px;">
                    <div class="modal-section-title">Importar productos</div>
                    <p style="color: var(--text-secondary); font-size: 14px; margin-bottom: 8px;">
                        Importa productos desde un archivo JSON. Características:
                    </p>
                    <ul style="color: var(--text-secondary); font-size: 13px; margin: 0 0 12px 20px; line-height: 1.6;">
                        <li>Los duplicados se omitirán automáticamente</li>
                        <li>Los labels (tiendas/ubicaciones) se crearán si no existen</li>
                        <li>Soporta formato v1 y v2 (mejorado)</li>
                        <li>Las imágenes deben añadirse manualmente</li>
                    </ul>
                    <input type="file" id="import-file" accept=".json" hidden>
                    <button class="btn btn-secondary" id="import-btn">📤 Seleccionar archivo JSON</button>
                    <button class="btn btn-secondary" id="show-format-btn" style="margin-top: 8px;">📋 Ver formato</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Bind events
        document.getElementById('back-to-settings-import-export').addEventListener('click', () => {
            modal.remove();
            this.showSettings();
        });
        
        document.getElementById('import-export-close').addEventListener('click', () => modal.remove());
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        document.getElementById('export-btn').addEventListener('click', () => {
            this.exportProducts();
        });

        document.getElementById('import-btn').addEventListener('click', () => {
            document.getElementById('import-file').click();
        });

        document.getElementById('import-file').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                this.importProducts(file);
                modal.remove();
            }
        });

        document.getElementById('show-format-btn').addEventListener('click', () => {
            this.showFormatDocumentation();
        });
    }

    showFormatDocumentation() {
        const existingModal = document.getElementById('format-doc-modal');
        if (existingModal) existingModal.remove();

        const modal = document.createElement('div');
        modal.id = 'format-doc-modal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal" style="max-width: 600px;">
                <div class="modal-header">
                    <button class="back-button" id="back-to-import-export">← Atrás</button>
                    <h3 class="modal-title">📋 Formato de Importación</h3>
                    <button class="modal-close" id="format-doc-close">×</button>
                </div>

                <div class="modal-section">
                    <div class="modal-section-title">Estructura del archivo JSON</div>
                    <pre style="background: var(--bg-secondary); padding: 16px; border-radius: var(--radius); overflow-x: auto; font-size: 12px; line-height: 1.6; color: var(--text);">
{
  "version": 2,
  "products": [
    {
      "name": "Leche",
      "desc": "Leche desnatada 1L",
      "stores": [
        {"name": "Mercadona", "color": "orange"}
      ],
      "locations": [
        {"name": "Nevera", "color": "sky"}
      ],
      "inList": true
    }
  ]
}

// Formato simple también válido:
{
  "version": 2,
  "products": [
    {
      "name": "Arroz",
      "stores": ["Mercadona"],
      "locations": ["Despensa"],
      "inList": false
    }
  ]
}</pre>
                </div>

                <div class="modal-section" style="margin-top: 16px;">
                    <div class="modal-section-title">Campos del producto</div>
                    <p style="color: var(--text-secondary); font-size: 13px; margin: 0 0 8px 0;">
                        <strong style="color: var(--primary);">Solo "name" es obligatorio</strong>. Todo lo demás es opcional.
                    </p>
                    <ul style="color: var(--text-secondary); font-size: 13px; margin: 0 0 0 20px; line-height: 1.8;">
                        <li><strong>name</strong>: Nombre del producto ✅ OBLIGATORIO</li>
                        <li><strong>desc</strong>: Descripción</li>
                        <li><strong>stores</strong>: ["Mercadona"] o [{"name": "Mercadona", "color": "orange"}]</li>
                        <li><strong>locations</strong>: ["Nevera"] o [{"name": "Nevera", "color": "sky"}]</li>
                        <li><strong>inList</strong>: true = Lista Activa, false = Todos los Productos (default: false)</li>
                    </ul>
                </div>

                <div class="modal-section" style="margin-top: 16px;">
                    <div class="modal-section-title">Colores disponibles</div>
                    <p style="color: var(--text-secondary); font-size: 13px; margin: 0;">
                        <strong>Tiendas:</strong> orange, red, yellow, black<br>
                        <strong>Ubicaciones:</strong> green, blue, purple, sky, lime, pink
                    </p>
                </div>

                <div class="modal-section" style="margin-top: 16px;">
                    <div class="modal-section-title">Compatibilidad</div>
                    <p style="color: var(--text-secondary); font-size: 13px; margin: 0;">
                        • <strong>Formato v2</strong> (recomendado): Incluye colores y configuración completa<br>
                        • <strong>Formato v1</strong>: Soportado, usa nombres simples de labels sin colores
                    </p>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        document.getElementById('format-doc-close').addEventListener('click', () => modal.remove());
        document.getElementById('back-to-import-export').addEventListener('click', () => {
            modal.remove();
            this.showImportExportModal();
        });
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    }

    showConfigStoresModal() {
        const existingModal = document.getElementById('config-stores-modal');
        if (existingModal) existingModal.remove();

        const modal = document.createElement('div');
        modal.id = 'config-stores-modal';
        modal.className = 'modal-overlay';

        const storesHtml = this.config.stores.map((store, idx) => `
            <div class="config-item">
                <span class="config-item-icon">${store.icon}</span>
                <span class="config-item-name">${store.name}</span>
                <button class="btn btn-danger btn-sm remove-store-btn" data-index="${idx}" title="Eliminar tienda">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                        <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
                    </svg>
                </button>
            </div>
        `).join('');

        modal.innerHTML = `
            <div class="modal">
                <div class="modal-header">
                    <button class="back-button" id="back-to-settings">← Atrás</button>
                    <h3 class="modal-title">🏪 Gestionar Tiendas</h3>
                    <button class="modal-close" id="config-stores-close">×</button>
                </div>

                <div class="modal-section">
                    ${storesHtml ? `<div class="config-list">${storesHtml}</div>` : '<p style="color: var(--text-muted); text-align: center; padding: 20px;">No hay tiendas configuradas</p>'}
                </div>

                <div class="modal-section" style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border);">
                    <div class="modal-section-title">Añadir nueva tienda</div>
                    <div style="display: flex; flex-direction: column; gap: 12px;">
                        <input type="text" id="new-store-name" placeholder="Nombre de la tienda" class="config-input">
                        <input type="text" id="new-store-icon" placeholder="Icono (emoji)" maxlength="2" class="config-input">
                        <button class="btn btn-primary" id="add-store-btn" style="width: 100%;">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16" style="margin-right: 6px;">
                                <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/>
                            </svg>
                            Añadir tienda
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        document.getElementById('config-stores-close').addEventListener('click', () => modal.remove());
        document.getElementById('back-to-settings').addEventListener('click', () => {
            modal.remove();
            this.showSettings();
        });
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        // Remove store buttons
        modal.querySelectorAll('.remove-store-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.index);
                this.removeStore(index);
            });
        });

        document.getElementById('back-to-settings').addEventListener('click', () => {
            modal.remove();
            this.showSettings();
        });

        document.getElementById('add-store-btn').addEventListener('click', () => {
            const name = document.getElementById('new-store-name').value.trim();
            const icon = document.getElementById('new-store-icon').value.trim() || '🏪';

            if (!name) {
                this.showToast('Introduce un nombre para la tienda');
                return;
            }

            // Añadir a la configuración local
            this.config.stores.push({ name, color: 'orange', icon });
            this.saveConfig(this.config);

            // Crear el label en Trello si no existe
            (async () => {
                let label = this.labels.find(l => l.name === name);
                if (!label) {
                    try {
                        label = await this.createLabel(this.selectedBoardId, name, 'orange');
                        this.labels.push(label);
                    } catch (error) {
                        this.showToast('No se pudo crear el tag en Trello: ' + error.message);
                        // No abortamos, solo informamos
                    }
                }
                this.showToast(`Tienda "${name}" añadida`);
                modal.remove();
                this.showConfigStoresModal();
            })();
        });
    }

    removeStore(index) {
        const store = this.config.stores[index];
        if (confirm(`¿Eliminar "${store.name}"?`)) {
            this.config.stores.splice(index, 1);
            this.saveConfig(this.config);
            this.showToast(`Tienda "${store.name}" eliminada`);
            this.showConfigStoresModal();
        }
    }

    showConfigLocationsModal() {
        const existingModal = document.getElementById('config-locations-modal');
        if (existingModal) existingModal.remove();

        const modal = document.createElement('div');
        modal.id = 'config-locations-modal';
        modal.className = 'modal-overlay';

        const locationsHtml = this.config.locations.map((location, idx) => `
            <div class="config-item">
                <span class="config-item-dot" style="background: ${this.getLabelColorHex(location.color)}"></span>
                <span class="config-item-name">${location.name}</span>
                <button class="btn btn-danger btn-sm remove-location-btn" data-index="${idx}" title="Eliminar ubicación">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16">
                        <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                        <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
                    </svg>
                </button>
            </div>
        `).join('');

        modal.innerHTML = `
            <div class="modal">
                <div class="modal-header">
                    <button class="back-button" id="back-to-settings-loc">← Atrás</button>
                    <h3 class="modal-title">📍 Gestionar Ubicaciones</h3>
                    <button class="modal-close" id="config-locations-close">×</button>
                </div>

                <div class="modal-section">
                    ${locationsHtml ? `<div class="config-list">${locationsHtml}</div>` : '<p style="color: var(--text-muted); text-align: center; padding: 20px;">No hay ubicaciones configuradas</p>'}
                </div>

                <div class="modal-section" style="margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border);">
                    <div class="modal-section-title">Añadir nueva ubicación</div>
                    <div style="display: flex; flex-direction: column; gap: 12px;">
                        <input type="text" id="new-location-name" placeholder="Nombre de la ubicación" class="config-input">
                        <select id="new-location-color" class="config-input">
                            <option value="green">🟢 Verde</option>
                            <option value="blue">🔵 Azul</option>
                            <option value="purple">🟣 Morado</option>
                            <option value="sky">🔷 Celeste</option>
                            <option value="lime">🟢 Lima</option>
                            <option value="pink">🩷 Rosa</option>
                        </select>
                        <button class="btn btn-primary" id="add-location-btn" style="width: 100%;">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" fill="currentColor" viewBox="0 0 16 16" style="margin-right: 6px;">
                                <path d="M8 4a.5.5 0 0 1 .5.5v3h3a.5.5 0 0 1 0 1h-3v3a.5.5 0 0 1-1 0v-3h-3a.5.5 0 0 1 0-1h3v-3A.5.5 0 0 1 8 4z"/>
                            </svg>
                            Añadir ubicación
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        document.getElementById('config-locations-close').addEventListener('click', () => modal.remove());
        document.getElementById('back-to-settings-loc').addEventListener('click', () => {
            modal.remove();
            this.showSettings();
        });
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });

        // Remove location buttons
        modal.querySelectorAll('.remove-location-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const index = parseInt(btn.dataset.index);
                this.removeLocation(index);
            });
        });

        document.getElementById('back-to-settings-locations').addEventListener('click', () => {
            modal.remove();
            this.showSettings();
        });

        document.getElementById('add-location-btn').addEventListener('click', () => {
            const name = document.getElementById('new-location-name').value.trim();
            const color = document.getElementById('new-location-color').value;

            if (!name) {
                this.showToast('Introduce un nombre para la ubicación');
                return;
            }

            this.config.locations.push({ name, color });
            this.saveConfig(this.config);
            this.showToast(`Ubicación "${name}" añadida`);
            modal.remove();
            this.showConfigLocationsModal();
        });
    }

    removeLocation(index) {
        const location = this.config.locations[index];
        if (confirm(`¿Eliminar "${location.name}"?`)) {
            this.config.locations.splice(index, 1);
            this.saveConfig(this.config);
            this.showToast(`Ubicación "${location.name}" eliminada`);
            this.showConfigLocationsModal();
        }
    }

    // ==================== Utilities ====================

    getLabelColorHex(color) {
        const colors = {
            green: '#61bd4f',
            yellow: '#f2d600',
            orange: '#ff9f1a',
            red: '#eb5a46',
            purple: '#c377e0',
            blue: '#0079bf',
            sky: '#00c2e0',
            lime: '#51e898',
            pink: '#ff78cb',
            black: '#344563'
        };
        return colors[color] || '#838c91';
    }


    showToast(message) {
        // Remove existing toast
        document.querySelectorAll('.toast').forEach(t => t.remove());

        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        document.body.appendChild(toast);

        setTimeout(() => toast.remove(), 3000);
    }

    loadTheme() {
        // Default to dark mode
        const savedTheme = localStorage.getItem('theme') || 'dark';
        if (savedTheme === 'dark') {
            document.body.classList.add('dark-mode');
            const toggleBtn = document.getElementById('theme-toggle');
            if (toggleBtn) toggleBtn.textContent = '☀️';
        } else {
            document.body.classList.remove('dark-mode');
            const toggleBtn = document.getElementById('theme-toggle');
            if (toggleBtn) toggleBtn.textContent = '🌙';
        }
    }

    toggleTheme() {
        const body = document.body;
        const toggleBtn = document.getElementById('theme-toggle');
        
        if (body.classList.contains('dark-mode')) {
            body.classList.remove('dark-mode');
            toggleBtn.textContent = '🌙';
            localStorage.setItem('theme', 'light');
        } else {
            body.classList.add('dark-mode');
            toggleBtn.textContent = '☀️';
            localStorage.setItem('theme', 'dark');
        }
    }
}

// Initialize app
const app = new TrelloShoppingApp();
