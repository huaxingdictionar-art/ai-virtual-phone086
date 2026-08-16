// lib/mixology/prose.ts
// 独家特调 · 正文语义协议：App 自有解析器，创作者零正则。
//
// 五种标记（由官方杯型引导 AI 书写，装饰 CSS 只管上色）：
//   「对白」   → dialogue    *心声*   → thought（整句斜体）
//   【场景】   → scene（独占一行，渲染成 — 场景 — 的过场行）
//   ~强调~    → accent      其余     → narration（普通叙述）
// 状态栏块 [状态栏]...[/状态栏] 在解析正文前剥离，交给沙盒 iframe 渲染。

export type MixProseSegmentType = "dialogue" | "thought" | "accent" | "narration";

export type MixProseSegment = {
    type: MixProseSegmentType;
    text: string;
};

export type MixProseParagraph =
    | { type: "scene"; text: string }
    | { type: "text"; segments: MixProseSegment[] };

// 兼容旧标签 [小票]：改名前开的局历史里还留着，别让它们的状态卡突然读不出来
const TICKET_BLOCK_RE = /\[(状态栏|小票)\]([\s\S]*?)\[\/(?:状态栏|小票)\]/g;

/** 从 AI 原文剥离状态栏块：返回干净正文 + 最后一个壳内原文 */
export function extractMixTicket(raw: string): { text: string; ticketRaw?: string } {
    let ticketRaw: string | undefined;
    const text = raw.replace(TICKET_BLOCK_RE, (_all, _tag: string, inner: string) => {
        const trimmed = inner.trim();
        if (trimmed) ticketRaw = trimmed;
        return "";
    }).trim();
    return { text, ticketRaw };
}

const INLINE_RE = /「([^」]*)」|\*([^*\n]+)\*|~([^~\n]+)~/g;

function parseInline(line: string): MixProseSegment[] {
    const segments: MixProseSegment[] = [];
    let cursor = 0;
    INLINE_RE.lastIndex = 0;
    for (let match = INLINE_RE.exec(line); match; match = INLINE_RE.exec(line)) {
        if (match.index > cursor) {
            segments.push({ type: "narration", text: line.slice(cursor, match.index) });
        }
        if (match[1] !== undefined) segments.push({ type: "dialogue", text: `「${match[1]}」` });
        else if (match[2] !== undefined) segments.push({ type: "thought", text: match[2] });
        else segments.push({ type: "accent", text: match[3] });
        cursor = match.index + match[0].length;
    }
    if (cursor < line.length) {
        segments.push({ type: "narration", text: line.slice(cursor) });
    }
    return segments;
}

/**
 * 把 AI 正文解析成段落序列。
 * 段落按空行/换行切分；整行被【】包裹的行视为场景过场，其余走内联解析。
 */
export function parseMixProse(text: string): MixProseParagraph[] {
    const paragraphs: MixProseParagraph[] = [];
    for (const rawLine of text.split(/\n+/)) {
        const line = rawLine.trim();
        if (!line) continue;
        const scene = line.match(/^【(.+)】$/);
        if (scene) {
            paragraphs.push({ type: "scene", text: scene[1].trim() });
            continue;
        }
        const segments = parseInline(line);
        if (segments.length) paragraphs.push({ type: "text", segments });
    }
    return paragraphs;
}
