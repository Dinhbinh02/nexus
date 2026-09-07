/**
 * Nexus Unified Apps Database (IndexedDB)
 * High-performance local storage for Custom Apps, Chat History, Code Versions/Diffs, and Sandbox Storage.
 */

export const NexusAppsDB = {
    DB_NAME: 'NexusAppsDB',
    DB_VERSION: 1,
    STORE_APPS: 'apps',
    STORE_CHECKPOINTS: 'checkpoints',
    STORE_SANDBOX: 'sandbox_storage',
    _db: null,
    _migrated: false,

    init() {
        return new Promise((resolve, reject) => {
            if (this._db) return resolve(this._db);
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);

            request.onupgradeneeded = (e) => {
                const db = e.target.result;

                // 1. Apps store (App metadata, code, chatHistory)
                if (!db.objectStoreNames.contains(this.STORE_APPS)) {
                    const appStore = db.createObjectStore(this.STORE_APPS, { keyPath: 'id' });
                    appStore.createIndex('category', 'category', { unique: false });
                    appStore.createIndex('updatedAt', 'updatedAt', { unique: false });
                    appStore.createIndex('createdAt', 'createdAt', { unique: false });
                }

                // 2. Checkpoints store (Diffs, code versions, rollback history)
                if (!db.objectStoreNames.contains(this.STORE_CHECKPOINTS)) {
                    const cpStore = db.createObjectStore(this.STORE_CHECKPOINTS, { keyPath: 'id' });
                    cpStore.createIndex('appId', 'appId', { unique: false });
                    cpStore.createIndex('timestamp', 'timestamp', { unique: false });
                }

                // 3. Sandbox storage store (Persistent data for apps running in sandbox)
                if (!db.objectStoreNames.contains(this.STORE_SANDBOX)) {
                    const sandboxStore = db.createObjectStore(this.STORE_SANDBOX, { keyPath: 'appId' });
                    sandboxStore.createIndex('updatedAt', 'updatedAt', { unique: false });
                }
            };

            request.onsuccess = async (e) => {
                this._db = e.target.result;
                this._db.onclose = () => { this._db = null; };
                this._db.onversionchange = () => {
                    if (this._db) {
                        this._db.close();
                        this._db = null;
                    }
                };

                // Run migration from chrome.storage.local once if needed
                if (!this._migrated) {
                    this._migrated = true;
                    await this._migrateFromStorageLocal().catch(err => {
                        console.warn('[NexusAppsDB] Migration warning:', err);
                    });
                }

                resolve(this._db);
            };

            request.onerror = (e) => reject(e.target.error);
        });
    },

    /**
     * Automatic migration from chrome.storage.local legacy keys
     */
    async _migrateFromStorageLocal() {
        if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
        try {
            const allStorage = await chrome.storage.local.get(null);
            if (!allStorage) return;

            // 1. Migrate apps
            if (allStorage.nexus_custom_apps && typeof allStorage.nexus_custom_apps === 'object') {
                const appsMap = allStorage.nexus_custom_apps;
                const appIds = Object.keys(appsMap);
                for (const appId of appIds) {
                    const app = appsMap[appId];
                    if (app && app.id) {
                        const existing = await this.getApp(app.id);
                        if (!existing) {
                            await this.putApp(app);
                        }
                    }
                }
            }

            // 2. Migrate sandbox storage keys (nexus_sandbox_*)
            const sandboxKeys = Object.keys(allStorage).filter(k => k.startsWith('nexus_sandbox_'));
            for (const key of sandboxKeys) {
                const appId = key.replace('nexus_sandbox_', '');
                const data = allStorage[key];
                if (appId && data && typeof data === 'object') {
                    const existing = await this.getSandboxData(appId);
                    if (!existing || Object.keys(existing).length === 0) {
                        await this.setSandboxData(appId, data);
                    }
                }
            }
        } catch (e) {
            console.warn('[NexusAppsDB] Migration skipped:', e);
        }
    },

    // ==========================================
    // APPS CRUD OPERATIONS
    // ==========================================

    async getAllApps() {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_APPS, 'readonly');
            const store = tx.objectStore(this.STORE_APPS);
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result || []);
            req.onerror = (e) => reject(e.target.error);
        });
    },

    async getAllAppsMap() {
        const list = await this.getAllApps();
        const map = {};
        for (const app of list) {
            if (app && app.id) {
                map[app.id] = app;
            }
        }
        return map;
    },

    async getApp(id) {
        if (!id) return null;
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_APPS, 'readonly');
            const store = tx.objectStore(this.STORE_APPS);
            const req = store.get(id);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = (e) => reject(e.target.error);
        });
    },

    async putApp(app) {
        if (!app || !app.id) return false;
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_APPS, 'readwrite');
            const store = tx.objectStore(this.STORE_APPS);
            const req = store.put(app);
            req.onsuccess = () => resolve(true);
            req.onerror = (e) => reject(e.target.error);
        });
    },

    async deleteApp(id) {
        if (!id) return false;
        const db = await this.init();
        await Promise.all([
            new Promise((resolve, reject) => {
                const tx = db.transaction(this.STORE_APPS, 'readwrite');
                const store = tx.objectStore(this.STORE_APPS);
                const req = store.delete(id);
                req.onsuccess = () => resolve(true);
                req.onerror = (e) => reject(e.target.error);
            }),
            this.deleteAppCheckpoints(id),
            this.clearSandboxData(id)
        ]);
        return true;
    },

    // ==========================================
    // SANDBOX PERSISTENT STORAGE
    // ==========================================

    _sandboxMemoryCache: new Map(),

    async getSandboxData(appId) {
        if (!appId) return {};
        if (this._sandboxMemoryCache.has(appId)) {
            return this._sandboxMemoryCache.get(appId) || {};
        }
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_SANDBOX, 'readonly');
            const store = tx.objectStore(this.STORE_SANDBOX);
            const req = store.get(appId);
            req.onsuccess = () => {
                const res = req.result;
                const data = res?.data || {};
                this._sandboxMemoryCache.set(appId, data);
                resolve(data);
            };
            req.onerror = (e) => reject(e.target.error);
        });
    },

    async setSandboxData(appId, data) {
        if (!appId) return false;
        const normalizedData = data || {};
        this._sandboxMemoryCache.set(appId, normalizedData);
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_SANDBOX, 'readwrite');
            const store = tx.objectStore(this.STORE_SANDBOX);
            const req = store.put({
                appId: appId,
                data: normalizedData,
                updatedAt: Date.now()
            });
            req.onsuccess = () => resolve(true);
            req.onerror = (e) => reject(e.target.error);
        });
    },

    async clearSandboxData(appId) {
        if (!appId) return false;
        this._sandboxMemoryCache.delete(appId);
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_SANDBOX, 'readwrite');
            const store = tx.objectStore(this.STORE_SANDBOX);
            const req = store.delete(appId);
            req.onsuccess = () => resolve(true);
            req.onerror = (e) => reject(e.target.error);
        });
    },

    // ==========================================
    // CHECKPOINTS & DIFF ENGINE
    // ==========================================

    computeLineDiff(beforeCode = '', afterCode = '') {
        const oldLines = beforeCode ? beforeCode.split('\n') : [];
        const newLines = afterCode ? afterCode.split('\n') : [];

        const m = oldLines.length;
        const n = newLines.length;

        if (m === 0 && n === 0) {
            return { additions: 0, deletions: 0, hasChanges: false, lines: [] };
        }
        if (beforeCode === afterCode) {
            return {
                additions: 0,
                deletions: 0,
                hasChanges: false,
                lines: oldLines.map((line, idx) => ({
                    type: 'unchanged',
                    oldLine: idx + 1,
                    newLine: idx + 1,
                    content: line
                }))
            };
        }

        const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));
        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (oldLines[i - 1] === newLines[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }

        let i = m;
        let j = n;
        const rawDiff = [];
        let additions = 0;
        let deletions = 0;

        while (i > 0 || j > 0) {
            if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
                rawDiff.push({
                    type: 'unchanged',
                    oldLine: i,
                    newLine: j,
                    content: oldLines[i - 1]
                });
                i--;
                j--;
            } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
                rawDiff.push({
                    type: 'added',
                    oldLine: null,
                    newLine: j,
                    content: newLines[j - 1]
                });
                additions++;
                j--;
            } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
                rawDiff.push({
                    type: 'removed',
                    oldLine: i,
                    newLine: null,
                    content: oldLines[i - 1]
                });
                deletions++;
                i--;
            }
        }

        rawDiff.reverse();

        return {
            additions,
            deletions,
            hasChanges: additions > 0 || deletions > 0,
            lines: rawDiff
        };
    },

    async putCheckpoint(checkpoint) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_CHECKPOINTS, 'readwrite');
            const store = tx.objectStore(this.STORE_CHECKPOINTS);
            const request = store.put(checkpoint);
            request.onsuccess = () => resolve(true);
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async getCheckpoint(id) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_CHECKPOINTS, 'readonly');
            const store = tx.objectStore(this.STORE_CHECKPOINTS);
            const request = store.get(id);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async getCheckpointsByApp(appId) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_CHECKPOINTS, 'readonly');
            const store = tx.objectStore(this.STORE_CHECKPOINTS);
            const index = store.index('appId');
            const request = index.getAll(IDBKeyRange.only(appId));
            request.onsuccess = () => {
                const list = request.result || [];
                list.sort((a, b) => a.entryIndex - b.entryIndex);
                resolve(list);
            };
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async updateStatus(id, status) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_CHECKPOINTS, 'readwrite');
            const store = tx.objectStore(this.STORE_CHECKPOINTS);
            const getReq = store.get(id);
            getReq.onsuccess = () => {
                const item = getReq.result;
                if (!item) return resolve(false);
                item.status = status;
                item.updatedAt = Date.now();
                const putReq = store.put(item);
                putReq.onsuccess = () => resolve(true);
                putReq.onerror = (e) => reject(e.target.error);
            };
            getReq.onerror = (e) => reject(e.target.error);
        });
    },

    async deleteCheckpointsFrom(appId, minEntryIndex) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_CHECKPOINTS, 'readwrite');
            const store = tx.objectStore(this.STORE_CHECKPOINTS);
            const index = store.index('appId');
            const req = index.openCursor(IDBKeyRange.only(appId));
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    if (cursor.value.entryIndex >= minEntryIndex) {
                        cursor.delete();
                    }
                    cursor.continue();
                } else {
                    resolve(true);
                }
            };
            req.onerror = (e) => reject(e.target.error);
        });
    },

    async deleteAppCheckpoints(appId) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_CHECKPOINTS, 'readwrite');
            const store = tx.objectStore(this.STORE_CHECKPOINTS);
            const index = store.index('appId');
            const req = index.openCursor(IDBKeyRange.only(appId));
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                } else {
                    resolve(true);
                }
            };
            req.onerror = (e) => reject(e.target.error);
        });
    }
};

export const NexusAppsCheckpointDB = NexusAppsDB;
