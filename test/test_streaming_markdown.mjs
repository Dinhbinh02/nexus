import assert from 'assert';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const markedMinPath = path.join(__dirname, '../src/lib/marked.min.js');
await import(`file://${markedMinPath}`);

import { completeIncompleteMarkdown, streamSafeParse, initMarkdownParser } from '../src/components/cores/markdown_parser.js';

initMarkdownParser();

console.log('--- Testing completeIncompleteMarkdown ---');

// Case 1: Bold streaming (The user's exact issue)
{
    const chunk1 = "**cf";
    const completed1 = completeIncompleteMarkdown(chunk1);
    console.log(`Chunk 1 input: "${chunk1}" -> completed: "${completed1}"`);
    assert.strictEqual(completed1, "**cf**");
    const html1 = streamSafeParse(chunk1);
    console.log(`HTML 1: ${html1.trim()}`);
    assert.ok(html1.includes('<strong>cf</strong>'), 'Should render strong tag on chunk 1');
    assert.ok(!html1.includes('**'), 'Should not contain raw ** in HTML');

    const chunk2 = "**cf.** là viết tắt của từ tiếng Latinh *confer*, có nghĩa là **";
    const completed2 = completeIncompleteMarkdown(chunk2);
    console.log(`Chunk 2 input: "${chunk2}" -> completed: "${completed2}"`);
    const html2 = streamSafeParse(chunk2);
    console.log(`HTML 2: ${html2.trim()}`);
    assert.ok(html2.includes('<strong>cf.</strong>'));
    assert.ok(html2.includes('<em>confer</em>'));
}

// Case 2: Code fence streaming
{
    const codeChunk = "```javascript\nconst x = 10;\nconsole.log(x);";
    const completed = completeIncompleteMarkdown(codeChunk);
    console.log('Code fence completed:\n' + completed);
    assert.ok(completed.endsWith('\n```'));
    const html = streamSafeParse(codeChunk);
    assert.ok(html.includes('<code class="language-javascript">'));
}

// Case 3: Inline code streaming
{
    const inlineCode = "Here is `myVariable";
    const completed = completeIncompleteMarkdown(inlineCode);
    assert.strictEqual(completed, "Here is `myVariable`");
    const html = streamSafeParse(inlineCode);
    assert.ok(html.includes('<code>myVariable</code>'));
}

// Case 4: Math block streaming
{
    const mathBlock = "$$\n\\int_{0}^{\\infty} e^{-x^2} dx";
    const completed = completeIncompleteMarkdown(mathBlock);
    assert.ok(completed.endsWith('$$'));
}

// Case 5: Custom XML tags streaming
{
    const xmlChunk = '<WritingBlock title="Test"><Option title="Opt 1">Hello **world';
    const completed = completeIncompleteMarkdown(xmlChunk);
    console.log('XML completed:\n' + completed);
    assert.ok(completed.endsWith('**</Option></WritingBlock>'));
}

// Case 6: Exact user SSE chunks replay
{
    const chunks = [
        "**cf",
        ".** là viết tắt của từ tiếng Latinh *confer*, có nghĩa là **",
        "\"đối chiếu\"**, **\"xem thêm\"** hoặc **\"so sánh với\"**. \n\nTrong văn bản học thuật",
        ", sách báo hoặc tài liệu nghiên cứu, từ này được dùng để hướng dẫn người đọc sang một trang, mục,",
        " hoặc tài liệu khác nhằm mục đích so sánh, kiểm chứng thông tin hoặc tìm hiểu thêm chi tiết.\n\n* **Ví",
        " dụ sử dụng:** \"Xem phân tích chi tiết về vấn đề này ở chương 2 (cf. Chương 2,",
        " tr. 45).\"\n* **Cách hiểu nhanh:** Hãy xem thêm / Đối chiếu với."
    ];

    let accumulated = '';
    console.log('\n--- Replaying User SSE Stream Frame by Frame ---');
    for (let i = 0; i < chunks.length; i++) {
        accumulated += chunks[i];
        const parsedHtml = streamSafeParse(accumulated);
        console.log(`[Frame ${i + 1}] Parsed HTML snippet:\n${parsedHtml.slice(0, 120)}...`);
        // Verify that raw ** is NEVER exposed in the HTML content
        assert.ok(!parsedHtml.includes('**'), `Frame ${i + 1} must not contain raw ** markdown marker!`);
    }
}

console.log('\n✅ ALL STREAMING AND SSE TESTS PASSED PERFECTLY!');
