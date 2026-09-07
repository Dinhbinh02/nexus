import { NexusAudioCacheDB } from '../db/attachment_db.js';

export function getLemma(w) {
    if (!w) return '';
    const word = w.toLowerCase().trim();
    if (word.endsWith('ss')) return word;
    if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
    if (word.endsWith('es')) {
        const base = word.slice(0, -2);
        if (base.endsWith('sh') || base.endsWith('ch') || base.endsWith('x') || base.endsWith('s') || base.endsWith('z')) {
            return base;
        }
        return word.slice(0, -1);
    }
    if (word.endsWith('s') && !word.endsWith('us') && !word.endsWith('is') && !word.endsWith('as')) {
        return word.slice(0, -1);
    }
    return word;
}

export function getAmericanSpelling(w) {
    if (!w) return '';
    return w
        .replace(/isation/gi, 'ization')
        .replace(/isations/gi, 'izations')
        .replace(/ise\b/gi, 'ize')
        .replace(/ises\b/gi, 'izes')
        .replace(/ised\b/gi, 'ized')
        .replace(/ising\b/gi, 'izing')
        .replace(/yse\b/gi, 'yze')
        .replace(/yses\b/gi, 'yzes')
        .replace(/ysed\b/gi, 'yzed')
        .replace(/ysing\b/gi, 'yzing');
}

export async function stopGoogleAudioOffscreen() {
    if ((await chrome.offscreen.hasDocument())) {
        return await chrome.runtime.sendMessage({
            action: 'offscreen_stopGoogleAudio'
        }).catch(() => { });
    }
}

