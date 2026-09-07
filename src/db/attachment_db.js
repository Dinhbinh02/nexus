export const NexusAttachmentDB = {
    DB_NAME: 'NexusAttachmentDB',
    DB_VERSION: 1,
    STORE_NAME: 'attachments',
    _db: null,

    init() {
        return new Promise((resolve, reject) => {
            if (this._db) return resolve(this._db);
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.STORE_NAME)) {
                    db.createObjectStore(this.STORE_NAME);
                }
            };
            request.onsuccess = (e) => {
                this._db = e.target.result;
                this._db.onclose = () => { this._db = null; };
                this._db.onversionchange = () => { if (this._db) { this._db.close(); this._db = null; } };
                resolve(this._db);
            };
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async put(key, blob) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, 'readwrite');
            const store = tx.objectStore(this.STORE_NAME);
            const request = store.put(blob, key);
            request.onsuccess = () => resolve(true);
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async get(key) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, 'readonly');
            const store = tx.objectStore(this.STORE_NAME);
            const request = store.get(key);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async delete(key) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, 'readwrite');
            const store = tx.objectStore(this.STORE_NAME);
            const request = store.delete(key);
            request.onsuccess = () => resolve(true);
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async clear() {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, 'readwrite');
            const store = tx.objectStore(this.STORE_NAME);
            const request = store.clear();
            request.onsuccess = () => resolve(true);
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async getAll(maxSize = 2 * 1024 * 1024) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, 'readonly');
            const store = tx.objectStore(this.STORE_NAME);
            const request = store.openCursor();
            const results = {};
            const conversionPromises = [];
            request.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    const key = cursor.key;
                    const blob = cursor.value;
                    if (blob instanceof Blob) {
                        if (blob.size <= maxSize) {
                            const p = this.blobToDataURL(blob).then(dataUrl => {
                                if (dataUrl) results[key] = dataUrl;
                            });
                            conversionPromises.push(p);
                        }
                    }
                    cursor.continue();
                } else {
                    Promise.all(conversionPromises).then(() => {
                        resolve(results);
                    }).catch(reject);
                }
            };
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async getAllMetadata() {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.STORE_NAME, 'readonly');
            const store = tx.objectStore(this.STORE_NAME);
            const request = store.openCursor();
            const results = [];
            request.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    const key = cursor.key;
                    const blob = cursor.value;
                    if (blob instanceof Blob) {
                        results.push({
                            key: key,
                            size: blob.size,
                            type: blob.type
                        });
                    }
                    cursor.continue();
                } else {
                    resolve(results);
                }
            };
            request.onerror = (e) => reject(e.target.error);
        });
    },

    dataURLtoBlob(dataUrl) {
        if (!dataUrl || typeof dataUrl !== 'string') return null;
        try {
            const commaIdx = dataUrl.indexOf(',');
            if (commaIdx === -1) return null;
            const header = dataUrl.substring(0, commaIdx);
            const base64Data = dataUrl.substring(commaIdx + 1);
            const mimeMatch = header.match(/:(.*?);/);
            const mime = mimeMatch ? mimeMatch[1] : 'image/png';
            const bstr = atob(base64Data);
            const len = bstr.length;
            const u8arr = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                u8arr[i] = bstr.charCodeAt(i);
            }
            return new Blob([u8arr], { type: mime });
        } catch (e) {
            console.error('Failed to convert dataURL to Blob', e);
            return null;
        }
    },

    async dataURLtoBlobAsync(dataUrl) {
        if (!dataUrl || typeof dataUrl !== 'string') return null;
        try {
            const res = await fetch(dataUrl);
            return await res.blob();
        } catch (e) {
            return this.dataURLtoBlob(dataUrl);
        }
    },

    blobToDataURL(blob) {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
        });
    },

    async cleanupStorage(maxTotalBytes = 250 * 1024 * 1024) {
        const metadataList = await this.getAllMetadata();
        let totalBytes = metadataList.reduce((acc, item) => acc + item.size, 0);
        if (totalBytes <= maxTotalBytes) return { freed: 0, remaining: totalBytes };

        let freedBytes = 0;
        for (const item of metadataList) {
            if (totalBytes <= maxTotalBytes) break;
            await this.delete(item.key).catch(() => {});
            freedBytes += item.size;
            totalBytes -= item.size;
        }
        return { freed: freedBytes, remaining: totalBytes };
    }
};

