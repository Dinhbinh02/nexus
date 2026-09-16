import { detectMediaType, processAttachments, processAttachmentsForGemini, readOpfsFileAsBase64 } from './attachment_processor.js';
import { UserMemory } from '../components/cores/memory.js';
import { UserLocation } from '../utils/location.js';

const sessionPorts = new Map();
const sessionControllers = new Map();

export function broadcastToSession(sessionId, message) {
    if (!sessionId) return;
    const ports = sessionPorts.get(sessionId);
    if (ports && ports.size > 0) {
        ports.forEach(port => {
            try {
                port.postMessage(message);
            } catch (_) {
                ports.delete(port);
            }
        });
    }
}

async function incrementModelUsage(modelId) {
    if (!modelId) return;
    try {
        const today = new Date().toISOString().split('T')[0];
        const data = await chrome.storage.local.get(['dailyModelStats']);
        let stats = data.dailyModelStats || { date: today, counts: {} };
        if (stats.date !== today) {
            stats.date = today;
            stats.counts = {};
        }
        if (!stats.counts[modelId]) {
            stats.counts[modelId] = 0;
        }
        stats.counts[modelId]++;
        await chrome.storage.local.set({
            dailyModelStats: stats,
            lastUsedModelId: modelId
        });
    } catch (e) {
        console.error('Error incrementing usage:', e);
    }
}

function normalizeOpenAICompatibleEndpoint(endpoint, targetPath) {
    if (typeof endpoint !== 'string') return endpoint;
    let trimmed = endpoint.trim().replace(/\/+$/, '');
    if (!trimmed) return trimmed;
    if (trimmed.includes('api.groq.com') && !trimmed.includes('/openai')) {
        trimmed = trimmed.replace('/v1', '/openai/v1');
    }
    const knownSuffixes = ['/chat/completions', '/models', '/audio/transcriptions'];
    for (const suffix of knownSuffixes) {
        if (trimmed.endsWith(suffix)) {
            return trimmed.slice(0, -suffix.length) + targetPath;
        }
    }
    if (trimmed.endsWith('/v1') || trimmed.endsWith('/v1beta/openai') || trimmed.endsWith('/openai/v1')) {
        return `${trimmed}${targetPath}`;
    }
    return `${trimmed}${targetPath}`;
}

function optimizeContextString(text) {
    if (!text || typeof text !== 'string') return '';
    return text
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/--- \[Segment \d+\] ---/g, '')
        .replace(/\[Context Source:.*?\]/g, '')
        .replace(/URL: https?:\/\/\S+/g, '')
        .trim();
}

function detectDomainFromContext(question = '', messages = []) {
    const combined = (question + ' ' + (messages.slice(-2).map(m => m.content || '').join(' '))).toLowerCase();

    if (/\b(code|function|react|javascript|typescript|python|html|css|bug|error|api|endpoint|git|docker|sql|database|regex|async|await|syntax|class|method)\b/i.test(combined)) {
        return 'software_engineering';
    }
    if (/\b(math|equation|formula|calculate|integral|derivative|matrix|probability|algebra|physics|velocity|quantum|theorem|geometry)\b/i.test(combined)) {
        return 'math_science';
    }
    if (/\b(symptom|illness|disease|medical|doctor|drug|medication|pain|diagnosis|treatment|dosage|infection|surgery|therapy)\b/i.test(combined)) {
        return 'health_medical';
    }
    if (/\b(law|legal|statute|contract|clause|liability|copyright|trademark|patent|regulation|compliance|jurisdiction)\b/i.test(combined)) {
        return 'legal';
    }
    return null;
}

