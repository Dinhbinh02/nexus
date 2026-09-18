import { performance } from 'perf_hooks';

const TEST_SAMPLES = [
    { text: 'record', lang: 'en', type: 'single_word' },
    { text: 'serendipity', lang: 'en', type: 'single_word' },
    { text: 'artificial intelligence', lang: 'en', type: 'short_phrase' },
    { text: 'Deep learning neural networks process complex multilingual data.', lang: 'en', type: 'sentence' },
    { text: 'chào buổi sáng Việt Nam', lang: 'vi', type: 'sentence' },
    { text: '你好世界，今天天气真好', lang: 'zh-CN', type: 'sentence' },
    { text: 'こんにちは、今日も一日頑張りましょう', lang: 'ja', type: 'sentence' },
    { text: '안녕하세요 반갑습니다', lang: 'ko', type: 'sentence' },
    { text: 'buenos días amigo', lang: 'es', type: 'sentence' }
];

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': '*/*'
};

const providers = {
    oxford_static: {
        name: 'Google Oxford MP3',
        supports: (lang, text) => lang.startsWith('en') && text.split(/\s+/).length <= 2,
        fetchAudio: async (text, lang) => {
            const word = text.toLowerCase().trim();
            const url = `https://ssl.gstatic.com/dictionary/static/sounds/oxford/${encodeURIComponent(word)}--_gb_1.mp3`;
            const res = await fetch(url, { headers: HEADERS });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const buf = await res.arrayBuffer();
            if (buf.byteLength < 200) throw new Error('Empty or invalid audio');
            return buf;
        }
    },
    cambridge_dict: {
        name: 'Cambridge Dictionary',
        supports: (lang, text) => lang.startsWith('en') && text.split(/\s+/).length === 1,
        fetchAudio: async (text, lang) => {
            const word = text.toLowerCase().trim();
            const pageUrl = `https://dictionary.cambridge.org/dictionary/english/${encodeURIComponent(word)}`;
            const pageRes = await fetch(pageUrl, { headers: HEADERS });
            if (!pageRes.ok) throw new Error(`HTTP ${pageRes.status}`);
            const html = await pageRes.text();
            const match = html.match(/<source\s+type="audio\/mpeg"\s+src="([^"]+)"/i) || html.match(/src="(\/media\/english\/uk_pron\/[^"]+\.mp3)"/i);
            if (!match || !match[1]) throw new Error('Audio URL not found in page');
            const audioUrl = match[1].startsWith('http') ? match[1] : `https://dictionary.cambridge.org${match[1]}`;
            const res = await fetch(audioUrl, { headers: HEADERS });
            if (!res.ok) throw new Error(`Audio HTTP ${res.status}`);
            const buf = await res.arrayBuffer();
            if (buf.byteLength < 200) throw new Error('Empty audio');
            return buf;
        }
    },
    youdao_dict: {
        name: 'Youdao Dict Voice',
        supports: (lang, text) => ['en', 'zh-CN', 'ja', 'ko', 'fr', 'es', 'de'].includes(lang) && text.length < 200,
        fetchAudio: async (text, lang) => {
            let le = 'zh';
            if (lang === 'zh-CN') le = 'zh';
            else if (lang === 'ja') le = 'jap';
            else if (lang === 'ko') le = 'ko';
            else if (lang === 'fr') le = 'fr';
            else if (lang === 'es') le = 'es';
            else if (lang === 'de') le = 'de';
            else if (lang.startsWith('en')) {
                const url = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&type=2`;
                const res = await fetch(url, { headers: HEADERS });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const buf = await res.arrayBuffer();
                if (buf.byteLength < 100) throw new Error('Empty audio');
                return buf;
            }
            const url = `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&le=${le}`;
            const res = await fetch(url, { headers: HEADERS });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const buf = await res.arrayBuffer();
            if (buf.byteLength < 100) throw new Error('Empty audio');
            return buf;
        }
    },
    spanishdict: {
        name: 'SpanishDict Audio',
        supports: (lang, text) => (lang === 'es' || lang.startsWith('en')) && text.split(/\s+/).length <= 4,
        fetchAudio: async (text, lang) => {
            const langParam = lang === 'es' ? 'es' : 'en';
            const url = `https://audio1.spanishdict.com/audio?lang=${langParam}&text=${encodeURIComponent(text)}`;
            const res = await fetch(url, { headers: HEADERS });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const buf = await res.arrayBuffer();
            if (buf.byteLength < 100) throw new Error('Empty audio');
            return buf;
        }
    },
    naver_papago: {
        name: 'Naver Papago TTS',
        supports: (lang) => ['ko', 'ja', 'zh-CN', 'en', 'es', 'fr', 'de', 'ru', 'th'].includes(lang),
        fetchAudio: async (text, lang) => {
            const speakerMap = {
                'ko': 'kyuri',
                'ja': 'yuri',
                'zh-CN': 'meimei',
                'en': 'clara',
                'es': 'carmen',
                'fr': 'roxane',
                'de': 'lena',
                'ru': 'vera',
                'th': 'somsi'
            };
            const speaker = speakerMap[lang] || 'clara';
            const makeIdUrl = 'https://papago.naver.com/api/tts/makeID';
            const params = new URLSearchParams({
                alpha: '0',
                pitch: '0',
                speaker: speaker,
                speed: '0',
                text: text
            });
            const idRes = await fetch(makeIdUrl, {
                method: 'POST',
                headers: {
                    ...HEADERS,
                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                    'Origin': 'https://papago.naver.com',
                    'Referer': 'https://papago.naver.com/'
                },
                body: params.toString()
            });
            if (!idRes.ok) throw new Error(`makeID HTTP ${idRes.status}`);
            const idData = await idRes.json();
            const soundId = idData.id;
            if (!soundId) throw new Error('No soundId returned');

            const audioUrl = `https://papago.naver.com/api/tts/${soundId}`;
            const audioRes = await fetch(audioUrl, {
                headers: {
                    ...HEADERS,
                    'Referer': 'https://papago.naver.com/'
                }
            });
            if (!audioRes.ok) throw new Error(`Audio HTTP ${audioRes.status}`);
            const buf = await audioRes.arrayBuffer();
            if (buf.byteLength < 100) throw new Error('Empty audio');
            return buf;
        }
    },
    google_translate: {
        name: 'Google Translate TTS',
        supports: () => true,
        fetchAudio: async (text, lang) => {
            const cleanLang = lang.split('-')[0];
            const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${cleanLang}&total=1&idx=0&textlen=${text.length}&client=tw-ob&ttsspeed=1`;
            const res = await fetch(url, { headers: HEADERS });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const buf = await res.arrayBuffer();
            if (buf.byteLength < 100) throw new Error('Empty audio');
            return buf;
        }
    }
};

async function runBenchmark() {
    console.log('='.repeat(90));
    console.log('   NEXUS TTS SPEED & COMPATIBILITY BENCHMARK');
    console.log('='.repeat(90));
    console.log();

    const summary = {};

    for (const [providerKey, provider] of Object.entries(providers)) {
        summary[providerKey] = {
            name: provider.name,
            totalRequests: 0,
            successes: 0,
            failures: 0,
            totalLatencyMs: 0,
            minLatencyMs: Infinity,
            maxLatencyMs: 0,
            results: []
        };
    }

    for (const sample of TEST_SAMPLES) {
        console.log(`\n🔹 Sample: "${sample.text}" (Lang: ${sample.lang}, Type: ${sample.type})`);
        console.log('-'.repeat(85));

        for (const [providerKey, provider] of Object.entries(providers)) {
            const stat = summary[providerKey];
            if (!provider.supports(sample.lang, sample.text)) {
                console.log(`  [SKIPPED] ${provider.name.padEnd(24)} : Not supported for this lang/format`);
                continue;
            }

            stat.totalRequests++;
            const t0 = performance.now();
            try {
                const audioBuffer = await provider.fetchAudio(sample.text, sample.lang);
                const latency = Math.round(performance.now() - t0);
                stat.successes++;
                stat.totalLatencyMs += latency;
                stat.minLatencyMs = Math.min(stat.minLatencyMs, latency);
                stat.maxLatencyMs = Math.max(stat.maxLatencyMs, latency);

                console.log(`  [SUCCESS] ${provider.name.padEnd(24)} : ⚡ ${latency}ms | Size: ${(audioBuffer.byteLength / 1024).toFixed(1)} KB`);
                stat.results.push({ sample: sample.text, latency, status: 'OK' });
            } catch (err) {
                const latency = Math.round(performance.now() - t0);
                stat.failures++;
                console.log(`  [FAILED ] ${provider.name.padEnd(24)} : ❌ ${err.message} (${latency}ms)`);
                stat.results.push({ sample: sample.text, latency, status: 'ERROR', error: err.message });
            }
        }
    }

    console.log('\n' + '='.repeat(90));
    console.log('   AGGREGATED PERFORMANCE SUMMARY');
    console.log('='.repeat(90));
    console.log(`| ${'Provider'.padEnd(24)} | ${'Success Rate'.padEnd(14)} | ${'Avg Latency'.padEnd(12)} | ${'Min'.padEnd(8)} | ${'Max'.padEnd(8)} |`);
    console.log(`|${'-'.repeat(26)}|${'-'.repeat(16)}|${'-'.repeat(14)}|${'-'.repeat(10)}|${'-'.repeat(10)}|`);

    for (const [key, stat] of Object.entries(summary)) {
        if (stat.totalRequests === 0) continue;
        const rate = `${stat.successes}/${stat.totalRequests} (${Math.round((stat.successes / stat.totalRequests) * 100)}%)`;
        const avg = stat.successes > 0 ? `${Math.round(stat.totalLatencyMs / stat.successes)} ms` : 'N/A';
        const min = stat.minLatencyMs !== Infinity ? `${stat.minLatencyMs} ms` : 'N/A';
        const max = stat.maxLatencyMs > 0 ? `${stat.maxLatencyMs} ms` : 'N/A';
        console.log(`| ${stat.name.padEnd(24)} | ${rate.padEnd(14)} | ${avg.padEnd(12)} | ${min.padEnd(8)} | ${max.padEnd(8)} |`);
    }
    console.log('='.repeat(90));
}

runBenchmark().catch(console.error);
