import { performance } from 'perf_hooks';
process.env.FORCE_PROXY = 'true';
import { Providers } from '../src/background/tts/providers.js';
import { detectLanguage, normalizeLangCode, preprocessText } from '../src/background/tts/text_processor.js';
import { getOxfordData, getLongmanData } from '../src/background/tts/dictionary_providers.js';

// 100 Exhaustive Test Cases: Positive, Academic, Inflections, Heteronyms, Phrases, Multilingual & Edge Cases
export const TEST_CASES_100 = [
    // 1. Positive Headwords (Common English)
    { id: 1, text: 'hello', pos: 'noun', category: 'Common Headwords' },
    { id: 2, text: 'world', pos: 'noun', category: 'Common Headwords' },
    { id: 3, text: 'serendipity', pos: 'noun', category: 'Common Headwords' },
    { id: 4, text: 'abandon', pos: 'verb', category: 'Common Headwords' },
    { id: 5, text: 'computer', pos: 'noun', category: 'Common Headwords' },
    { id: 6, text: 'beautiful', pos: 'adjective', category: 'Common Headwords' },
    { id: 7, text: 'resilience', pos: 'noun', category: 'Common Headwords' },
    { id: 8, text: 'architecture', pos: 'noun', category: 'Common Headwords' },
    { id: 9, text: 'efficiency', pos: 'noun', category: 'Common Headwords' },
    { id: 10, text: 'innovation', pos: 'noun', category: 'Common Headwords' },

    // 2. Academic & Advanced Vocabulary (Oxford 5000 / OPAL / C1-C2)
    { id: 11, text: 'convert', pos: 'verb', category: 'Academic Vocabulary' },
    { id: 12, text: 'monastery', pos: 'noun', category: 'Academic Vocabulary' },
    { id: 13, text: 'epistemology', pos: 'noun', category: 'Academic Vocabulary' },
    { id: 14, text: 'phenomenology', pos: 'noun', category: 'Academic Vocabulary' },
    { id: 15, text: 'paradigm', pos: 'noun', category: 'Academic Vocabulary' },
    { id: 16, text: 'juxtapose', pos: 'verb', category: 'Academic Vocabulary' },
    { id: 17, text: 'ubiquitous', pos: 'adjective', category: 'Academic Vocabulary' },
    { id: 18, text: 'pragmatic', pos: 'adjective', category: 'Academic Vocabulary' },
    { id: 19, text: 'catalyst', pos: 'noun', category: 'Academic Vocabulary' },
    { id: 20, text: 'hypothesis', pos: 'noun', category: 'Academic Vocabulary' },
    { id: 21, text: 'dichotomy', pos: 'noun', category: 'Academic Vocabulary' },
    { id: 22, text: 'aesthetic', pos: 'adjective', category: 'Academic Vocabulary' },
    { id: 23, text: 'eloquent', pos: 'adjective', category: 'Academic Vocabulary' },
    { id: 24, text: 'meticulous', pos: 'adjective', category: 'Academic Vocabulary' },
    { id: 25, text: 'indispensable', pos: 'adjective', category: 'Academic Vocabulary' },

    // 3. Inflected Forms & Verb Tenses (Crucial Issue Fix)
    { id: 26, text: 'converted', pos: 'verb', category: 'Inflections & Plurals' },
    { id: 27, text: 'converting', pos: 'verb', category: 'Inflections & Plurals' },
    { id: 28, text: 'converts', pos: 'verb', category: 'Inflections & Plurals' },
    { id: 29, text: 'monasteries', pos: 'noun', category: 'Inflections & Plurals' },
    { id: 30, text: 'phenomena', pos: 'noun', category: 'Inflections & Plurals' },
    { id: 31, text: 'hypotheses', pos: 'noun', category: 'Inflections & Plurals' },
    { id: 32, text: 'breathing', pos: 'noun', category: 'Inflections & Plurals' },
    { id: 33, text: 'dramatically', pos: 'adverb', category: 'Inflections & Plurals' },
    { id: 34, text: 'strengthened', pos: 'verb', category: 'Inflections & Plurals' },
    { id: 35, text: 'simplifying', pos: 'verb', category: 'Inflections & Plurals' },
    { id: 36, text: 'characterized', pos: 'verb', category: 'Inflections & Plurals' },
    { id: 37, text: 'reproducing', pos: 'verb', category: 'Inflections & Plurals' },
    { id: 38, text: 'established', pos: 'verb', category: 'Inflections & Plurals' },
    { id: 39, text: 'capabilities', pos: 'noun', category: 'Inflections & Plurals' },
    { id: 40, text: 'collaborated', pos: 'verb', category: 'Inflections & Plurals' },

    // 4. Heteronyms / Homographs (POS Sensitivity Check)
    { id: 41, text: 'record', pos: 'noun', category: 'Heteronyms' },
    { id: 42, text: 'record', pos: 'verb', category: 'Heteronyms' },
    { id: 43, text: 'present', pos: 'noun', category: 'Heteronyms' },
    { id: 44, text: 'present', pos: 'verb', category: 'Heteronyms' },
    { id: 45, text: 'object', pos: 'noun', category: 'Heteronyms' },
    { id: 46, text: 'object', pos: 'verb', category: 'Heteronyms' },
    { id: 47, text: 'lead', pos: 'noun', category: 'Heteronyms' },
    { id: 48, text: 'lead', pos: 'verb', category: 'Heteronyms' },
    { id: 49, text: 'desert', pos: 'noun', category: 'Heteronyms' },
    { id: 50, text: 'desert', pos: 'verb', category: 'Heteronyms' },

    // 5. Short Phrases, Collocations & Idioms
    { id: 51, text: 'early adopter', category: 'Phrases & Collocations' },
    { id: 52, text: 'artificial intelligence', category: 'Phrases & Collocations' },
    { id: 53, text: 'machine learning', category: 'Phrases & Collocations' },
    { id: 54, text: 'user experience', category: 'Phrases & Collocations' },
    { id: 55, text: 'state of the art', category: 'Phrases & Collocations' },
    { id: 56, text: 'once in a blue moon', category: 'Phrases & Collocations' },
    { id: 57, text: 'deep learning', category: 'Phrases & Collocations' },
    { id: 58, text: 'climate change', category: 'Phrases & Collocations' },
    { id: 59, text: 'software development', category: 'Phrases & Collocations' },
    { id: 60, text: 'data science', category: 'Phrases & Collocations' },

    // 6. Multilingual: Vietnamese (Tiếng Việt)
    { id: 61, text: 'chào buổi sáng', lang: 'vi', category: 'Vietnamese' },
    { id: 62, text: 'trí tuệ nhân tạo', lang: 'vi', category: 'Vietnamese' },
    { id: 63, text: 'học máy', lang: 'vi', category: 'Vietnamese' },
    { id: 64, text: 'người tiên phong', lang: 'vi', category: 'Vietnamese' },
    { id: 65, text: 'hạnh phúc và thành công', lang: 'vi', category: 'Vietnamese' },

    // 7. Multilingual: Japanese (日本語)
    { id: 66, text: 'こんにちは', lang: 'ja', category: 'Japanese' },
    { id: 67, text: '人工知能', lang: 'ja', category: 'Japanese' },
    { id: 68, text: 'ありがとうございます', lang: 'ja', category: 'Japanese' },
    { id: 69, text: 'プログラミング', lang: 'ja', category: 'Japanese' },
    { id: 70, text: '今日も一日頑張りましょう', lang: 'ja', category: 'Japanese' },

    // 8. Multilingual: Chinese (中文)
    { id: 71, text: '你好世界', lang: 'zh-CN', category: 'Chinese' },
    { id: 72, text: '人工智能', lang: 'zh-CN', category: 'Chinese' },
    { id: 73, text: '今天天气真好', lang: 'zh-CN', category: 'Chinese' },
    { id: 74, text: '機器學習', lang: 'zh-TW', category: 'Chinese' },
    { id: 75, text: '早安朋友', lang: 'zh-CN', category: 'Chinese' },

    // 9. Multilingual: Korean (한국어)
    { id: 76, text: '안녕하세요', lang: 'ko', category: 'Korean' },
    { id: 77, text: '인공지능', lang: 'ko', category: 'Korean' },
    { id: 78, text: '감사합니다', lang: 'ko', category: 'Korean' },
    { id: 79, text: '오늘 날씨가 정말 좋습니다', lang: 'ko', category: 'Korean' },
    { id: 80, text: '빅데이터 분석', lang: 'ko', category: 'Korean' },

    // 10. Multilingual: European (Spanish, French, German, Russian, Thai, Arabic)
    { id: 81, text: 'buenos días amigo', lang: 'es', category: 'European & Other' },
    { id: 82, text: 'inteligencia artificial', lang: 'es', category: 'European & Other' },
    { id: 83, text: 'bonjour le monde', lang: 'fr', category: 'European & Other' },
    { id: 84, text: 'intelligence artificielle', lang: 'fr', category: 'European & Other' },
    { id: 85, text: 'guten Morgen Deutschland', lang: 'de', category: 'European & Other' },
    { id: 86, text: 'künstliche Intelligenz', lang: 'de', category: 'European & Other' },
    { id: 87, text: 'привет мир', lang: 'ru', category: 'European & Other' },
    { id: 88, text: 'искусственный интеллект', lang: 'ru', category: 'European & Other' },
    { id: 89, text: 'สวัสดีครับยินดีที่ได้รู้จัก', lang: 'th', category: 'European & Other' },
    { id: 90, text: 'مرحبا بكم في العالم الرقمي', lang: 'ar', category: 'European & Other' },

    // 11. Edge Cases & Formats
    { id: 91, text: 'a', category: 'Edge Cases' },
    { id: 92, text: 'I', category: 'Edge Cases' },
    { id: 93, text: 'state-of-the-art', category: 'Edge Cases' },
    { id: 94, text: 'API', category: 'Edge Cases' },
    { id: 95, text: 'HTTP', category: 'Edge Cases' },
    { id: 96, text: 'COVID-19', category: 'Edge Cases' },
    { id: 97, text: '2026', category: 'Edge Cases' },
    { id: 98, text: '"Hello, world!"', category: 'Edge Cases' },
    { id: 99, text: 'Wait... really???', category: 'Edge Cases' },
    { id: 100, text: '   CONVERTED   \n', category: 'Edge Cases' }
];

