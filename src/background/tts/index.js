import { NexusAudioCacheDB } from '../../db/attachment_db.js';
import { preprocessText, detectLanguage, normalizeLangCode, getLemma, getAmericanSpelling } from './text_processor.js';
import { isHeteronym, inferPartOfSpeech, getHeteronymInfo } from './heteronyms.js';
import { Providers } from './providers.js';

export { getLemma, getAmericanSpelling, isHeteronym, inferPartOfSpeech, getHeteronymInfo };

export async function stopGoogleAudioOffscreen() {
    if ((await chrome.offscreen.hasDocument())) {
        return await chrome.runtime.sendMessage({
            action: 'offscreen_stopGoogleAudio'
        }).catch(() => { });
    }
}

const MAX_CHUNK_CHARS = 180;
const WORDS_PER_CHUNK = 20;

export function splitIntoChunks(text) {
    if (!text) return [];
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
    const final = [];
    for (const chunk of level2) {
        if (chunk.length <= MAX_CHUNK_CHARS) { final.push(chunk); continue; }
        const words = chunk.split(/\s+/);
        for (let i = 0; i < words.length; i += WORDS_PER_CHUNK) {
            final.push(words.slice(i, i + WORDS_PER_CHUNK).join(' '));
        }
    }
    return final.filter(Boolean);
}

export async function fetchAudio(text, speed = 1.0, forcedLang = null, options = {}) {
    if (!text) return { type: null, chunks: [], ipa: null, definitions: [] };

    const normalizedText = preprocessText(text);
    if (!normalizedText) return { type: null, chunks: [], ipa: null, definitions: [] };

    const detected = forcedLang || detectLanguage(normalizedText);
    const lang = normalizeLangCode(detected);

    let pos = options.pos;
    if (!pos && options.sentenceContext && isHeteronym(normalizedText)) {
        pos = inferPartOfSpeech(normalizedText, options.sentenceContext);
    }

    const speedKey = Math.round((speed || 1.0) * 100);
    const cacheKey = `${lang}_${speedKey}_${pos || 'def'}_${normalizedText.toLowerCase()}`;

    const cachedEntry = await getAudioFromCache(cacheKey);
    if (cachedEntry && Array.isArray(cachedEntry.data) && cachedEntry.data.length > 0) {
        return {
            type: cachedEntry.type || 'cached',
            chunks: cachedEntry.data,
            ipa: cachedEntry.ipa || null,
            definitions: cachedEntry.definitions || [],
            is_academic_word: cachedEntry.is_academic_word || false,
            related_words: cachedEntry.related_words || [],
            pos: cachedEntry.pos || '',
            posMatched: cachedEntry.posMatched || false
        };
    }

    let chunks = [];
    let providerType = 'google';
    let ipa = null;
    let definitions = [];
    let is_academic_word = false;
    let related_words = [];
    let posMatched = false;
    let matchedPos = pos || '';

    if (Providers.oxford_dictionary.supports(lang, normalizedText)) {
        try {
            const oxfordPromise = Providers.oxford_dictionary.getAudio(normalizedText, lang, { pos, sentenceContext: options.sentenceContext }).catch(() => null);
            const cambridgePromise = Providers.cambridge_dictionary.getAudio(normalizedText, lang, { pos, sentenceContext: options.sentenceContext }).catch(() => null);
            const fastGooglePromise = Providers.google_translate.getAudio(normalizedText, lang, { speed }).catch(() => null);

            const fastOxford = await Promise.race([
                oxfordPromise,
                new Promise(resolve => setTimeout(() => resolve(null), 100))
            ]);

            if (fastOxford && fastOxford.audioDataUrl) {
                chunks = [fastOxford.audioDataUrl];
                providerType = 'oxford_dictionary';
                ipa = fastOxford.ipa;
                definitions = fastOxford.definitions;
                is_academic_word = fastOxford.is_academic_word;
                related_words = fastOxford.related_words;
                matchedPos = fastOxford.pos;
                posMatched = fastOxford.posMatched;
            } else {
                const fastCambridge = await Promise.race([
                    cambridgePromise,
                    new Promise(resolve => setTimeout(() => resolve(null), 150))
                ]);

                if (fastCambridge && fastCambridge.audioDataUrl) {
                    chunks = [fastCambridge.audioDataUrl];
                    providerType = 'cambridge_dictionary';
                    ipa = fastCambridge.ipa;
                    definitions = fastCambridge.definitions;
                    is_academic_word = fastCambridge.is_academic_word;
                    related_words = fastCambridge.related_words;
                    matchedPos = fastCambridge.pos;
                    posMatched = fastCambridge.posMatched;
                } else {
                    const gData = await fastGooglePromise;
                    if (gData && gData.audioDataUrl) {
                        chunks = [gData.audioDataUrl];
                        providerType = 'google_translate';
                    } else {
                        const fallbackCam = await cambridgePromise;
                        if (fallbackCam && fallbackCam.audioDataUrl) {
                            chunks = [fallbackCam.audioDataUrl];
                            providerType = 'cambridge_dictionary';
                            ipa = fallbackCam.ipa;
                            definitions = fallbackCam.definitions;
                            is_academic_word = fallbackCam.is_academic_word;
                            related_words = fallbackCam.related_words;
                            matchedPos = fallbackCam.pos;
                            posMatched = fallbackCam.posMatched;
                        }
                    }
                }
            }

            cambridgePromise.then(camData => {
                if (camData && (camData.ipa || (camData.definitions && camData.definitions.length > 0))) {
                    setAudioCache(cacheKey, {
                        type: camData.audioDataUrl ? 'cambridge_dictionary' : providerType,
                        chunks: camData.audioDataUrl ? [camData.audioDataUrl] : chunks,
                        ipa: camData.ipa || ipa,
                        definitions: camData.definitions || definitions,
                        is_academic_word: camData.is_academic_word || is_academic_word,
                        related_words: camData.related_words || related_words,
                        pos: camData.pos || matchedPos,
                        posMatched: camData.posMatched || posMatched
                    }).catch(() => { });
                }
            }).catch(() => { });
        } catch (_) { }
    }

    if (chunks.length === 0 && Providers.spanishdict.supports(lang, normalizedText)) {
        try {
            const data = await Providers.spanishdict.getAudio(normalizedText, lang);
            if (data && data.audioDataUrl) {
                chunks = [data.audioDataUrl];
                providerType = 'spanishdict';
            }
        } catch (_) { }
    }

    if (chunks.length === 0 && Providers.youdao_dict.supports(lang, normalizedText)) {
        try {
            const data = await Providers.youdao_dict.getAudio(normalizedText, lang);
            if (data && data.audioDataUrl) {
                chunks = [data.audioDataUrl];
                providerType = 'youdao_dict';
            }
        } catch (_) { }
    }

    if (chunks.length === 0) {
        const isEastAsian = ['ko', 'ja', 'zh-CN', 'zh-TW', 'th'].includes(lang);
        const firstChoice = isEastAsian ? Providers.naver_papago : Providers.google_translate;
        const secondChoice = isEastAsian ? Providers.google_translate : Providers.naver_papago;

        if (firstChoice.supports(lang)) {
            try {
                const data = await firstChoice.getAudio(normalizedText, lang, { speed });
                if (data && data.audioDataUrl) {
                    chunks = [data.audioDataUrl];
                    providerType = isEastAsian ? 'naver_papago' : 'google_translate';
                }
            } catch (_) { }
        }

        if (chunks.length === 0 && secondChoice.supports(lang)) {
            try {
                const data = await secondChoice.getAudio(normalizedText, lang, { speed });
                if (data && data.audioDataUrl) {
                    chunks = [data.audioDataUrl];
                    providerType = isEastAsian ? 'google_translate' : 'naver_papago';
                }
            } catch (_) { }
        }

        if (chunks.length === 0) {
            const splitList = splitIntoChunks(normalizedText);
            const results = new Array(splitList.length).fill(null);
            await Promise.all(splitList.map(async (chunk, i) => {
                try {
                    const d = await Providers.google_translate.getAudio(chunk, lang, { speed });
                    results[i] = d.audioDataUrl;
                } catch (_) {
                    results[i] = null;
                }
            }));
            chunks = results.filter(Boolean);
            providerType = 'google_translate_chunked';
        }
    }

    const payload = {
        type: providerType,
        chunks,
        ipa,
        definitions,
        is_academic_word,
        related_words,
        pos: matchedPos,
        posMatched
    };

    if (chunks.length > 0) {
        setAudioCache(cacheKey, payload).catch(() => { });
    }

    return payload;
}

