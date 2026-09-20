import { arrayBufferToBase64DataUrl } from './audio_trimmer.js';
import { isHeteronym, getHeteronymInfo } from './heteronyms.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const DEFAULT_HEADERS = { 'User-Agent': USER_AGENT };
const REQUEST_TIMEOUT = 3500;

export const PROXY_BASE_URL = 'https://gemini-proxy-hub.binhbuidinh60.workers.dev/proxy?url=';

export async function fetchHttp(targetUrl, customHeaders = DEFAULT_HEADERS, timeoutMs = REQUEST_TIMEOUT) {
    const forceProxy = typeof process !== 'undefined' && process.env && process.env.FORCE_PROXY === 'true';

    // 1. Force Proxy mode (used for high-concurrency benchmark testing)
    if (forceProxy && PROXY_BASE_URL) {
        try {
            const proxyUrl = `${PROXY_BASE_URL}${encodeURIComponent(targetUrl)}`;
            const proxyController = new AbortController();
            const proxyTimeout = setTimeout(() => proxyController.abort(), timeoutMs);
            const proxyRes = await fetch(proxyUrl, { headers: customHeaders, signal: proxyController.signal });
            clearTimeout(proxyTimeout);
            if (proxyRes.ok) return proxyRes;
        } catch (_) { }
    }

    // 2. Direct-First: Normal user requests go straight to target with 0 proxy overhead
    try {
        const directController = new AbortController();
        const directTimeout = setTimeout(() => directController.abort(), Math.min(timeoutMs, 2000));
        const directRes = await fetch(targetUrl, { headers: customHeaders, signal: directController.signal });
        clearTimeout(directTimeout);
        if (directRes.ok) return directRes;
    } catch (_) { }

    // 3. Smart Proxy Fallback: Rescues the request if Direct is blocked or fails
    if (!forceProxy && PROXY_BASE_URL) {
        try {
            const proxyUrl = `${PROXY_BASE_URL}${encodeURIComponent(targetUrl)}`;
            const proxyController = new AbortController();
            const proxyTimeout = setTimeout(() => proxyController.abort(), timeoutMs);
            const proxyRes = await fetch(proxyUrl, { headers: customHeaders, signal: proxyController.signal });
            clearTimeout(proxyTimeout);
            if (proxyRes.ok) return proxyRes;
        } catch (_) { }
    }

    throw new Error(`Failed to fetch ${targetUrl}`);
}

export function normalizePos(pos) {
    if (!pos) return '';
    const p = pos.toLowerCase().trim();
    if (p.includes('noun') || p === 'n') return 'noun';
    if (p.includes('verb') || p === 'v') return 'verb';
    if (p.includes('adj') || p === 'a') return 'adjective';
    if (p.includes('adv')) return 'adverb';
    return p;
}

export function cleanText(text) {
    if (!text) return '';
    return text
        .replace(/<[^>]+>/g, '')
        .replace(/\s+/g, ' ')
        .replace(/:\s*$/, '')
        .trim();
}

export async function getOxfordData(term, pos = null) {
    const slug = term.toLowerCase().trim().replace(/\s+/g, '-');
    const targetPos = normalizePos(pos);
    const entryNum = targetPos === 'verb' ? '2' : '1';

    // 1. Fast static Google Oxford check (ultra low latency for common headwords)
    const staticUrl = `https://ssl.gstatic.com/dictionary/static/sounds/oxford/${encodeURIComponent(slug)}--_gb_${entryNum}.mp3`;
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 450);
        const res = await fetch(staticUrl, { headers: DEFAULT_HEADERS, signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
            const buf = await res.arrayBuffer();
            if (buf.byteLength >= 150) {
                const hetInfo = getHeteronymInfo(slug);
                const ipa = hetInfo ? (targetPos === 'verb' ? `/${hetInfo.verb}/` : `/${hetInfo.noun}/`) : null;
                return {
                    audioDataUrl: arrayBufferToBase64DataUrl(buf),
                    ipa,
                    definitions: [],
                    is_academic_word: false,
                    related_words: [],
                    service: 'Oxford Dictionary',
                    posMatched: !!hetInfo,
                    pos: targetPos || 'noun'
                };
            }
        }
    } catch (_) { }

    // 2. Oxford Learner's Dictionary (Supports inflected forms: converted, monasteries, convert_1, etc.)
    const urls = [
        `https://www.oxfordlearnersdictionaries.com/definition/english/${encodeURIComponent(slug)}`,
        `https://www.oxfordlearnersdictionaries.com/definition/english/${encodeURIComponent(slug)}_1`,
        `https://www.oxfordlearnersdictionaries.com/search/english/direct/?q=${encodeURIComponent(slug)}`
    ];

    for (const url of urls) {
        try {
            const res = await fetchHttp(url, DEFAULT_HEADERS, 2500);
            if (!res.ok) continue;
            const html = await res.text();

            // Match inflected or specific British audio
            const exactMatch = html.match(new RegExp('data-src-mp3=\\"([^\\"]*' + slug + '__gb_[^\\"]*\\.mp3)\\"', 'i'))
                || html.match(new RegExp('data-src-mp3=\\"([^\\"]*' + slug + '[^\\"]*gb[^\\"]*\\.mp3)\\"', 'i'));
            
            const mainUkMatch = html.match(/<div class="sound audio_play_button pron-uk[^"]*"[^>]*data-src-mp3="([^"]+)"/i)
                || html.match(/data-src-mp3="([^\\"]*uk_pron[^\\"]*\\.mp3)"/i);

            const audioUrl = (exactMatch && exactMatch[1]) || (mainUkMatch && mainUkMatch[1]);
            if (audioUrl) {
                const phonMatch = html.match(/<div class="phons_br"[^>]*>[\s\S]*?<span class="phon"[^>]*>([\s\S]*?)<\/span>/i)
                    || html.match(/<span class="phon"[^>]*>([\s\S]*?)<\/span>/i);
                let ipa = phonMatch ? cleanText(phonMatch[1]).replace(/^\/+|\/+$/g, '') : '';
                if (ipa) ipa = `/${ipa}/`;

                const defMatches = [...html.matchAll(/<span class="def"[^>]*>([\s\S]*?)<\/span>/gi)];
                const definitions = defMatches.map(m => cleanText(m[1])).filter(Boolean).slice(0, 3);

                const isAcademic = /class="(opal_symbol|ox5000|ox3000)"/i.test(html);

                const wfMatch = html.match(/<div class="wordfamily"[^>]*>([\s\S]*?)<\/div>/i)
                    || html.match(/<span class="unbox" unbox="wordfamily"[^>]*>([\s\S]*?)<\/span>/i);
                let relatedWords = [];
                if (wfMatch) {
                    relatedWords = [...wfMatch[1].matchAll(/<span class="p">([^<]+)<\/span>/gi)]
                        .map(m => cleanText(m[1]))
                        .filter(w => w && w.toLowerCase() !== term.toLowerCase());
                }

                const audioRes = await fetchHttp(audioUrl, DEFAULT_HEADERS, 2000);
                if (audioRes.ok) {
                    const buf = await audioRes.arrayBuffer();
                    if (buf.byteLength >= 100) {
                        return {
                            audioDataUrl: arrayBufferToBase64DataUrl(buf),
                            ipa: ipa || null,
                            definitions,
                            is_academic_word: isAcademic,
                            related_words: relatedWords,
                            service: 'Oxford Dictionary',
                            posMatched: true,
                            pos: targetPos || ''
                        };
                    }
                }
            }
        } catch (_) { }
    }

    return null;
}

