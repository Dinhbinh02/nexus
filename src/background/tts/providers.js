import { arrayBufferToBase64DataUrl } from './audio_trimmer.js';
import { getOxfordData, getCambridgeData, getLongmanData, fetchHttp, PROXY_BASE_URL } from './dictionary_providers.js';

const DEFAULT_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    'Accept': '*/*'
};

const REQUEST_TIMEOUT_MS = 6000;

async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);
    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        clearTimeout(timeoutId);
        return response;
    } catch (e) {
        clearTimeout(timeoutId);
        throw e;
    }
}

export const Providers = {
    oxford_dictionary: {
        name: 'Oxford Dictionary',
        supports: (lang, text) => {
            if (!lang.startsWith('en')) return false;
            const words = text.trim().split(/\s+/);
            return words.length === 1 && !/[.,!?;:]/.test(text);
        },
        getAudio: async (text, lang, options = {}) => {
            const data = await getOxfordData(text, options.pos);
            if (data && data.audioDataUrl) {
                return {
                    audioDataUrl: data.audioDataUrl,
                    ipa: data.ipa,
                    definitions: data.definitions,
                    is_academic_word: data.is_academic_word,
                    related_words: data.related_words,
                    pos: data.pos,
                    posMatched: data.posMatched
                };
            }
            throw new Error('Oxford dictionary lookup failed');
        }
    },

    cambridge_dictionary: {
        name: 'Cambridge Dictionary',
        supports: (lang, text) => {
            if (!lang.startsWith('en')) return false;
            const words = text.trim().split(/\s+/);
            return words.length === 1 && !/[.,!?;:]/.test(text);
        },
        getAudio: async (text, lang, options = {}) => {
            const data = await getCambridgeData(text, options.pos);
            if (data && data.audioDataUrl) {
                return {
                    audioDataUrl: data.audioDataUrl,
                    ipa: data.ipa,
                    definitions: data.definitions,
                    is_academic_word: data.is_academic_word,
                    related_words: data.related_words,
                    pos: data.pos,
                    posMatched: data.posMatched
                };
            }
            throw new Error('Cambridge dictionary lookup failed');
        }
    },

    longman_dictionary: {
        name: 'Longman Dictionary',
        supports: (lang, text) => {
            if (!lang.startsWith('en')) return false;
            const words = text.trim().split(/\s+/);
            return words.length === 1 && !/[.,!?;:]/.test(text);
        },
        getAudio: async (text, lang, options = {}) => {
            const data = await getLongmanData(text, options.pos);
            if (data && data.audioDataUrl) {
                return {
                    audioDataUrl: data.audioDataUrl,
                    ipa: data.ipa,
                    definitions: data.definitions,
                    is_academic_word: data.is_academic_word,
                    related_words: data.related_words,
                    pos: data.pos,
                    posMatched: data.posMatched
                };
            }
            throw new Error('Longman dictionary lookup failed');
        }
    },

    spanishdict: {
        name: 'SpanishDict',
        supports: (lang, text) => lang === 'es' && text.trim().split(/\s+/).length <= 2,
        getAudio: async (text, lang) => {
            const url = `https://audio1.spanishdict.com/audio?lang=es&text=${encodeURIComponent(text)}`;
            const res = await fetchHttp(url, DEFAULT_HEADERS, 2500);
            if (!res.ok) throw new Error(`SpanishDict HTTP ${res.status}`);
            const buf = await res.arrayBuffer();
            if (buf.byteLength < 100) throw new Error('Empty SpanishDict audio');
            return {
                audioDataUrl: arrayBufferToBase64DataUrl(buf),
                ipa: null,
                definitions: [],
                pos: ''
            };
        }
    },

    youdao_dict: {
        name: 'Youdao Dict',
        supports: (lang, text) => {
            const words = text.trim().split(/\s+/);
            if (lang.startsWith('zh')) return text.length <= 6;
            if (lang === 'ja' || lang === 'ko') return text.length <= 8 && words.length <= 2;
            return ['fr', 'de'].includes(lang) && words.length === 1 && !/[.,!?;:]/.test(text);
        },
        getAudio: async (text, lang) => {
            let le = 'zh';
            if (lang.startsWith('zh')) le = 'zh';
            else if (lang === 'ja') le = 'jap';
            else if (lang === 'ko') le = 'ko';
            else if (lang === 'fr') le = 'fr';
            else if (lang === 'de') le = 'de';

            const url = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&le=${le}`;
            const res = await fetchHttp(url, DEFAULT_HEADERS, 2500);
            if (!res.ok) throw new Error(`Youdao HTTP ${res.status}`);
            const buf = await res.arrayBuffer();
            if (buf.byteLength < 100) throw new Error('Empty Youdao audio');
            return {
                audioDataUrl: arrayBufferToBase64DataUrl(buf),
                ipa: null,
                definitions: [],
                pos: ''
            };
        }
    },

    naver_papago: {
        name: 'Naver Papago Neural',
        supports: (lang) => ['ko', 'ja', 'zh-CN', 'zh-TW', 'en-US', 'en-GB', 'es', 'fr', 'de', 'ru', 'th'].includes(lang),
        getAudio: async (text, lang, options = {}) => {
            const speakerMap = {
                'ko': 'kyuri',
                'ja': 'yuri',
                'zh-CN': 'meimei',
                'zh-TW': 'chiahua',
                'en-US': 'clara',
                'en-GB': 'clara',
                'es': 'carmen',
                'fr': 'roxane',
                'de': 'lena',
                'ru': 'vera',
                'th': 'somsi'
            };
            const speaker = speakerMap[lang] || 'clara';
            const makeIdUrl = 'https://papago.naver.com/api/tts/makeID';
            const speedParam = options.speed ? Math.max(-5, Math.min(5, Math.round((options.speed - 1) * 5))).toString() : '0';
            const params = new URLSearchParams({
                alpha: '0',
                pitch: '0',
                speaker: speaker,
                speed: speedParam,
                text: text
            });

            const idRes = await fetchWithTimeout(makeIdUrl, {
                method: 'POST',
                headers: {
                    ...DEFAULT_HEADERS,
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'Origin': 'https://papago.naver.com',
                    'Referer': 'https://papago.naver.com/'
                },
                body: params.toString(),
                timeoutMs: 4000
            });

            if (!idRes.ok) throw new Error(`Papago makeID HTTP ${idRes.status}`);
            const idData = await idRes.json();
            const soundId = idData.id;
            if (!soundId) throw new Error('No Papago sound ID');

            const audioUrl = `https://papago.naver.com/api/tts/${soundId}`;
            const audioRes = await fetchHttp(audioUrl, {
                ...DEFAULT_HEADERS,
                'Referer': 'https://papago.naver.com/'
            }, 4000);

            if (!audioRes.ok) throw new Error(`Papago audio HTTP ${audioRes.status}`);
            const buf = await audioRes.arrayBuffer();
            if (buf.byteLength < 100) throw new Error('Empty Papago audio');
            return {
                audioDataUrl: arrayBufferToBase64DataUrl(buf),
                ipa: null,
                definitions: [],
                pos: ''
            };
        }
    },

    google_translate: {
        name: 'Google Translate',
        supports: () => true,
        getAudio: async (text, lang, options = {}) => {
            const cleanLang = /^(en-|zh-|pt-|es-|fr-)/i.test(lang) ? lang.toLowerCase() : lang.split('-')[0];
            const speedParam = options.speed && options.speed < 0.9 ? '0.24' : '1';
            const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${cleanLang}&total=1&idx=0&textlen=${text.length}&client=tw-ob&ttsspeed=${speedParam}`;
            const res = await fetchHttp(url, DEFAULT_HEADERS, 4500);
            if (!res.ok) throw new Error(`Google Translate HTTP ${res.status}`);
            const buf = await res.arrayBuffer();
            if (buf.byteLength < 100) throw new Error('Empty Google audio');
            return {
                audioDataUrl: arrayBufferToBase64DataUrl(buf),
                ipa: null,
                definitions: [],
                pos: ''
            };
        }
    }
};