export async function fetchAudio(text, speed = 1.0, forcedLang = null) {
    if (!text) return { type: null, chunks: [] };
    let normalizedText = text.trim();
    normalizedText = normalizedText.replace(/_/g, ' ');
    const acronymsToSpellOut = ['id', 'url', 'ip', 'io', 'os', 'ui', 'db', 'api', 'ssl', 'tls', 'dto', 'dao'];
    acronymsToSpellOut.forEach(acronym => {
        const regex = new RegExp(`\\b${acronym}\\b`, 'gi');
        normalizedText = normalizedText.replace(regex, acronym.toUpperCase().split('').join(' '));
    });

    const detectLanguage = (t) => {
        let counts = { vietnamese: 0, chinese: 0, japanese: 0, korean: 0, cyrillic: 0, latin: 0 };
        const vietnameseRegex = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/gi;
        for (const char of t) {
            const code = char.charCodeAt(0);
            if (code >= 0x4E00 && code <= 0x9FFF) counts.chinese++;
            else if (code >= 0x3040 && code <= 0x30FF) counts.japanese++;
            else if (code >= 0xAC00 && code <= 0xD7AF) counts.korean++;
            else if (code >= 0x0400 && code <= 0x04FF) counts.cyrillic++;
            else if ((code >= 0x0041 && code <= 0x007A) || (code >= 0x00C0 && code <= 0x00FF)) counts.latin++;
        }
        const vietnameseMatches = t.match(vietnameseRegex);
        if (vietnameseMatches) counts.vietnamese = vietnameseMatches.length;
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        if (total === 0) return 'en-GB';
        const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
        const langMap = { chinese: 'zh-CN', japanese: 'ja', korean: 'ko', cyrillic: 'ru', latin: 'en-GB', vietnamese: 'vi' };
        if (dominant[0] === 'latin' && counts.vietnamese > 0 && counts.vietnamese / counts.latin > 0.15) return 'vi';
        return langMap[dominant[0]] || 'en-GB';
    };

    let lang = (forcedLang || detectLanguage(normalizedText)).trim();
    const langLower = lang.toLowerCase();
    if (langLower.startsWith('zh')) lang = 'zh-CN';
    else if (langLower.startsWith('en')) lang = 'en-GB';
    else if (langLower.startsWith('ja')) lang = 'ja';
    else if (langLower.startsWith('ko')) lang = 'ko';
    else if (langLower.startsWith('vi')) lang = 'vi';
    else if (langLower.startsWith('fr')) lang = 'fr';
    else if (langLower.startsWith('es')) lang = 'es';
    else if (langLower.startsWith('de')) lang = 'de';
    else if (langLower.startsWith('ru')) lang = 'ru';
    else if (langLower.startsWith('it')) lang = 'it';
    else if (langLower.startsWith('pt')) lang = 'pt';

    // 1. Check 1-Week Persistent Audio Cache First
    const speedKey = Math.round((speed || 1.0) * 100);
    const cacheKey = `${lang}_${speedKey}_${normalizedText.toLowerCase()}`;
    const cachedEntry = await getAudioFromCache(cacheKey);
    if (cachedEntry && Array.isArray(cachedEntry.data) && cachedEntry.data.length > 0) {
        return { type: cachedEntry.type || 'cached', chunks: cachedEntry.data };
    }

    const fetchToBase64 = async (url, opts = {}) => {
        const response = await fetch(url, opts);
        if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
        const contentType = response.headers.get('Content-Type');
        if (contentType && !contentType.includes('audio') && !contentType.includes('mpeg') && !contentType.includes('octet-stream')) {
            throw new Error('Invalid content type');
        }
        const arrayBuffer = await response.arrayBuffer();
        if (arrayBuffer.byteLength < 100) throw new Error('Empty audio');
        const base64 = btoa(new Uint8Array(arrayBuffer).reduce((d, byte) => d + String.fromCharCode(byte), ''));
        return `data:audio/mpeg;base64,${base64}`;
    };

    const stripListPrefix = (q) =>
        q.replace(/^\s*(?:[a-zA-Z\d]{1,2}\)|[a-zA-Z\d]{1,2}\.|[•\-–—])\s+/, '').trim();

    // High quality provider endpoints
    const googleUrl = (q) => {
        const cleaned = stripListPrefix(q);
        return `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(cleaned)}&tl=${lang}&total=1&idx=0&textlen=${cleaned.length}&client=tw-ob&ttsspeed=${speed}`;
    };

    const youdaoUrl = (q) => {
        const cleaned = stripListPrefix(q);
        let le = 'zh';
        if (lang === 'zh-CN') le = 'zh';
        else if (lang === 'ja') le = 'jap';
        else if (lang === 'ko') le = 'ko';
        else if (lang === 'fr') le = 'fr';
        else if (lang === 'es') le = 'es';
        else if (lang === 'de') le = 'de';
        else if (lang.startsWith('en')) {
            return `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(cleaned)}&type=2`;
        }
        return `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(cleaned)}&le=${le}`;
    };

    const MAX_CHUNK_CHARS = 180;
    const splitIntoChunks = (text) => {
        const sentences = text.match(/[^.?!。？！\n]+[.?!。？！\n]+/g) || [];
        const lastSentenceEnd = sentences.reduce((acc, s) => acc + s.length, 0);
        if (lastSentenceEnd < text.length) sentences.push(text.slice(lastSentenceEnd).trim());
        const level1 = sentences.map(s => s.trim()).filter(s => s.replace(/[.?!,;:。？！，、]/g, '').trim().length >= 1);
        const base = level1.length >= 1 ? level1 : [text];
        const level2 = [];
        for (const chunk of base) {
            if (chunk.length <= MAX_CHUNK_CHARS) { level2.push(chunk); continue; }
            const clauses = chunk.split(/(?<=[,;–—，、；])\s*/);
            if (clauses.length >= 2) {
                let current = '';
                for (const clause of clauses) {
                    if (current && (current + ' ' + clause).length > MAX_CHUNK_CHARS) {
                        level2.push(current.trim());
                        current = clause;
                    } else {
                        current = current ? current + ' ' + clause : clause;
                    }
                }
                if (current.trim()) level2.push(current.trim());
            } else {
                level2.push(chunk);
            }
        }
        const WORDS_PER_CHUNK = 20;
        const final = [];
        for (const chunk of level2) {
            if (chunk.length <= MAX_CHUNK_CHARS) { final.push(chunk); continue; }
            const words = chunk.split(/\s+/);
            for (let i = 0; i < words.length; i += WORDS_PER_CHUNK) {
                final.push(words.slice(i, i + WORDS_PER_CHUNK).join(' '));
            }
        }
        return final.filter(Boolean);
    };

    let chunks = [];
    let providerType = 'google';
    const wordCount = normalizedText.split(/\s+/).length;
    const supportsYoudao = ['zh-CN', 'ja', 'ko', 'fr', 'es', 'de', 'en-GB'].includes(lang) && normalizedText.length < 200;

    // 2. High-Fidelity Audio Engine for Top Languages
    if (lang === 'zh-CN') {
        // Native Standard Mandarin stream (crystal clear tonal inflection & human pronunciation)
        try {
            const ydData = await fetchToBase64(youdaoUrl(normalizedText), { referrerPolicy: 'no-referrer' });
            if (ydData) {
                chunks = [ydData];
                providerType = 'youdao_mandarin';
            }
        } catch (_) {}
    } else if (lang === 'en-GB' && wordCount <= 2) {
        // Studio Oxford dictionary pronunciation
        const audioText = getAmericanSpelling(normalizedText);
        const oxfordUrl = `https://ssl.gstatic.com/dictionary/static/sounds/oxford/${audioText.toLowerCase()}--_gb_1.mp3`;
        try {
            const oxData = await fetchToBase64(oxfordUrl, { referrerPolicy: 'no-referrer' });
            if (oxData) {
                chunks = [oxData];
                providerType = 'oxford';
            }
        } catch (_) {}
    } else if (supportsYoudao && wordCount <= 15) {
        try {
            const ydData = await fetchToBase64(youdaoUrl(normalizedText), { referrerPolicy: 'no-referrer' });
            if (ydData) {
                chunks = [ydData];
                providerType = 'youdao';
            }
        } catch (_) {}
    }

    // 3. Fallback to Google Web TTS (client=tw-ob)
    if (chunks.length === 0) {
        try {
            const gData = await fetchToBase64(googleUrl(normalizedText), { referrerPolicy: 'no-referrer' });
            if (gData) {
                chunks = [gData];
                providerType = 'google_tts';
            }
        } catch (e) {
            const splitChunks = splitIntoChunks(normalizedText);
            const results = new Array(splitChunks.length).fill(null);
            await Promise.all(splitChunks.map(async (chunk, i) => {
                try {
                    results[i] = await fetchToBase64(googleUrl(chunk), { referrerPolicy: 'no-referrer' });
                } catch (_) {
                    results[i] = null;
                }
            }));
            chunks = results.filter(Boolean);
            providerType = 'google_tts_chunked';
        }
    }

    // 4. Save to 1-Week Persistent Audio Cache
    if (chunks.length > 0) {
        setAudioCache(cacheKey, providerType, chunks).catch(() => {});
    }

    return { type: providerType, chunks };
}