export async function getCambridgeData(term, pos = null) {
    try {
        const slug = term.toLowerCase().trim().replace(/\s+/g, '-');
        const targetPos = normalizePos(pos);
        const url = `https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(slug)}`;

        const res = await fetchHttp(url, DEFAULT_HEADERS, 2000);
        if (!res.ok) return null;
        const html = await res.text();

        const ukMatch = html.match(/<span class="uk dpron-i[\s\S]*?<source[^>]*type="audio\/mpeg"[^>]*src="([^"]+)"/i);
        if (ukMatch && ukMatch[1]) {
            const audioUrl = ukMatch[1].startsWith('http') ? ukMatch[1] : `https://dictionary.cambridge.org${ukMatch[1]}`;
            const pronMatch = html.match(/<span class="uk dpron-i[\s\S]*?<span class="pron dpron"[^>]*>([\s\S]*?)<\/span>/i);
            let ipa = pronMatch ? cleanText(pronMatch[1]).replace(/^\/+|\/+$/g, '') : '';
            if (ipa) ipa = `/${ipa}/`;

            const defMatches = [...html.matchAll(/<div class="def ddef_d db"[^>]*>([\s\S]*?)<\/div>/gi)];
            const definitions = defMatches.map(m => cleanText(m[1])).filter(Boolean).slice(0, 3);

            const audioRes = await fetchHttp(audioUrl, DEFAULT_HEADERS, 1500);
            if (audioRes.ok) {
                const buf = await audioRes.arrayBuffer();
                if (buf.byteLength >= 100) {
                    return {
                        audioDataUrl: arrayBufferToBase64DataUrl(buf),
                        ipa: ipa || null,
                        definitions,
                        is_academic_word: /<span class="epp-xref (b2|c1|c2)">/i.test(html),
                        related_words: [],
                        service: 'Cambridge Dictionary',
                        posMatched: true,
                        pos: targetPos || ''
                    };
                }
            }
        }
    } catch (_) { }
    return null;
}

export async function getLongmanData(term, pos = null) {
    try {
        const slug = term.toLowerCase().trim().replace(/\s+/g, '-');
        const targetPos = normalizePos(pos);
        const url = `https://www.ldoceonline.com/dictionary/${encodeURIComponent(slug)}`;

        const res = await fetchHttp(url, DEFAULT_HEADERS, 2000);
        if (!res.ok) return null;
        const html = await res.text();

        const ukMatch = html.match(/data-src-mp3="([^"]*\/breProns\/[^"]*)"/i)
            || html.match(/data-src-mp3="([^"]+)"/i);

        if (ukMatch && ukMatch[1]) {
            const ipaMatch = html.match(/<span class="PRON"[^>]*>([\s\S]*?)<\/span>/i);
            let ipa = ipaMatch ? cleanText(ipaMatch[1]) : '';
            if (ipa && !ipa.startsWith('/')) ipa = `/${ipa}/`;

            const defMatches = [...html.matchAll(/<span class="DEF"[^>]*>([\s\S]*?)<\/span>/gi)];
            const definitions = defMatches.map(m => cleanText(m[1])).filter(Boolean).slice(0, 3);

            const audioRes = await fetchHttp(ukMatch[1], DEFAULT_HEADERS, 1500);
            if (audioRes.ok) {
                const buf = await audioRes.arrayBuffer();
                if (buf.byteLength >= 100) {
                    return {
                        audioDataUrl: arrayBufferToBase64DataUrl(buf),
                        ipa: ipa || null,
                        definitions,
                        is_academic_word: /class="tooltip LEVEL"[^>]*>AWL/i.test(html),
                        related_words: [],
                        service: 'Longman Dictionary',
                        posMatched: true,
                        pos: targetPos || ''
                    };
                }
            }
        }
    } catch (_) { }
    return null;
}