function buildChatSystemInstruction(reasoningMode = false, surface = 'desktop', question = '', messages = [], requestOptions = {}, userLocation = null) {
    let timezone = 'UTC';
    try {
        timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (e) { }

    const now = new Date();
    const currentDate = now.toISOString().split('T')[0];
    const currentTime = now.toLocaleTimeString('en-US', { timeZone: timezone, hour12: false });
    const currentYear = now.getFullYear();

    let userLocLine = '';
    if (userLocation && userLocation.formatted) {
        userLocLine = `\nUser location: ${userLocation.formatted}`;
    } else if (requestOptions && requestOptions.userLocation) {
        userLocLine = `\nUser location: ${requestOptions.userLocation}`;
    }

    let instruction = `# system_instructions

Current date: ${currentDate}
Current time: ${currentTime}
Timezone: ${timezone}${userLocLine}

You are Nexus. You are an authentic, adaptive AI collaborator with a touch of wit. Your goal is to address the user's true intent with insightful, clear, and helpful responses. Balance empathy with candor: validate the user's feelings authentically as a supportive, grounded AI, while correcting significant misinformation gently yet directly—like a helpful peer, not a rigid lecturer. Subtly adapt your tone, energy, and humor to the user's style.

For time-sensitive user queries that require up-to-date information, you MUST follow the provided current time (date and year) when formulating search queries in tool calls. Remember it is ${currentYear} this year.

## lmdx_syntax_protocol

You are a streaming engine. Follow these syntax laws to avoid parser crashes.

**Law 1: Flat Structure.** No root wrapper tag. Output a flat stream of blocks.

**Law 2: Line-Start Law.** Every opening tag MUST start the line. Content and closing tag MAY follow on the same line for leaf nodes.
* *Good:* \`<Step title="Install"> Run the installer </Step>\` (tag starts line)
* *Good:* \`<Elicitation label="Learn more" query="..."/>\` (self-closing)
* *Bad:* \`<Sequence><Step>...\` (parser misses Step)
* *Bad:* \`Here are the steps: <Sequence>...\` (parser treats as text)

**Law 3: Block Boundaries.** XML components are block terminators. Do NOT place components inside Markdown blocks (list items, blockquotes, or table cells).

**Law 4: Attribute Safety.** \`>\` inside a prop value is **FATAL** - it closes the tag and spills raw text. Escape \`"\` inside props with \`\\"\`. All props must be quoted strings - even numbers (\`count="5"\`, not \`count=5\`).
* *Bad:* \`title="Settings > General"\` - \`>\` closes the tag
* *Good:* \`title="Settings - General"\`
* *Bad:* \`title="The "Best" Way"\` - unescaped \`"\` terminates the attribute
* *Good:* \`title="The \\"Best\\" Way"\`

BANNED in props: \`{{...}}\` (double-brace expressions), \`{[...]}\`, \`{...}\`, JSON objects, Markdown formatting.

**Law 5: Fences for Complex Data.** Never put JSON or complex objects in props. Wrap them in fenced code blocks (\`\`\`) as a child element. Inside fences, the parser ignores XML tags.

**Law 6: Strict Parent-Child.** Containers accept ONLY their designated children - see each component's spec in the component library for valid children. Examples: \`<Sequence>\` → \`<Step>\`, \`<Timeline>\` → \`<TimelineEvent>\`. Using the wrong child tag is a fatal parser error.

**Law 7: XML-Safe Text.** In body text outside of code fences, write comparison operators as words ("less than 2 years", "greater than 50%") instead of \`<\` or \`>\` symbols. The parser may interpret bare \`<\` as an opening tag.

<component_library>

### <Widget> (Built-in Interactive Utilities & Realtime Tools)
* **[Universal Contract]:** Self-closing tag \`<Widget name="<type_slug>" [semantic_attributes] />\`. Supported utility categories:
  - \`world_clock\`: Current time across cities, countries, and timezones (e.g. \`<Widget name="world_clock" cities="Sydney" />\`).
  - \`timer\`: Countdown timer with chime alert (e.g. \`<Widget name="timer" minutes="10" />\`).
  - \`pomodoro\`: Focus timer with work/break intervals (e.g. \`<Widget name="pomodoro" work="25" break="5" />\`).
  - \`stopwatch\`: Precision stopwatch with lap tracking (e.g. \`<Widget name="stopwatch" />\`).
  - \`unit_converter\`: Measurement conversions for temperature, length, weight, speed, volume, data, area (e.g. \`<Widget name="unit_converter" category="temperature" from="f" to="c" value="155" />\`).
  - \`date_diff\`: Date intervals, age calculations & event countdowns (e.g. \`<Widget name="date_diff" from="2026-08-30" to="2027-01-01" />\`).
  - \`qr_generator\`: Instant QR code generator for URLs or text (e.g. \`<Widget name="qr_generator" text="https://example.com" />\`).
  - \`currency\`: Realtime currency exchange converter (e.g. \`<Widget name="currency" from="USD" to="EUR" amount="100" />\`).
  - \`crypto\`: Realtime cryptocurrency ticker and 24h market stats (e.g. \`<Widget name="crypto" symbol="BTC" />\`).
  - \`loan_calc\`: Amortization loan & mortgage calculator (e.g. \`<Widget name="loan_calc" amount="1000000" rate="8" years="15" />\`).
  - \`compound_interest\`: Compound growth & investment returns calculator (e.g. \`<Widget name="compound_interest" initial="10000" monthly="1000" rate="10" years="15" />\`).
  - \`tip_splitter\`: Bill and tip splitter for groups with per-person breakdown (e.g. \`<Widget name="tip_splitter" bill="145" tip="15" people="4" />\`).
  - \`gold_price\`: Live world spot gold price (XAU/USD) with interactive multi-timeframe charts (e.g. \`<Widget name="gold_price" unit="oz" quantity="1" />\`).
  - \`weather\`: Realtime current weather, humidity, wind & feels-like temperature (e.g. \`<Widget name="weather" city="London" unit="c" />\`).
  - \`weather_forecast\`: 7-day extended weather forecast with min/max temp trends (e.g. \`<Widget name="weather_forecast" city="Tokyo" />\`).
  - \`air_quality\`: Realtime Air Quality Index (AQI) and PM2.5 pollution monitor (e.g. \`<Widget name="air_quality" city="New York" />\`).
  - \`sun_uv\`: Realtime UV Index and celestial solar arc sunrise/sunset tracker (e.g. \`<Widget name="sun_uv" city="Sydney" />\`).
  - \`bmi_tdee\`: Body Mass Index (BMI) & daily maintenance calorie (TDEE) calculator (e.g. \`<Widget name="bmi_tdee" height="175" weight="70" age="26" gender="male" />\`).
  - \`function_plotter\`: Interactive 2D mathematical function grapher for y = f(x) (e.g. \`<Widget name="function_plotter" expr="x^2 - 4*x + 3" />\`).
  - \`periodic_table\`: Interactive chemistry periodic table and atomic elements explorer (e.g. \`<Widget name="periodic_table" element="Au" />\`).
* Limit strictly to max 1 \`<Widget />\` per response when an interactive tool is useful.

### <GenerateApp> (Interactive App / Sandbox Tool)
* **[Safety Refusal (Absolute Override)]:** REFUSE with Standard Text if the prompt requests interactive content involving: physical harm or dangerous challenges, illegal activity facilitation, drug synthesis or abuse, sexual or exploitative content, harassment or stalking, self-harm or eating disorders, harm to children or minors. If matched: do NOT generate a widget. Respond with a brief text refusal.
* **[Execution & Product Standards]:**
* **Self-Contained HTML+CSS+JS:** Write complete code inside the block.
* **Auto-Startup Execution:** ALWAYS call the calculation/render function immediately at the end of the script tag.
* **Anti-Slop Aesthetic Guidelines:**
  - Avoid AI Slop: Strictly NO multi-color gradients (linear-gradient) and NO box-shadows (use clean \`border: 1px solid var(--border-color)\` instead). Keep design clean, modern, and solid.
  - Typography Tokens: Use \`var(--font-sans)\`, \`var(--font-mono)\`, \`var(--text-xs)\`, \`var(--text-sm)\`, \`var(--text-base)\`, \`var(--text-xl)\`, \`var(--font-weight-medium)\`, \`var(--font-weight-bold)\`. Strictly NO \`@import\` external fonts.
  - Controls & Visualizers: Clean sleek range sliders, responsive compact canvas/charts (\`aspect-ratio: 16/9\` when applicable).
  - Runtime SDK Available: \`window.NexusApp\` provides \`ai.generate()\`, \`ai.stream()\`, \`ai.generateJson()\`, \`speak()\`, \`storage\`, \`copy()\`, \`toast()\`, \`fetch()\`, \`download()\`, \`confetti()\`.
* *Format:*  
<GenerateApp height="380px" title="App Name">
\`\`\`html
<style>
  /* Minimalist neutral styling */
</style>
<div class="card">
  <!-- Controls & Results -->
</div>
<script>
  function calculate() { /* Compute & update DOM elements */ }
  inputEl.addEventListener('input', calculate);
  calculate();
</script>
\`\`\`
</GenerateApp>

### <WritingBlock> (Document & Draft Deliverables)
* **[Role]:** In-line deliverable surface for drafting, writing, and editing long-form text artifacts (documents, emails, outlines, formal letters, social posts, essays).
* **Props:** \`variant\` [REQ: "document" | "email" | "letter" | "social" | "general"], \`title\` [REQ: concise name of the deliverable].
* **Child <Option>:** \`title\` [REQ: Option variant name], \`subject\` [OPT: For email variant].
* *Format:*
<WritingBlock variant="document" title="Sprint Retrospective Document">
<Option title="Detailed Draft">
# Sprint Retrospective
...markdown content...
</Option>
</WritingBlock>

### <Comparison> (Side-by-Side Dual Entity Matrix)
* **[Role]:** Side-by-side comparative analysis between 2 distinct entities (A vs B).
* **Props:** \`title\` [REQ], \`left\` [REQ: Entity A name], \`right\` [REQ: Entity B name].
* **Child <Aspect>:** \`label\` [REQ: compared dimension], \`leftWinner\` [OPT: "true"], \`rightWinner\` [OPT: "true"].
* *Format:*
<Comparison title="PostgreSQL vs MongoDB" left="PostgreSQL" right="MongoDB">
<Aspect label="Data Model">
<Left>Relational (RDBMS) tables</Left>
<Right>Document-oriented (BSON)</Right>
</Aspect>
<Aspect label="ACID Compliance" leftWinner="true">
<Left>Full ACID transactions</Left>
<Right>Document-level atomicity</Right>
</Aspect>
</Comparison>

### <Metrics> (Executive KPI Cards & Quantitative Formula Blocks)
* **[Role]:** High-density quantitative metric badges, KPI targets, Big-O complexities, and key stats.
* **Props:** \`title\` [OPT].
* **Child <Metric>:**
  - \`label\` [REQ]: Metric name or dimension (e.g. "ARR", "Time Complexity").
  - \`value\` [REQ]: Short target number, benchmark range, or formula (e.g. "> $1M / yr", "< 1% / mo", "≥ 3.0x", "O(n log n)"). Strictly keep under 4 words/numbers.
  - \`status\` [OPT]: "success" (green) | "warning" (yellow) | "danger" (red) | "neutral" (standard).
  - \`hint\` [OPT]: 1-line definition or condition context.
* *Format:*
<Metrics title="QuickSort Performance Benchmarks">
<Metric label="Best Case" value="O(n log n)" status="success" hint="Even partition" />
<Metric label="Worst Case" value="O(n²)" status="danger" hint="Already sorted array" />
<Metric label="Auxiliary Space" value="O(log n)" status="neutral" hint="Recursive stack space" />
</Metrics>

### <BentoGrid> (Asymmetric Feature Matrix & Modern Bento Highlights)
* **[Role]:** Feature highlights, core architectural pillars, or an executive multi-dimensional breakdown.
* **Props:** \`title\` [OPT - Card header title].
* **Child <BentoItem>:**
  - \`title\` [REQ]: Concise feature or concept headline (e.g. "React Compiler", "Zero-Cost Abstractions").
  - \`span\` [OPT: "1" | "2"]: Set "2" for flagship/hero items (wide 2 columns) or "1" for compact items.
  - \`tag\` [OPT]: Short category badge (e.g. "Flagship", "Performance", "Security", "Core").
  - \`icon\` [OPT]: "sparkles" | "zap" | "shield" | "layers" | "cpu" | "code" | "rocket" | "chart" | "globe".
  - Child content: 1-2 sentences of markdown explanation.
* *Format:*
<BentoGrid title="Next.js 15 Core Highlights">
<BentoItem title="React 19 & React Compiler" span="2" tag="Flagship" icon="sparkles">
Full support for React 19, async request lifecycles, and automated build-time memoization.
</BentoItem>
<BentoItem title="Turbopack Dev" span="1" tag="Performance" icon="zap">
Up to 76.7% faster local server startup and 96.3% faster fast refresh iterations.
</BentoItem>
<BentoItem title="Enhanced Security" span="1" tag="Security" icon="shield">
Server Actions with unguessable action IDs and dead code elimination for server-only logic.
</BentoItem>
</BentoGrid>

</component_library>\n`;

    if (requestOptions.lengthModifier === 'shorter') {
        instruction += `\n\n[Instruction: Be concise and direct]`;
    } else if (requestOptions.lengthModifier === 'longer') {
        instruction += `\n\n[Instruction: Provide a comprehensive and detailed response with explanations and examples]`;
    }

    if (requestOptions.bypassPersonalization) {
        instruction += `\n\n[Mode: Non-Personalized / Objective Baseline]
The user requested a non-personalized, objective response. Formulate this answer purely from first principles and objective domain standards without referencing previous subjective preferences or persona biases.`;
    }

    const domain = detectDomainFromContext(question, messages);
    if (domain === 'software_engineering') {
        instruction += `\n\n[Domain Overlay: Software Engineering & Code]
- Code Quality: Deliver production-grade, clean, defensive code with explicit error handling.
- Syntax: Use modern, idiomatic conventions (ESNext, async/await, typed interfaces where applicable).
- Self-Contained: Ensure code blocks include necessary imports or variable definitions to run reliably.`;
    } else if (domain === 'math_science') {
        instruction += `\n\n[Domain Overlay: Mathematics & Natural Sciences]
- Precision: Render equations and formulas with exact KaTeX LaTeX syntax ($...$ for inline, $$...$$ for block).
- Derivation: Show intermediate reasoning steps clearly when solving multi-step mathematical problems.`;
    } else if (domain === 'health_medical') {
        instruction += `\n\n[Domain Overlay: Health & Medical Information]
- Rigor: Provide factually rigorous, evidence-based physiological mechanisms.
- Safety: Distinguish educational physiological explanations from individualized clinical diagnoses, and include appropriate guidance to consult certified medical professionals.`;
    } else if (domain === 'legal') {
        instruction += `\n\n[Domain Overlay: Legal & Compliance Analysis]
- Jurisdictional Awareness: Explicitly state when legal principles depend on specific regional jurisdictions.
- Objective Evaluation: Provide balanced analytical breakdowns accompanied by a standard non-legal-advice disclaimer.`;
    }

    return instruction;
}


function cleanThinkingBlocks(text) {
    if (!text || typeof text !== 'string') return text || '';
    return text
        .replace(/<(think|thought|reasoning|details)>[\s\S]*?<\/(think|thought|reasoning|details)>/gi, '')
        .replace(/^<(think|thought|reasoning|details)>[\s\S]*/gi, '')
        .trim();
}


async function buildApiPayload(msgs, currentQ, sysPrompt, activeKey, params) {
    const { model, endpoint, providerType, temperature, topP, parsedCustomParams, normalizedThinkingLevel, isGemini25Model, reasoningMode, imageData, maxTokens = null, isStreaming = true, cachedContent = null } = params;
    const isGemini = providerType === 'gemini' || (typeof endpoint === 'string' && endpoint.includes('generativelanguage.googleapis.com'));
    if (isGemini) {
        const geminiContents = [];
        for (const msg of msgs) {
            const attachments = msg.files || msg.images;
            const role = (msg.role === 'model' || msg.role === 'assistant') ? 'model' : 'user';
            const cleanText = cleanThinkingBlocks(msg.text || '');
            if (attachments && attachments.length > 0) {
                const parts = [];
                if (!cachedContent) {
                    const processed = await processAttachmentsForGemini(attachments);
                    parts.push(...processed.parts);
                    if (processed.unsupported.length > 0) {
                        parts.push({ text: '[Note] Skipped unsupported attachments: ' + processed.unsupported.map(i => i.name).join(', ') });

                    }
                }
                if (cleanText) parts.push({ text: cleanText });
                if (parts.length === 0) parts.push({ text: '' });
                geminiContents.push({ role, parts });
            } else {
                geminiContents.push({ role, parts: [{ text: cleanText }] });
            }
        }
        if (imageData && imageData.length > 0) {
            const parts = [];
            if (!cachedContent) {
                const currentAttachments = Array.isArray(imageData) ? imageData : [imageData];
                const processed = await processAttachmentsForGemini(currentAttachments);
                parts.push(...processed.parts);
                if (processed.unsupported.length > 0) {
                    parts.push({ text: '[Note] Skipped unsupported attachments: ' + processed.unsupported.map(i => i.name).join(', ') });

                }
            }
            if (currentQ) parts.push({ text: currentQ });
            if (parts.length === 0) parts.push({ text: '' });
            geminiContents.push({ role: 'user', parts });
        } else {
            geminiContents.push({ role: 'user', parts: [{ text: currentQ || '' }] });
        }
        const maxOutputTokensVal = (Number.isFinite(maxTokens) && maxTokens > 0) ? parseInt(maxTokens, 10) : 8192;
        const generationConfig = {
            maxOutputTokens: maxOutputTokensVal,
            ...parsedCustomParams
        };
        const isGemini3 = /gemini-[3-9]/i.test(model);
        const isGemma = /gemma/i.test(model);
        if (!isGemini3) {
            generationConfig.temperature = temperature;
            generationConfig.topP = topP;
        }
        if (params.disableThinking) {
            delete generationConfig.thinkingConfig;
        } else {
            let level = normalizedThinkingLevel || 'medium';
            if (isGemma) {

                const gemmaLevel = (level === 'high' || level === 'medium') ? 'high' : 'minimal';
                generationConfig.thinkingConfig = {
                    includeThoughts: true,
                    thinkingLevel: gemmaLevel
                };
            } else if (isGemini3) {

                const validLevels = ['minimal', 'low', 'medium', 'high'];
                const targetLevel = validLevels.includes(level) ? level : (level === 'none' ? 'minimal' : 'medium');
                generationConfig.thinkingConfig = {
                    includeThoughts: true,
                    thinkingLevel: targetLevel
                };
            } else {

                let budget = -1;
                if (level === 'none' || level === 'minimal') {
                    budget = 0;
                } else if (level === 'low') {
                    budget = 1024;
                } else if (level === 'medium') {
                    budget = -1;
                } else if (level === 'high') {
                    budget = 4096;
                }
                generationConfig.thinkingConfig = {
                    includeThoughts: budget > 0 || budget === -1,
                    thinkingBudget: budget
                };
            }
        }
        const geminiBody = {
            contents: geminiContents,
            generationConfig,
            ...(sysPrompt ? {
                system_instruction: {
                    parts: [{ text: sysPrompt }]
                }
            } : {}),
            ...(cachedContent ? { cachedContent } : {})
        };
        const method = isStreaming ? 'streamGenerateContent' : 'generateContent';
        let baseEndpoint = endpoint.replace(/\/$/, '')
            .replace(/\/openai\/chat\/completions$/, '')
            .replace(/\/chat\/completions$/, '')
            .replace(/\/openai$/, '')
            .replace(/\/models$/, '');
        let urlModel = model;
        if (!urlModel.startsWith('models/')) {
            urlModel = 'models/' + urlModel;
        }
        const url = `${baseEndpoint}/${urlModel}:${method}${isStreaming ? '?alt=sse' : ''}`;
        return { url, body: geminiBody };
    }
    const openaiMessages = [{ role: 'system', content: sysPrompt }];
    if (typeof NexusToken !== 'undefined') {
        const sysTokens = NexusToken.count(sysPrompt || '');
        const historyTokens = msgs.reduce((acc, m) => acc + NexusToken.count(m.text || ''), 0);
        const inputTokens = NexusToken.count(currentQ || '');
        let attachmentTokens = 0;
        const allAttachments = [...(imageData || [])];
        msgs.forEach(m => { if (m.files || m.images) allAttachments.push(...(m.files || m.images)); });
        allAttachments.forEach(att => {
            const mime = normalizeMimeType(att.mimeType || '');
            if (isTextAttachmentMime(mime)) {
                attachmentTokens += NexusToken.count(decodeBase64Utf8(getBase64FromAttachment(att)));
            } else {
                attachmentTokens += 765;
            }
        });
    }
    for (const msg of msgs) {
        const attachments = msg.files || msg.images;
        const cleanText = cleanThinkingBlocks(msg.text || '');
        if (attachments && attachments.length > 0) {
            const parts = [];
            if (cleanText) parts.push({ type: "text", text: cleanText });
            const processed = await processAttachments(attachments);
            parts.push(...processed.parts);
            if (processed.unsupported.length > 0) {
                parts.push({ type: "text", text: `[Note] Skipped unsupported attachments: ${processed.unsupported.map(i => i.name).join(', ')}` });
            }
            openaiMessages.push({ role: (msg.role === 'model' || msg.role === 'assistant') ? 'assistant' : 'user', content: parts });
        } else {
            openaiMessages.push({ role: (msg.role === 'model' || msg.role === 'assistant') ? 'assistant' : 'user', content: cleanText });
        }
    }
    if (imageData && imageData.length > 0) {
        const parts = [{ type: "text", text: currentQ }];
        const currentAttachments = Array.isArray(imageData) ? imageData : [imageData];
        const processed = await processAttachments(currentAttachments);
        parts.push(...processed.parts);
        openaiMessages.push({ role: 'user', content: parts });
    } else {
        openaiMessages.push({ role: 'user', content: currentQ });
    }
    const openaiBody = {
        model, messages: openaiMessages, temperature, top_p: topP,
        stream: isStreaming,
        ...(isStreaming ? { stream_options: { include_usage: true } } : {}),
        ...parsedCustomParams
    };
    const hasCustomTokenLimit = Object.prototype.hasOwnProperty.call(openaiBody, 'max_tokens')
        || Object.prototype.hasOwnProperty.call(openaiBody, 'max_completion_tokens')
        || Object.prototype.hasOwnProperty.call(openaiBody, 'max_output_tokens');
    if (!hasCustomTokenLimit) {
        if (Number.isFinite(maxTokens) && maxTokens > 0) {
            openaiBody.max_tokens = maxTokens;
        } else {
            openaiBody.max_tokens = 8192;
        }
    }
    if (normalizedThinkingLevel) {
        const effortMap = { none: 'none', minimal: 'low', low: 'low', medium: 'medium', high: 'high' };
        if (effortMap[normalizedThinkingLevel]) {
            openaiBody.reasoning_effort = effortMap[normalizedThinkingLevel];
        }
    }
    return { url: normalizeOpenAICompatibleEndpoint(endpoint, '/chat/completions'), body: openaiBody };
}

async function getModelChain(type = 'text', preferredModel = null) {
    const data = await chrome.storage.local.get(['models', 'providers', 'provider', 'model', 'lastUsedModel']);
    let chain = [];
    const storedModels = data.models || [];
    if (storedModels.length > 0) {
        chain = [...storedModels];
    } else {
        chain = [{ providerId: data.provider, model: data.model }];
    }
    const activeModel = preferredModel || (type === 'text' ? data.lastUsedModel : null);
    if (activeModel && activeModel.model) {
        let actPId = activeModel.providerId;
        const actModel = activeModel.model;
        if (!actPId || !data.providers?.some(p => p.id === actPId)) {
            const matchingChainItem = storedModels.find(item => item.model === actModel);
            if (matchingChainItem) {
                actPId = matchingChainItem.providerId;
            } else {
                const matchingProvider = data.providers?.find(p => p.defaultModel === actModel);
                if (matchingProvider) {
                    actPId = matchingProvider.id;
                }
            }
        }
        const idx = chain.findIndex(item => item.providerId === actPId && item.model === actModel);
        if (idx > 0) {
            const preferred = chain.splice(idx, 1)[0];
            chain.unshift(preferred);
        } else if (idx === -1 && actModel) {
            const matchingChainItem = data.modelChains?.text?.find(item => item.model === actModel);
            chain.unshift({
                providerId: actPId || '',
                model: actModel,
                maxTokens: activeModel.maxTokens || matchingChainItem?.maxTokens || 8192
            });
        }
    }
    const hydratedChain = chain.map(config => {
        const provider = data.providers?.find(p => p.id === config.providerId);
        if (!provider) return null;
        return {
            ...config,
            providerType: provider.type,
            apiKey: provider.apiKey,
            endpoint: provider.endpoint,
            defaultModel: provider.defaultModel
        };
    }).filter(item => item !== null);
    return hydratedChain;
}

function getKeysArray(keyStr) {
    if (!keyStr) return [];
    return keyStr.split(',').map(k => k.trim()).filter(k => k.length > 0);
}

function getTodayString() {
    const now = new Date();
    return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

async function fetchWithRotation(keys, requestFn, options = {}) {
    if (!keys || keys.length === 0) {
        return requestFn('');
    }
    const groupKey = 'rot_' + keys.join(',').substring(0, 32).replace(/[^a-zA-Z0-9]/g, '');
    const today = getTodayString();
    if (typeof options.keyIndex === 'number' && options.keyIndex >= 0 && options.keyIndex < keys.length) {
        return await requestFn(keys[options.keyIndex]);
    }
    let activeIndex = 0;
    try {
        const data = await chrome.storage.local.get([groupKey]);
        const state = data[groupKey];
        if (state && state.date === today) activeIndex = state.index;
    } catch (e) { }
    const isRateLimitOrTooLarge = async (response) => {
        if (response.status === 429 || response.status === 503) return true;
        if (response.status === 400 || response.status === 413) {
            try {
                const clone = response.clone();
                const text = await clone.text();
                if (/Request too large|tokens per minute|TPM|context_length_exceeded/i.test(text)) {
                    return true;
                }
            } catch (e) { }
        }
        return false;
    };
    for (let attempts = 0; attempts < keys.length; attempts++) {
        const currentIndex = (activeIndex + attempts) % keys.length;
        const currentKey = keys[currentIndex];
        try {
            const response = await requestFn(currentKey);
            if (await isRateLimitOrTooLarge(response)) {
                console.warn(`[Nexus] Key ${currentIndex} hit rate limit or request-too-large. Rotating to next key.`);
            } else {
                chrome.storage.local.set({
                    [groupKey]: { index: currentIndex, date: today }
                });
                return response;
            }
        } catch (err) {
            const errName = err?.name || '';
            const errMsg = err?.message || '';
            if (errName === 'AbortError' || errMsg.includes('aborted') || errMsg === 'signal is aborted without reason') {
                throw err;
            }
            const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
            const isFetchFailed = errName === 'TypeError' || errMsg.includes('Failed to fetch') || errMsg.includes('fetch failed') || errMsg.includes('network') || errMsg.includes('net::ERR');
            if (isOffline || isFetchFailed) {
                const netErr = new Error("Network error: Failed to connect to the AI provider. Please check your internet connection.");
                netErr.name = 'NetworkError';
                throw netErr;
            }
            console.error(`[Nexus] Request failed with key ${currentIndex}:`, err);
        }
    }
    throw new Error("All API keys failed or were rate limited in this cycle.");
}

async function executeChatRequest(config, messages, initialContext, question, port, imageData = null, isNexus = false, globalSettings = {}, requestOptions = {}, action = 'chat_stream', systemOverride = null, sessionId = null) {
    const { model, providerType: currentProvider, endpoint, apiKey, defaultModel } = config;
    const streamLogPrefix = `[Nexus BG][${action}]`;
    const advancedParamsByModel = globalSettings.advancedParamsByModel || {};
    const providerId = config.providerId;
    const compositeKey = providerId ? `${providerId}:${model}` : model;
    const modelParams = (providerId && advancedParamsByModel[compositeKey]) ? advancedParamsByModel[compositeKey] : (!providerId ? (advancedParamsByModel[model] || {}) : {});
    const temperature = requestOptions.temperature ?? modelParams.temperature ?? 1.0;
    const topP = modelParams.topP ?? 1.0;
    const maxTokens = requestOptions.maxTokens ?? config.maxTokens ?? null;
    const thinkingLevel = requestOptions.thinkingLevel ?? modelParams.thinkingLevel ?? null;
    const customParams = modelParams.customParams || {};
    const responseLanguage = globalSettings.responseLanguage;
    let parsedCustomParams = {};
    if (customParams) {
        if (typeof customParams === 'object') {
            parsedCustomParams = customParams;
        } else if (typeof customParams === 'string') {
            try { parsedCustomParams = JSON.parse(customParams); } catch (e) { }
        }
    }
    const hasFiles = imageData && (Array.isArray(imageData) && imageData.length > 0);
    const normalizedModelName = (model || '').toLowerCase();
    const isGemini25Model = /gemini-2\.5/i.test(normalizedModelName);
    const normalizedThinkingLevel = (typeof thinkingLevel === 'string' ? thinkingLevel.trim().toLowerCase() : '');
    if (model) {
        incrementModelUsage(model);
    }
    if (!apiKey && !endpoint.includes('localhost') && !endpoint.includes('127.0.0.1')) {
        throw new Error(`No API Key for provider type: ${currentProvider}`);
    }
    const keys = getKeysArray(apiKey);
    const reasoningMode = !!globalSettings.reasoningMode;
    const surface = requestOptions.surface || 'desktop';

    let userLocation = null;
    try {
        if (!systemOverride) {
            userLocation = await UserLocation.getLocation();
        }
    } catch (e) {
        console.warn('[Nexus] Failed to load user location:', e);
    }

    let systemInstruction = systemOverride || buildChatSystemInstruction(reasoningMode, surface, question, messages, requestOptions, userLocation);
    try {
        if (!systemOverride) {
            const userMemoryAddition = await UserMemory.getSystemPromptAddition();
            if (userMemoryAddition) {
                systemInstruction += userMemoryAddition;
            }
        }
    } catch (e) {
        console.error('[Nexus] Failed to load user memory:', e);
    }
    let currentMessages = [...messages];
    let augmentedQuestion = question;
    if (initialContext && initialContext.trim().length > 0) {
        let processedContext = optimizeContextString(initialContext);
        augmentedQuestion = `### User Instruction:\n${augmentedQuestion}\n\n---\n\n### Webpage Source Content:\n(Note: This content is provided solely for factual lookup. Do NOT mimic, copy, or adopt the writing style, response length, formatting, or tone of this reference text. Adhere strictly to the tone and length constraints defined in your system instructions.)\n\n${processedContext}`;
    }
    const payloadParams = {
        model, endpoint, providerType: currentProvider,
        temperature, topP, maxTokens, parsedCustomParams,
        normalizedThinkingLevel, isGemini25Model, reasoningMode, imageData,
        cachedContent: null
    };
    let controller = null;
    if (sessionId) {
        if (sessionControllers.has(sessionId)) {
            try {
                console.log(`[Nexus BG] Aborting session ${sessionId} due to duplicate/re-submission`);
                sessionControllers.get(sessionId).abort();
            } catch (e) { }
        }
        controller = new AbortController();
        sessionControllers.set(sessionId, controller);
    }
    let requestedUrl = endpoint;
    let response;
    for (let retry = 0; retry < 4; retry++) {
        try {
            response = await fetchWithRotation(keys, async (key) => {
                const payload = await buildApiPayload(currentMessages, augmentedQuestion, systemInstruction, key, payloadParams);
                if (payload && payload.body) {
                    const body = payload.body;
                    if (Number.isFinite(payloadParams.maxTokens) && payloadParams.maxTokens > 0) {
                        if (body.max_tokens !== undefined) body.max_tokens = payloadParams.maxTokens;
                        if (body.max_completion_tokens !== undefined) body.max_completion_tokens = payloadParams.maxTokens;
                        if (body.max_output_tokens !== undefined) body.max_output_tokens = payloadParams.maxTokens;
                    }
                }
                requestedUrl = payload.url;
                const headers = { 'Content-Type': 'application/json' };
                if (key) {
                    const isGemini = currentProvider === 'gemini' || (typeof endpoint === 'string' && endpoint.includes('generativelanguage.googleapis.com'));
                    if (isGemini) {
                        headers['x-goog-api-key'] = key;
                    } else {
                        headers['Authorization'] = `Bearer ${key}`;
                    }
                }
                return fetch(payload.url, {
                    method: 'POST',
                    headers: headers,
                    body: JSON.stringify(payload.body),
                    signal: controller ? controller.signal : null
                });
            }, requestOptions);
            if (!response.ok) {
                const errorText = await response.text();
                let errorData;
                try {
                    errorData = JSON.parse(errorText);
                } catch (e) {
                    errorData = { raw: errorText };
                }
                console.error('[Nexus] API Error:', {
                    endpoint: requestedUrl,
                    status: response.status,
                    statusText: response.statusText,
                    errorData
                });
                const errMsg =
                    (typeof errorData?.error?.message === 'string' && errorData.error.message.trim()) ||
                    (typeof errorData?.message === 'string' && errorData.message.trim()) ||
                    (typeof errorText === 'string' && errorText.trim()) || '';
                const fallbackMsg = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''} from ${requestedUrl}${errorText ? `: ${errorText.slice(0, 300)}` : ''}`;
                const isTpmRateLimit = response.status === 429 || /Request too large|tokens per minute|TPM|rate_limit_exceeded|context_length_exceeded/i.test(errMsg);
                if (isTpmRateLimit && retry < 3) {
                    const limitMatch = errMsg.match(/Limit\s+(\d+)/i);
                    const requestedMatch = errMsg.match(/Requested\s+(\d+)/i);
                    let diff = 1000;
                    if (limitMatch && requestedMatch) {
                        const limit = parseInt(limitMatch[1], 10);
                        const requested = parseInt(requestedMatch[1], 10);
                        if (requested > limit) {
                            diff = requested - limit + 150;
                        }
                    }
                    const currentMaxTokens = payloadParams.maxTokens || 4096;
                    let newMaxTokens = currentMaxTokens;
                    if (diff > 0) {
                        const maxReducible = currentMaxTokens - 1024;
                        if (maxReducible > 0) {
                            const reduction = Math.min(diff, maxReducible);
                            newMaxTokens = currentMaxTokens - reduction;
                            diff -= reduction;
                            payloadParams.maxTokens = newMaxTokens;
                            console.warn(`[Nexus] Dynamic token reduction: Changing max_tokens from ${currentMaxTokens} to ${newMaxTokens}. Remaining diff: ${diff}`);
                        }
                    }
                    if (diff > 0 && currentMessages.length > 2) {
                        let tokensRemoved = 0;
                        let pairsRemoved = 0;
                        while (diff > tokensRemoved && currentMessages.length > 2) {
                            const msg1 = currentMessages[0];
                            const msg2 = currentMessages[1];
                            const t1 = msg1 ? NexusToken.count(JSON.stringify(msg1)) : 0;
                            const t2 = msg2 ? NexusToken.count(JSON.stringify(msg2)) : 0;
                            tokensRemoved += (t1 + t2);
                            currentMessages.splice(0, 2);
                            pairsRemoved++;
                        }
                        console.warn(`[Nexus] Prompt too large. Removed ${pairsRemoved} message pair(s) to free up ~${tokensRemoved} tokens. Remaining diff: ${diff - tokensRemoved}`);
                    }
                    continue;
                }
                if (response.status === 429 || /Request too large|tokens per minute|TPM|context_length_exceeded/i.test(errMsg)) {
                    throw new Error('RATE_LIMIT_EXHAUSTED');
                }
                throw new Error(errMsg || fallbackMsg || 'Failed to fetch from AI provider');
            }
            break;
        } catch (e) {
            if (retry < 3 && (e.message === 'RATE_LIMIT_EXHAUSTED' || e.message === 'Failed to fetch')) {
                if (currentMessages.length > 2) {
                    console.warn(`[Nexus] Request failed. Retrying with cropped history...`);
                    currentMessages.splice(0, 2);
                    continue;
                }
            }
            throw e;
        }
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let emittedChunks = 0;
    let isInReasoning = false;
    const collectDeltasFromPayload = (payloadStr, textDeltas) => {
        if (!payloadStr) return false;
        const trimmedPayload = payloadStr.trim();
        if (!trimmedPayload) return false;
        if (trimmedPayload === '[DONE]' || trimmedPayload.includes('[DONE]')) {
            return true;
        }
        try {
            const parsed = JSON.parse(trimmedPayload);
            const choice = parsed.choices?.[0] || parsed.candidates?.[0] || {};
            const delta = choice.delta || {};
            let content = '';
            let reasoning = '';
            if (choice.content?.parts) {
                for (const part of choice.content.parts) {
                    if (part.thought === true) {
                        reasoning += part.text || '';
                    } else {
                        content += part.text || '';
                    }
                }
            } else {
                content = delta.content || '';
                if (Array.isArray(content)) {
                    content = content.map((part) => {
                        if (typeof part === 'string') return part;
                        if (part && typeof part.text === 'string') return part.text;
                        if (part && typeof part.content === 'string') return part.content;
                        return '';
                    }).join('');
                }
                if (!content && typeof choice.message?.content === 'string') {
                    content = choice.message.content;
                }
                reasoning = delta.reasoning || delta.reasoning_content || delta.reasoningContent || '';
                if (Array.isArray(reasoning)) {
                    reasoning = reasoning.map((part) => {
                        if (typeof part === 'string') return part;
                        if (part && typeof part.text === 'string') return part.text;
                        if (part && typeof part.content === 'string') return part.content;
                        return '';
                    }).join('');
                }
            }
            if (typeof reasoning === 'string' && reasoning.length > 0) {
                if (!isInReasoning) {
                    textDeltas.push('<think>');
                    isInReasoning = true;
                }
                textDeltas.push(reasoning);
            }
            if (typeof content === 'string' && content.length > 0) {
                if (isInReasoning) {
                    textDeltas.push('</think>');
                    isInReasoning = false;
                }
                textDeltas.push(content);
            }
            return true;
        } catch (e) {
            return false;
        }
    };
    const processSSEEvent = (rawEvent, textDeltas) => {
        if (!rawEvent) return;
        const lines = rawEvent.split(/\r?\n/);
        const dataLines = [];
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith(':') || trimmed.startsWith('event:')) continue;
            if (!trimmed.startsWith('data:')) continue;
            dataLines.push(trimmed.slice(5).trimStart());
        }
        if (dataLines.length === 0) return;
        const combinedPayload = dataLines.join('\n').trim();
        const parsedCombined = collectDeltasFromPayload(combinedPayload, textDeltas);
        if (!parsedCombined && dataLines.length > 1) {
            dataLines.forEach((payloadLine) => {
                collectDeltasFromPayload(payloadLine, textDeltas);
            });
        }
    };
    const emitChunk = (text) => {
        if (text.length > 0) {
            emittedChunks += 1;
            const chunkMsg = { action: 'chunk', chunk: text, sessionId };
            if (sessionId) broadcastToSession(sessionId, chunkMsg);
            else port.postMessage(chunkMsg);
        }
    };
    let nonSseBuffer = '';
    const detectAndExtractJsonError = (str) => {
        if (!str || typeof str !== 'string') return null;
        const trimmed = str.trim();
        if (!trimmed) return null;
        if (trimmed.includes('"error"') && (trimmed.includes('{') || trimmed.startsWith('{'))) {
            const firstBrace = trimmed.indexOf('{');
            const lastBrace = trimmed.lastIndexOf('}');
            if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
                const potentialJson = trimmed.slice(firstBrace, lastBrace + 1);
                try {
                    const parsed = JSON.parse(potentialJson);
                    if (parsed && parsed.error) {
                        return parsed.error.message || parsed.error.status || 'AI Service Error';
                    }
                } catch (e) {
                    const msgMatch = trimmed.match(/"message"\s*:\s*"([^"]+)"/);
                    if (msgMatch && msgMatch[1]) {
                        return msgMatch[1];
                    }
                }
            }
        }
        return null;
    };
    let keepAliveInterval = setInterval(() => {
        try {
            chrome.runtime.getPlatformInfo(() => { });
        } catch (e) {
            console.error('[Nexus] Keep-alive error:', e);
        }
    }, 5000);
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                const flushChunk = decoder.decode();
                if (flushChunk) {
                    buffer += flushChunk;
                }
                const tailDeltas = [];
                if (buffer && buffer.length > 0) {
                    const lines = buffer.split('\n');
                    for (const line of lines) {
                        const trimmed = line.trim();
                        if (!trimmed || trimmed.startsWith(':') || trimmed.startsWith('event:')) continue;
                        if (trimmed.startsWith('data:')) {
                            processSSEEvent(line, tailDeltas);
                        } else {
                            nonSseBuffer += (nonSseBuffer ? '\n' : '') + line;
                        }
                    }
                }
                const errorMsg = detectAndExtractJsonError(nonSseBuffer) || detectAndExtractJsonError(buffer);
                if (errorMsg) {
                    throw new Error(errorMsg);
                }
                for (const text of tailDeltas) {
                    emitChunk(text);
                }
                break;
            }
            const chunk = decoder.decode(value, { stream: true });
            const textDeltas = [];
            buffer += chunk;
            const lines = buffer.split('\n');
            buffer = lines.pop();
            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith(':') || trimmed.startsWith('event:')) continue;
                if (trimmed.startsWith('data:')) {
                    processSSEEvent(line, textDeltas);
                } else {
                    nonSseBuffer += (nonSseBuffer ? '\n' : '') + line;
                    const errorMsg = detectAndExtractJsonError(nonSseBuffer);
                    if (errorMsg) {
                        throw new Error(errorMsg);
                    }
                }
            }
            for (const text of textDeltas) {
                emitChunk(text);
            }
        }
    } finally {
        clearInterval(keepAliveInterval);
    }
    if (isInReasoning) {
        const thinkEndMsg = { action: 'chunk', chunk: '</think>', sessionId };
        if (sessionId) broadcastToSession(sessionId, thinkEndMsg);
        else port.postMessage(thinkEndMsg);
        isInReasoning = false;
    }
}

async function handleChatStream(messages, initialContext, question, port, imageData = null, isNexus = false, requestOptions = {}, hasTranscriptForVideoId = null, action = 'chat_stream', systemOverride = null, sessionId = null) {
    try {
        try {
            let activeUrl = port?.sender?.tab?.url;
            let activeTabId = port?.sender?.tab?.id;
            if (!activeUrl) {
                const queryOptions = isNexus ? { active: true } : { active: true, currentWindow: true };
                const tabs = await chrome.tabs.query(queryOptions);
                if (tabs && tabs.length > 0) {
                    activeUrl = tabs[0].url;
                    activeTabId = tabs[0].id;
                    if (isNexus && activeUrl && activeUrl.includes(chrome.runtime.id)) {
                        const allActive = await chrome.tabs.query({ active: true });
                        const realTab = allActive.find(t => t.url && !t.url.includes(chrome.runtime.id));
                        if (realTab) {
                            activeUrl = realTab.url;
                            activeTabId = realTab.id;
                        }
                    }
                }
            }
        } catch (e) {
            console.warn("[Nexus] Optional context extraction failed:", e);
        }
        const globalSettings = await chrome.storage.local.get(['responseLanguage', 'advancedParamsByModel']);
        let chain = await getModelChain('text', requestOptions.tabModel);
        const cleanMessages = (messages || []).map(m => {
            if (typeof m.content === 'string') {
                let cleaned = m.content.replace(/(image-search:\/\/[^)#\s]+)#[^)\s]+/g, '$1');
                return { ...m, content: cleaned.trim() };
            }
            return m;
        });
        if (!chain || chain.length === 0) {
            const errorMsg = { error: 'No valid AI models configured. Please check Options.' };
            if (sessionId) broadcastToSession(sessionId, errorMsg);
            else port.postMessage(errorMsg);
            return;
        }
        for (let i = 0; i < chain.length; i++) {
            const config = chain[i];
            try {
                const isLast = i === chain.length - 1;
                await executeChatRequest(config, cleanMessages, initialContext, question, port, imageData, isNexus, globalSettings, requestOptions, action, systemOverride, sessionId);
                return;
            } catch (e) {
                if (e.name === 'AbortError' || e.message?.includes('aborted') || e.message === 'signal is aborted without reason') {
                    console.log(`[Nexus] Request aborted by user at index ${i} (${config.model})`);
                    return;
                }
                if (e.message === 'RATE_LIMIT_EXHAUSTED') {
                    console.warn(`[Nexus] Model ${config.model} hit RATE LIMIT. Falling back to next...`);
                    if (i < chain.length - 1) {
                        try {
                            const statusMsg = {
                                action: 'status_update',
                                text: `Rate limit hit on ${config.model}. Switching to backup model...`,
                                sessionId: sessionId
                            };
                            if (sessionId) broadcastToSession(sessionId, statusMsg);
                            else port.postMessage(statusMsg);
                        } catch (err) { }
                        continue;
                    }
                }
                console.error(`[Nexus] Chat Chain failed at index ${i} (${config.model}):`, e);
                const errorMsg = { error: e.message || "AI Request Failed" };
                if (sessionId) broadcastToSession(sessionId, errorMsg);
                else port.postMessage(errorMsg);
                return;
            }
        }
    } catch (err) {
        console.error('[Nexus] Fatal Chat Error:', err);
        const errorMsg = { error: err.message };
        if (sessionId) broadcastToSession(sessionId, errorMsg);
        else port.postMessage(errorMsg);
    }
}

async function generateChatTitleFromModel(modelObj, question, images, files, history) {
    const chain = await getModelChain('text', modelObj);
    if (!chain || chain.length === 0) {
        throw new Error("No configured models found.");
    }
    const config = chain[0];
    const { model, providerType: currentProvider, endpoint, apiKey } = config;
    const keys = getKeysArray(apiKey);
    const systemInstruction = `Analyze the preceding prompt/conversation and generate a concise, descriptive chat title in 8 words or fewer. Capture the core topic or main intent directly without filler words, matching the language of the prompt. Respond ONLY with the title itself, nothing else. Do not wrap in quotes.`;
    const attachments = [];
    if (Array.isArray(images)) attachments.push(...images);
    if (Array.isArray(files)) attachments.push(...files);
    const payloadParams = {
        model, endpoint, providerType: currentProvider,
        temperature: 0.3, topP: 1.0, maxTokens: 50, parsedCustomParams: {},
        normalizedThinkingLevel: 'none', isGemini25Model: false, reasoningMode: false,
        imageData: attachments.length > 0 ? attachments : null,
        isStreaming: false, cachedContent: null, disableThinking: true
    };
    const titlePrompt = `Generate a concise, descriptive chat title (8 words or fewer) in the exact same language for the following prompt. Respond ONLY with the title text itself, without quotes or conversational filler:\n\n${question}`;
    const response = await fetchWithRotation(keys, async (key) => {
        const payload = await buildApiPayload(history || [], titlePrompt, systemInstruction, key, payloadParams);
        const headers = { 'Content-Type': 'application/json' };
        if (key) {
            const isGemini = currentProvider === 'gemini' || (typeof endpoint === 'string' && endpoint.includes('generativelanguage.googleapis.com'));
            if (isGemini) {
                headers['x-goog-api-key'] = key;
            } else {
                headers['Authorization'] = `Bearer ${key}`;
            }
        }
        return fetch(payload.url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload.body)
        });
    });
    if (!response.ok) {
        throw new Error(`HTTP error ${response.status}`);
    }
    const data = await response.json();
    let text = '';
    const isGemini = currentProvider === 'gemini' || (typeof endpoint === 'string' && endpoint.includes('generativelanguage.googleapis.com'));
    if (isGemini) {
        const parts = data.candidates?.[0]?.content?.parts || [];
        const textParts = parts.filter(p => p.text && !p.thoughtSignature && !p.thought);
        text = textParts.length > 0 ? textParts[textParts.length - 1].text : (parts[0]?.text || '');
    } else {
        text = data.choices?.[0]?.message?.content || '';
    }
    let cleanedText = text.trim();
    const lines = cleanedText.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length > 1) {
        const titleLine = lines.find(l => /^(corrected\s+)?title\s*:/i.test(l));
        if (titleLine) {
            cleanedText = titleLine;
        } else {

            cleanedText = lines[lines.length - 1];
        }
    }

    cleanedText = cleanedText.replace(/^(corrected\s+)?title\s*:\s*/i, '');
    cleanedText = cleanedText.replace(/^(suggested\s+)?title\s*:\s*/i, '');
    cleanedText = cleanedText.replace(/^chat\s+title\s*:\s*/i, '');
    cleanedText = cleanedText.trim().replace(/^["']|["']$/g, '').trim();
    if (!cleanedText) {
        return question.substring(0, 30);
    }
    return cleanedText;
}


export function initChatStreamService() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request && request.action === 'generate_chat_title') {
            generateChatTitleFromModel(request.modelObj, request.question, request.images, request.files, request.history)
                .then(title => {
                    sendResponse({ success: true, title });
                })
                .catch(err => {
                    console.error('[Nexus BG] generate_chat_title error:', err);
                    sendResponse({ success: false, error: err?.message || String(err) });
                });
            return true;
        }
    });

    chrome.runtime.onConnect.addListener((port) => {
        if (port.name === 'nexus-chat-stream') {
            const registeredSessions = new Set();
            port.onDisconnect.addListener(() => {
                for (const sid of registeredSessions) {
                    if (sessionPorts.has(sid)) {
                        sessionPorts.get(sid).delete(port);
                        if (sessionPorts.get(sid).size === 0) {
                            sessionPorts.delete(sid);
                        }
                    }
                }
            });
            port.onMessage.addListener(async (msg) => {
                if (msg.action === 'ping') {
                    try {
                        chrome.runtime.getPlatformInfo(() => { });
                    } catch (e) { }
                    return;
                }
                if (msg.action === 'register_sessions' && Array.isArray(msg.sessionIds)) {
                    msg.sessionIds.forEach(sid => {
                        registeredSessions.add(sid);
                        if (!sessionPorts.has(sid)) sessionPorts.set(sid, new Set());
                        sessionPorts.get(sid).add(port);
                    });
                    return;
                }
                if (msg.action === 'stop_chat' && msg.sessionId) {
                    const controller = sessionControllers.get(msg.sessionId);
                    if (controller) {
                        console.log(`[Nexus BG] Aborting session ${msg.sessionId} due to stop_chat message`);
                        controller.abort();
                        sessionControllers.delete(msg.sessionId);
                    }
                    broadcastToSession(msg.sessionId, { action: 'done', sessionId: msg.sessionId });
                    return;
                }
                if (msg.sessionId && !registeredSessions.has(msg.sessionId)) {
                    registeredSessions.add(msg.sessionId);
                    if (!sessionPorts.has(msg.sessionId)) sessionPorts.set(msg.sessionId, new Set());
                    sessionPorts.get(msg.sessionId).add(port);
                }
                if (msg.action === 'chat_stream') {
                    try {
                        let question = msg.question;
                        let initialContext = msg.initialContext;
                        const finalSystemOverride = (msg.options && msg.options.systemOverride) || msg.systemOverride;
                        await handleChatStream(
                            msg.messages,
                            initialContext,
                            question,
                            port,
                            msg.imageData,
                            msg.isNexus ?? msg.isSpotlight ?? false,
                            msg.requestOptions || {},
                            msg.hasTranscriptForVideoId || null,
                            (msg.options && msg.options.mode) || msg.action,
                            finalSystemOverride,
                            msg.sessionId
                        );
                    } catch (e) {
                        console.error('[Nexus BG][stream] request error', {
                            action: msg.action,
                            error: e?.message || String(e)
                        });
                        port.postMessage({ action: 'chunk', chunk: `*Error: ${e.message}*` });
                    } finally {
                        const doneMsg = { action: 'done', sessionId: msg.sessionId };
                        if (msg.sessionId) broadcastToSession(msg.sessionId, doneMsg);
                        else port.postMessage(doneMsg);
                    }
                }
            });
        }
    });
}

