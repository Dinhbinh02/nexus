import { performance } from 'perf_hooks';
import { fetchAudio, isHeteronym, inferPartOfSpeech } from '../src/background/tts/index.js';
import { preprocessText, detectLanguage } from '../src/background/tts/text_processor.js';
import { trimLeadingSilenceFromMp3 } from '../src/background/tts/audio_trimmer.js';

const TEST_CASES_50 = [
    { id: 1, category: 'Single Word (Oxford/Youdao)', text: 'hello', lang: 'en-GB' },
    { id: 2, category: 'Single Word (Oxford/Youdao)', text: 'serendipity', lang: 'en-GB' },
    { id: 3, category: 'Single Word (Oxford/Youdao)', text: 'ephemeral', lang: 'en-GB' },
    { id: 4, category: 'Single Word (Oxford/Youdao)', text: 'quintessential', lang: 'en-GB' },
    { id: 5, category: 'Single Word (Oxford/Youdao)', text: 'ubiquitous', lang: 'en-GB' },
    { id: 6, category: 'UK vs US Spelling', text: 'colour', lang: 'en-GB' },
    { id: 7, category: 'UK vs US Spelling', text: 'organisation', lang: 'en-GB' },
    { id: 8, category: 'UK vs US Spelling', text: 'theatre', lang: 'en-GB' },

    { id: 9, category: 'Heteronym (Noun)', text: 'record', context: 'She set a new world record in swimming.', expectedPos: 'noun', lang: 'en-GB' },
    { id: 10, category: 'Heteronym (Verb)', text: 'record', context: 'Please record this meeting for the team.', expectedPos: 'verb', lang: 'en-GB' },
    { id: 11, category: 'Heteronym (Noun)', text: 'present', context: 'He gave me a birthday present.', expectedPos: 'noun', lang: 'en-GB' },
    { id: 12, category: 'Heteronym (Verb)', text: 'present', context: 'They will present the research tomorrow.', expectedPos: 'verb', lang: 'en-GB' },
    { id: 13, category: 'Heteronym (Noun)', text: 'object', context: 'What is that metallic object on the floor?', expectedPos: 'noun', lang: 'en-GB' },
    { id: 14, category: 'Heteronym (Verb)', text: 'object', context: 'I must object to this unfair decision.', expectedPos: 'verb', lang: 'en-GB' },
    { id: 15, category: 'Heteronym (Noun)', text: 'project', context: 'We are working on a new software project.', expectedPos: 'noun', lang: 'en-GB' },
    { id: 16, category: 'Heteronym (Verb)', text: 'project', context: 'The lights project shadows on the wall.', expectedPos: 'verb', lang: 'en-GB' },
    { id: 17, category: 'Heteronym (Noun)', text: 'desert', context: 'The Sahara is a vast desert.', expectedPos: 'noun', lang: 'en-GB' },
    { id: 18, category: 'Heteronym (Verb)', text: 'desert', context: 'Soldiers should never desert their posts.', expectedPos: 'verb', lang: 'en-GB' },
    { id: 19, category: 'Heteronym (Noun)', text: 'rebel', context: 'He was known as a teenage rebel.', expectedPos: 'noun', lang: 'en-GB' },
    { id: 20, category: 'Heteronym (Verb)', text: 'rebel', context: 'Citizens began to rebel against the regime.', expectedPos: 'verb', lang: 'en-GB' },
    { id: 21, category: 'Heteronym (Noun)', text: 'contrast', context: 'There is a stark contrast between the two.', expectedPos: 'noun', lang: 'en-GB' },
    { id: 22, category: 'Heteronym (Verb)', text: 'contrast', context: 'We can contrast the results with previous data.', expectedPos: 'verb', lang: 'en-GB' },

    { id: 23, category: 'Short Phrase', text: 'artificial intelligence', lang: 'en-GB' },
    { id: 24, category: 'Short Phrase', text: 'piece of cake', lang: 'en-GB' },
    { id: 25, category: 'Short Phrase', text: 'break a leg', lang: 'en-GB' },
    { id: 26, category: 'Short Phrase', text: 'machine learning algorithms', lang: 'en-GB' },

    { id: 27, category: 'Sentence (English)', text: 'The quick brown fox jumps over the lazy dog.', lang: 'en-GB' },
    { id: 28, category: 'Sentence (English)', text: 'Modern frontend applications require modular architecture and reactive state.', lang: 'en-GB' },

    { id: 29, category: 'Multilingual (Vietnamese)', text: 'Chào buổi sáng, chúc bạn một ngày làm việc hiệu quả!', lang: 'vi' },
    { id: 30, category: 'Multilingual (Vietnamese)', text: 'Hệ thống học tiếng Anh và tra cứu từ vựng thông minh.', lang: 'vi' },
    { id: 31, category: 'Multilingual (Chinese)', text: '你好，欢迎使用 Nexus 智能语音助手。', lang: 'zh-CN' },
    { id: 32, category: 'Multilingual (Chinese)', text: '今天天气非常晴朗，我们一起去公园散步吧。', lang: 'zh-CN' },
    { id: 33, category: 'Multilingual (Japanese)', text: 'こんにちは、今日も一日頑張りましょう。', lang: 'ja' },
    { id: 34, category: 'Multilingual (Japanese)', text: '東京の桜が満開になりました。', lang: 'ja' },
    { id: 35, category: 'Multilingual (Korean)', text: '안녕하세요, 만나서 반갑습니다.', lang: 'ko' },
    { id: 36, category: 'Multilingual (Korean)', text: '오늘 날씨가 정말 좋습니다.', lang: 'ko' },
    { id: 37, category: 'Multilingual (Spanish)', text: 'Buenos días, ¿cómo estás hoy amigo?', lang: 'es' },
    { id: 38, category: 'Multilingual (French)', text: 'Bonjour tout le monde, bienvenue à Paris.', lang: 'fr' },
    { id: 39, category: 'Multilingual (German)', text: 'Guten Morgen, wie geht es Ihnen?', lang: 'de' },
    { id: 40, category: 'Multilingual (Russian)', text: 'Привет, как твои дела сегодня?', lang: 'ru' },
    { id: 41, category: 'Multilingual (Thai)', text: 'สวัสดีครับ ยินดีที่ได้รู้จักครับ', lang: 'th' },

    { id: 42, category: 'Acronyms & Tech Terms', text: 'api and ssl with jwt token in ui', lang: 'en-GB' },
    { id: 43, category: 'Acronyms & Tech Terms', text: 'crud operations with sql db and dto layer', lang: 'en-GB' },
    { id: 44, category: 'Acronyms & Tech Terms', text: 'spa and pwa with ssr on cloud vm', lang: 'en-GB' },

    { id: 45, category: 'Anki Cloze & Sound Tags', text: 'The capital of France is {{c1::Paris::city}} [sound:audio1.mp3].', lang: 'en-GB' },
    { id: 46, category: 'HTML Stripping', text: '<div class="lesson"><p><b>Understanding</b> <span style="color:red;">distributed</span> systems.</p></div>', lang: 'en-GB' },
    { id: 47, category: 'Bracket Stripping', text: 'Photosynthesis (in green plants) produces glucose [energy] {important}.', lang: 'en-GB' },
    { id: 48, category: 'Numbers & Symbols', text: 'The model achieved 98.5% accuracy with $250 budget in 2026.', lang: 'en-GB' },
    { id: 49, category: 'Whitespace & Punctuation', text: '   extra   spaces   and   commas ,,, !!!   ', lang: 'en-GB' },
    { id: 50, category: 'Long Paragraph Chunking', text: 'Knowledge management systems allow individuals and teams to organize ideas, synthesize complex concepts, connect disparate notes into structured graphs, and retrieve relevant insights seamlessly during intense coding and research sessions.', lang: 'en-GB' }
];