export const NexusCacheDB = {
    DB_NAME: 'NexusCacheDB',
    DB_VERSION: 1,
    IMAGE_STORE: 'image_queries',
    AUDIO_STORE: 'audio_entries',
    _db: null,
    _migrated: false,

    init() {
        return new Promise((resolve, reject) => {
            if (this._db) return resolve(this._db);
            const request = indexedDB.open(this.DB_NAME, this.DB_VERSION);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(this.IMAGE_STORE)) {
                    db.createObjectStore(this.IMAGE_STORE);
                }
                if (!db.objectStoreNames.contains(this.AUDIO_STORE)) {
                    db.createObjectStore(this.AUDIO_STORE);
                }
            };
            request.onsuccess = async (e) => {
                this._db = e.target.result;
                this._db.onclose = () => { this._db = null; };
                this._db.onversionchange = () => { if (this._db) { this._db.close(); this._db = null; } };
                if (!this._migrated) {
                    this._migrated = true;
                    this._migrateLegacyDatabases().catch(() => {});
                }
                resolve(this._db);
            };
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async _migrateLegacyDatabases() {
        try {
            if (typeof indexedDB !== 'undefined') {
                if (typeof indexedDB.databases === 'function') {
                    const dbs = await indexedDB.databases().catch(() => []);
                    if (dbs.some(d => d.name === 'NexusImageCacheDB')) {
                        try { indexedDB.deleteDatabase('NexusImageCacheDB'); } catch (e) {}
                    }
                    if (dbs.some(d => d.name === 'NexusAudioCacheDB')) {
                        try { indexedDB.deleteDatabase('NexusAudioCacheDB'); } catch (e) {}
                    }
                } else {
                    try { indexedDB.deleteDatabase('NexusImageCacheDB'); } catch (e) {}
                    try { indexedDB.deleteDatabase('NexusAudioCacheDB'); } catch (e) {}
                }
            }
        } catch (e) {}
    },

    // --- Image Cache Methods ---
    async putImage(key, value) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.IMAGE_STORE, 'readwrite');
            const store = tx.objectStore(this.IMAGE_STORE);
            const request = store.put({ value, timestamp: Date.now() }, key);
            request.onsuccess = () => resolve(true);
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async getImage(key) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.IMAGE_STORE, 'readonly');
            const store = tx.objectStore(this.IMAGE_STORE);
            const request = store.get(key);
            request.onsuccess = () => {
                const res = request.result;
                if (res) {
                    if (Date.now() - res.timestamp > 24 * 60 * 60 * 1000) {
                        this.deleteImage(key).catch(() => {});
                        resolve(null);
                    } else {
                        resolve(res.value);
                    }
                } else {
                    resolve(null);
                }
            };
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async deleteImage(key) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.IMAGE_STORE, 'readwrite');
            const store = tx.objectStore(this.IMAGE_STORE);
            const request = store.delete(key);
            request.onsuccess = () => resolve(true);
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async clearImages() {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.IMAGE_STORE, 'readwrite');
            const store = tx.objectStore(this.IMAGE_STORE);
            const request = store.clear();
            request.onsuccess = () => resolve(true);
            request.onerror = (e) => reject(e.target.error);
        });
    },

    // --- Audio Cache Methods ---
    async putAudio(key, entry) {
        const db = await this.init();
        let dbValue = { ...entry };
        if (entry && entry.data && Array.isArray(entry.data)) {
            dbValue.data = await Promise.all(entry.data.map(async base64 => {
                if (typeof base64 !== 'string' || !base64.startsWith('data:')) return base64;
                return (await NexusAttachmentDB.dataURLtoBlobAsync(base64)) || base64;
            }));
        }
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.AUDIO_STORE, 'readwrite');
            const store = tx.objectStore(this.AUDIO_STORE);
            const request = store.put({ value: dbValue, timestamp: Date.now() }, key);
            request.onsuccess = () => resolve(true);
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async getAudio(key) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.AUDIO_STORE, 'readonly');
            const store = tx.objectStore(this.AUDIO_STORE);
            const request = store.get(key);
            request.onsuccess = async () => {
                const res = request.result;
                if (res) {
                    if (Date.now() - res.timestamp > 7 * 24 * 60 * 60 * 1000) {
                        this.deleteAudio(key).catch(() => {});
                        resolve(null);
                    } else {
                        const entry = { ...res.value };
                        if (entry && entry.data && Array.isArray(entry.data)) {
                            try {
                                const base64Promises = entry.data.map(async (item) => {
                                    if (item instanceof Blob) {
                                        return await NexusAttachmentDB.blobToDataURL(item);
                                    }
                                    return item;
                                });
                                entry.data = (await Promise.all(base64Promises)).filter(Boolean);
                            } catch (err) {
                                console.error('Failed to deserialize Blobs in audio cache get:', err);
                            }
                        }
                        resolve(entry);
                    }
                } else {
                    resolve(null);
                }
            };
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async deleteAudio(key) {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.AUDIO_STORE, 'readwrite');
            const store = tx.objectStore(this.AUDIO_STORE);
            const request = store.delete(key);
            request.onsuccess = () => resolve(true);
            request.onerror = (e) => reject(e.target.error);
        });
    },

    async clearAudio() {
        const db = await this.init();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.AUDIO_STORE, 'readwrite');
            const store = tx.objectStore(this.AUDIO_STORE);
            const request = store.clear();
            request.onsuccess = () => resolve(true);
            request.onerror = (e) => reject(e.target.error);
        });
    },

    // --- Unified Cleanup & Stats Methods ---
    async cleanupExpired() {
        const db = await this.init();
        const now = Date.now();
        await new Promise((resolve) => {
            const tx = db.transaction(this.IMAGE_STORE, 'readwrite');
            const store = tx.objectStore(this.IMAGE_STORE);
            const request = store.openCursor();
            request.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    if (now - cursor.value.timestamp > 24 * 60 * 60 * 1000) {
                        cursor.delete();
                    }
                    cursor.continue();
                } else {
                    resolve(true);
                }
            };
            request.onerror = () => resolve(false);
        });
        await new Promise((resolve) => {
            const tx = db.transaction(this.AUDIO_STORE, 'readwrite');
            const store = tx.objectStore(this.AUDIO_STORE);
            const request = store.openCursor();
            request.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    if (now - cursor.value.timestamp > 7 * 24 * 60 * 60 * 1000) {
                        cursor.delete();
                    }
                    cursor.continue();
                } else {
                    resolve(true);
                }
            };
            request.onerror = () => resolve(false);
        });
        return true;
    },

    async getStorageUsage() {
        const db = await this.init();
        let totalBytes = 0;
        return new Promise((resolve) => {
            const tx = db.transaction([this.IMAGE_STORE, this.AUDIO_STORE], 'readonly');
            const imgStore = tx.objectStore(this.IMAGE_STORE);
            const reqImg = imgStore.openCursor();
            reqImg.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    const keyStr = JSON.stringify(cursor.key);
                    const valStr = JSON.stringify(cursor.value);
                    totalBytes += (keyStr.length + valStr.length) * 2;
                    cursor.continue();
                }
            };
            const audioStore = tx.objectStore(this.AUDIO_STORE);
            const reqAudio = audioStore.openCursor();
            reqAudio.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    const keyStr = JSON.stringify(cursor.key);
                    totalBytes += keyStr.length * 2;
                    const val = cursor.value;
                    if (val) {
                        if (val.value && val.value.data && Array.isArray(val.value.data)) {
                            val.value.data.forEach(item => {
                                if (item instanceof Blob) {
                                    totalBytes += item.size;
                                } else if (typeof item === 'string') {
                                    totalBytes += item.length * 2;
                                }
                            });
                            const copy = { ...val };
                            delete copy.value.data;
                            totalBytes += JSON.stringify(copy).length * 2;
                        } else {
                            totalBytes += JSON.stringify(val).length * 2;
                        }
                    }
                    cursor.continue();
                }
            };
            tx.oncomplete = () => resolve(totalBytes);
            tx.onerror = () => resolve(totalBytes);
        });
    },

    async clearAll() {
        await Promise.all([this.clearImages(), this.clearAudio()]);
        return true;
    }
};

