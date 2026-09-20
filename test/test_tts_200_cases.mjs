import { performance } from 'perf_hooks';
process.env.FORCE_PROXY = 'true'; // Use Cloudflare Proxy Hub for 50-thread high-concurrency benchmark
import { fetchAudio } from '../src/background/tts/index.js';

// 215 Exhaustive Test Cases: Positive, Academic, Inflections, Heteronyms, Phrases, Multilingual & Edge Cases
export const TEST_CASES_200 = [
    // 1. Positive Headwords (25 cases)
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
    { id: 11, text: 'freedom', pos: 'noun', category: 'Common Headwords' },
    { id: 12, text: 'journey', pos: 'noun', category: 'Common Headwords' },
    { id: 13, text: 'silence', pos: 'noun', category: 'Common Headwords' },
    { id: 14, text: 'harmony', pos: 'noun', category: 'Common Headwords' },
    { id: 15, text: 'adventure', pos: 'noun', category: 'Common Headwords' },
    { id: 16, text: 'clarity', pos: 'noun', category: 'Common Headwords' },
    { id: 17, text: 'courage', pos: 'noun', category: 'Common Headwords' },
    { id: 18, text: 'infinite', pos: 'adjective', category: 'Common Headwords' },
    { id: 19, text: 'wonder', pos: 'noun', category: 'Common Headwords' },
    { id: 20, text: 'treasure', pos: 'noun', category: 'Common Headwords' },
    { id: 21, text: 'wisdom', pos: 'noun', category: 'Common Headwords' },
    { id: 22, text: 'passion', pos: 'noun', category: 'Common Headwords' },
    { id: 23, text: 'elegance', pos: 'noun', category: 'Common Headwords' },
    { id: 24, text: 'horizon', pos: 'noun', category: 'Common Headwords' },
    { id: 25, text: 'universe', pos: 'noun', category: 'Common Headwords' },

    // 2. Academic & Advanced Vocabulary (30 cases - C1/C2 Oxford 5000 / OPAL)
    { id: 26, text: 'convert', pos: 'verb', category: 'Academic Vocabulary' },
    { id: 27, text: 'monastery', pos: 'noun', category: 'Academic Vocabulary' },
    { id: 28, text: 'epistemology', pos: 'noun', category: 'Academic Vocabulary' },
    { id: 29, text: 'phenomenology', pos: 'noun', category: 'Academic Vocabulary' },
    { id: 30, text: 'paradigm', pos: 'noun', category: 'Academic Vocabulary' },
    { id: 31, text: 'juxtapose', pos: 'verb', category: 'Academic Vocabulary' },
    { id: 32, text: 'ubiquitous', pos: 'adjective', category: 'Academic Vocabulary' },
    { id: 33, text: 'pragmatic', pos: 'adjective', category: 'Academic Vocabulary' },
    { id: 34, text: 'catalyst', pos: 'noun', category: 'Academic Vocabulary' },
    { id: 35, text: 'hypothesis', pos: 'noun', category: 'Academic Vocabulary' },
    { id: 36, text: 'dichotomy', pos: 'noun', category: 'Academic Vocabulary' },
    { id: 37, text: 'aesthetic', pos: 'adjective', category: 'Academic Vocabulary' },
    { id: 38, text: 'eloquent', pos: 'adjective', category: 'Academic Vocabulary' },
    { id: 39, text: 'meticulous', pos: 'adjective', category: 'Academic Vocabulary' },
    { id: 40, text: 'indispensable', pos: 'adjective', category: 'Academic Vocabulary' },
    { id: 41, text: 'concomitant', pos: 'adjective', category: 'Academic Vocabulary' },
    { id: 42, text: 'anachronism', pos: 'noun', category: 'Academic Vocabulary' },
    { id: 43, text: 'circumlocution', pos: 'noun', category: 'Academic Vocabulary' },
    { id: 44, text: 'perspicacious', pos: 'adjective', category: 'Academic Vocabulary' },
    { id: 45, text: 'quintessential', pos: 'adjective', category: 'Academic Vocabulary' },
    { id: 46, text: 'recalcitrant', pos: 'adjective', category: 'Academic Vocabulary' },
    { id: 47, text: 'surreptitious', pos: 'adjective', category: 'Academic Vocabulary' },
    { id: 48, text: 'syllogism', pos: 'noun', category: 'Academic Vocabulary' },
    { id: 49, text: 'verisimilitude', pos: 'noun', category: 'Academic Vocabulary' },
    { id: 50, text: 'zeitgeist', pos: 'noun', category: 'Academic Vocabulary' },
    { id: 51, text: 'magnanimous', pos: 'adjective', category: 'Academic Vocabulary' },
    { id: 52, text: 'ineffable', pos: 'adjective', category: 'Academic Vocabulary' },
    { id: 53, text: 'equivocate', pos: 'verb', category: 'Academic Vocabulary' },
    { id: 54, text: 'idiosyncratic', pos: 'adjective', category: 'Academic Vocabulary' },
    { id: 55, text: 'supercilious', pos: 'adjective', category: 'Academic Vocabulary' },

    // 3. Inflected Forms & Verb Tenses (35 cases)
    { id: 56, text: 'converted', pos: 'verb', category: 'Inflections & Plurals' },
    { id: 57, text: 'converting', pos: 'verb', category: 'Inflections & Plurals' },
    { id: 58, text: 'converts', pos: 'verb', category: 'Inflections & Plurals' },
    { id: 59, text: 'monasteries', pos: 'noun', category: 'Inflections & Plurals' },
    { id: 60, text: 'phenomena', pos: 'noun', category: 'Inflections & Plurals' },
    { id: 61, text: 'hypotheses', pos: 'noun', category: 'Inflections & Plurals' },
    { id: 62, text: 'breathing', pos: 'noun', category: 'Inflections & Plurals' },
    { id: 63, text: 'dramatically', pos: 'adverb', category: 'Inflections & Plurals' },
    { id: 64, text: 'strengthened', pos: 'verb', category: 'Inflections & Plurals' },
    { id: 65, text: 'simplifying', pos: 'verb', category: 'Inflections & Plurals' },
    { id: 66, text: 'characterized', pos: 'verb', category: 'Inflections & Plurals' },
    { id: 67, text: 'reproducing', pos: 'verb', category: 'Inflections & Plurals' },
    { id: 68, text: 'established', pos: 'verb', category: 'Inflections & Plurals' },
    { id: 69, text: 'capabilities', pos: 'noun', category: 'Inflections & Plurals' },
    { id: 70, text: 'collaborated', pos: 'verb', category: 'Inflections & Plurals' },
    { id: 71, text: 'underwent', pos: 'verb', category: 'Inflections & Plurals' },
    { id: 72, text: 'crystallized', pos: 'verb', category: 'Inflections & Plurals' },
    { id: 73, text: 'diminishing', pos: 'adjective', category: 'Inflections & Plurals' },
    { id: 74, text: 'exacerbated', pos: 'verb', category: 'Inflections & Plurals' },
    { id: 75, text: 'fluctuating', pos: 'adjective', category: 'Inflections & Plurals' },
    { id: 76, text: 'synthesized', pos: 'verb', category: 'Inflections & Plurals' },
    { id: 77, text: 'theorized', pos: 'verb', category: 'Inflections & Plurals' },
    { id: 78, text: 'rationalized', pos: 'verb', category: 'Inflections & Plurals' },
    { id: 79, text: 'diversified', pos: 'verb', category: 'Inflections & Plurals' },
    { id: 80, text: 'manifested', pos: 'verb', category: 'Inflections & Plurals' },
    { id: 81, text: 'orchestrated', pos: 'verb', category: 'Inflections & Plurals' },
    { id: 82, text: 'interconnected', pos: 'adjective', category: 'Inflections & Plurals' },
    { id: 83, text: 'reinforcing', pos: 'verb', category: 'Inflections & Plurals' },
    { id: 84, text: 'differentiated', pos: 'verb', category: 'Inflections & Plurals' },
    { id: 85, text: 'prioritized', pos: 'verb', category: 'Inflections & Plurals' },
    { id: 86, text: 'scrutinized', pos: 'verb', category: 'Inflections & Plurals' },
    { id: 87, text: 'streamlined', pos: 'verb', category: 'Inflections & Plurals' },
    { id: 88, text: 'unprecedented', pos: 'adjective', category: 'Inflections & Plurals' },
    { id: 89, text: 'substantiated', pos: 'verb', category: 'Inflections & Plurals' },
    { id: 90, text: 'accentuated', pos: 'verb', category: 'Inflections & Plurals' },

    // 4. Heteronyms / Homographs (20 cases)
    { id: 91, text: 'record', pos: 'noun', category: 'Heteronyms' },
    { id: 92, text: 'record', pos: 'verb', category: 'Heteronyms' },
    { id: 93, text: 'present', pos: 'noun', category: 'Heteronyms' },
    { id: 94, text: 'present', pos: 'verb', category: 'Heteronyms' },
    { id: 95, text: 'object', pos: 'noun', category: 'Heteronyms' },
    { id: 96, text: 'object', pos: 'verb', category: 'Heteronyms' },
    { id: 97, text: 'lead', pos: 'noun', category: 'Heteronyms' },
    { id: 98, text: 'lead', pos: 'verb', category: 'Heteronyms' },
    { id: 99, text: 'desert', pos: 'noun', category: 'Heteronyms' },
    { id: 100, text: 'desert', pos: 'verb', category: 'Heteronyms' },
    { id: 101, text: 'tear', pos: 'noun', category: 'Heteronyms' },
    { id: 102, text: 'tear', pos: 'verb', category: 'Heteronyms' },
    { id: 103, text: 'wind', pos: 'noun', category: 'Heteronyms' },
    { id: 104, text: 'wind', pos: 'verb', category: 'Heteronyms' },
    { id: 105, text: 'close', pos: 'adjective', category: 'Heteronyms' },
    { id: 106, text: 'close', pos: 'verb', category: 'Heteronyms' },
    { id: 107, text: 'rebel', pos: 'noun', category: 'Heteronyms' },
    { id: 108, text: 'rebel', pos: 'verb', category: 'Heteronyms' },
    { id: 109, text: 'contract', pos: 'noun', category: 'Heteronyms' },
    { id: 110, text: 'contract', pos: 'verb', category: 'Heteronyms' },

    // 5. Phrases, Collocations & Idioms (25 cases)
    { id: 111, text: 'early adopter', category: 'Phrases & Idioms' },
    { id: 112, text: 'artificial intelligence', category: 'Phrases & Idioms' },
    { id: 113, text: 'machine learning', category: 'Phrases & Idioms' },
    { id: 114, text: 'user experience', category: 'Phrases & Idioms' },
    { id: 115, text: 'state of the art', category: 'Phrases & Idioms' },
    { id: 116, text: 'once in a blue moon', category: 'Phrases & Idioms' },
    { id: 117, text: 'deep learning', category: 'Phrases & Idioms' },
    { id: 118, text: 'climate change', category: 'Phrases & Idioms' },
    { id: 119, text: 'software development', category: 'Phrases & Idioms' },
    { id: 120, text: 'data science', category: 'Phrases & Idioms' },
    { id: 121, text: 'bite the bullet', category: 'Phrases & Idioms' },
    { id: 122, text: 'break the ice', category: 'Phrases & Idioms' },
    { id: 123, text: 'piece of cake', category: 'Phrases & Idioms' },
    { id: 124, text: 'hit the nail on the head', category: 'Phrases & Idioms' },
    { id: 125, text: 'call it a day', category: 'Phrases & Idioms' },
    { id: 126, text: 'back to square one', category: 'Phrases & Idioms' },
    { id: 127, text: 'under the weather', category: 'Phrases & Idioms' },
    { id: 128, text: 'spill the beans', category: 'Phrases & Idioms' },
    { id: 129, text: 'burn the midnight oil', category: 'Phrases & Idioms' },
    { id: 130, text: 'cross that bridge', category: 'Phrases & Idioms' },
    { id: 131, text: 'cutting edge technology', category: 'Phrases & Idioms' },
    { id: 132, text: 'cloud computing', category: 'Phrases & Idioms' },
    { id: 133, text: 'neural network', category: 'Phrases & Idioms' },
    { id: 134, text: 'natural language processing', category: 'Phrases & Idioms' },
    { id: 135, text: 'large language model', category: 'Phrases & Idioms' },

    // 6. Vietnamese (15 cases)
    { id: 136, text: 'chào buổi sáng', lang: 'vi', category: 'Vietnamese' },
    { id: 137, text: 'trí tuệ nhân tạo', lang: 'vi', category: 'Vietnamese' },
    { id: 138, text: 'học máy', lang: 'vi', category: 'Vietnamese' },
    { id: 139, text: 'người tiên phong', lang: 'vi', category: 'Vietnamese' },
    { id: 140, text: 'hạnh phúc và thành công', lang: 'vi', category: 'Vietnamese' },
    { id: 141, text: 'chúc mừng năm mới', lang: 'vi', category: 'Vietnamese' },
    { id: 142, text: 'công nghệ thông tin', lang: 'vi', category: 'Vietnamese' },
    { id: 143, text: 'phát triển phần mềm', lang: 'vi', category: 'Vietnamese' },
    { id: 144, text: 'khám phá thế giới', lang: 'vi', category: 'Vietnamese' },
    { id: 145, text: 'học tập suốt đời', lang: 'vi', category: 'Vietnamese' },
    { id: 146, text: 'ngôn ngữ tự nhiên', lang: 'vi', category: 'Vietnamese' },
    { id: 147, text: 'xử lý dữ liệu lớn', lang: 'vi', category: 'Vietnamese' },
    { id: 148, text: 'kiến trúc hệ thống', lang: 'vi', category: 'Vietnamese' },
    { id: 149, text: 'trải nghiệm người dùng', lang: 'vi', category: 'Vietnamese' },
    { id: 150, text: 'tối ưu hóa hiệu năng', lang: 'vi', category: 'Vietnamese' },

    // 7. Japanese (15 cases)
    { id: 151, text: 'こんにちは', lang: 'ja', category: 'Japanese' },
    { id: 152, text: '人工知能', lang: 'ja', category: 'Japanese' },
    { id: 153, text: 'ありがとうございます', lang: 'ja', category: 'Japanese' },
    { id: 154, text: 'プログラミング', lang: 'ja', category: 'Japanese' },
    { id: 155, text: '今日も一日頑張りましょう', lang: 'ja', category: 'Japanese' },
    { id: 156, text: '機械学習', lang: 'ja', category: 'Japanese' },
    { id: 157, text: 'おはようございます', lang: 'ja', category: 'Japanese' },
    { id: 158, text: '東京大学', lang: 'ja', category: 'Japanese' },
    { id: 159, text: '自然言語処理', lang: 'ja', category: 'Japanese' },
    { id: 160, text: '深層学習', lang: 'ja', category: 'Japanese' },
    { id: 161, text: 'ソフトウェア開発', lang: 'ja', category: 'Japanese' },
    { id: 162, text: 'お疲れ様でした', lang: 'ja', category: 'Japanese' },
    { id: 163, text: '素晴らしい一日', lang: 'ja', category: 'Japanese' },
    { id: 164, text: 'データサイエンス', lang: 'ja', category: 'Japanese' },
    { id: 165, text: '未来の技術', lang: 'ja', category: 'Japanese' },

    // 8. Chinese (15 cases - Simplified & Traditional)
    { id: 166, text: '你好世界', lang: 'zh-CN', category: 'Chinese' },
    { id: 167, text: '人工智能', lang: 'zh-CN', category: 'Chinese' },
    { id: 168, text: '今天天气真好', lang: 'zh-CN', category: 'Chinese' },
    { id: 169, text: '機器學習', lang: 'zh-TW', category: 'Chinese' },
    { id: 170, text: '早安朋友', lang: 'zh-CN', category: 'Chinese' },
    { id: 171, text: '自然語言處理', lang: 'zh-TW', category: 'Chinese' },
    { id: 172, text: '深度學習技術', lang: 'zh-TW', category: 'Chinese' },
    { id: 173, text: '祝你有美好的一天', lang: 'zh-CN', category: 'Chinese' },
    { id: 174, text: '大數據分析', lang: 'zh-TW', category: 'Chinese' },
    { id: 175, text: '雲計算平台', lang: 'zh-TW', category: 'Chinese' },
    { id: 176, text: '軟件工程師', lang: 'zh-CN', category: 'Chinese' },
    { id: 177, text: '編程開發', lang: 'zh-TW', category: 'Chinese' },
    { id: 178, text: '量子計算', lang: 'zh-TW', category: 'Chinese' },
    { id: 179, text: '創新思維', lang: 'zh-TW', category: 'Chinese' },
    { id: 180, text: '知識就是力量', lang: 'zh-CN', category: 'Chinese' },

    // 9. Korean (10 cases)
    { id: 181, text: '안녕하세요', lang: 'ko', category: 'Korean' },
    { id: 182, text: '인공지능', lang: 'ko', category: 'Korean' },
    { id: 183, text: '감사합니다', lang: 'ko', category: 'Korean' },
    { id: 184, text: '오늘 날씨가 정말 좋습니다', lang: 'ko', category: 'Korean' },
    { id: 185, text: '빅데이터 분석', lang: 'ko', category: 'Korean' },
    { id: 186, text: '머신러닝', lang: 'ko', category: 'Korean' },
    { id: 187, text: '자연어 처리', lang: 'ko', category: 'Korean' },
    { id: 188, text: '소프트웨어 공학', lang: 'ko', category: 'Korean' },
    { id: 189, text: '딥러닝 모델', lang: 'ko', category: 'Korean' },
    { id: 190, text: '좋은 하루 되세요', lang: 'ko', category: 'Korean' },

    // 10. European & Global (10 cases)
    { id: 191, text: 'buenos días amigo', lang: 'es', category: 'European & Global' },
    { id: 192, text: 'inteligencia artificial', lang: 'es', category: 'European & Global' },
    { id: 193, text: 'bonjour le monde', lang: 'fr', category: 'European & Global' },
    { id: 194, text: 'intelligence artificielle', lang: 'fr', category: 'European & Global' },
    { id: 195, text: 'guten Morgen Deutschland', lang: 'de', category: 'European & Global' },
    { id: 196, text: 'künstliche Intelligenz', lang: 'de', category: 'European & Global' },
    { id: 197, text: 'привет мир', lang: 'ru', category: 'European & Global' },
    { id: 198, text: 'искусственный интеллект', lang: 'ru', category: 'European & Global' },
    { id: 199, text: 'สวัสดีครับยินดีที่ได้รู้จัก', lang: 'th', category: 'European & Global' },
    { id: 200, text: 'مرحبا بكم في العالم الرقمي', lang: 'ar', category: 'European & Global' },

    // 11. Edge Cases & Formatting (15 cases)
    { id: 201, text: 'a', category: 'Edge Cases' },
    { id: 202, text: 'I', category: 'Edge Cases' },
    { id: 203, text: 'state-of-the-art', category: 'Edge Cases' },
    { id: 204, text: 'API', category: 'Edge Cases' },
    { id: 205, text: 'HTTP', category: 'Edge Cases' },
    { id: 206, text: 'JSON', category: 'Edge Cases' },
    { id: 207, text: 'TTS', category: 'Edge Cases' },
    { id: 208, text: 'LLM', category: 'Edge Cases' },
    { id: 209, text: 'SDK', category: 'Edge Cases' },
    { id: 210, text: 'COVID-19', category: 'Edge Cases' },
    { id: 211, text: '2026', category: 'Edge Cases' },
    { id: 212, text: 'Web3', category: 'Edge Cases' },
    { id: 213, text: '"Hello, world!"', category: 'Edge Cases' },
    { id: 214, text: 'Wait... really???', category: 'Edge Cases' },
    { id: 215, text: '   CONVERTED   \n', category: 'Edge Cases' }
];