export async function getAudioFromCache(text) {
    try {
        if (typeof NexusAudioCacheDB !== 'undefined') {
            const key = text.trim().toLowerCase();
            const entry = await NexusAudioCacheDB.get(key);
            return entry;
        }
        return null;
    } catch (e) {
        console.error('[Nexus Audio] Cache read error:', e);
        return null;
    }
}

export async function setAudioCache(text, type, data) {
    try {
        if (typeof NexusAudioCacheDB !== 'undefined') {
            const key = text.trim().toLowerCase();
            const entry = {
                type,
                data,
                timestamp: Date.now()
            };
            await NexusAudioCacheDB.put(key, entry);
        }
    } catch (e) {
        console.error('[Nexus Audio] Cache write error:', e);
    }
}

export function initAudioHandlers() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (!request || !request.action) return false;
        switch (request.action) {
            case 'fetchAudio':
                fetchAudio(request.text, request.speed || 1.0, request.lang)
                    .then(result => sendResponse(result))
                    .catch(() => sendResponse({ type: null, chunks: [] }));
                return true;

            case 'fetchAudioBase64':
                (async () => {
                    try {
                        const response = await fetch(request.url);
                        if (!response.ok) throw new Error('HTTP error');
                        const arrayBuffer = await response.arrayBuffer();
                        if (arrayBuffer.byteLength < 100) throw new Error('Empty audio');
                        const base64 = btoa(new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));
                        sendResponse({ success: true, data: `data:audio/mpeg;base64,${base64}` });
                    } catch (err) {
                        sendResponse({ error: err.message });
                    }
                })();
                return true;

            case 'getAudioCache':
                (async () => {
                    try {
                        const cached = await getAudioFromCache(request.text);
                        if (cached) sendResponse({ success: true, type: cached.type, data: cached.data });
                        else sendResponse({ success: false });
                    } catch (err) {
                        sendResponse({ success: false });
                    }
                })();
                return true;

            case 'setAudioCache':
                setAudioCache(request.text, request.type, request.data).then(() => {
                    sendResponse({ success: true });
                }).catch(() => {
                    sendResponse({ success: false });
                });
                return true;

            case 'stopGoogleOffscreenAudio':
                stopGoogleAudioOffscreen().then(res => sendResponse(res || { success: true })).catch(() => sendResponse({ success: true }));
                return true;

            default:
                return false;
        }
    });
}