async function runComprehensiveTest() {
    console.log('='.repeat(95));
    console.log('          NEXUS TTS COMPREHENSIVE 50-TEST-SUITE (SPEED & ACCURACY)');
    console.log('='.repeat(95));

    let passedCount = 0;
    let failedCount = 0;
    let totalLatency = 0;
    const providerStats = {};
    const categoryStats = {};

    for (const testCase of TEST_CASES_50) {
        const t0 = performance.now();
        try {
            const preprocessed = preprocessText(testCase.text, { stripBrackets: true });
            const detectedLang = detectLanguage(preprocessed);

            let pos = null;
            if (testCase.context && isHeteronym(testCase.text)) {
                pos = inferPartOfSpeech(testCase.text, testCase.context);
            }

            const result = await fetchAudio(testCase.text, 1.0, testCase.lang, {
                sentenceContext: testCase.context,
                pos: pos
            });

            const latency = Math.round(performance.now() - t0);
            totalLatency += latency;

            const provider = result.type || 'unknown';
            providerStats[provider] = (providerStats[provider] || 0) + 1;

            const cat = testCase.category;
            if (!categoryStats[cat]) categoryStats[cat] = { total: 0, passed: 0, latency: 0 };
            categoryStats[cat].total++;
            categoryStats[cat].latency += latency;

            if (result.chunks && result.chunks.length > 0) {
                passedCount++;
                categoryStats[cat].passed++;
                const posInfo = pos ? `[POS: ${pos.toUpperCase()}]` : '';
                const ipaInfo = result.ipa ? `[IPA: ${result.ipa}]` : '';
                console.log(`✅ [#${testCase.id.toString().padStart(2, '0')}] ${cat.padEnd(28)} | ${provider.padEnd(20)} | ⚡ ${latency.toString().padStart(4)}ms ${ipaInfo} ${posInfo}`);
            } else {
                failedCount++;
                console.log(`❌ [#${testCase.id.toString().padStart(2, '0')}] ${cat.padEnd(28)} | No audio returned`);
            }
        } catch (err) {
            failedCount++;
            const latency = Math.round(performance.now() - t0);
            console.log(`❌ [#${testCase.id.toString().padStart(2, '0')}] ${testCase.category.padEnd(28)} | ERROR: ${err.message} (${latency}ms)`);
        }
    }

    console.log('\n' + '='.repeat(95));
    console.log('                            FINAL TEST RESULTS SUMMARY');
    console.log('='.repeat(95));
    console.log(`Total Cases Tested : ${TEST_CASES_50.length}`);
    console.log(`Passed             : ${passedCount} / ${TEST_CASES_50.length} (${Math.round((passedCount / TEST_CASES_50.length) * 100)}%)`);
    console.log(`Failed             : ${failedCount}`);
    console.log(`Average Latency    : ${Math.round(totalLatency / TEST_CASES_50.length)} ms`);

    console.log('\n--- Provider Distribution ---');
    for (const [provider, count] of Object.entries(providerStats)) {
        console.log(`  • ${provider.padEnd(24)}: ${count} requests (${Math.round((count / TEST_CASES_50.length) * 100)}%)`);
    }

    console.log('\n--- Category Breakdown ---');
    for (const [cat, stat] of Object.entries(categoryStats)) {
        const avgCatLatency = Math.round(stat.latency / stat.total);
        console.log(`  • ${cat.padEnd(30)}: ${stat.passed}/${stat.total} passed | Avg: ${avgCatLatency}ms`);
    }
    console.log('='.repeat(95));
}

runComprehensiveTest().catch(console.error);
