/**
 * Trello Shopping List App
 * Version: 2.1.0 (2026-01-16)
 *
 * Board Structure:
 * - List 1: "Todos los Productos" (All products as cards)
 * - List 2: "Lista Activa" (Products to buy)
 * - Dictionary lists for V2 tag system
 */

// ==================== Tag System V2 Lookup & Active City Helpers ====================

// Lookup functions for dictionaries (expects parsed arrays)
function getCityName(cityCode, cityDict) {
    const entry = cityDict.find(c => c.code === cityCode);
    return entry ? entry.name : '';
}

// ========== Shopping Mode Floor Selector Handler ==========
// Call this when entering shopping mode and a multi-floor shop is selected
window.renderFloorSelector = function(totalFloors, currentFloor) {
    const selector = document.getElementById('shopping-mode-floor-selector');
    if (!selector) return;
    selector.innerHTML = '';
    if (!totalFloors || totalFloors < 2) {
        selector.style.display = 'none';
        return;
    }
    selector.style.display = '';
    const label = document.createElement('label');
    label.textContent = 'Planta:';
    label.style.marginRight = '8px';
    selector.appendChild(label);
    const select = document.createElement('select');
    select.id = 'floor-select';
    for (let i = 0; i < totalFloors; i++) {
        const opt = document.createElement('option');
        opt.value = String(i).padStart(2, '0');
        opt.textContent = i === 0 ? 'Baja' : String(i);
        if (opt.value === currentFloor) opt.selected = true;
        select.appendChild(opt);
    }
    selector.appendChild(select);
    select.addEventListener('change', () => {
        if (window.app && typeof window.app.onFloorChange === 'function') {
            window.app.onFloorChange(select.value);
        }
    });
};

// ========== City Selector UI Handler ==========
document.addEventListener('DOMContentLoaded', () => {
    const citySelector = document.getElementById('city-selector');
    if (!citySelector) return;
    // Populate city selector from localStorage or app cache
    function updateCitySelector() {
        // Try to get cities from app instance if available
        let cities = [];
        if (window.app && window.app.cities && window.app.cities.length) {
            cities = window.app.cities;
        } else {
            // fallback: try from localStorage
            try {
                const saved = localStorage.getItem('cities_cache');
                if (saved) cities = JSON.parse(saved);
            } catch {}
        }
        citySelector.innerHTML = '';
        cities.forEach(city => {
            const opt = document.createElement('option');
            opt.value = city.code;
            opt.textContent = city.name;
            citySelector.appendChild(opt);
        });
        // Set current value
        const active = localStorage.getItem('activeCity') || (cities[0] && cities[0].code) || '00';
        citySelector.value = active;
    }
    updateCitySelector();
    citySelector.addEventListener('change', () => {
        localStorage.setItem('activeCity', citySelector.value);
        // Optionally trigger app re-render or reload
        if (window.app && typeof window.app.onCityChange === 'function') {
            window.app.onCityChange(citySelector.value);
        } else {
            location.reload();
        }
    });
    // Expose for app to call after Trello load
    window.updateCitySelector = updateCitySelector;
});

function getShopInfo(cityCode, shopCode, shopDict) {
    return shopDict.find(s => s.cityCode === cityCode && s.shopCode === shopCode) || null;
}

function getRoomName(cityCode, roomCode, roomDict) {
    const entry = roomDict.find(r => r.cityCode === cityCode && r.roomCode === roomCode);
    return entry ? entry.name : '';
}

function getClosetName(cityCode, roomCode, closetCode, closetDict) {
    const entry = closetDict.find(c => c.cityCode === cityCode && c.roomCode === roomCode && c.closetCode === closetCode);
    return entry ? entry.name : '';
}

// Active city helpers
function getActiveCity() {
    return localStorage.getItem('activeCity') || '00';
}

function setActiveCity(code) {
    localStorage.setItem('activeCity', code);
}

/*
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
    version: 2,
    listNames: {
        allProducts: 'Todos los Productos',
        activeList: 'Lista Activa',
        dictCities: 'Diccionario ciudades',
        dictShops: 'Diccionario tienda',
        dictRooms: 'Diccionario habitacion',
        dictClosets: 'Diccionario armarios'
    },
    // Legacy store/location config (for backwards compatibility during migration)
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

// ==================== Tag System V2 Helper Functions ====================

/**
 * Tag Format: XX_YY_ZZ_TT_RR
 * - XX: City code (00-99)
 * - YY: Shop code (00-99)
 * - ZZ: Floor number (00-99, 00=ground floor)
 * - TT: Room code (00-98, 99=unspecified)
 * - RR: Closet code (00-98, 99=unspecified)
 */

