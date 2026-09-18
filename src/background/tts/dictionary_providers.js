import { arrayBufferToBase64DataUrl } from './audio_trimmer.js';
import { isHeteronym, getHeteronymInfo } from './heteronyms.js';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const DEFAULT_HEADERS = { 'User-Agent': USER_AGENT };
const REQUEST_TIMEOUT = 3500;

export const PROXY_BASE_URL = 'https://gemini-proxy-hub.binhbuidinh60.workers.dev/proxy?url=';

export async function fetchHttp(targetUrl, customHeaders = DEFAULT_HEADERS, timeoutMs = REQUEST_TIMEOUT) {
    const isCambridge = targetUrl.includes('dictionary.cambridge.org');
    const isOxford = targetUrl.includes('oxfordlearnersdictionaries.com');
    const isLongman = targetUrl.includes('ldoceonline.com');
    const shouldProxyFirst = isCambridge || isOxford || isLongman;

    if (shouldProxyFirst && PROXY_BASE_URL) {
        try {
            const proxyUrl = `${PROXY_BASE_URL}${encodeURIComponent(targetUrl)}`;
            const proxyController = new AbortController();
            const proxyTimeout = setTimeout(() => proxyController.abort(), timeoutMs);
            const proxyRes = await fetch(proxyUrl, { headers: customHeaders, signal: proxyController.signal });
            clearTimeout(proxyTimeout);
            if (proxyRes.ok) return proxyRes;
        } catch (_) { }
    }

    const directController = new AbortController();
    const directTimeout = setTimeout(() => directController.abort(), Math.min(timeoutMs, 1200));
    try {
        const directRes = await fetch(targetUrl, { headers: customHeaders, signal: directController.signal });
        clearTimeout(directTimeout);
        if (directRes.ok) return directRes;
    } catch (_) {
        clearTimeout(directTimeout);
    }

    if (!shouldProxyFirst && PROXY_BASE_URL) {
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
    const staticUrl = `https://ssl.gstatic.com/dictionary/static/sounds/oxford/${encodeURIComponent(slug)}--_gb_${entryNum}.mp3`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 600);

    let audioData = null;
    try {
        const res = await fetch(staticUrl, { headers: DEFAULT_HEADERS, signal: controller.signal });
        clearTimeout(timeoutId);
        if (res.ok) {
            const buf = await res.arrayBuffer();
            if (buf.byteLength >= 150) {
                audioData = arrayBufferToBase64DataUrl(buf);
            }
        }
    } catch (_) {
        clearTimeout(timeoutId);
    }

    if (!audioData && entryNum !== '1') {
        try {
            const fallbackRes = await fetch(`https://ssl.gstatic.com/dictionary/static/sounds/oxford/${encodeURIComponent(slug)}--_gb_1.mp3`, { headers: DEFAULT_HEADERS });
            if (fallbackRes.ok) {
                const buf = await fallbackRes.arrayBuffer();
                if (buf.byteLength >= 150) audioData = arrayBufferToBase64DataUrl(buf);
            }
        } catch (_) { }
    }

    if (audioData) {
        const hetInfo = getHeteronymInfo(slug);
        const ipa = hetInfo ? (targetPos === 'verb' ? `/${hetInfo.verb}/` : `/${hetInfo.noun}/`) : null;
        return {
            audioDataUrl: audioData,
            ipa,
            definitions: [],
            is_academic_word: false,
            related_words: [],
            service: 'Oxford Dictionary',
            posMatched: !!hetInfo,
            pos: targetPos || 'noun'
        };
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