/**
 * Execute worker pool with fixed concurrency
 */
async function runConcurrentPool(items, concurrency, taskFn) {
    const results = new Array(items.length);
    let index = 0;

    async function worker() {
        while (index < items.length) {
            const currentIndex = index++;
            const item = items[currentIndex];
            try {
                results[currentIndex] = await taskFn(item, currentIndex);
            } catch (err) {
                results[currentIndex] = { item, error: err.message, status: 'FAILED' };
            }
        }
    }

    const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
    await Promise.all(workers);
    return results;
}

/**
 * Fast pipeline fetch matching background audio logic
 */
async function executeAudioPipeline(testCase) {
    const rawText = testCase.text;
    const normalizedText = preprocessText(rawText);
    const detected = testCase.lang || detectLanguage(normalizedText);
    const lang = normalizeLangCode(detected);

    const t0 = performance.now();

    let result = null;
    let serviceUsed = 'none';

    if (Providers.oxford_dictionary.supports(lang, normalizedText)) {
        try {
            const oxfordPromise = Providers.oxford_dictionary.getAudio(normalizedText, lang, { pos: testCase.pos }).catch(() => null);
            const longmanPromise = Providers.longman_dictionary.getAudio(normalizedText, lang, { pos: testCase.pos }).catch(() => null);
            const googlePromise = Providers.google_translate.getAudio(normalizedText, lang, { speed: 1.0 }).catch(() => null);

            // Phase 1: Fast Oxford check
            const fastOxford = await Promise.race([
                oxfordPromise,
                new Promise(resolve => setTimeout(() => resolve(null), 180))
            ]);

            if (fastOxford && fastOxford.audioDataUrl) {
                result = fastOxford;
                serviceUsed = 'oxford_dictionary';
            } else {
                const fastDictOrGoogle = await Promise.race([
                    oxfordPromise,
                    longmanPromise,
                    googlePromise,
                    new Promise(resolve => setTimeout(() => resolve(null), 300))
                ]);

                if (fastDictOrGoogle && fastDictOrGoogle.audioDataUrl) {
                    result = fastDictOrGoogle;
                    serviceUsed = fastDictOrGoogle.definitions ? (fastDictOrGoogle.service === 'Longman Dictionary' ? 'longman_dictionary' : 'oxford_dictionary') : 'google_translate';
                } else {
                    const fallbackData = await googlePromise || await oxfordPromise || await longmanPromise;
                    if (fallbackData && fallbackData.audioDataUrl) {
                        result = fallbackData;
                        serviceUsed = fallbackData.definitions ? 'oxford_dictionary' : 'google_translate';
                    }
                }
            }
        } catch (_) {}
    }

    if (!result && Providers.spanishdict.supports(lang, normalizedText)) {
        try {
            const d = await Providers.spanishdict.getAudio(normalizedText, lang);
            if (d && d.audioDataUrl) { result = d; serviceUsed = 'spanishdict'; }
        } catch (_) {}
    }

    if (!result && Providers.youdao_dict.supports(lang, normalizedText)) {
        try {
            const d = await Providers.youdao_dict.getAudio(normalizedText, lang);
            if (d && d.audioDataUrl) { result = d; serviceUsed = 'youdao_dict'; }
        } catch (_) {}
    }

    if (!result) {
        const isEastAsian = ['ko', 'ja', 'zh-CN', 'zh-TW', 'th'].includes(lang);
        const first = isEastAsian ? Providers.naver_papago : Providers.google_translate;
        const second = isEastAsian ? Providers.google_translate : Providers.naver_papago;

        if (first.supports(lang)) {
            try {
                const d = await first.getAudio(normalizedText, lang);
                if (d && d.audioDataUrl) { result = d; serviceUsed = isEastAsian ? 'naver_papago' : 'google_translate'; }
            } catch (_) {}
        }

        if (!result && second.supports(lang)) {
            try {
                const d = await second.getAudio(normalizedText, lang);
                if (d && d.audioDataUrl) { result = d; serviceUsed = isEastAsian ? 'google_translate' : 'naver_papago'; }
            } catch (_) {}
        }
    }

    const latencyMs = Math.round(performance.now() - t0);

    if (result && result.audioDataUrl && result.audioDataUrl.startsWith('data:audio/mpeg;base64,')) {
        const base64Part = result.audioDataUrl.split(',')[1] || '';
        const byteLength = Math.round((base64Part.length * 3) / 4);
        return {
            id: testCase.id,
            text: testCase.text,
            category: testCase.category,
            lang,
            service: serviceUsed,
            ipa: result.ipa || null,
            byteLength,
            latencyMs,
            status: 'SUCCESS'
        };
    } else {
        return {
            id: testCase.id,
            text: testCase.text,
            category: testCase.category,
            lang,
            service: serviceUsed,
            latencyMs,
            status: 'FAILED',
            error: 'No valid audio data URL produced'
        };
    }
}