/**
 * Worker pool with 50 concurrent worker threads
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
 * Execute FULL end-to-end background TTS pipeline via fetchAudio()
 */
async function testCaseRunner(testCase) {
    const t0 = performance.now();
    try {
        const payload = await fetchAudio(testCase.text, 1.0, testCase.lang, {
            pos: testCase.pos
        });

        const latencyMs = Math.round(performance.now() - t0);

        if (payload && payload.chunks && payload.chunks.length > 0) {
            const firstChunk = payload.chunks[0];
            const base64Part = firstChunk.startsWith('data:audio/mpeg;base64,') ? firstChunk.split(',')[1] : firstChunk;
            const byteLength = Math.round((base64Part.length * 3) / 4);

            return {
                id: testCase.id,
                text: testCase.text,
                category: testCase.category,
                type: payload.type,
                ipa: payload.ipa,
                definitionsCount: payload.definitions ? payload.definitions.length : 0,
                isAcademic: payload.is_academic_word || false,
                byteLength,
                latencyMs,
                status: 'SUCCESS'
            };
        } else {
            return {
                id: testCase.id,
                text: testCase.text,
                category: testCase.category,
                type: payload ? payload.type : 'null',
                latencyMs,
                status: 'FAILED',
                error: 'No audio chunks returned'
            };
        }
    } catch (err) {
        return {
            id: testCase.id,
            text: testCase.text,
            category: testCase.category,
            latencyMs: Math.round(performance.now() - t0),
            status: 'FAILED',
            error: err.message
        };
    }
}