const TagSystem = {
    UNSPECIFIED: '99',

    // Encode components into a tag string
    encodeTag(city, shop, floor, room = '99', closet = '99') {
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(city)}_${pad(shop)}_${pad(floor)}_${pad(room)}_${pad(closet)}`;
    },

    // Decode a tag string into components
    decodeTag(tagCode) {
        if (!this.isValidTag(tagCode)) {
            return null;
        }
        const parts = tagCode.split('_');
        return {
            city: parts[0],
            shop: parts[1],
            floor: parts[2],
            room: parts[3],
            closet: parts[4],
            hasRoom: parts[3] !== '99',
            hasCloset: parts[4] !== '99'
        };
    },

    // Validate tag format
    isValidTag(tagCode) {
        if (!tagCode || typeof tagCode !== 'string') return false;
        const regex = /^\d{2}_\d{2}_\d{2}_\d{2}_\d{2}$/;
        return regex.test(tagCode);
    },

    // Parse city dictionary card: "XX-City Name"
    parseCityCard(cardName) {
        const match = cardName.match(/^(\d{2})-(.+)$/);
        if (!match) return null;
        return {
            code: match[1],
            name: match[2].trim()
        };
    },

    // Parse shop dictionary card: "XX-YY-ZZZ-Shop Name"
    // ZZZ format: first digit 0/1 (single/multi floor) + 2 digits total floors
    parseShopCard(cardName) {
        const match = cardName.match(/^(\d{2})-(\d{2})-(\d)(\d{2})-(.+)$/);
        if (!match) return null;
        return {
            cityCode: match[1],
            shopCode: match[2],
            isMultiFloor: match[3] === '1',
            totalFloors: parseInt(match[4], 10),
            name: match[5].trim()
        };
    },

    // Parse room dictionary card: "XX-TT-Room Name"
    parseRoomCard(cardName) {
        const match = cardName.match(/^(\d{2})-(\d{2})-(.+)$/);
        if (!match) return null;
        return {
            cityCode: match[1],
            roomCode: match[2],
            name: match[3].trim()
        };
    },

    // Parse closet dictionary card: "XX-TT-RR-Closet Name"
    parseClosetCard(cardName) {
        const match = cardName.match(/^(\d{2})-(\d{2})-(\d{2})-(.+)$/);
        if (!match) return null;
        return {
            cityCode: match[1],
            roomCode: match[2],
            closetCode: match[3],
            name: match[4].trim()
        };
    },

    // Format city card name
    formatCityCard(code, name) {
        return `${String(code).padStart(2, '0')}-${name}`;
    },

    // Format shop card name
    formatShopCard(cityCode, shopCode, isMultiFloor, totalFloors, name) {
        const floorInfo = `${isMultiFloor ? '1' : '0'}${String(totalFloors).padStart(2, '0')}`;
        return `${String(cityCode).padStart(2, '0')}-${String(shopCode).padStart(2, '0')}-${floorInfo}-${name}`;
    },

    // Format room card name
    formatRoomCard(cityCode, roomCode, name) {
        return `${String(cityCode).padStart(2, '0')}-${String(roomCode).padStart(2, '0')}-${name}`;
    },

    // Format closet card name
    formatClosetCard(cityCode, roomCode, closetCode, name) {
        return `${String(cityCode).padStart(2, '0')}-${String(roomCode).padStart(2, '0')}-${String(closetCode).padStart(2, '0')}-${name}`;
    }
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

        // Dictionary lists (V2 tag system)
        this.dictCitiesList = null;
        this.dictShopsList = null;
        this.dictRoomsList = null;
        this.dictClosetsList = null;

        // Dictionary caches (populated from Trello cards)
        this.cities = [];      // [{code, name, color?}]
        this.shops = [];       // [{cityCode, shopCode, name, isMultiFloor, totalFloors, color?, icon?}]
        this.rooms = [];       // [{cityCode, roomCode, name, color?}]
        this.closets = [];     // [{cityCode, roomCode, closetCode, name}]

        // Active city (stored in localStorage)
        this.activeCity = localStorage.getItem('active_city') || null;

        // Load configuration (File B) - Active config from localStorage, or copy from seed if first time
        this.config = this.loadConfig();

        // New state for card-based navigation
        this.currentView = 'stores'; // 'stores', 'detail', or 'shopping'
        this.currentStore = null;
        this.selectedStore = null; // For shopping mode (legacy label)
        this.selectedV2Shop = null; // For shopping mode (V2 shop from dictionary)
        this.selectedFloor = 'all'; // For multi-floor shops: 'all' or floor number '00', '01', etc.
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
        console.log('🔗 bindEvents() iniciando...');
        // Use passive listeners for better scroll performance
        const passiveOpts = { passive: true };

        // Login form submission
        const loginForm = document.getElementById('login-form');
        if (loginForm) {
            loginForm.addEventListener('submit', (e) => {
                e.preventDefault();
                console.log('📝 Form submit detected');
                this.handleLogin();
            });
            console.log('✅ Login form event bound');
        } else {
            console.error('❌ login-form not found!');
        }

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
        document.getElementById('api-key')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') document.getElementById('api-token')?.focus();
        });
        document.getElementById('api-token')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.handleLogin();
        });

        console.log('🔗 bindEvents() completado');

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
        return this.trelloFetch(`/boards/${boardId}?fields=id,name,url,prefs`);
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

    async createLabel(boardId, name, color = 'black') {
        // Trello requires a color for labels - default to 'black' for V2 tags
        const labelColor = color || 'black';
        const endpoint = `/labels?idBoard=${boardId}&name=${encodeURIComponent(name)}&color=${labelColor}`;
        return this.trelloFetch(endpoint, { method: 'POST' });
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

            // Mostrar selector de tableros tras login
            this.showScreen('board-selector');
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

            // Find dictionary lists (V2 tag system)
            this.dictCitiesList = lists.find(l => l.name === this.config.listNames.dictCities);
            this.dictShopsList = lists.find(l => l.name === this.config.listNames.dictShops);
            this.dictRoomsList = lists.find(l => l.name === this.config.listNames.dictRooms);
            this.dictClosetsList = lists.find(l => l.name === this.config.listNames.dictClosets);

            // Create missing lists
            if (!this.allProductsList || !this.activeList ||
                !this.dictCitiesList || !this.dictShopsList ||
                !this.dictRoomsList || !this.dictClosetsList) {
                await this.setupBoardStructure();
            }

            // Load dictionaries from cards
            this.loadDictionaries();

            // Set default active city if not set
            if (!this.activeCity && this.cities.length > 0) {
                this.activeCity = this.cities[0].code;
                localStorage.setItem('active_city', this.activeCity);
            }

            this.showStoreCards();

        } catch (error) {
            this.showToast('Error cargando tablero: ' + error.message);
        }
    }

    // Load dictionaries from Trello cards into caches
    loadDictionaries() {
        this.cities = [];
        this.shops = [];
        this.rooms = [];
        this.closets = [];

        // Load cities
        if (this.dictCitiesList) {
            const cityCards = this.cards.filter(c => c.idList === this.dictCitiesList.id);
            for (const card of cityCards) {
                const parsed = TagSystem.parseCityCard(card.name);
                if (parsed) {
                    // Get color from card labels if present
                    const cardLabel = card.idLabels.length > 0 ?
                        this.labels.find(l => l.id === card.idLabels[0]) : null;
                    this.cities.push({
                        ...parsed,
                        color: cardLabel?.color || 'blue',
                        cardId: card.id
                    });
                }
            }
        }

        // Load shops
        if (this.dictShopsList) {
            const shopCards = this.cards.filter(c => c.idList === this.dictShopsList.id);
            for (const card of shopCards) {
                const parsed = TagSystem.parseShopCard(card.name);
                if (parsed) {
                    const cardLabel = card.idLabels.length > 0 ?
                        this.labels.find(l => l.id === card.idLabels[0]) : null;
                    // Get icon from card description if present
                    const iconMatch = card.desc?.match(/^icon:(.+)$/m);
                    this.shops.push({
                        ...parsed,
                        color: cardLabel?.color || 'orange',
                        icon: iconMatch ? iconMatch[1].trim() : '🏪',
                        cardId: card.id
                    });
                }
            }
        }

        // Load rooms
        if (this.dictRoomsList) {
            const roomCards = this.cards.filter(c => c.idList === this.dictRoomsList.id);
            for (const card of roomCards) {
                const parsed = TagSystem.parseRoomCard(card.name);
                if (parsed) {
                    const cardLabel = card.idLabels.length > 0 ?
                        this.labels.find(l => l.id === card.idLabels[0]) : null;
                    this.rooms.push({
                        ...parsed,
                        color: cardLabel?.color || 'green',
                        cardId: card.id
                    });
                }
            }
        }

        // Load closets
        if (this.dictClosetsList) {
            const closetCards = this.cards.filter(c => c.idList === this.dictClosetsList.id);
            for (const card of closetCards) {
                const parsed = TagSystem.parseClosetCard(card.name);
                if (parsed) {
                    this.closets.push({
                        ...parsed,
                        cardId: card.id
                    });
                }
            }
        }

        console.log('📚 Diccionarios cargados:', {
            cities: this.cities.length,
            shops: this.shops.length,
            rooms: this.rooms.length,
            closets: this.closets.length
        });
    }

    // Lookup functions for dictionaries
    getCityName(cityCode) {
        const city = this.cities.find(c => c.code === cityCode);
        return city?.name || `Ciudad ${cityCode}`;
    }

    getShopInfo(cityCode, shopCode) {
        return this.shops.find(s => s.cityCode === cityCode && s.shopCode === shopCode) || null;
    }

    getShopsByCity(cityCode) {
        return this.shops.filter(s => s.cityCode === cityCode);
    }

    getRoomName(cityCode, roomCode) {
        const room = this.rooms.find(r => r.cityCode === cityCode && r.roomCode === roomCode);
        return room?.name || (roomCode === '99' ? 'Sin habitación' : `Habitación ${roomCode}`);
    }

    getRoomsByCity(cityCode) {
        return this.rooms.filter(r => r.cityCode === cityCode);
    }

    getClosetName(cityCode, roomCode, closetCode) {
        const closet = this.closets.find(c =>
            c.cityCode === cityCode && c.roomCode === roomCode && c.closetCode === closetCode
        );
        return closet?.name || (closetCode === '99' ? 'Sin armario' : `Armario ${closetCode}`);
    }

    getClosetsByRoom(cityCode, roomCode) {
        return this.closets.filter(c => c.cityCode === cityCode && c.roomCode === roomCode);
    }

    // Get human-readable location string from tag
    getTagLocationString(tagCode) {
        const decoded = TagSystem.decodeTag(tagCode);
        if (!decoded) return 'Ubicación inválida';

        const shopInfo = this.getShopInfo(decoded.city, decoded.shop);
        const shopName = shopInfo?.name || `Tienda ${decoded.shop}`;

        let location = shopName;

        if (shopInfo?.isMultiFloor) {
            location += ` (Planta ${parseInt(decoded.floor, 10)})`;
        }

        if (decoded.hasRoom) {
            location += ` → ${this.getRoomName(decoded.city, decoded.room)}`;
        }

        if (decoded.hasCloset) {
            location += ` → ${this.getClosetName(decoded.city, decoded.room, decoded.closet)}`;
        }

        return location;
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

        // Create dictionary lists (V2 tag system)
        if (!this.dictCitiesList) {
            this.dictCitiesList = await this.createList(this.selectedBoardId, this.config.listNames.dictCities, 3);
            this.lists.push(this.dictCitiesList);
        }

        if (!this.dictShopsList) {
            this.dictShopsList = await this.createList(this.selectedBoardId, this.config.listNames.dictShops, 4);
            this.lists.push(this.dictShopsList);
        }

        if (!this.dictRoomsList) {
            this.dictRoomsList = await this.createList(this.selectedBoardId, this.config.listNames.dictRooms, 5);
            this.lists.push(this.dictRoomsList);
        }

        if (!this.dictClosetsList) {
            this.dictClosetsList = await this.createList(this.selectedBoardId, this.config.listNames.dictClosets, 6);
            this.lists.push(this.dictClosetsList);
        }

        // Create default location labels if none exist (legacy support)
        const locationLabels = this.labels.filter(l => ['green', 'blue', 'purple', 'sky', 'lime', 'pink'].includes(l.color));

        if (locationLabels.length === 0) {
            for (const loc of this.config.locations) {
                const label = await this.createLabel(this.selectedBoardId, loc.name, loc.color);
                this.labels.push(label);
            }
        }

        // Create default store labels if none exist (legacy support)
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

        // Populate city selector
        this.populateCitySelector();

        this.renderStoreCards();
    }

    populateCitySelector() {
        const selector = document.getElementById('city-selector');
        const container = document.getElementById('city-selector-container');
        if (!selector) return;

        // Clear existing options
        selector.innerHTML = '';

        if (this.cities.length === 0) {
            selector.innerHTML = '<option value="">Sin ciudades</option>';
            if (container) container.style.display = 'none';
            return;
        }

        if (container) container.style.display = 'flex';

        // Add city options
        this.cities.forEach(city => {
            const option = document.createElement('option');
            option.value = city.code;
            option.textContent = city.name;
            if (city.code === this.activeCity) {
                option.selected = true;
            }
            selector.appendChild(option);
        });

        // Bind change event (remove old listener first)
        const newSelector = selector.cloneNode(true);
        selector.parentNode.replaceChild(newSelector, selector);

        newSelector.addEventListener('change', (e) => {
            this.activeCity = e.target.value;
            localStorage.setItem('active_city', this.activeCity);
            this.renderStoreCards();
        });
    }

    showStoreDetail(storeLabel) {
        this.currentView = 'detail';
        this.currentStore = storeLabel;
        this.selectedV2Shop = null;
        this.searchQuery = '';

        document.getElementById('store-cards-view').classList.add('hidden');
        document.getElementById('shopping-mode-view').classList.add('hidden');
        document.getElementById('store-detail-view').classList.remove('hidden');

        document.getElementById('store-detail-title').textContent = storeLabel.name;

        this.renderStoreDetail(storeLabel);
    }

    showV2StoreDetail(shop) {
        this.currentView = 'detail';
        this.currentStore = null;
        this.selectedV2Shop = shop;
        this.searchQuery = '';

        document.getElementById('store-cards-view').classList.add('hidden');
        document.getElementById('shopping-mode-view').classList.add('hidden');
        document.getElementById('store-detail-view').classList.remove('hidden');

        document.getElementById('store-detail-title').textContent = shop.name;

        this.renderV2StoreDetail(shop);
    }

    renderV2StoreDetail(shop) {
        const container = document.getElementById('products-container');

        if (!this.activeList || !this.allProductsList) {
            container.innerHTML = '<div class="loading"><div class="spinner"></div><p>Cargando productos...</p></div>';
            return;
        }

        const tagPrefix = `${shop.cityCode}_${shop.shopCode}_`;

        // Get products with V2 tags for this shop
        const shopProducts = this.cards.filter(card => {
            return card.idLabels.some(labelId => {
                const label = this.labels.find(l => l.id === labelId);
                return label && TagSystem.isValidTag(label.name) && label.name.startsWith(tagPrefix);
            });
        });

        // Separate active and inactive products
        const activeProducts = shopProducts.filter(c => c.idList === this.activeList.id);
        const inactiveProducts = shopProducts.filter(c => c.idList !== this.activeList.id);

        if (shopProducts.length === 0) {
            container.innerHTML = `
                <div class="empty-state" style="padding: 40px 20px;">
                    <div style="font-size: 48px; margin-bottom: 16px;">📦</div>
                    <p>No hay productos en ${shop.name}</p>
                    <p style="font-size: 13px; color: var(--text-muted); margin-top: 8px;">
                        Usa el botón + para añadir productos
                    </p>
                </div>
            `;
            return;
        }

        let html = '';

        // Active products section
        if (activeProducts.length > 0) {
            html += `<div class="products-section"><div class="section-title">En la lista (${activeProducts.length})</div>`;
            html += activeProducts.map(card => this.renderDetailProduct(card, true)).join('');
            html += '</div>';
        }

        // Inactive products section
        if (inactiveProducts.length > 0) {
            html += `<div class="products-section"><div class="section-title">Otros productos (${inactiveProducts.length})</div>`;
            html += inactiveProducts.map(card => this.renderDetailProduct(card, false)).join('');
            html += '</div>';
        }

        container.innerHTML = html;
        this.attachProductCardListeners();
    }

    attachProductCardListeners() {
        const container = document.getElementById('products-container');

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

        // Load thumbnails asynchronously
        this.loadProductThumbnails();
    }

    renderStoreCards() {
        const container = document.getElementById('store-cards-container');

        if (!this.activeList) {
            container.innerHTML = '<div class="loading"><div class="spinner"></div><p>Configurando listas...</p></div>';
            return;
        }

        // Get V2 shops for active city
        const v2Shops = this.activeCity ? this.getShopsByCity(this.activeCity) : [];

        if (v2Shops.length === 0) {
            // Check if there's no active city or no shops
            if (!this.activeCity || this.cities.length === 0) {
                container.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">🏙️</div>
                        <p style="font-size: 16px; margin-bottom: 8px;">Configura tu primera ciudad</p>
                        <p style="font-size: 14px; opacity: 0.7; margin-bottom: 16px;">Añade ciudades y tiendas para empezar</p>
                        <button class="btn btn-primary" id="open-dict-from-empty">Configurar</button>
                    </div>
                `;
                container.querySelector('#open-dict-from-empty')?.addEventListener('click', () => this.showDictionaryModal());
            } else {
                container.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-state-icon">🏪</div>
                        <p style="font-size: 16px; margin-bottom: 8px;">No hay tiendas</p>
                        <p style="font-size: 14px; opacity: 0.7; margin-bottom: 16px;">Añade tiendas en ${this.getCityName(this.activeCity)}</p>
                        <button class="btn btn-primary" id="open-dict-from-empty">Añadir Tienda</button>
                    </div>
                `;
                container.querySelector('#open-dict-from-empty')?.addEventListener('click', () => this.showDictionaryModal());
            }
            return;
        }

        // Count products per V2 shop
        const shopCounts = v2Shops.map(shop => {
            const tagPrefix = `${this.activeCity}_${shop.shopCode}_`;

            // Find products with V2 tags matching this shop
            const shopProducts = this.cards.filter(card => {
                return card.idLabels.some(labelId => {
                    const label = this.labels.find(l => l.id === labelId);
                    return label && TagSystem.isValidTag(label.name) && label.name.startsWith(tagPrefix);
                });
            });

            const activeCount = shopProducts.filter(c => c.idList === this.activeList.id).length;
            const totalCount = shopProducts.length;

            return { shop, activeCount, totalCount };
        });

        // Sort by active count descending
        shopCounts.sort((a, b) => b.activeCount - a.activeCount);

        let html = shopCounts.map(({ shop, activeCount, totalCount }) => {
            const countText = totalCount === 0 ? 'Sin productos' :
                (totalCount === 1 ? `${activeCount}/1 producto` : `${activeCount}/${totalCount} productos`);
            const floorInfo = shop.isMultiFloor ? ` · ${shop.totalFloors} plantas` : '';

            return `
                <div class="store-card" data-shop-code="${shop.shopCode}" data-city-code="${shop.cityCode}">
                    <div class="store-card-icon">${shop.icon || '🏪'}</div>
                    <div class="store-card-content">
                        <div class="store-card-name">${shop.name}</div>
                        <div class="store-card-count">${countText}${floorInfo}</div>
                    </div>
                    <span class="store-card-arrow">›</span>
                </div>
            `;
        }).join('');

        container.innerHTML = html;

        // Add click handlers for V2 shops
        container.querySelectorAll('.store-card').forEach(card => {
            card.addEventListener('click', () => {
                const shopCode = card.dataset.shopCode;
                const cityCode = card.dataset.cityCode;
                const shop = v2Shops.find(s => s.shopCode === shopCode && s.cityCode === cityCode);
                if (shop) {
                    this.showV2StoreDetail(shop);
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
                <div class="products-section products-section-available">
                    <div class="products-section-title">Disponibles (${sortedAvailableCards.length})</div>
                    ${sortedAvailableCards.map(card => this.renderDetailProduct(card, false)).join('')}
                </div>
            `;
        } else {
            // Empty section to maintain layout height
            html += `
                <div class="products-section products-section-available">
                    ${this.searchQuery ? '<p style="color: var(--text-muted); padding: 40px 20px;">No se encontraron productos</p>' : ''}
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

        // Bind clear button event (touchend for mobile, click for desktop)
        if (clearBtn) {
            const clearSearch = (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.searchQuery = '';
                this.renderStoreDetail(this.currentStore);
                const newInput = document.getElementById('product-search-inline');
                if (newInput) {
                    newInput.focus();
                }
            };
            clearBtn.addEventListener('touchend', clearSearch);
            clearBtn.addEventListener('click', clearSearch);
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
        document.body.style.overflow = 'hidden';
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

        // Initialize pending changes for edit mode
        this.pendingEditImage = null;
        this.pendingDeleteAttachments = [];

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
                            <button class="image-delete-btn" data-attachment-id="${img.id}">&times;</button>
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
                    <div id="edit-tag-builder">
                        <select id="edit-tag-city" class="input" style="width: 100%; margin-bottom: 12px;"></select>
                        <div class="location-picker-section">
                            <div class="location-picker-title">🏪 Tiendas</div>
                            <div id="edit-shops-picker" class="location-picker-list"></div>
                        </div>
                        <div class="location-picker-section">
                            <div class="location-picker-title">🏠 Habitaciones</div>
                            <div id="edit-rooms-picker" class="location-picker-list"></div>
                        </div>
                    </div>
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

        // Add event listeners to existing image delete buttons
        document.querySelectorAll('.image-delete-btn[data-attachment-id]').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                const attachmentId = btn.dataset.attachmentId;
                this.markAttachmentForDeletion(attachmentId);
            });
        });

        // Populate tag builder with existing tags pre-selected
        this.populateEditTagBuilder(card);
    }

    populateEditTagBuilder(card) {
        const citySelect = document.getElementById('edit-tag-city');
        const shopsPicker = document.getElementById('edit-shops-picker');
        const roomsPicker = document.getElementById('edit-rooms-picker');

        if (!citySelect || !shopsPicker || !roomsPicker) return;

        // Get existing V2 tags from card
        const existingTags = card.idLabels
            .map(labelId => this.labels.find(l => l.id === labelId))
            .filter(label => label && TagSystem.isValidTag(label.name))
            .map(label => TagSystem.decodeTag(label.name))
            .filter(Boolean);

        // Determine city from existing tags or use active city
        const tagCity = existingTags.length > 0 ? existingTags[0].city : this.activeCity;

        // Populate cities
        citySelect.innerHTML = '<option value="">-- Selecciona ciudad --</option>' +
            this.cities.map(c => `<option value="${c.code}" ${c.code === tagCity ? 'selected' : ''}>${c.name}</option>`).join('');

        // Get selected shops, rooms, closets from existing tags
        const selectedShops = new Set(existingTags.map(t => t.shop));
        const selectedRooms = new Set(existingTags.filter(t => t.hasRoom).map(t => t.room));
        const selectedClosets = new Set(existingTags.filter(t => t.hasCloset).map(t => `${t.room}_${t.closet}`));

        // Render shops
        const renderEditShops = () => {
            const cityCode = citySelect.value;
            const shops = cityCode ? this.getShopsByCity(cityCode) : [];

            if (shops.length === 0) {
                shopsPicker.innerHTML = '<div class="location-picker-empty">Selecciona una ciudad primero</div>';
                return;
            }

            shopsPicker.innerHTML = shops.map(shop => {
                const isSelected = selectedShops.has(shop.shopCode);
                const floorOptions = shop.isMultiFloor && shop.totalFloors > 1
                    ? Array.from({length: shop.totalFloors}, (_, i) => {
                        const code = String(i).padStart(2, '0');
                        const name = i === 0 ? 'Baja' : `P${i}`;
                        return `<option value="${code}">${name}</option>`;
                    }).join('')
                    : '';

                return `
                    <label class="location-picker-item ${isSelected ? 'selected' : ''}" data-type="shop" data-shop="${shop.shopCode}">
                        <input type="checkbox" class="edit-shop-checkbox" data-shop="${shop.shopCode}" ${isSelected ? 'checked' : ''}>
                        <span class="item-name">${shop.name}</span>
                        ${floorOptions ? `<select class="floor-select" data-shop="${shop.shopCode}">${floorOptions}</select>` : ''}
                    </label>
                `;
            }).join('');
        };

        // Render rooms with closets
        const renderEditRooms = () => {
            const cityCode = citySelect.value;
            const rooms = cityCode ? this.getRoomsByCity(cityCode) : [];

            if (rooms.length === 0) {
                roomsPicker.innerHTML = '<div class="location-picker-empty">No hay habitaciones configuradas</div>';
                return;
            }

            let html = '';
            rooms.forEach(room => {
                const isRoomSelected = selectedRooms.has(room.roomCode);
                html += `
                    <label class="location-picker-item ${isRoomSelected ? 'selected' : ''}" data-type="room" data-room="${room.roomCode}">
                        <input type="checkbox" class="edit-room-checkbox" data-room="${room.roomCode}" ${isRoomSelected ? 'checked' : ''}>
                        <span class="item-name">${room.name}</span>
                    </label>
                `;

                const closets = this.getClosetsByRoom(cityCode, room.roomCode);
                closets.forEach(closet => {
                    const isClosetSelected = selectedClosets.has(`${room.roomCode}_${closet.closetCode}`);
                    html += `
                        <label class="location-picker-item closet-item ${isClosetSelected ? 'selected' : ''}" data-type="closet" data-room="${room.roomCode}" data-closet="${closet.closetCode}">
                            <input type="checkbox" class="edit-closet-checkbox" data-room="${room.roomCode}" data-closet="${closet.closetCode}" ${isClosetSelected ? 'checked' : ''}>
                            <span class="item-name">${closet.name}</span>
                        </label>
                    `;
                });
            });

            roomsPicker.innerHTML = html;
        };

        // Event delegation
        const container = document.getElementById('edit-tag-builder');
        if (container) {
            container.addEventListener('change', (e) => {
                if (e.target.id === 'edit-tag-city') {
                    renderEditShops();
                    renderEditRooms();
                } else if (e.target.type === 'checkbox') {
                    const item = e.target.closest('.location-picker-item');
                    if (item) item.classList.toggle('selected', e.target.checked);
                }
            });
        }

        renderEditShops();
        renderEditRooms();
    }

    // Get selected V2 tags from edit tag builder
    getEditSelectedV2Tags() {
        const citySelect = document.getElementById('edit-tag-city');
        const cityCode = citySelect?.value;

        if (!cityCode) return [];

        const tags = [];

        const shopCheckboxes = document.querySelectorAll('.edit-shop-checkbox:checked');
        shopCheckboxes.forEach(cb => {
            const shopCode = cb.dataset.shop;
            const floorSelect = document.querySelector(`#edit-tag-builder .floor-select[data-shop="${shopCode}"]`);
            const floorCode = floorSelect?.value || '00';

            const roomCheckboxes = document.querySelectorAll('.edit-room-checkbox:checked');
            const closetCheckboxes = document.querySelectorAll('.edit-closet-checkbox:checked');

            if (roomCheckboxes.length === 0 && closetCheckboxes.length === 0) {
                tags.push(TagSystem.encodeTag(cityCode, shopCode, floorCode, '99', '99'));
            } else {
                roomCheckboxes.forEach(rcb => {
                    const roomCode = rcb.dataset.room;
                    const roomClosets = document.querySelectorAll(`.edit-closet-checkbox:checked[data-room="${roomCode}"]`);
                    if (roomClosets.length === 0) {
                        tags.push(TagSystem.encodeTag(cityCode, shopCode, floorCode, roomCode, '99'));
                    }
                });

                closetCheckboxes.forEach(ccb => {
                    const roomCode = ccb.dataset.room;
                    const closetCode = ccb.dataset.closet;
                    tags.push(TagSystem.encodeTag(cityCode, shopCode, floorCode, roomCode, closetCode));
                });
            }
        });

        return tags;
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

        // Clear any pending image
        this.pendingEditImage = null;

        uploadArea.onclick = (e) => {
            if (e.target.closest('.edit-image-preview-remove')) return;
            imageInput.click();
        };

        imageInput.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                this.showEditImagePreview(file);
            }
        };
    }

    showEditImagePreview(file) {
        const uploadArea = document.getElementById('edit-image-upload-area');

        // Store file for upload on save
        this.pendingEditImage = file;

        // Show preview
        const reader = new FileReader();
        reader.onload = (ev) => {
            uploadArea.innerHTML = `
                <div class="edit-image-preview-container">
                    <img src="${ev.target.result}" alt="Preview" style="max-width: 100%; max-height: 150px; border-radius: 8px;">
                    <button type="button" class="edit-image-preview-remove">✕</button>
                </div>
            `;
            uploadArea.classList.add('has-preview');

            // Add event listener directly to button
            const removeBtn = uploadArea.querySelector('.edit-image-preview-remove');
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                e.preventDefault();
                this.removeEditImagePreview();
            });
        };
        reader.readAsDataURL(file);
    }

    removeEditImagePreview() {
        const uploadArea = document.getElementById('edit-image-upload-area');

        this.pendingEditImage = null;
        uploadArea.classList.remove('has-preview');
        uploadArea.innerHTML = `
            <input type="file" id="edit-product-image" accept="image/*" hidden>
            <div class="image-upload-placeholder">
                <span class="image-upload-icon">➕</span>
                <span class="image-upload-text">Añadir foto</span>
            </div>
        `;

        // Re-setup the input listener
        const imageInput = document.getElementById('edit-product-image');
        imageInput.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                this.showEditImagePreview(file);
            }
        };
    }

    markAttachmentForDeletion(attachmentId) {
        // Add to pending deletions
        if (!this.pendingDeleteAttachments.includes(attachmentId)) {
            this.pendingDeleteAttachments.push(attachmentId);
        }

        // Hide the image element visually
        const imageElement = document.querySelector(`.product-edit-image[data-attachment-id="${attachmentId}"]`);
        if (imageElement) {
            imageElement.style.display = 'none';
        }
    }

    async deleteAttachment(cardId, attachmentId) {
        if (!confirm('¿Eliminar esta imagen?')) return;

        try {
            await this.trelloFetch(`/cards/${cardId}/attachments/${attachmentId}`, { method: 'DELETE' });

            // Reload card
            const updatedCard = await this.trelloFetch(`/cards/${cardId}?fields=name,idList,idLabels,pos,desc&attachments=true&attachment_fields=url,name,mimeType,previews`);
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

        if (!nameInput) {
            this.showToast('El nombre no puede estar vacío');
            return;
        }

        // Get new V2 tags from edit builder
        const newV2Tags = this.getEditSelectedV2Tags();

        if (newV2Tags.length === 0) {
            this.showToast('Selecciona al menos una tienda');
            return;
        }

        btn.disabled = true;
        btn.textContent = 'Guardando...';

        try {
            const card = this.cards.find(c => c.id === cardId);
            const boardId = this.board?.id || this.selectedBoardId;

            // Get non-V2 labels to preserve (legacy labels)
            const nonV2LabelIds = card.idLabels.filter(labelId => {
                const label = this.labels.find(l => l.id === labelId);
                return label && !TagSystem.isValidTag(label.name);
            });

            // Find or create labels for new V2 tags
            const newV2LabelIds = [];
            for (const tagCode of newV2Tags) {
                let tagLabel = this.labels.find(l => l.name === tagCode);
                if (!tagLabel) {
                    try {
                        tagLabel = await this.createLabel(boardId, tagCode, null);
                        this.labels.push(tagLabel);
                    } catch (error) {
                        console.error('Error creating label:', error);
                        continue;
                    }
                }
                newV2LabelIds.push(tagLabel.id);
            }

            // Combine non-V2 labels with new V2 labels
            const finalLabelIds = [...nonV2LabelIds, ...newV2LabelIds];

            // Update card
            await this.trelloFetch(`/cards/${cardId}`, {
                method: 'PUT',
                body: JSON.stringify({
                    name: nameInput,
                    desc: descInput,
                    idLabels: finalLabelIds
                })
            });

            // Update local card
            if (card) {
                card.name = nameInput;
                card.desc = descInput;
                card.idLabels = finalLabelIds;
            }

            // Track if we need to reload attachments
            let needsAttachmentReload = false;

            // Delete pending attachments if any
            if (this.pendingDeleteAttachments && this.pendingDeleteAttachments.length > 0) {
                btn.textContent = 'Eliminando imágenes...';
                for (const attachmentId of this.pendingDeleteAttachments) {
                    try {
                        await this.trelloFetch(`/cards/${cardId}/attachments/${attachmentId}`, { method: 'DELETE' });
                        needsAttachmentReload = true;
                    } catch (error) {
                        console.error('Error deleting attachment:', error);
                    }
                }
                this.pendingDeleteAttachments = [];
            }

            // Upload pending image if any
            if (this.pendingEditImage) {
                btn.textContent = 'Subiendo imagen...';
                await this.addAttachmentToCard(cardId, this.pendingEditImage);
                this.pendingEditImage = null;
                needsAttachmentReload = true;
            }

            // Reload card with attachments if we made any image changes
            if (needsAttachmentReload) {
                const updatedCard = await this.trelloFetch(`/cards/${cardId}?fields=name,idList,idLabels,pos,desc&attachments=true&attachment_fields=url,name,mimeType,previews`);
                const cardIndex = this.cards.findIndex(c => c.id === cardId);
                if (cardIndex !== -1) {
                    this.cards[cardIndex] = updatedCard;
                }
            }

            this.showToast('Guardado');
            this.showProductDetail(cardId);

            // Re-render current view
            if (this.currentView === 'detail') {
                if (this.selectedV2Shop) {
                    this.renderV2StoreDetail(this.selectedV2Shop);
                } else if (this.currentStore) {
                    this.renderStoreDetail(this.currentStore);
                }
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
        document.body.style.overflow = '';
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
            this.rerenderCurrentDetailView();
        });

        try {
            await this.moveCard(cardId, targetListId);
        } catch (error) {
            // Rollback on error
            card.idList = previousListId;
            requestAnimationFrame(() => {
                this.rerenderCurrentDetailView();
            });
            this.showToast('Error: ' + error.message);
        }
    }

    rerenderCurrentDetailView() {
        if (this.selectedV2Shop) {
            this.renderV2StoreDetail(this.selectedV2Shop);
        } else if (this.currentStore) {
            this.renderStoreDetail(this.currentStore);
        }
    }

    refresh() {
        if (this.currentView === 'stores') {
            this.loadBoard();
        } else if (this.currentView === 'detail') {
            const savedV2Shop = this.selectedV2Shop;
            const savedStore = this.currentStore;
            this.loadBoard().then(() => {
                if (savedV2Shop) {
                    // Re-find the V2 shop after reload
                    const shop = this.getShopsByCity(savedV2Shop.cityCode)
                        .find(s => s.shopCode === savedV2Shop.shopCode);
                    if (shop) {
                        this.showV2StoreDetail(shop);
                    } else {
                        this.showStoreCards();
                    }
                } else if (savedStore) {
                    const storeLabel = this.labels.find(l => l.id === savedStore.id);
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
        this.selectedV2Shop = null;
        this.selectedFloor = 'all';

        document.getElementById('store-cards-view').classList.add('hidden');
        document.getElementById('store-detail-view').classList.add('hidden');
        document.getElementById('shopping-mode-view').classList.remove('hidden');

        this.renderShoppingMode();
    }

    renderShoppingMode() {
        const container = document.getElementById('shopping-mode-container');

        // If no store selected (neither legacy nor V2), show store selector
        if (!this.selectedStore && !this.selectedV2Shop) {
            this.renderStoreSelector(container);
            return;
        }

        // Store is selected, show shopping view
        this.renderShoppingView(container);
    }

    renderStoreSelector(container) {
        const storeNames = this.getStoreNames();
        const storeLabels = this.labels.filter(l => storeNames.includes(l.name));

        // Get V2 shops for current city
        const v2Shops = this.getShopsByCity(this.activeCity);

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

        // Show V2 shops first if they exist
        if (v2Shops.length > 0) {
            v2Shops.forEach(shop => {
                const colorHex = this.getLabelColorHex(shop.color || 'orange');
                html += `
                    <button class="shopping-store-card shopping-store-v2" data-v2-shop="${shop.cityCode}_${shop.shopCode}">
                        <div class="shopping-store-icon" style="background: ${colorHex}20; color: ${colorHex}">
                            ${shop.icon || '🏪'}
                        </div>
                        <span class="shopping-store-name">${shop.name}</span>
                        ${shop.isMultiFloor ? `<span class="shopping-store-floors">${shop.totalFloors} plantas</span>` : ''}
                    </button>
                `;
            });
        }

        // Show legacy stores
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

        // V2 shop click handlers
        container.querySelectorAll('.shopping-store-v2').forEach(btn => {
            btn.addEventListener('click', () => {
                const shopKey = btn.dataset.v2Shop;
                const [cityCode, shopCode] = shopKey.split('_');
                this.selectedV2Shop = this.getShopInfo(cityCode, shopCode);
                this.selectedStore = null;
                this.selectedFloor = 'all';
                this.renderShoppingMode();
            });
        });

        // Legacy store click handlers
        container.querySelectorAll('.shopping-store-card:not(.shopping-store-v2)').forEach(btn => {
            btn.addEventListener('click', () => {
                const storeId = btn.dataset.storeId;
                this.selectedStore = this.labels.find(l => l.id === storeId);
                this.selectedV2Shop = null;
                this.renderShoppingMode();
            });
        });
    }

    renderShoppingView(container) {
        let storeProducts, activeStoreProducts, storeIcon, storeName;
        let isV2Shop = false;
        let isMultiFloor = false;
        let totalFloors = 1;

        if (this.selectedV2Shop) {
            // V2 shop - filter by tag prefix
            isV2Shop = true;
            isMultiFloor = this.selectedV2Shop.isMultiFloor;
            totalFloors = this.selectedV2Shop.totalFloors;
            storeIcon = this.selectedV2Shop.icon || '🏪';
            storeName = this.selectedV2Shop.name;

            // Find products with V2 tags matching this shop
            const tagPrefix = `${this.selectedV2Shop.cityCode}_${this.selectedV2Shop.shopCode}_`;
            storeProducts = this.cards.filter(card => {
                // Check if any label name is a V2 tag for this shop
                return card.idLabels.some(labelId => {
                    const label = this.labels.find(l => l.id === labelId);
                    return label && TagSystem.isValidTag(label.name) && label.name.startsWith(tagPrefix);
                });
            });

            activeStoreProducts = storeProducts.filter(c => c.idList === this.activeList?.id);
        } else {
            // Legacy store
            storeProducts = this.cards.filter(c => c.idLabels.includes(this.selectedStore.id));
            activeStoreProducts = storeProducts.filter(c => c.idList === this.activeList?.id);
            storeIcon = this.getStoreIcon(this.selectedStore.name);
            storeName = this.selectedStore.name;
        }

        // Get location labels (excluding store names), sorted alphabetically
        const storeNames = this.getStoreNames();
        const locationLabels = this.labels
            .filter(l => !storeNames.includes(l.name))
            .sort((a, b) => a.name.localeCompare(b.name, 'es'));

        let html = `
            <div class="shopping-view">
                <div class="shopping-header">
                    <button class="back-button" id="back-to-shopping-stores">← Cambiar tienda</button>
                    <div class="shopping-title">
                        <span>${storeIcon}</span>
                        <strong>${storeName}</strong>
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

        // Sort location labels to group closets by room
        const sortedLocations = [...locationLabels].sort((a, b) => {
            const aDecoded = TagSystem.isValidTag(a.name) ? TagSystem.decodeTag(a.name) : null;
            const bDecoded = TagSystem.isValidTag(b.name) ? TagSystem.decodeTag(b.name) : null;

            // V2 tags: sort by room code first, then closet code
            if (aDecoded && bDecoded) {
                if (aDecoded.room !== bDecoded.room) {
                    return aDecoded.room.localeCompare(bDecoded.room);
                }
                return aDecoded.closet.localeCompare(bDecoded.closet);
            }
            // V2 tags before legacy labels
            if (aDecoded && !bDecoded) return -1;
            if (!aDecoded && bDecoded) return 1;
            // Legacy labels: alphabetical
            return a.name.localeCompare(b.name, 'es');
        });

        sortedLocations.forEach(location => {
            const locationProducts = storeProducts.filter(c => c.idLabels.includes(location.id));

            if (locationProducts.length > 0) {
                const inList = locationProducts.filter(c => c.idList === this.activeList?.id).length;

                // Get display name: for V2 tags show "Room : Closet" format, for legacy show label name
                let displayName = location.name;
                if (TagSystem.isValidTag(location.name)) {
                    const decoded = TagSystem.decodeTag(location.name);
                    if (decoded) {
                        if (decoded.hasCloset) {
                            const roomName = this.getRoomName(decoded.city, decoded.room);
                            const closetName = this.getClosetName(decoded.city, decoded.room, decoded.closet);
                            displayName = `${roomName} : ${closetName}`;
                        } else if (decoded.hasRoom) {
                            displayName = this.getRoomName(decoded.city, decoded.room);
                        } else {
                            displayName = 'Sin ubicación específica';
                        }
                    }
                }

                html += `
                    <div class="location-section">
                        <div class="location-header" style="background: ${this.getLabelColorHex(location.color)}">
                            ${displayName}
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
            this.selectedV2Shop = null;
            this.selectedFloor = 'all';
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
                this.rerenderCurrentDetailView();
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
                    this.rerenderCurrentDetailView();
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
                    <button class="settings-option" id="settings-dictionaries">
                        <span class="settings-option-icon">
                            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="white" viewBox="0 0 16 16">
                                <path d="M1 2.828c.885-.37 2.154-.769 3.388-.893 1.33-.134 2.458.063 3.112.752v9.746c-.935-.53-2.12-.603-3.213-.493-1.18.12-2.37.461-3.287.811V2.828zm7.5-.141c.654-.689 1.782-.886 3.112-.752 1.234.124 2.503.523 3.388.893v9.923c-.918-.35-2.107-.692-3.287-.81-1.094-.111-2.278-.039-3.213.492V2.687zM8 1.783C7.015.936 5.587.81 4.287.94c-1.514.153-3.042.672-3.994 1.105A.5.5 0 0 0 0 2.5v11a.5.5 0 0 0 .707.455c.882-.4 2.303-.881 3.68-1.02 1.409-.142 2.59.087 3.223.877a.5.5 0 0 0 .78 0c.633-.79 1.814-1.019 3.222-.877 1.378.139 2.8.62 3.681 1.02A.5.5 0 0 0 16 13.5v-11a.5.5 0 0 0-.293-.455c-.952-.433-2.48-.952-3.994-1.105C10.413.809 8.985.936 8 1.783z"/>
                            </svg>
                        </span>
                        <div class="settings-option-text">
                            <strong>Gestionar diccionarios</strong>
                            <span>Ciudades, tiendas, habitaciones y armarios</span>
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
        document.body.style.overflow = 'hidden';

        const closeModal = () => {
            modal.remove();
            document.body.style.overflow = '';
        };

        // Bind events
        document.getElementById('settings-close').addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });

        document.getElementById('settings-import-export').addEventListener('click', () => {
            modal.remove();
            this.showImportExportModal();
        });

        document.getElementById('settings-dictionaries').addEventListener('click', () => {
            modal.remove();
            this.showDictionaryModal();
        });

        document.getElementById('settings-logout').addEventListener('click', () => {
            closeModal();
            this.logout();
        });
    }

    // ==================== Dictionary Management ====================

    showDictionaryModal() {
        const existingModal = document.getElementById('dictionary-modal-dynamic');
        if (existingModal) existingModal.remove();

        // Check if dictionary lists exist
        if (!this.dictCitiesList || !this.dictShopsList || !this.dictRoomsList || !this.dictClosetsList) {
            this.showToast('Error: Las listas de diccionarios no están configuradas. Recarga la página.');
            return;
        }

        const modal = document.createElement('div');
        modal.id = 'dictionary-modal-dynamic';
        modal.className = 'modal-overlay';

        const renderContent = () => {
            const currentCity = this.activeCity;
            const cityName = currentCity ? this.getCityName(currentCity) : null;

            // If no cities exist, show city creation first
            if (this.cities.length === 0) {
                modal.innerHTML = `
                    <div class="modal" style="max-width: 450px;">
                        <div class="modal-header">
                            <h3 class="modal-title">Configurar Diccionarios</h3>
                            <button class="modal-close" id="dict-modal-close">×</button>
                        </div>
                        <div class="modal-section" style="text-align: center; padding: 30px;">
                            <div style="font-size: 48px; margin-bottom: 16px;">🏙️</div>
                            <h4 style="margin-bottom: 8px;">Primero, añade una ciudad</h4>
                            <p style="color: var(--text-muted); margin-bottom: 20px;">
                                Las tiendas, habitaciones y armarios pertenecerán a la ciudad que selecciones.
                            </p>
                            <button class="btn btn-primary" id="add-first-city-btn" style="min-height: 48px; padding: 14px 24px; font-size: 16px; -webkit-tap-highlight-color: transparent; touch-action: manipulation;">+ Añadir primera ciudad</button>
                        </div>
                    </div>
                `;
                // Use modal.querySelector since modal isn't in DOM yet
                modal.querySelector('#dict-modal-close')?.addEventListener('click', () => {
                    modal.remove();
                    document.body.style.overflow = '';
                    if (this.currentView === 'stores') this.showStoreCards();
                });
                modal.addEventListener('click', (e) => {
                    if (e.target === modal) {
                        modal.remove();
                        document.body.style.overflow = '';
                    }
                });
                modal.querySelector('#add-first-city-btn')?.addEventListener('click', () => {
                    this.showAddDictionaryItemModal('city', renderContent);
                });
                return;
            }

            // Normal view with active city
            modal.innerHTML = `
                <div class="modal" style="max-height: 90vh; overflow-y: auto;">
                    <div class="modal-header">
                        <h3 class="modal-title">Diccionarios</h3>
                        <button class="modal-close" id="dict-modal-close">×</button>
                    </div>

                    <!-- Active City Selector -->
                    <div class="modal-section" style="background: var(--bg-secondary); border-radius: 8px; margin: 0 16px 16px;">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <span style="font-size: 24px;">🏙️</span>
                            <div style="flex: 1;">
                                <div style="font-size: 12px; color: var(--text-muted);">Ciudad activa</div>
                                <select id="active-city-select" class="input" style="margin-top: 4px; font-weight: 600;">
                                    ${this.cities.map(c => `
                                        <option value="${c.code}" ${c.code === currentCity ? 'selected' : ''}>${c.name}</option>
                                    `).join('')}
                                </select>
                            </div>
                            <button class="add-btn-compact" id="add-city-btn" title="Añadir ciudad">+</button>
                        </div>
                    </div>

                    <!-- Shops Section -->
                    <div class="modal-section">
                        <div class="modal-section-title">🏪 Tiendas de ${cityName}</div>
                        <div class="dict-list" id="dict-shops-list">
                            ${this.getShopsByCity(currentCity).length === 0 ?
                                '<p style="color: var(--text-muted); font-size: 14px;">No hay tiendas en esta ciudad</p>' :
                                this.getShopsByCity(currentCity).map(s => `
                                    <div class="dict-item" data-type="shop" data-card-id="${s.cardId}">
                                        <span class="dict-item-icon">${s.icon || '🏪'}</span>
                                        <span class="dict-item-name">${s.name}</span>
                                        <span class="dict-item-info">${s.isMultiFloor ? `${s.totalFloors} plantas` : '1 planta'}</span>
                                        <button class="dict-item-delete" data-card-id="${s.cardId}">×</button>
                                    </div>
                                `).join('')
                            }
                        </div>
                        <button class="add-dict-btn" id="add-shop-btn"><span class="add-icon">+</span> Añadir tienda</button>
                    </div>

                    <!-- Rooms Section -->
                    <div class="modal-section">
                        <div class="modal-section-title">🚪 Habitaciones de ${cityName}</div>
                        <div class="dict-list" id="dict-rooms-list">
                            ${this.getRoomsByCity(currentCity).length === 0 ?
                                '<p style="color: var(--text-muted); font-size: 14px;">No hay habitaciones en esta ciudad</p>' :
                                this.getRoomsByCity(currentCity).map(r => `
                                    <div class="dict-item" data-type="room" data-card-id="${r.cardId}">
                                        <span class="dict-item-name">${r.name}</span>
                                        <button class="dict-item-delete" data-card-id="${r.cardId}">×</button>
                                    </div>
                                `).join('')
                            }
                        </div>
                        <button class="add-dict-btn" id="add-room-btn"><span class="add-icon">+</span> Añadir habitación</button>
                    </div>

                    <!-- Closets Section -->
                    <div class="modal-section">
                        <div class="modal-section-title">🗄️ Armarios de ${cityName}</div>
                        <div class="dict-list" id="dict-closets-list">
                            ${this.closets.filter(c => c.cityCode === currentCity).length === 0 ?
                                '<p style="color: var(--text-muted); font-size: 14px;">No hay armarios en esta ciudad</p>' :
                                this.closets.filter(c => c.cityCode === currentCity).map(c => {
                                    const roomName = this.getRoomName(c.cityCode, c.roomCode);
                                    return `
                                        <div class="dict-item" data-type="closet" data-card-id="${c.cardId}">
                                            <span class="dict-item-name">${c.name}</span>
                                            <span class="dict-item-info">${roomName}</span>
                                            <button class="dict-item-delete" data-card-id="${c.cardId}">×</button>
                                        </div>
                                    `;
                                }).join('')
                            }
                        </div>
                        <button class="add-dict-btn" id="add-closet-btn" ${this.getRoomsByCity(currentCity).length === 0 ? 'disabled title="Primero añade una habitación"' : ''}><span class="add-icon">+</span> Añadir armario</button>
                    </div>
                </div>
            `;

            // Bind all events
            this.bindDictionaryModalEvents(modal, renderContent);
        };

        renderContent();
        document.body.appendChild(modal);
        document.body.style.overflow = 'hidden';
    }

    bindDictionaryModalClose(modal) {
        const closeModal = () => {
            modal.remove();
            document.body.style.overflow = '';
            // Refresh main view when closing
            if (this.currentView === 'stores') {
                this.showStoreCards();
            }
        };
        modal.querySelector('#dict-modal-close')?.addEventListener('click', closeModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
    }

    bindDictionaryModalEvents(modal, renderContent) {
        this.bindDictionaryModalClose(modal);

        // Active city selector
        modal.querySelector('#active-city-select')?.addEventListener('change', (e) => {
            this.activeCity = e.target.value;
            localStorage.setItem('active_city', this.activeCity);
            renderContent();
        });

        // Delete buttons
        modal.querySelectorAll('.dict-item-delete').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const cardId = btn.dataset.cardId;
                if (confirm('¿Eliminar este elemento?')) {
                    try {
                        await this.trelloFetch(`/cards/${cardId}`, { method: 'DELETE' });
                        this.cards = this.cards.filter(c => c.id !== cardId);
                        this.loadDictionaries();
                        renderContent();
                        this.showToast('Eliminado');
                    } catch (error) {
                        this.showToast('Error: ' + error.message);
                    }
                }
            });
        });

        // Add buttons
        modal.querySelector('#add-city-btn')?.addEventListener('click', () => {
            this.showAddDictionaryItemModal('city', renderContent);
        });
        modal.querySelector('#add-shop-btn')?.addEventListener('click', () => {
            this.showAddDictionaryItemModal('shop', renderContent);
        });
        modal.querySelector('#add-room-btn')?.addEventListener('click', () => {
            this.showAddDictionaryItemModal('room', renderContent);
        });
        modal.querySelector('#add-closet-btn')?.addEventListener('click', () => {
            this.showAddDictionaryItemModal('closet', renderContent);
        });
    }

    showAddDictionaryItemModal(type, parentRenderCallback) {
        const overlay = document.createElement('div');
        overlay.className = 'modal-overlay';
        overlay.style.zIndex = '1001';

        const titles = {
            city: 'Nueva Ciudad',
            shop: 'Nueva Tienda',
            room: 'Nueva Habitación',
            closet: 'Nuevo Armario'
        };

        const currentCity = this.activeCity;

        // Get next available code
        const getNextCode = (items, codeField = 'code') => {
            if (!items || items.length === 0) return '00';
            const codes = items.map(i => parseInt(i[codeField], 10)).filter(n => !isNaN(n));
            if (codes.length === 0) return '00';
            return String(Math.max(...codes) + 1).padStart(2, '0');
        };

        let formContent = '';

        if (type === 'city') {
            const nextCode = getNextCode(this.cities);
            formContent = `
                <div class="input-group">
                    <label>Nombre de la ciudad</label>
                    <input type="text" id="dict-name" class="input" placeholder="Ej: Sant Cugat" autofocus>
                </div>
                <input type="hidden" id="dict-code" value="${nextCode}">
            `;
        } else if (type === 'shop') {
            const nextCode = getNextCode(this.getShopsByCity(currentCity), 'shopCode');
            formContent = `
                <div class="input-group">
                    <label>Nombre de la tienda</label>
                    <input type="text" id="dict-name" class="input" placeholder="Ej: Mercadona" autofocus>
                </div>
                <div class="input-group">
                    <label>Icono (emoji)</label>
                    <input type="text" id="dict-icon" class="input" placeholder="🛒" maxlength="4" style="width: 80px;">
                </div>
                <div class="input-group">
                    <label>¿Tiene múltiples plantas?</label>
                    <select id="dict-multifloor" class="input">
                        <option value="0">No (1 planta)</option>
                        <option value="1">Sí</option>
                    </select>
                </div>
                <div class="input-group" id="floors-group" style="display: none;">
                    <label>Número de plantas</label>
                    <input type="number" id="dict-floors" class="input" value="2" min="2" max="99">
                </div>
                <input type="hidden" id="dict-code" value="${nextCode}">
            `;
        } else if (type === 'room') {
            const nextCode = getNextCode(this.getRoomsByCity(currentCity), 'roomCode');
            formContent = `
                <div class="input-group">
                    <label>Nombre de la habitación</label>
                    <input type="text" id="dict-name" class="input" placeholder="Ej: Cocina" autofocus>
                </div>
                <input type="hidden" id="dict-code" value="${nextCode}">
            `;
        } else if (type === 'closet') {
            const rooms = this.getRoomsByCity(currentCity);
            const firstRoom = rooms.length > 0 ? rooms[0].roomCode : '00';
            const nextCode = getNextCode(this.getClosetsByRoom(currentCity, firstRoom), 'closetCode');
            formContent = `
                <div class="input-group">
                    <label>Habitación</label>
                    <select id="dict-room" class="input">
                        ${rooms.map(r => `<option value="${r.roomCode}">${r.name}</option>`).join('')}
                    </select>
                </div>
                <div class="input-group">
                    <label>Nombre del armario</label>
                    <input type="text" id="dict-name" class="input" placeholder="Ej: Nevera" autofocus>
                </div>
                <input type="hidden" id="dict-code" value="${nextCode}">
            `;
        }

        overlay.innerHTML = `
            <div class="modal" style="max-width: 380px;">
                <div class="modal-header">
                    <h3 class="modal-title">${titles[type]}</h3>
                    <button class="modal-close" id="dict-add-close">×</button>
                </div>
                <div class="modal-section">
                    ${formContent}
                </div>
                <div style="padding: 0 20px 20px; display: flex; gap: 10px;">
                    <button class="btn btn-secondary" id="dict-add-cancel" style="flex: 1;">Cancelar</button>
                    <button class="btn btn-primary" id="dict-add-save" style="flex: 1;">Guardar</button>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);

        const closeOverlay = () => overlay.remove();

        document.getElementById('dict-add-close')?.addEventListener('click', closeOverlay);
        document.getElementById('dict-add-cancel')?.addEventListener('click', closeOverlay);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeOverlay();
        });

        // Focus input
        setTimeout(() => document.getElementById('dict-name')?.focus(), 100);

        // Toggle floors input for shops
        if (type === 'shop') {
            const multifloorSelect = document.getElementById('dict-multifloor');
            const floorsGroup = document.getElementById('floors-group');
            multifloorSelect?.addEventListener('change', () => {
                floorsGroup.style.display = multifloorSelect.value === '1' ? 'block' : 'none';
            });
        }

        // Update closet code when room changes
        if (type === 'closet') {
            const roomSelect = document.getElementById('dict-room');
            roomSelect?.addEventListener('change', () => {
                const nextCode = getNextCode(this.getClosetsByRoom(currentCity, roomSelect.value), 'closetCode');
                document.getElementById('dict-code').value = nextCode;
            });
        }

        // Save button
        document.getElementById('dict-add-save')?.addEventListener('click', async () => {
            const name = document.getElementById('dict-name')?.value.trim();
            if (!name) {
                this.showToast('El nombre es obligatorio');
                return;
            }

            const saveBtn = document.getElementById('dict-add-save');
            saveBtn.disabled = true;
            saveBtn.textContent = 'Guardando...';

            try {
                let cardName = '';
                let listId = '';
                let desc = '';

                const code = document.getElementById('dict-code').value;

                if (type === 'city') {
                    cardName = TagSystem.formatCityCard(code, name);
                    listId = this.dictCitiesList.id;
                } else if (type === 'shop') {
                    const isMultiFloor = document.getElementById('dict-multifloor')?.value === '1';
                    const floors = isMultiFloor ? parseInt(document.getElementById('dict-floors')?.value || '2', 10) : 1;
                    const icon = document.getElementById('dict-icon')?.value.trim() || '🏪';
                    cardName = TagSystem.formatShopCard(currentCity, code, isMultiFloor, floors, name);
                    listId = this.dictShopsList.id;
                    desc = `icon:${icon}`;
                } else if (type === 'room') {
                    cardName = TagSystem.formatRoomCard(currentCity, code, name);
                    listId = this.dictRoomsList.id;
                } else if (type === 'closet') {
                    const roomCode = document.getElementById('dict-room')?.value;
                    cardName = TagSystem.formatClosetCard(currentCity, roomCode, code, name);
                    listId = this.dictClosetsList.id;
                }

                const card = await this.createCard(listId, cardName, [], desc);
                this.cards.push(card);
                this.loadDictionaries();

                // Set as active city if it's the first one
                if (type === 'city' && this.cities.length === 1) {
                    this.activeCity = this.cities[0].code;
                    localStorage.setItem('active_city', this.activeCity);
                }

                closeOverlay();
                parentRenderCallback();
                this.showToast(`${titles[type].replace('Nuev', '')} añadid${type === 'city' || type === 'room' ? 'a' : 'o'}`);
            } catch (error) {
                console.error('Error creating dictionary item:', error);
                this.showToast('Error: ' + error.message);
                saveBtn.disabled = false;
                saveBtn.textContent = 'Guardar';
            }
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
                this.rerenderCurrentDetailView();
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
                this.rerenderCurrentDetailView();
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
        document.body.style.overflow = 'hidden';

        // Reset image upload area
        const uploadArea = document.getElementById('image-upload-area');
        const imageInput = document.getElementById('product-image');
        const preview = document.getElementById('image-preview');

        imageInput.value = '';
        preview.innerHTML = '';
        preview.classList.remove('has-image');
        uploadArea.classList.remove('has-image');

        // Populate tag builder (V2)
        this.populateTagBuilder();

        // Setup image upload handlers
        this.setupImageUpload();

        // Focus input
        setTimeout(() => document.getElementById('product-name').focus(), 100);
    }

    populateTagBuilder() {
        const citySelect = document.getElementById('tag-city');
        const shopsPicker = document.getElementById('shops-picker');
        const roomsPicker = document.getElementById('rooms-picker');

        if (!citySelect || !shopsPicker || !roomsPicker) {
            console.error('Tag builder elements not found');
            return;
        }

        // Clear selected tags
        this.selectedV2Tags = this.selectedV2Tags || [];

        // Populate cities
        citySelect.innerHTML = '<option value="">-- Selecciona ciudad --</option>' +
            this.cities.map(c => `<option value="${c.code}" ${c.code === this.activeCity ? 'selected' : ''}>${c.name}</option>`).join('');

        // Render shops with checkboxes
        const renderShops = () => {
            const cityCode = citySelect.value;
            const shops = cityCode ? this.getShopsByCity(cityCode) : [];

            if (shops.length === 0) {
                shopsPicker.innerHTML = '<div class="location-picker-empty">Selecciona una ciudad primero</div>';
                return;
            }

            shopsPicker.innerHTML = shops.map(shop => {
                const floorOptions = shop.isMultiFloor && shop.totalFloors > 1
                    ? Array.from({length: shop.totalFloors}, (_, i) => {
                        const code = String(i).padStart(2, '0');
                        const name = i === 0 ? 'Baja' : `P${i}`;
                        return `<option value="${code}">${name}</option>`;
                    }).join('')
                    : '';

                return `
                    <label class="location-picker-item" data-type="shop" data-shop="${shop.shopCode}">
                        <input type="checkbox" class="shop-checkbox" data-shop="${shop.shopCode}">
                        <span class="item-name">${shop.name}</span>
                        ${floorOptions ? `<select class="floor-select" data-shop="${shop.shopCode}">${floorOptions}</select>` : ''}
                    </label>
                `;
            }).join('');
        };

        // Render rooms with closets nested
        const renderRooms = () => {
            const cityCode = citySelect.value;
            const rooms = cityCode ? this.getRoomsByCity(cityCode) : [];

            if (rooms.length === 0) {
                roomsPicker.innerHTML = '<div class="location-picker-empty">No hay habitaciones configuradas</div>';
                return;
            }

            let html = '';
            rooms.forEach(room => {
                // Room checkbox
                html += `
                    <label class="location-picker-item" data-type="room" data-room="${room.roomCode}">
                        <input type="checkbox" class="room-checkbox" data-room="${room.roomCode}">
                        <span class="item-name">${room.name}</span>
                    </label>
                `;

                // Closets for this room (indented)
                const closets = this.getClosetsByRoom(cityCode, room.roomCode);
                closets.forEach(closet => {
                    html += `
                        <label class="location-picker-item closet-item" data-type="closet" data-room="${room.roomCode}" data-closet="${closet.closetCode}">
                            <input type="checkbox" class="closet-checkbox" data-room="${room.roomCode}" data-closet="${closet.closetCode}">
                            <span class="item-name">${closet.name}</span>
                        </label>
                    `;
                });
            });

            roomsPicker.innerHTML = html;
        };

        // Handle checkbox changes for visual feedback
        const handleCheckboxChange = (e) => {
            const item = e.target.closest('.location-picker-item');
            if (item) {
                item.classList.toggle('selected', e.target.checked);
            }
        };

        // Event delegation for the tag builder container
        const container = document.getElementById('tag-builder');
        if (container) {
            container._tagBuilderHandler && container.removeEventListener('change', container._tagBuilderHandler);

            container._tagBuilderHandler = (e) => {
                if (e.target.id === 'tag-city') {
                    renderShops();
                    renderRooms();
                } else if (e.target.type === 'checkbox') {
                    handleCheckboxChange(e);
                }
            };

            container.addEventListener('change', container._tagBuilderHandler);
        }

        // Initialize
        renderShops();
        renderRooms();
    }

    // Get selected V2 tags from the tag builder
    getSelectedV2Tags() {
        const citySelect = document.getElementById('tag-city');
        const cityCode = citySelect?.value;

        if (!cityCode) return [];

        const tags = [];

        // Get selected shops
        const shopCheckboxes = document.querySelectorAll('.shop-checkbox:checked');
        shopCheckboxes.forEach(cb => {
            const shopCode = cb.dataset.shop;
            const floorSelect = document.querySelector(`.floor-select[data-shop="${shopCode}"]`);
            const floorCode = floorSelect?.value || '00';

            // Get selected rooms/closets for this shop
            const roomCheckboxes = document.querySelectorAll('.room-checkbox:checked');
            const closetCheckboxes = document.querySelectorAll('.closet-checkbox:checked');

            if (roomCheckboxes.length === 0 && closetCheckboxes.length === 0) {
                // Shop only, no room/closet
                tags.push(TagSystem.encodeTag(cityCode, shopCode, floorCode, '99', '99'));
            } else {
                // Add tag for each selected room (without closet)
                roomCheckboxes.forEach(rcb => {
                    const roomCode = rcb.dataset.room;
                    // Check if any closet of this room is selected
                    const roomClosets = document.querySelectorAll(`.closet-checkbox:checked[data-room="${roomCode}"]`);
                    if (roomClosets.length === 0) {
                        // Room without closet
                        tags.push(TagSystem.encodeTag(cityCode, shopCode, floorCode, roomCode, '99'));
                    }
                });

                // Add tag for each selected closet
                closetCheckboxes.forEach(ccb => {
                    const roomCode = ccb.dataset.room;
                    const closetCode = ccb.dataset.closet;
                    tags.push(TagSystem.encodeTag(cityCode, shopCode, floorCode, roomCode, closetCode));
                });
            }
        });

        return tags;
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
                <button type="button" class="image-preview-remove">✕</button>
            `;
            preview.classList.remove('hidden');
            preview.classList.add('has-image');
            uploadArea.classList.add('has-image');

            // Add event listener directly to button
            const removeBtn = preview.querySelector('.image-preview-remove');
            removeBtn.addEventListener('click', (ev) => {
                ev.stopPropagation();
                ev.preventDefault();
                this.removeImagePreview();
            });
        };
        reader.readAsDataURL(file);
    }

    removeImagePreview() {
        const uploadArea = document.getElementById('image-upload-area');
        const imageInput = document.getElementById('product-image');
        const preview = document.getElementById('image-preview');

        imageInput.value = '';
        preview.innerHTML = '';
        preview.classList.add('hidden');
        preview.classList.remove('has-image');
        uploadArea.classList.remove('has-image');
    }

    closeAddModal() {
        document.getElementById('add-modal').classList.add('hidden');
        document.body.style.overflow = '';
    }

    async createProduct() {
        const btn = document.getElementById('create-product-btn');

        // Prevent double submission
        if (btn.disabled) {
            console.log('⚠️ createProduct already in progress, ignoring');
            return;
        }

        const name = document.getElementById('product-name').value.trim();
        const descriptionInput = document.getElementById('product-description').value.trim();
        const imageInput = document.getElementById('product-image');
        const imageFile = imageInput.files[0];

        if (!name) {
            this.showToast('Introduce un nombre para el producto');
            return;
        }

        // Get selected V2 tags (multiple locations)
        const v2Tags = this.getSelectedV2Tags();
        const hasV2Tags = v2Tags.length > 0;

        // Enforce at least one location tag
        if (!hasV2Tags) {
            this.showToast('Selecciona al menos una tienda');
            return;
        }

        btn.disabled = true;
        btn.textContent = 'Creando...';

        // Find or create labels for all V2 tags
        const boardId = this.board?.id || this.selectedBoardId;
        if (!boardId) {
            this.showToast('Error: No hay tablero cargado');
            btn.disabled = false;
            btn.textContent = 'Crear Producto';
            return;
        }

        for (const tagCode of v2Tags) {
            let tagLabel = this.labels.find(l => l.name === tagCode);
            if (!tagLabel) {
                try {
                    console.log('Creating V2 tag label:', { boardId, tagCode });
                    tagLabel = await this.createLabel(boardId, tagCode, null);
                    this.labels.push(tagLabel);
                } catch (error) {
                    console.error('Error creating V2 tag label:', error);
                    this.showToast('Error: ' + (error.message || 'No se pudo crear etiqueta'));
                    btn.disabled = false;
                    btn.textContent = 'Crear Producto';
                    return;
                }
            }
            this.selectedLabels.add(tagLabel.id);
        }

        try {
            // Create card in "Todos los Productos" list
            // V2 tag code is stored as a label, not in the name (allows multiple locations per product)
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
                const updatedCard = await this.trelloFetch(`/cards/${card.id}?fields=name,idList,idLabels,pos,desc&attachments=true&attachment_fields=url,name,mimeType,previews`);
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
                if (this.selectedV2Shop) {
                    this.renderV2StoreDetail(this.selectedV2Shop);
                } else if (this.currentStore) {
                    this.renderStoreDetail(this.currentStore);
                }
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

        // Re-populate tag builder
        this.populateTagBuilder();
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
                this.rerenderCurrentDetailView();
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
window.app = app; // Expose globally for event handlers

// Script is at end of body, DOM is ready - init immediately
app.init().catch(err => console.error('Error initializing app:', err));
