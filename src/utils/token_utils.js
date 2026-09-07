export const NexusToken = {
    count: (text) => text ? Math.ceil(text.length / 2.5) : 0,
    truncate: (text, max) => (text && max > 0) ? text.substring(0, Math.floor(max * 2.5)) : ''
};

if (typeof globalThis !== 'undefined') globalThis.NexusToken = NexusToken;

