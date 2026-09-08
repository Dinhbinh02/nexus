import markdownit from 'markdown-it';
import taskLists from 'markdown-it-task-lists';

const md = markdownit({
    html: true,
    linkify: true,
    breaks: false,
    typographer: true
}).use(taskLists, { enabled: true, label: true, labelAfter: false });

function highlightPlugin(mdInstance) {
    function tokenize(state, silent) {
        if (state.src.charCodeAt(state.pos) !== 0x3D || state.src.charCodeAt(state.pos + 1) !== 0x3D) {
            return false;
        }
        const start = state.pos;
        const max = state.posMax;
        if (silent) return false;

        let end = -1;
        for (let i = start + 2; i < max - 1; i++) {
            if (state.src.charCodeAt(i) === 0x3D && state.src.charCodeAt(i + 1) === 0x3D) {
                end = i;
                break;
            }
        }
        if (end === -1) return false;

        const content = state.src.slice(start + 2, end);
        if (!content || content.includes('\n')) return false;

        state.pos = end + 2;
        const tokenOpen = state.push('mark_open', 'mark', 1);
        tokenOpen.attrs = [['class', 'nexus-highlight']];
        const tokenText = state.push('text', '', 0);
        tokenText.content = content;
        state.push('mark_close', 'mark', -1);
        return true;
    }
    mdInstance.inline.ruler.before('emphasis', 'mark', tokenize);
}

md.use(highlightPlugin);

export function isMarkdownText(text) {
    if (!text || typeof text !== 'string') return false;
    const trimmed = text.trim();
    if (!trimmed) return false;

    // Check for markdown headers: # Header
    if (/^#{1,6}\s+\S+/m.test(trimmed)) return true;
    // Check for task lists: - [ ] or * [x] or [ ]
    if (/^\s*[-*+]?\s*\[[ xX]\]\s+/m.test(trimmed)) return true;
    // Check for code blocks: ``` or ~~~
    if (/^```|^~~~/m.test(trimmed)) return true;
    // Check for blockquotes: > Quote
    if (/^>\s+\S+/m.test(trimmed)) return true;
    // Check for markdown tables: | a | b |\n|---|---|
    if (/\|.+\|[\r\n]+\|[-:\s|]+\|/m.test(trimmed)) return true;
    // Check for horizontal rules: ---, ***, ___
    if (/^(?:---|---|\*\*\*|___)\s*$/m.test(trimmed)) return true;
    // Check for bullet lists with multiple items: - item1\n- item2
    if (/(?:^|\n)\s*[-*+]\s+.+\n\s*[-*+]\s+/m.test(trimmed)) return true;
    // Check for numbered lists: 1. item1\n2. item2
    if (/(?:^|\n)\s*\d+\.\s+.+\n\s*\d+\.\s+/m.test(trimmed)) return true;
    // Check for bold/italic/strike/highlight/link marks in text
    if (/\*\*[^*\n]+\*\*|~~[^~\n]+~~|==[^=\n]+==|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)/.test(trimmed)) return true;

    return false;
}

export function markdownToTipTapHtml(markdown) {
    if (!markdown || typeof markdown !== 'string') return '';
    let html = md.render(markdown);

    // Normalize task lists to TipTap format
    html = html.replace(/<ul class="contains-task-list">/g, '<ul data-type="taskList">');
    html = html.replace(/<li class="[^"]*task-list-item[^"]*">([\s\S]*?)<\/li>/g, (match, inner) => {
        const isChecked = /type="checkbox"\s+checked/.test(inner) || /checked=""/.test(inner) || /checked\b/.test(inner);
        const textOnly = inner
            .replace(/<input[^>]*>/gi, '')
            .replace(/<\/?label[^>]*>/gi, '')
            .trim();
        return `<li data-type="taskItem" data-checked="${isChecked}"><p>${textOnly}</p></li>`;
    });

    return html;
}

// Tests
const testCases = [
    {
        name: 'Header + Lists + Formatting',
        input: '# Note Title\n\nHere is a list:\n- [ ] Task 1\n- [x] Task 2\n\nSome **bold** and *italic* and ==highlight== and [link](https://nexus.ai)',
        expectMd: true
    },
    {
        name: 'Markdown Table',
        input: '| Command | Description |\n|---|---|\n| Mod-B | Bold |\n| Mod-I | Italic |',
        expectMd: true
    },
    {
        name: 'Code Fence',
        input: '```js\nconsole.log("hello");\n```',
        expectMd: true
    },
    {
        name: 'Plain text sentence',
        input: 'Just a regular sentence without markdown formatting.',
        expectMd: false
    }
];

let allPassed = true;
for (const tc of testCases) {
    const isMd = isMarkdownText(tc.input);
    const html = markdownToTipTapHtml(tc.input);
    console.log(`[TEST] ${tc.name}: isMd=${isMd} (expected ${tc.expectMd})`);
    if (isMd !== tc.expectMd) {
        console.error(`  FAIL: isMarkdownText returned ${isMd}`);
        allPassed = false;
    }
    console.log(`  Output HTML snippet: ${html.slice(0, 80)}...`);
}

if (allPassed) {
    console.log('✅ ALL TEST CASES PASSED!');
} else {
    process.exit(1);
}