// Aliases for backwards-compatibility:
export const NexusImageCacheDB = {
    init: () => NexusCacheDB.init(),
    put: (key, val) => NexusCacheDB.putImage(key, val),
    get: (key) => NexusCacheDB.getImage(key),
    delete: (key) => NexusCacheDB.deleteImage(key),
    clear: () => NexusCacheDB.clearImages(),
    cleanupExpired: () => NexusCacheDB.cleanupExpired(),
    getStorageUsage: () => NexusCacheDB.getStorageUsage()
};

export const NexusAudioCacheDB = {
    init: () => NexusCacheDB.init(),
    put: (key, entry) => NexusCacheDB.putAudio(key, entry),
    get: (key) => NexusCacheDB.getAudio(key),
    delete: (key) => NexusCacheDB.deleteAudio(key),
    clear: () => NexusCacheDB.clearAudio(),
    cleanupExpired: () => NexusCacheDB.cleanupExpired(),
    getStorageUsage: () => NexusCacheDB.getStorageUsage()
};

if (typeof globalThis !== 'undefined') {
    globalThis.NexusAttachmentDB = NexusAttachmentDB;
    globalThis.NexusCacheDB = NexusCacheDB;
    globalThis.NexusImageCacheDB = NexusImageCacheDB;
    globalThis.NexusAudioCacheDB = NexusAudioCacheDB;
}
