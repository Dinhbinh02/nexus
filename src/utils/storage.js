export const StorageService = {
    async get(keys, area = 'sync') {
        const storage = chrome?.storage?.[area] || chrome?.storage?.local;
        return storage ? (await storage.get(keys)) || {} : {};
    },

    async set(items, area = 'sync') {
        const storage = chrome?.storage?.[area] || chrome?.storage?.local;
        if (!storage) return false;
        await storage.set(items);
        return true;
    },

    async remove(keys, area = 'sync') {
        const storage = chrome?.storage?.[area] || chrome?.storage?.local;
        if (!storage) return false;
        await storage.remove(keys);
        return true;
    },

    onChanged(callback) {
        if (!chrome?.storage?.onChanged) return () => {};
        chrome.storage.onChanged.addListener(callback);
        return () => chrome.storage.onChanged.removeListener(callback);
    }
};
