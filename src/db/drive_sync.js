import { NexusAuth, AuthService } from './google_auth.js';
import { NexusChatDB } from './chat_db.js';
import { TTSDB } from './tts_manager.js';
import { NexusAttachmentDB } from './attachment_db.js';
import { NexusAppsDB } from './apps_db.js';

// --- Crypto & Compression Helpers ---
export async function compressData(string) {
    const byteArray = new TextEncoder().encode(string);
    const stream = new CompressionStream("gzip");
    const writer = stream.writable.getWriter();
    writer.write(byteArray);
    writer.close();
    const response = new Response(stream.readable);
    return await response.arrayBuffer();
}

export async function decompressData(arrayBuffer) {
    const stream = new DecompressionStream("gzip");
    const writer = stream.writable.getWriter();
    writer.write(new Uint8Array(arrayBuffer));
    writer.close();
    const response = new Response(stream.readable);
    const buffer = await response.arrayBuffer();
    return new TextDecoder().decode(buffer);
}

export async function sha256Hash(str) {
    try {
        const msgUint8 = new TextEncoder().encode(str);
        const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
        let h = 5381;
        for (let i = 0; i < str.length; i++) {
            h = ((h << 5) + h) + str.charCodeAt(i);
            h |= 0;
        }
        return 'fallback_' + h.toString(36);
    }
}

export function syncLog(...args) {
    console.log(...args);
    try {
        if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
            chrome.runtime.sendMessage({
                action: 'nexus_sync_log',
                args: args.map(a => typeof a === 'object' ? JSON.parse(JSON.stringify(a)) : a)
            }).catch(() => {});
        }
    } catch (e) {}
}

const EXCLUDED_PREFIX_REGEX = /^(google_|temp_|rot_|pending_|nexus_img_|(nexus|sidepanel)_(tabs|active_|secondary_|tab_counter|is_split|split_|session_)|lumina_session_)/;
const EXCLUDED_KEYS = new Set([
    'google_oauth_token', 'google_oauth_token_time', 'google_user_info', 'nexus_cached_user',
    'last_sync_time', 'last_sync_hash', 'last_sync_md5', 'last_sync_size', 'last_cloud_stats',
    'drive_uploaded_blobs', 'drive_backup_file_id', 'settings_last_updated',
    'optionsLastSection', 'optionsLastScroll', 'optionsScrollPositions',
    'nexusWindowId', 'pendingMicToggle', 'nexusTemplatesV3', 'nexusBatchHistoryV3',
    'lastUsedGenAIModel', 'lastUsedBatchSize', 'lastUsedDeck', 'lastUsedTemplateId',
    'ankiQuickNoteContent', 'attachments', 'audio_cache', 'lastUsedModel',
    'lastUsedThinkingLevel', 'lastUsedModelId', 'dailyModelStats',
    'nexus_session_settings', 'nexus_spark_last_settings'
]);

export const isExcludedKey = (k) => EXCLUDED_KEYS.has(k) || k.includes('_inst_') || EXCLUDED_PREFIX_REGEX.test(k);