async function runBenchmark200() {
    console.log('='.repeat(100));
    console.log('   NEXUS 200+ CASES FULL PIPELINE TTS ULTRA-BENCHMARK (50 CONCURRENT THREADS)');
    console.log('='.repeat(100));
    console.log(`Total Test Cases  : ${TEST_CASES_200.length}`);
    console.log(`Worker Concurrency: 50 Parallel Threads`);
    console.log(`Target Function   : fetchAudio() (End-to-End Background Pipeline)`);
    console.log(`Audio Quality     : Prioritizing Studio Oxford/Longman Native Sound`);
    console.log(`Network Gateway   : Universal Cloudflare Anycast Proxy`);
    console.log('-'.repeat(100));

    const overallStart = performance.now();
    const results = await runConcurrentPool(TEST_CASES_200, 50, testCaseRunner);
    const overallTotalMs = Math.round(performance.now() - overallStart);

    console.log('\n' + '='.repeat(100));
    console.log('   DETAILED RESULTS BY CATEGORY');
    console.log('='.repeat(100));

    const successes = results.filter(r => r.status === 'SUCCESS');
    const failures = results.filter(r => r.status === 'FAILED');

    const categories = [...new Set(TEST_CASES_200.map(c => c.category))];
    for (const cat of categories) {
        const catResults = results.filter(r => r.category === cat);
        const catPass = catResults.filter(r => r.status === 'SUCCESS').length;
        console.log(`\n📂 [${cat}] (${catPass}/${catResults.length} Pass)`);
        for (const r of catResults) {
            const icon = r.status === 'SUCCESS' ? '✅' : '❌';
            const speed = `${r.latencyMs}ms`.padStart(7);
            const size = r.byteLength ? `${(r.byteLength / 1024).toFixed(1)}KB`.padStart(7) : '  0.0KB';
            const ipa = r.ipa ? `[${r.ipa}]`.padEnd(16) : ''.padEnd(16);
            const type = (r.type || 'unknown').padEnd(20);
            console.log(`  ${icon} #${String(r.id).padStart(3)}: ${r.text.padEnd(26)} | ⚡ ${speed} | 📦 ${size} | 🎙️ ${type} | ${ipa}`);
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

    const providerCounts = {};
    for (const r of successes) {
        providerCounts[r.type] = (providerCounts[r.type] || 0) + 1;
    }

    console.log('\n' + '='.repeat(100));
    console.log('   FULL PIPELINE PERFORMANCE & STABILITY REPORT');
    console.log('='.repeat(100));
    console.log(`🎯 Overall Pass Rate   : ${successes.length}/${TEST_CASES_200.length} (${((successes.length / TEST_CASES_200.length) * 100).toFixed(1)}%)`);
    console.log(`⏱️  Total Test Execution: ${overallTotalMs}ms for ${TEST_CASES_200.length} requests across 50 threads`);
    console.log(`⚡ Latency - Min        : ${minLatency}ms`);
    console.log(`⚡ Latency - Avg (P50)  : ${avgLatency}ms (P50: ${p50}ms)`);
    console.log(`⚡ Latency - P95        : ${p95}ms`);
    console.log(`⚡ Latency - P99 / Max  : ${p99}ms / ${maxLatency}ms`);
    console.log('-'.repeat(100));
    console.log('📊 Studio Sound / Provider Distribution:');
    for (const [provider, count] of Object.entries(providerCounts)) {
        console.log(`   - ${provider.padEnd(25)}: ${count} requests (${((count / successes.length) * 100).toFixed(1)}%)`);
    }
    console.log('='.repeat(100));
}

runBenchmark200().catch(console.error);