async function runBenchmark100() {
    console.log('='.repeat(95));
    console.log('   NEXUS 100-CASE PARALLEL TTS & PROXY ULTRA-BENCHMARK (50 CONCURRENT THREADS)');
    console.log('='.repeat(95));
    console.log(`Total test cases  : ${TEST_CASES_100.length}`);
    console.log(`Concurrency level : 50 Parallel Workers`);
    console.log(`Proxy Gateway     : Cloudflare Anycast Proxy Hub`);
    console.log('-'.repeat(95));

    const overallStart = performance.now();
    const results = await runConcurrentPool(TEST_CASES_100, 50, executeAudioPipeline);
    const overallTotalMs = Math.round(performance.now() - overallStart);

    console.log('\n' + '='.repeat(95));
    console.log('   DETAILED TEST RESULTS (100 CASES)');
    console.log('='.repeat(95));

    const successes = results.filter(r => r.status === 'SUCCESS');
    const failures = results.filter(r => r.status === 'FAILED');

    // Group by Category
    const categories = [...new Set(TEST_CASES_100.map(c => c.category))];
    for (const cat of categories) {
        const catResults = results.filter(r => r.category === cat);
        const catPass = catResults.filter(r => r.status === 'SUCCESS').length;
        console.log(`\n📂 [${cat}] (${catPass}/${catResults.length} Pass)`);
        for (const r of catResults) {
            const icon = r.status === 'SUCCESS' ? '✅' : '❌';
            const speed = `${r.latencyMs}ms`.padStart(7);
            const size = r.byteLength ? `${(r.byteLength / 1024).toFixed(1)}KB`.padStart(7) : '  0.0KB';
            const ipa = r.ipa ? `[${r.ipa}]`.padEnd(16) : ''.padEnd(16);
            console.log(`  ${icon} #${String(r.id).padStart(3)}: ${r.text.padEnd(26)} | ⚡ ${speed} | 📦 ${size} | 🌐 ${r.service.padEnd(18)} | ${ipa}`);
        }
    }

    // Statistics Calculation
    const latencies = successes.map(r => r.latencyMs).sort((a, b) => a - b);
    const minLatency = latencies[0] || 0;
    const maxLatency = latencies[latencies.length - 1] || 0;
    const avgLatency = latencies.length ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : 0;
    const p50 = latencies[Math.floor(latencies.length * 0.5)] || 0;
    const p95 = latencies[Math.floor(latencies.length * 0.95)] || 0;
    const p99 = latencies[Math.floor(latencies.length * 0.99)] || 0;

    // Service Breakdown
    const serviceCounts = {};
    for (const r of successes) {
        serviceCounts[r.service] = (serviceCounts[r.service] || 0) + 1;
    }

    console.log('\n' + '='.repeat(95));
    console.log('   OVERALL PERFORMANCE & STABILITY REPORT');
    console.log('='.repeat(95));
    console.log(`🎯 Overall Pass Rate   : ${successes.length}/${TEST_CASES_100.length} (${((successes.length / TEST_CASES_100.length) * 100).toFixed(1)}%)`);
    console.log(`⏱️  Total Test Execution: ${overallTotalMs}ms for 100 requests across 50 threads`);
    console.log(`⚡ Latency - Min        : ${minLatency}ms`);
    console.log(`⚡ Latency - Avg (P50)  : ${avgLatency}ms (P50: ${p50}ms)`);
    console.log(`⚡ Latency - P95        : ${p95}ms`);
    console.log(`⚡ Latency - P99 / Max  : ${p99}ms / ${maxLatency}ms`);
    console.log('-'.repeat(95));
    console.log('📊 Provider Distribution:');
    for (const [svc, count] of Object.entries(serviceCounts)) {
        console.log(`   - ${svc.padEnd(22)}: ${count} requests (${((count / successes.length) * 100).toFixed(1)}%)`);
    }
    console.log('='.repeat(95));
}

runBenchmark100().catch(console.error);