export class SyncManager {
    _isPageContext() {
        return typeof window !== 'undefined';
    }
    _delegateSyncToBackground(action = 'nexus_drive_sync', params = {}) {
        this.notifyListeners('Syncing...', null);
        const wrapper = (typeof document !== 'undefined') ? document.getElementById('user-avatar-wrapper') : null;
        if (wrapper) wrapper.classList.add('is-syncing');

        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage({ action, ...params }, (res) => {
                    if (chrome.runtime.lastError) {
                        console.warn('[Sync] SW delegate failed:', chrome.runtime.lastError.message);
                        if (wrapper) wrapper.classList.remove('is-syncing');
                        this.notifyListeners('Sync failure', null);
                    } else {
                        setTimeout(() => {
                            if (wrapper) wrapper.classList.remove('is-syncing');
                            this.notifyListeners('Synced just now', Date.now());
                        }, 500);
                    }
                    resolve(res);
                });
            } catch (e) {
                console.warn('[Sync] SW delegate error:', e);
                if (wrapper) wrapper.classList.remove('is-syncing');
                this.notifyListeners('Sync failure', null);
                resolve(null);
            }
        });
    }
    constructor(authService) {
        this.authService = authService || new AuthService();
        this.FILENAME = 'nexus_backup.json';
        this.listeners = [];
        this.isSyncing = false;

        const isBackground = typeof window === 'undefined';
        if (typeof window !== 'undefined') {
            setTimeout(() => {
                this.checkAutoSync(true);
            }, 200);
        }

        if (isBackground && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.onChanged) {
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area !== 'local') return;
                if (this.isSyncing) return;
                const keys = Object.keys(changes);
                const hasSettingsKeys = keys.some(k => !isExcludedKey(k));
                if (hasSettingsKeys) {
                    syncLog('[Sync:StorageChanged] Detected setting changes, scheduling debounced sync in 3s:', keys.filter(k => !isExcludedKey(k)));
                    this.triggerDebouncedSync(3000);
                }
            });
        }
    }

    triggerDebouncedSync(delayMs = 1000) {
        if (!this.authService.isAuthenticated) return;
        if (this._isPageContext()) {
            const wrapper = (typeof document !== 'undefined') ? document.getElementById('user-avatar-wrapper') : null;
            if (wrapper) wrapper.classList.add('is-syncing');
            this.notifyListeners('Syncing...', null);
            try {
                chrome.runtime.sendMessage({ action: 'nexus_drive_sync_debounced', delayMs }).catch(() => {});
            } catch (e) {}
            return;
        }
        if (this._debounceTimer) clearTimeout(this._debounceTimer);
        this._debounceTimer = setTimeout(() => {
            this._debounceTimer = null;
            this.pushToCloud().catch(err => console.error('[Sync] Debounced push failed:', err));
        }, delayMs);
    }

    addListener(callback) {
        this.listeners.push(callback);
    }
    notifyListeners(status, lastSync) {
        this.listeners.forEach(cb => cb(status, lastSync));
    }

    async checkAutoSync(forceCheck = false) {
        if (!this.authService.isAuthenticated) return;
        if (this._isPageContext()) {
            await this._delegateSyncToBackground('nexus_drive_sync', { isAuto: true });
            return;
        }
        try {
            await this.pullFromCloud(forceCheck);
        } catch (e) {
            console.error('[Sync] Auto-sync pull failed:', e);
        }
    }

    async getLastSyncTime() {
        const result = await chrome.storage.local.get(['last_sync_time']);
        return result.last_sync_time ? new Date(result.last_sync_time).toLocaleString() : 'Never';
    }

    async getToken(interactive = false) {
        return await this.authService.getAuthToken(interactive);
    }

    async syncUp(isAuto = false) {
        if (this._isPageContext()) return await this._delegateSyncToBackground('nexus_drive_sync', { isAuto: false, forcePush: true });
        return await this.pushToCloud();
    }

    async syncDown() {
        if (this._isPageContext()) return await this._delegateSyncToBackground('nexus_drive_sync', { isAuto: true, forcePull: true });
        return await this.pullFromCloud(true);
    }

    async downloadBackup(token, fileId) {
        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.status === 401 || response.status === 403) throw new Error('UNAUTHORIZED');
        if (!response.ok) throw new Error('Download failed');
        const buffer = await response.arrayBuffer();
        const arr = new Uint8Array(buffer);
        if (arr.length >= 2 && arr[0] === 0x1f && arr[1] === 0x8b) {
            const jsonStr = await decompressData(buffer);
            return JSON.parse(jsonStr);
        }
        const jsonStr = new TextDecoder().decode(buffer);
        return JSON.parse(jsonStr);
    }

    async listAppDataFiles(token) {
        const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent("'appDataFolder' in parents and trashed = false")}&spaces=appDataFolder&orderBy=${encodeURIComponent("modifiedTime desc")}&fields=files(id, name, md5Checksum, modifiedTime, size)&pageSize=1000`;
        const response = await fetch(url, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.status === 401 || response.status === 403) throw new Error('UNAUTHORIZED');
        if (!response.ok) throw new Error('Failed to list appData files');
        const data = await response.json();
        return data.files || [];
    }

    async uploadBlobFile(token, filename, blob, existingFileId = null) {
        const mimeType = (blob && blob.type) ? blob.type : 'application/octet-stream';
        const metadata = {
            name: filename,
            ...(existingFileId ? {} : { parents: ['appDataFolder'] })
        };
        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', blob, filename);

        const url = existingFileId
            ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart&fields=id,name,md5Checksum,size`
            : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,md5Checksum,size`;

        const response = await fetch(url, {
            method: existingFileId ? 'PATCH' : 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: form
        });
        if (response.status === 401 || response.status === 403) throw new Error('UNAUTHORIZED');
        if (!response.ok) throw new Error(`Failed to upload blob ${filename}`);
        return await response.json();
    }

    async downloadBlobFile(token, fileId) {
        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.status === 401 || response.status === 403) throw new Error('UNAUTHORIZED');
        if (!response.ok) throw new Error(`Failed to download blob ${fileId}`);
        return await response.blob();
    }

    async deleteDriveFile(token, fileId) {
        try {
            const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            return response.ok;
        } catch (e) {
            console.warn(`[Sync] Failed to delete drive file ${fileId}:`, e);
            return false;
        }
    }

    async createBackupFile(token, content) {
        const metadata = {
            name: this.FILENAME,
            parents: ['appDataFolder']
        };
        const compressed = await compressData(content);
        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', new Blob([compressed], { type: 'application/octet-stream' }));
        const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,md5Checksum,size', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: form
        });
        if (response.status === 401 || response.status === 403) throw new Error('UNAUTHORIZED');
        if (!response.ok) throw new Error('Failed to create file');
        return await response.json();
    }

    async updateBackupFile(token, fileId, content) {
        const metadata = {
            name: this.FILENAME
        };
        const compressed = await compressData(content);
        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', new Blob([compressed], { type: 'application/octet-stream' }));
        const response = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart&fields=id,name,md5Checksum,size`, {
            method: 'PATCH',
            headers: { 'Authorization': `Bearer ${token}` },
            body: form
        });
        if (response.status === 401 || response.status === 403) throw new Error('UNAUTHORIZED');
        if (!response.ok) throw new Error('Failed to update file');
        return await response.json();
    }

    async getFileMetadata(token, fileId) {
        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,name,md5Checksum,modifiedTime,size`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (response.status === 401 || response.status === 403) throw new Error('UNAUTHORIZED');
        if (!response.ok) return null;
        return await response.json();
    }

    async getOrFindBackupFile(token, forceRefresh = false) {
        let activeToken = token;
        let driveFiles = [];
        try {
            driveFiles = await this.listAppDataFiles(activeToken);
        } catch (err) {
            if (err.message === 'UNAUTHORIZED') {
                await chrome.storage.local.remove(['google_oauth_token', 'google_oauth_token_time']);
                activeToken = await this.authService.getAuthToken(false, true);
                driveFiles = await this.listAppDataFiles(activeToken);
            } else {
                throw err;
            }
        }

        const backupFiles = (driveFiles || []).filter(f => f.name === this.FILENAME || f.name === 'lumina_backup.json');
        if (backupFiles.length === 0) {
            this.cachedBackupFileId = null;
            await chrome.storage.local.remove(['drive_backup_file_id']).catch(() => {});
            return { token: activeToken, remoteFile: null, fileId: null, driveFiles };
        }

        const primaryFile = backupFiles[0];
        const fileId = primaryFile.id;
        this.cachedBackupFileId = fileId;
        chrome.storage.local.set({ drive_backup_file_id: fileId }).catch(() => {});

        if (backupFiles.length > 1) {
            const duplicates = backupFiles.slice(1);
            for (const dup of duplicates) {
                this.deleteDriveFile(activeToken, dup.id).catch(() => {});
            }
        }

        return { token: activeToken, remoteFile: primaryFile, fileId, driveFiles };
    }

    async gatherLocalData() {
        const rawLocal = await chrome.storage.local.get(null);
        const localData = {};
        for (const [k, v] of Object.entries(rawLocal)) {
            if (!isExcludedKey(k)) {
                localData[k] = v;
            }
        }

        if (typeof TTSDB !== 'undefined') {
            try {
                const recordings = typeof TTSDB.getAllRecordingsRaw === 'function'
                    ? await TTSDB.getAllRecordingsRaw()
                    : await TTSDB.getAllRecordings(true);
                localData.nexus_tts_recordings = recordings.map(rec => {
                    const { audioBlob, ...meta } = rec;
                    return meta;
                });
            } catch (err) {
                console.error('[Sync] Failed to gather TTS recordings for sync:', err);
            }
        }

        if (typeof NexusChatDB !== 'undefined') {
            try {
                const sessions = typeof NexusChatDB.getAllSessionsRaw === 'function'
                    ? await NexusChatDB.getAllSessionsRaw()
                    : await NexusChatDB.getAllSessions(true);
                const sessionsObj = {};
                for (const s of Object.values(sessions)) {
                    if (s && s.id) {
                        sessionsObj[s.id] = s;
                        if (!s.isDeleted) {
                            localData[`nexus_session_${s.id}`] = await NexusChatDB.getMessages(s.id).catch(() => []);
                        }
                    }
                }
                localData.nexus_chat_sessions = sessionsObj;
                syncLog('[Sync:Gather] Gathered chat sessions for backup:', Object.keys(sessionsObj).length, Object.keys(sessionsObj));
            } catch (err) {
                console.error('[Sync] Failed to load chats from IndexedDB:', err);
            }
        }

        if (typeof NexusAppsDB !== 'undefined') {
            try {
                localData.nexus_custom_apps = await NexusAppsDB.getAllAppsMap();
            } catch (err) {
                console.error('[Sync] Failed to load apps from IndexedDB:', err);
            }
        }

        return localData;
    }

    async pullFromCloud(force = false) {
        if (this._isPageContext()) {
            return await this._delegateSyncToBackground('nexus_drive_sync', { isAuto: true, forcePull: force });
        }
        if (this.isSyncing) return;
        this.isSyncing = true;
        this.notifyListeners('Syncing...', null);
        try {
            try { chrome.runtime.sendMessage({ action: 'nexus_sync_status', status: 'syncing' }).catch(() => {}); } catch (e) {}
            const initialToken = await this.getToken(!force);
            if (!initialToken) throw new Error('Not authenticated');

            const localSync = await chrome.storage.local.get(['last_sync_md5']);
            const { token, remoteFile, fileId, driveFiles } = await this.getOrFindBackupFile(initialToken, force);

            if (!remoteFile || !fileId) {
                syncLog('[Sync:Pull] No cloud backup file found on Google Drive.');
                this.notifyListeners('No cloud data', null);
                try { chrome.runtime.sendMessage({ action: 'nexus_sync_status', status: 'done', timestamp: Date.now() }).catch(() => {}); } catch (e) {}
                return null;
            }

            const localSessionData = typeof NexusChatDB !== 'undefined'
                ? await NexusChatDB.getAllSessions().catch(() => ({}))
                : {};
            const localSessionCount = Object.values(localSessionData).filter(s => s && !s.isDeleted).length;
            const lastCloudStats = (await chrome.storage.local.get(['last_cloud_stats'])).last_cloud_stats;
            const cloudSessionCount = lastCloudStats ? lastCloudStats.chatsCount : -1;

            syncLog(`[Sync:Pull] Remote MD5: ${remoteFile.md5Checksum} | Local MD5: ${localSync.last_sync_md5 || 'None'} | Local Sessions: ${localSessionCount} | Cloud Sessions: ${cloudSessionCount}`);

            if (!force && remoteFile.md5Checksum && localSync.last_sync_md5 && remoteFile.md5Checksum === localSync.last_sync_md5) {
                if (localSessionCount >= cloudSessionCount) {
                    const now = Date.now();
                    syncLog('[Sync:Pull] Remote MD5 matches last_sync_md5 and local sessions valid. Skipping download.');
                    this.notifyListeners('Synced just now', now);
                    try { chrome.runtime.sendMessage({ action: 'nexus_sync_status', status: 'done', timestamp: now }).catch(() => {}); } catch (e) {}
                    return now;
                }
            }

            const remoteBackup = await this.downloadBackup(token, fileId);

            if (!remoteBackup || !remoteBackup.data) {
                this.notifyListeners('No cloud data', null);
                try { chrome.runtime.sendMessage({ action: 'nexus_sync_status', status: 'done', timestamp: Date.now() }).catch(() => {}); } catch (e) {}
                return null;
            }

            const remoteData = remoteBackup.data;
            delete remoteData.attachments;

            const currentLocal = await chrome.storage.local.get(null);
            const keysToRemove = [];
            for (const key of Object.keys(currentLocal)) {
                if (isExcludedKey(key)) continue;
                if (key.startsWith('nexus_session_') || key === 'nexus_chat_sessions') continue;
                if (key.startsWith('highlights_')) continue;
                if (!(key in remoteData)) {
                    keysToRemove.push(key);
                }
            }
            if (keysToRemove.length > 0) {
                await chrome.storage.local.remove(keysToRemove);
            }

            const storageToSet = {};
            for (const [k, v] of Object.entries(remoteData)) {
                if (isExcludedKey(k)) continue;
                if (k.startsWith('nexus_session_') || k.startsWith('lumina_session_') || k === 'nexus_chat_sessions' || k === 'lumina_chat_sessions') continue;
                if (k.startsWith('highlights_')) continue;
                storageToSet[k] = v;
                if (k === 'sparks' || k === 'lumina_sparks') {
                    storageToSet.nexus_sparks = v;
                }
            }
            if (remoteData.sparks || remoteData.lumina_sparks) {
                storageToSet.nexus_sparks = remoteData.nexus_sparks || remoteData.lumina_sparks || remoteData.sparks;
            }
            if (Object.keys(storageToSet).length > 0) {
                await chrome.storage.local.set(storageToSet);
            }


            const remoteSessions = remoteData.nexus_chat_sessions || remoteData.lumina_chat_sessions || {};
            const activeAttachmentIds = new Set();
            const cloudUpdatedSessionIds = [];

            if (typeof NexusChatDB !== 'undefined') {
                try {
                    syncLog('[Sync:Pull] Applying chat sessions from cloud. Remote count:', Object.keys(remoteSessions).length);
                    const currentSessions = await NexusChatDB.getAllSessions().catch(() => ({}));
                    syncLog('[Sync:Pull] Current local sessions in IndexedDB:', Object.keys(currentSessions).length, Object.keys(currentSessions));
                    
                    for (const [sid, sessionMeta] of Object.entries(remoteSessions)) {
                        if (sessionMeta && sessionMeta.isDeleted) {
                            syncLog('[Sync:Pull] Session marked deleted in cloud, deleting locally:', sid);
                            await NexusChatDB.deleteSession(sid).catch(() => {});
                        } else {
                            await NexusChatDB.putSession(sessionMeta).catch(() => {});
                            const sessionKey = `nexus_session_${sid}`;
                            const messages = remoteData[sessionKey] || remoteData[`lumina_session_${sid}`];
                            if (Array.isArray(messages)) {
                                await NexusChatDB.putMessages(sid, messages).catch(() => {});
                                cloudUpdatedSessionIds.push(sid);
                                for (const msg of messages) {
                                    const rawFiles = Array.isArray(msg.files) ? msg.files : (Array.isArray(msg.images) ? msg.images : []);
                                    for (const f of rawFiles) {
                                        if (f && typeof f === 'object' && f.attachmentId) {
                                            activeAttachmentIds.add(f.attachmentId);
                                        }
                                    }
                                }
                            }
                        }
                    }

                    for (const sid of Object.keys(currentSessions)) {
                        const localMsgs = await NexusChatDB.getMessages(sid).catch(() => []);
                        for (const msg of localMsgs) {
                            const rawFiles = Array.isArray(msg.files) ? msg.files : (Array.isArray(msg.images) ? msg.images : []);
                            for (const f of rawFiles) {
                                if (f && typeof f === 'object' && f.attachmentId) {
                                    activeAttachmentIds.add(f.attachmentId);
                                }
                            }
                        }
                    }
                    syncLog('[Sync:Pull] Updated sessions from cloud:', cloudUpdatedSessionIds.length, cloudUpdatedSessionIds);
                } catch (err) {
                    console.error('[Sync] Failed to apply chats from cloud:', err);
                }
            }

            if (typeof NexusAppsDB !== 'undefined') {
                try {
                    const remoteApps = remoteData.nexus_custom_apps || remoteData.lumina_custom_apps;
                    if (remoteApps && typeof remoteApps === 'object') {
                        const currentApps = await NexusAppsDB.getAllAppsMap().catch(() => ({}));
                        const remoteAppIds = new Set(Object.keys(remoteApps));
                        for (const appId of Object.keys(currentApps)) {
                            if (!remoteAppIds.has(appId)) {
                                await NexusAppsDB.deleteApp(appId).catch(() => {});
                            }
                        }
                        for (const app of Object.values(remoteApps)) {
                            if (app && app.id) {
                                await NexusAppsDB.putApp(app).catch(() => {});
                            }
                        }
                    }
                } catch (err) {
                    console.error('[Sync] Failed to apply apps from cloud:', err);
                }
            }

            const activeTtsRecMap = new Map();
            let ttsUpdated = false;
            const remoteTtsList = remoteData.nexus_tts_recordings || remoteData.lumina_tts_recordings;
            if (typeof TTSDB !== 'undefined' && Array.isArray(remoteTtsList)) {
                try {
                    const remoteRecs = remoteTtsList;
                    const remoteRecIds = new Set(remoteRecs.map(r => r && r.id).filter(Boolean));
                    const currentRecs = await TTSDB.getAllRecordings().catch(() => []);
                    const currentMap = new Map(currentRecs.map(r => [r.id, r]));

                    for (const r of currentRecs) {
                        if (r && r.id && !remoteRecIds.has(r.id)) {
                            await TTSDB.deleteRecording(r.id).catch(() => {});
                            ttsUpdated = true;
                        }
                    }

                    for (const recMeta of remoteRecs) {
                        if (recMeta && recMeta.id) {
                            if (!recMeta.isDeleted) activeTtsRecMap.set(recMeta.id, recMeta);
                            const localRec = currentMap.get(recMeta.id);
                            await TTSDB.saveRecording({
                                ...recMeta,
                                audioBlob: localRec ? localRec.audioBlob : null
                            }).catch(() => {});
                            ttsUpdated = true;
                        }
                    }
                } catch (err) {
                    console.error('[Sync] Failed to apply TTS records from cloud:', err);
                }
            }

            let actualDriveFiles = driveFiles;
            if (!actualDriveFiles || activeAttachmentIds.size > 0 || activeTtsRecMap.size > 0) {
                actualDriveFiles = await this.listAppDataFiles(token).catch(() => []);
            }
            const driveFileMap = new Map((actualDriveFiles || []).map(f => [f.name, f]));

            syncLog(`[Sync:Attachments:Pull] Active attachment IDs needed across sessions (${activeAttachmentIds.size}):`, Array.from(activeAttachmentIds));

            if (typeof NexusAttachmentDB !== 'undefined' && NexusAttachmentDB.init) {
                const db = await NexusAttachmentDB.init();
                let downloadedCount = 0;
                for (const [filename, fileObj] of driveFileMap.entries()) {
                    if (filename.startsWith('att_') && filename.endsWith('.bin')) {
                        const key = filename.slice(4, -4);
                        if (activeAttachmentIds.has(key)) {
                            const exists = await NexusAttachmentDB.get(key).catch(() => null);
                            if (!exists) {
                                try {
                                    syncLog(`[Sync:Attachments:Pull] Downloading attachment ${key} (${fileObj.size} bytes)...`);
                                    const downloadedBlob = await this.downloadBlobFile(token, fileObj.id);
                                    if (downloadedBlob) {
                                        await NexusAttachmentDB.put(key, downloadedBlob);
                                        downloadedCount++;
                                        syncLog(`[Sync:Attachments:Pull] Saved attachment ${key} to local IndexedDB.`);
                                    }
                                } catch (err) {
                                    console.warn(`[Sync:Attachments:Pull] Failed to download attachment ${key}:`, err);
                                }
                            }
                        }
                    }
                }
                syncLog(`[Sync:Attachments:Pull] Completed attachment download check. Downloaded ${downloadedCount} new attachments.`);

                try {
                    const metadata = await NexusAttachmentDB.getAllMetadata();
                    for (const item of metadata) {
                        if (!activeAttachmentIds.has(item.key)) {
                            await NexusAttachmentDB.delete(item.key);
                        }
                    }
                } catch (cleanupErr) {}
            }

            if (typeof TTSDB !== 'undefined') {
                let ttsAudioDownloaded = false;
                const currentRecs = await TTSDB.getAllRecordings().catch(() => []);
                const localRecMap = new Map(currentRecs.map(r => [r.id, r]));

                for (const [filename, fileObj] of driveFileMap.entries()) {
                    if (filename.startsWith('tts_') && filename.endsWith('.bin')) {
                        const id = filename.slice(4, -4);
                        const localRec = localRecMap.get(id);
                        if (activeTtsRecMap.has(id) && localRec && !localRec.audioBlob) {
                            try {
                                const downloadedBlob = await this.downloadBlobFile(token, fileObj.id);
                                if (downloadedBlob) {
                                    localRec.audioBlob = downloadedBlob;
                                    await TTSDB.saveRecording(localRec);
                                    ttsAudioDownloaded = true;
                                }
                            } catch (err) {
                                console.warn(`[Sync] Failed to download TTS audio ${id}:`, err);
                            }
                        }
                    }
                }
                if (ttsAudioDownloaded) ttsUpdated = true;
            }

            const now = Date.now();
            const cloudStats = {
                chatsCount: Object.values(remoteSessions).filter(s => s && !s.isDeleted).length,
                highlightsCount: Object.keys(remoteData).filter(k => k.startsWith('highlights_')).length,
                ttsCount: Array.isArray(remoteData.nexus_tts_recordings) ? remoteData.nexus_tts_recordings.filter(r => r && !r.isDeleted).length : 0,
                appsCount: (remoteData.nexus_custom_apps && typeof remoteData.nexus_custom_apps === 'object') ? Object.keys(remoteData.nexus_custom_apps).length : 0,
                attachmentsCount: activeAttachmentIds.size
            };
            const currentGathered = await this.gatherLocalData();
            const localDataHash = await sha256Hash(JSON.stringify(currentGathered));
            syncLog('[Sync:Pull] Successfully applied cloud data. Saved localDataHash:', localDataHash);
            await chrome.storage.local.set({
                last_sync_time: now,
                last_sync_hash: localDataHash,
                last_sync_md5: remoteFile ? remoteFile.md5Checksum : null,
                last_sync_size: remoteFile ? remoteFile.size : null,
                last_cloud_stats: cloudStats
            });
            if (typeof globalThis !== 'undefined') globalThis._lastDriveSyncAt = now;

            try {
                chrome.runtime.sendMessage({ action: 'nexus_sessions_index_updated' }).catch(() => {});
                if (cloudUpdatedSessionIds && cloudUpdatedSessionIds.length > 0) {
                    for (const sid of cloudUpdatedSessionIds) {
                        chrome.runtime.sendMessage({ action: 'nexus_session_updated', sessionId: sid, source: 'cloud_sync' }).catch(() => {});
                    }
                }
                chrome.runtime.sendMessage({ action: 'nexus_highlights_updated' }).catch(() => {});
                chrome.runtime.sendMessage({ action: 'nexus_apps_updated' }).catch(() => {});
                if (ttsUpdated) {
                    chrome.runtime.sendMessage({ action: 'nexus_tts_updated' }).catch(() => {});
                }
                chrome.runtime.sendMessage({ action: 'nexus_sync_status', status: 'done', timestamp: now }).catch(() => {});
            } catch (e) {}

            this.notifyListeners('Synced just now', now);
            return now;
        } catch (error) {
            console.error('[Sync] pullFromCloud error:', error);
            this.notifyListeners('Sync failure', null);
            try { chrome.runtime.sendMessage({ action: 'nexus_sync_status', status: 'failure' }).catch(() => {}); } catch (e) {}
            throw error;
        } finally {
            this.isSyncing = false;
        }
    }

    async pushToCloud(forcePush = false) {
        if (this._isPageContext()) {
            return await this._delegateSyncToBackground('nexus_drive_sync', { isAuto: false, forcePush });
        }
        if (this.isSyncing) {
            syncLog('[Sync:Push] Already syncing, skip duplicate push request');
            return;
        }
        this.isSyncing = true;
        this.notifyListeners('Syncing...', null);
        try { chrome.runtime.sendMessage({ action: 'nexus_sync_status', status: 'syncing' }).catch(() => {}); } catch (e) {}
        try {
            const initialToken = await this.getToken(true);
            if (!initialToken) throw new Error('Not authenticated');

            const localData = await this.gatherLocalData();
            const dataToUpload = { ...localData };
            const currentDataHash = await sha256Hash(JSON.stringify(dataToUpload));

            const storedSync = await chrome.storage.local.get(['last_sync_hash', 'last_sync_md5', 'drive_backup_file_id', 'last_sync_time']);

            syncLog('[Sync:Push] Hash comparison -> currentHash:', currentDataHash, 'storedHash:', storedSync.last_sync_hash, 'forcePush:', forcePush);

            if (!forcePush && storedSync.last_sync_hash && storedSync.last_sync_hash === currentDataHash && storedSync.drive_backup_file_id) {
                const now = Date.now();
                syncLog('[Sync:Push] No data changes detected (hash matched). Skipping upload.');
                this.notifyListeners('Synced just now', storedSync.last_sync_time || now);
                try { chrome.runtime.sendMessage({ action: 'nexus_sync_status', status: 'done', timestamp: storedSync.last_sync_time || now }).catch(() => {}); } catch (e) {}
                return storedSync.last_sync_time || now;
            }

            syncLog('[Sync:Push] Changes detected or forcePush. Uploading backup to Google Drive...');
            let { token, fileId, driveFiles } = await this.getOrFindBackupFile(initialToken, false);

            const payload = {
                timestamp: new Date().toISOString(),
                version: chrome.runtime.getManifest().version,
                data: dataToUpload
            };

            let uploadRes;
            try {
                uploadRes = fileId
                    ? await this.updateBackupFile(token, fileId, JSON.stringify(payload))
                    : await this.createBackupFile(token, JSON.stringify(payload));
            } catch (err) {
                if (fileId) {
                    const refreshed = await this.getOrFindBackupFile(token, true);
                    token = refreshed.token;
                    fileId = refreshed.fileId;
                    uploadRes = fileId
                        ? await this.updateBackupFile(token, fileId, JSON.stringify(payload))
                        : await this.createBackupFile(token, JSON.stringify(payload));
                } else {
                    throw err;
                }
            }

            if (uploadRes && uploadRes.id) {
                this.cachedBackupFileId = uploadRes.id;
                chrome.storage.local.set({ drive_backup_file_id: uploadRes.id }).catch(() => {});
            }

            const newUploadedMd5 = (uploadRes && typeof uploadRes === 'object') ? uploadRes.md5Checksum : uploadRes;
            const newUploadedSize = (uploadRes && typeof uploadRes === 'object') ? uploadRes.size : null;

            const storedBlobs = await chrome.storage.local.get(['drive_uploaded_blobs']);
            const uploadedBlobSet = new Set(storedBlobs.drive_uploaded_blobs || []);
            let hasNewBlobs = false;

            if (typeof NexusAttachmentDB !== 'undefined' && NexusAttachmentDB.init) {
                const db = await NexusAttachmentDB.init();
                const localAttachments = await new Promise((resolve) => {
                    const tx = db.transaction(NexusAttachmentDB.STORE_NAME, 'readonly');
                    const store = tx.objectStore(NexusAttachmentDB.STORE_NAME);
                    const req = store.openCursor();
                    const map = new Map();
                    req.onsuccess = (e) => {
                        const cursor = e.target.result;
                        if (cursor) {
                            if (cursor.value instanceof Blob) map.set(cursor.key, cursor.value);
                            cursor.continue();
                        } else resolve(map);
                    };
                    req.onerror = () => resolve(map);
                });

                syncLog(`[Sync:Attachments:Push] Scanning local attachments in IndexedDB: ${localAttachments.size} items.`);
                let uploadedCount = 0;
                for (const [key, blob] of localAttachments.entries()) {
                    const filename = `att_${key}.bin`;
                    if (!uploadedBlobSet.has(filename) && blob) {
                        try {
                            syncLog(`[Sync:Attachments:Push] Uploading new attachment ${filename} (${blob.size} bytes)...`);
                            await this.uploadBlobFile(token, filename, blob);
                            uploadedBlobSet.add(filename);
                            hasNewBlobs = true;
                            uploadedCount++;
                            syncLog(`[Sync:Attachments:Push] Successfully uploaded ${filename}`);
                        } catch (err) {
                            console.warn(`[Sync:Attachments:Push] Failed to upload attachment ${key}:`, err);
                        }
                    }
                }
                syncLog(`[Sync:Attachments:Push] Completed attachment upload check. Uploaded ${uploadedCount} new files. Total in state: ${uploadedBlobSet.size}`);
            }

            if (typeof TTSDB !== 'undefined') {
                const currentRecs = await TTSDB.getAllRecordings().catch(() => []);
                for (const rec of currentRecs) {
                    if (rec && rec.id && rec.audioBlob instanceof Blob) {
                        const filename = `tts_${rec.id}.bin`;
                        if (!uploadedBlobSet.has(filename)) {
                            try {
                                await this.uploadBlobFile(token, filename, rec.audioBlob);
                                uploadedBlobSet.add(filename);
                                hasNewBlobs = true;
                            } catch (err) {
                                console.warn(`[Sync] Failed to upload TTS audio ${rec.id}:`, err);
                            }
                        }
                    }
                }
            }

            if (hasNewBlobs || !storedBlobs.drive_uploaded_blobs) {
                await chrome.storage.local.set({ drive_uploaded_blobs: Array.from(uploadedBlobSet) });
            }

            const now = Date.now();
            const cloudStats = {
                chatsCount: Object.values(localData.nexus_chat_sessions || {}).filter(s => s && !s.isDeleted).length,
                highlightsCount: Object.keys(localData).filter(k => k.startsWith('highlights_')).length,
                ttsCount: Array.isArray(localData.nexus_tts_recordings) ? localData.nexus_tts_recordings.filter(r => r && !r.isDeleted).length : 0,
                appsCount: (localData.nexus_custom_apps && typeof localData.nexus_custom_apps === 'object') ? Object.keys(localData.nexus_custom_apps).length : 0,
                attachmentsCount: Array.from(uploadedBlobSet).filter(n => n.startsWith('att_') || n.startsWith('blob_att_')).length
            };
            await chrome.storage.local.set({
                last_sync_time: now,
                last_sync_hash: currentDataHash,
                last_sync_md5: newUploadedMd5,
                last_sync_size: newUploadedSize,
                last_cloud_stats: cloudStats
            });

            if (typeof globalThis !== 'undefined') globalThis._lastDriveSyncAt = now;

            this.notifyListeners('Synced just now', now);
            try { chrome.runtime.sendMessage({ action: 'nexus_sync_status', status: 'done', timestamp: now }).catch(() => {}); } catch (e) {}
            return now;
        } catch (error) {
            console.error('[Sync] pushToCloud error:', error);
            this.notifyListeners('Sync failure', null);
            try { chrome.runtime.sendMessage({ action: 'nexus_sync_status', status: 'failure' }).catch(() => {}); } catch (e) {}
            throw error;
        } finally {
            this.isSyncing = false;
        }
    }

    async cleanDriveDuplicates() {
        if (this._isPageContext()) {
            return await this._delegateSyncToBackground('nexus_clean_drive_duplicates');
        }
        const token = await this.getToken(true);
        if (!token) return { success: false, error: 'Not authenticated' };

        const allFiles = await this.listAppDataFiles(token);
        if (!Array.isArray(allFiles) || allFiles.length === 0) return { success: true, deletedCount: 0 };

        const fileMap = new Map();
        for (const file of allFiles) {
            if (!fileMap.has(file.name)) {
                fileMap.set(file.name, []);
            }
            fileMap.get(file.name).push(file);
        }

        let deletedCount = 0;
        for (const [name, files] of fileMap.entries()) {
            if (files.length > 1) {
                files.sort((a, b) => new Date(b.modifiedTime || 0) - new Date(a.modifiedTime || 0));
                const toDelete = files.slice(1);
                for (const f of toDelete) {
                    await this.deleteDriveFile(token, f.id);
                    deletedCount++;
                }
            }
        }

        const uniqueBlobNames = Array.from(fileMap.keys()).filter(n => n.endsWith('.bin'));
        await chrome.storage.local.set({ drive_uploaded_blobs: uniqueBlobNames });

        return { success: true, deletedCount };
    }

    async showDriveFiles() {
        const token = await this.getToken(true);
        if (!token) return [];
        const files = await this.listAppDataFiles(token);
        return files;
    }

    async cleanOrphanedDriveBlobs() {
        const token = await this.getToken(true);
        if (!token) return { success: false, error: 'Not authenticated' };

        const allFiles = await this.listAppDataFiles(token);
        if (!Array.isArray(allFiles) || allFiles.length === 0) return { success: true, deletedCount: 0 };

        const activeAttachmentKeys = new Set();
        if (typeof NexusChatDB !== 'undefined') {
            try {
                const sessions = await NexusChatDB.getAllSessions(true).catch(() => ({}));
                for (const sid of Object.keys(sessions)) {
                    const msgs = await NexusChatDB.getMessages(sid).catch(() => []);
                    for (const m of msgs) {
                        if (Array.isArray(m.files)) {
                            for (const f of m.files) {
                                if (f && f.attachmentId) activeAttachmentKeys.add(String(f.attachmentId));
                            }
                        }
                    }
                }
            } catch (e) {}
        }

        const activeTtsIds = new Set();
        if (typeof TTSDB !== 'undefined') {
            try {
                const recs = await TTSDB.getAllRecordings().catch(() => []);
                for (const r of recs) {
                    if (r && r.id && !r.isDeleted) activeTtsIds.add(String(r.id));
                }
            } catch (e) {}
        }

        let deletedCount = 0;
        for (const file of allFiles) {
            const name = file.name;
            let isOrphan = false;

            if (name.startsWith('att_') && name.endsWith('.bin')) {
                const key = name.slice(4, -4);
                if (!activeAttachmentKeys.has(key)) isOrphan = true;
            } else if (name.startsWith('blob_att_')) {
                isOrphan = true;
                for (const key of activeAttachmentKeys) {
                    if (name.includes(key)) { isOrphan = false; break; }
                }
            } else if (name.startsWith('tts_') && name.endsWith('.bin')) {
                const id = name.slice(4, -4);
                if (!activeTtsIds.has(id)) isOrphan = true;
            } else if (name.startsWith('blob_tts_')) {
                isOrphan = true;
                for (const id of activeTtsIds) {
                    if (name.includes(id)) { isOrphan = false; break; }
                }
            }

            if (isOrphan) {
                await this.deleteDriveFile(token, file.id);
                deletedCount++;
            }
        }

        const remainingFiles = await this.listAppDataFiles(token);
        const uniqueBlobNames = (remainingFiles || []).map(f => f.name).filter(n => n.endsWith('.bin'));
        await chrome.storage.local.set({ drive_uploaded_blobs: uniqueBlobNames });

        return { success: true, deletedCount };
    }

    async downloadBackupFileToComputer() {
        const token = await this.getToken(true);
        if (!token) throw new Error('Not authenticated');
        const files = await this.listAppDataFiles(token);
        const remoteFile = files.find(f => f.name === this.FILENAME);
        if (!remoteFile) throw new Error('nexus_backup.json not found on Google Drive');
        const data = await this.downloadBackup(token, remoteFile.id);
        const jsonStr = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `nexus_backup_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        return data;
    }

    async purgeLegacyLuminaCloudData() {
        if (this._isPageContext()) {
            return await this._delegateSyncToBackground('nexus_purge_legacy_cloud');
        }
        const token = await this.getToken(true);
        if (!token) throw new Error('Not authenticated');

        const driveFiles = await this.listAppDataFiles(token).catch(() => []);
        let deletedLegacyFiles = 0;

        for (const file of driveFiles) {
            if (file.name === 'lumina_backup.json' || file.name.startsWith('lumina_')) {
                await this.deleteDriveFile(token, file.id).catch(() => {});
                deletedLegacyFiles++;
            }
        }

        const localAll = await chrome.storage.local.get(null);
        const legacyKeys = Object.keys(localAll).filter(k => k.startsWith('lumina_') || k === 'sparks');
        if (legacyKeys.length > 0) {
            await chrome.storage.local.remove(legacyKeys);
        }

        this.cachedBackupFileId = null;
        await chrome.storage.local.remove(['drive_backup_file_id']).catch(() => {});
        const pushResult = await this.pushToCloud();

        return {
            success: true,
            deletedLegacyFiles,
            removedLegacyLocalKeys: legacyKeys.length,
            pushResult
        };
    }

    async syncData(isAuto = false) {
        if (isAuto) {
            return await this.pullFromCloud(false);
        } else {
            return await this.pushToCloud();
        }
    }
}

export const NexusSync = new SyncManager(NexusAuth);
if (typeof window !== 'undefined') {
    window.NexusSync = NexusSync;
}
