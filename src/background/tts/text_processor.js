const ACRONYMS_LIST = [
    'id', 'url', 'ip', 'io', 'os', 'ui', 'db', 'api', 'ssl', 'tls',
    'dto', 'dao', 'sdk', 'html', 'css', 'json', 'sql', 'jwt', 'crud',
    'uri', 'http', 'https', 'ftp', 'ssh', 'dom', 'spa', 'pwa', 'ssr',
    'ssg', 'ram', 'rom', 'cpu', 'gpu', 'tpu', 'npu', 'cli', 'gui',
    'vm', 'vpn', 'dns', 'lan', 'wan', 'nat', 'iot', 'ai', 'ml', 'nlp',
    'llm', 'tts', 'stt', 'asr', 'ocr', 'rpa', 'ci', 'cd', 'pr', 'mr',
    'poc', 'mvp', 'kpi', 'okr', 'b2b', 'b2c', 'saas', 'paas', 'iaas'
];

const SSML_CONVERSION_MAP = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '，': ',',
    '、': ','
};

export function stripHtml(text) {
    if (!text) return '';
    let clean = text.replace(/<[^>]*>/g, ' ');
    clean = clean
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ');
    return clean.replace(/\s+/g, ' ').trim();
}

export function stripBrackets(text) {
    if (!text) return '';
    return text
        .replace(/\([^\)]*\)/g, ' ')
        .replace(/\[[^\]]*\]/g, ' ')
        .replace(/\{[^\}]*\}/g, ' ')
        .replace(/\<[^\>]*\>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function stripClozeMarkers(text) {
    if (!text) return '';
    return text.replace(/\{\{c\d+::([^:}]+)(?:::[^}]+)?\}\}/g, '$1');
}

export function stripSoundTags(text) {
    if (!text) return '';
    return text.replace(/\[sound:[^\]]+\]/gi, '').trim();
}

export function normalizeSSML(text) {
    if (!text) return '';
    let res = text;
    for (const [pat, rep] of Object.entries(SSML_CONVERSION_MAP)) {
        res = res.replaceAll(pat, rep);
    }
    return res;
}

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
        .replace(/ysing\b/gi, 'yzing')
        .replace(/colour/gi, 'color')
        .replace(/flavour/gi, 'flavor')
        .replace(/behaviour/gi, 'behavior')
        .replace(/neighbour/gi, 'neighbor')
        .replace(/centre/gi, 'center')
        .replace(/theatre/gi, 'theater')
        .replace(/metre/gi, 'meter');
}

export function expandAcronyms(text) {
    if (!text) return '';
    let result = text;
    ACRONYMS_LIST.forEach(acronym => {
        const regex = new RegExp(`\\b${acronym}\\b`, 'gi');
        result = result.replace(regex, acronym.toUpperCase().split('').join(' '));
    });
    return result;
}

export function preprocessText(text, options = {}) {
    if (!text) return '';
    let result = text.trim();
    result = stripSoundTags(result);
    result = stripClozeMarkers(result);
    result = stripHtml(result);
    if (options.stripBrackets) {
        result = stripBrackets(result);
    }
    result = result.replace(/_/g, ' ');
    result = result.replace(/\s+/g, ' ').trim();
    result = expandAcronyms(result);
    return result;
}

export function detectLanguage(text) {
    if (!text || !text.trim()) return 'en-GB';
    const t = text.trim();
    let counts = {
        vietnamese: 0,
        chinese: 0,
        japanese: 0,
        korean: 0,
        cyrillic: 0,
        thai: 0,
        arabic: 0,
        hindi: 0,
        latin: 0
    };

    const vietnameseRegex = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/gi;
    for (const char of t) {
        const code = char.charCodeAt(0);
        if (code >= 0x4E00 && code <= 0x9FFF) counts.chinese++;
        else if ((code >= 0x3040 && code <= 0x309F) || (code >= 0x30A0 && code <= 0x30FF)) counts.japanese++;
        else if (code >= 0xAC00 && code <= 0xD7AF) counts.korean++;
        else if (code >= 0x0400 && code <= 0x04FF) counts.cyrillic++;
        else if (code >= 0x0E00 && code <= 0x0E7F) counts.thai++;
        else if (code >= 0x0600 && code <= 0x06FF) counts.arabic++;
        else if (code >= 0x0900 && code <= 0x097F) counts.hindi++;
        else if ((code >= 0x0041 && code <= 0x007A) || (code >= 0x00C0 && code <= 0x00FF)) counts.latin++;
    }

    const vietnameseMatches = t.match(vietnameseRegex);
    if (vietnameseMatches) counts.vietnamese = vietnameseMatches.length;

    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    if (total === 0) return 'en-GB';

    const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const langMap = {
        chinese: 'zh-CN',
        japanese: 'ja',
        korean: 'ko',
        cyrillic: 'ru',
        thai: 'th',
        arabic: 'ar',
        hindi: 'hi',
        latin: 'en-GB',
        vietnamese: 'vi'
    };

    if (dominant[0] === 'latin' && counts.vietnamese > 0 && counts.vietnamese / counts.latin > 0.12) {
        return 'vi';
    }
    return langMap[dominant[0]] || 'en-GB';
}

export function normalizeLangCode(lang) {
    if (!lang) return 'en-GB';
    const l = lang.trim().toLowerCase();
    if (l.startsWith('zh')) return l.includes('tw') || l.includes('hk') ? 'zh-TW' : 'zh-CN';
    if (l.startsWith('en')) return l.includes('us') ? 'en-US' : 'en-GB';
    if (l.startsWith('ja')) return 'ja';
    if (l.startsWith('ko')) return 'ko';
    if (l.startsWith('vi')) return 'vi';
    if (l.startsWith('es')) return 'es';
    if (l.startsWith('fr')) return 'fr';
    if (l.startsWith('de')) return 'de';
    if (l.startsWith('ru')) return 'ru';
    if (l.startsWith('it')) return 'it';
    if (l.startsWith('pt')) return l.includes('br') ? 'pt-BR' : 'pt-PT';
    if (l.startsWith('th')) return 'th';
    if (l.startsWith('ar')) return 'ar';
    return l;
}