export async function getAudioFromCache(text) {
    try {
        if (typeof NexusAudioCacheDB !== 'undefined') {
            const key = text.trim().toLowerCase();
            return await NexusAudioCacheDB.get(key);
        }
        return null;
    } catch (e) {
        return null;
    }
}

export async function setAudioCache(text, payload) {
    try {
        if (typeof NexusAudioCacheDB !== 'undefined') {
            const key = text.trim().toLowerCase();
            const entry = {
                type: payload.type,
                data: payload.chunks,
                ipa: payload.ipa,
                definitions: payload.definitions,
                is_academic_word: payload.is_academic_word,
                related_words: payload.related_words,
                pos: payload.pos,
                posMatched: payload.posMatched,
                timestamp: Date.now()
            };
            await NexusAudioCacheDB.put(key, entry);
        }
    } catch (e) { }
}

export function initAudioHandlers() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (!request || !request.action) return false;
        switch (request.action) {
            case 'fetchAudio':
            case 'fetchDictionary':
                fetchAudio(request.text, request.speed || 1.0, request.lang, {
                    sentenceContext: request.sentenceContext,
                    pos: request.pos
                })
                    .then(result => sendResponse(result))
                    .catch(() => sendResponse({ type: null, chunks: [], ipa: null, definitions: [] }));
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
                        if (cached) sendResponse({ success: true, ...cached });
                        else sendResponse({ success: false });
                    } catch (err) {
                        sendResponse({ success: false });
                    }
                })();
                return true;

            case 'stopGoogleOffscreenAudio':
                stopGoogleAudioOffscreen().then(res => sendResponse(res || { success: true })).catch(() => sendResponse({ success: true }));
                return true;

            default:
                return false;
        }
    });
}
