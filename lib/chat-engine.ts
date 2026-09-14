// lib/chat-engine.ts

import { createSseJsonParser } from "./sse-json";
import { maybeAppendShortcutCapability } from "./offline-shortcut-capability";
import { loadCharacters } from "./character-storage";
import { buildScreenEffectPromptHint } from "./chat-screen-effects";
import { emitChatPluginEvent, runChatPluginTransform } from "./chat-plugin-hooks";
import { buildChatPluginPromptFragments } from "./chat-plugin-storage";
import type { LlmRequestPayload } from "./chat-plugin-types";
import type { Character } from "./character-types";
import {
    ChatSession,
    ChatMessage,
    loadFollowUpSchedule,
    loadChatAppSettings,
    getMaxToolRounds,
    loadChatSessions,
    saveChatSessions,
    getLatestCharacterStateValues,
    normalizeVisionImagePromptLimit,
    createResponseBatchId,
    createToolExecutionId,
    isSessionStreamingEnabled,
} from "./chat-storage";
import { extractTextToolDirectiveText, stripTextToolDirectives } from "./text-tool-protocol";
import type { ApiConfig, PresetConfig, Prompt, PromptOrderEntry, RegexConfig } from "./settings-types";
import type { CustomAppPromptProfile } from "./custom-app-types";
import {
    resolveBinding,
    loadBindingConfig,
    loadApiConfigs,
    loadPresets,
    loadWorldBooks,
    loadRegexes,
    resolveUserIdentity,
} from "./settings-storage";
import { assemblePromptPayload, applyOutputRegex, type LLMMessage, type LLMContentPart } from "./llm-prompt-assembler";
import { MacroEngine, postProcessTrim } from "./macro-engine";
import { getStatusRegionConfig, resolveStatusRegionSection, resolveStatusRegionExampleLine, resolveStatusRegionComposition, resolveStatusRegionFullExample } from "./chat-status-region";
import {
    buildProviderDebugMessages,
    buildProviderRequest,
    debugMessagesFromRequest,
    nativeToolProtocolForConfig,
    parseProviderResponse,
    parseProviderStreamDelta,
    stripHallucinatedTimestamps,
    toLlmRequestMessages,
    type LlmProviderKind,
    type LlmRequestMessage,
    type LlmToolCall,
    type LlmToolCallDelta,
    type LlmToolDefinition,
} from "./llm-provider-adapter";
import { setDebugPromptSnapshot, type DebugPromptSnapshot } from "./debug-store";
import { extractFinishReason } from "./api-helpers";
import { fetchLlmPayload } from "./llm-http";
import { loadMemoryConfig, incrementEventCounter } from "./memory-storage";
import { retrieveCoreMemoriesForPrompt, retrieveMemoriesForPrompt } from "./memory-service";
import { formatCoreMemories, formatLongTermMemories } from "./memory-injector";
import { maybeRunSummarization } from "./memory-summarizer";
import { prepareShortTermContext } from "./short-term-assembler";
import { parseActionTags, dispatchActions } from "./action-parser";
import { findEnabledToolForSchema, getEnabledTools, type EnabledTool } from "./tool-storage";
import { formatToolsForPrompt, formatToolSchema } from "./tool-prompt";
import { loadChatOfflineTurns } from "./chat-offline-storage";
import { parseToolCalls, parseToolFetches, executeToolCalls, formatToolResults } from "./tool-executor";
import type { ToolCall, ToolResult } from "./tool-executor";
import { getCustomStickerNames, getCustomStickerExample } from "./custom-sticker-storage";
import { formatCustomAppChatDirectivesForPrompt } from "./custom-app-chat-directives";
import { loadAllTracks } from "./music-storage";
import { getActiveAppTags } from "./content-tag-utils";
import { isNeteaseConfigured, getUserPlaylists, getPlaylistTracks, checkLoginStatus, loadMusicApiConfig } from "./music-service";
import { buildCalendarScheduleMarker, getCurrentCalendarScheduleForPrompt } from "./calendar-storage";
import { getWeekStartIso } from "./calendar-utils";
import { buildCharacterTimeContext } from "./character-time";
import { getPromptTimestampOptionsForTimeContext } from "./prompt-time";
import { kvGet, kvSet, registerKvMigration } from "./kv-db";
import { pushApiLog } from "./api-log-store";
export { getApiLogs, clearApiLogs, type DebugInfo } from "./api-log-store";
import { stripStateAndInnerForPrompt } from "./prompt-sanitizer";
import { getInternalCapability, getInternalCapabilitySubToolDefinitions } from "./internal-capability-storage";
import { isMediaStoreRef, loadMediaBlob } from "./media-cache-storage";
import {
    DEFAULT_CHAT_BILINGUAL_PROMPT,
    DEFAULT_GROUP_CHAT_BILINGUAL_PROMPT,
    DEFAULT_GROUP_OFFLINE_CHAT_BILINGUAL_PROMPT,
    DEFAULT_OFFLINE_CHAT_BILINGUAL_PROMPT,
    resolveBilingualPrompt,
} from "./bilingual-prompt-defaults";
import { parseOfflineResponse, extractThinkingTag, type ParsedOfflineResponse } from "./chat-offline-storage";
import { throwIfAborted } from "./abort-utils";
import { armShortcutContinuation, SHORTCUT_VISION_OFF_NOTE, type ShortcutContinuationHandle, type ShortcutContinuationStyle } from "./shortcut-continuation-client";



export class ChatEngineError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ChatEngineError";
    }
}

const LLM_IMAGE_MAX_SIDE = 512;
const LLM_IMAGE_JPEG_QUALITY = 0.72;

function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("图片读取失败"));
        reader.readAsDataURL(blob);
    });
}

function loadImageFromBlob(blob: Blob): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(blob);
        const image = new Image();
        image.onload = () => {
            URL.revokeObjectURL(url);
            resolve(image);
        };
        image.onerror = () => {
            URL.revokeObjectURL(url);
            reject(new Error("图片解码失败"));
        };
        image.src = url;
    });
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number): Promise<Blob | null> {
    return new Promise((resolve) => {
        canvas.toBlob(resolve, mimeType, quality);
    });
}

function dataUrlToBlob(dataUrl: string): Blob | null {
    const match = dataUrl.match(/^data:([^;,]+)(;base64)?,(.*)$/);
    if (!match) return null;
    const mimeType = match[1] || "application/octet-stream";
    const isBase64 = Boolean(match[2]);
    try {
        const raw = isBase64 ? atob(match[3]) : decodeURIComponent(match[3]);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
        return new Blob([bytes], { type: mimeType });
    } catch {
        return null;
    }
}

export async function readCompressedImageDataUrl(blob: Blob): Promise<string> {
    return (await rasterizeImageBlobToJpegDataUrl(blob)) ?? blobToDataUrl(blob);
}

async function rasterizeImageBlobToJpegDataUrl(blob: Blob): Promise<string | null> {
    if (typeof document === "undefined" || typeof Image === "undefined") {
        return null;
    }

    try {
        const image = await loadImageFromBlob(blob);
        const sourceWidth = image.naturalWidth || image.width;
        const sourceHeight = image.naturalHeight || image.height;
        if (!sourceWidth || !sourceHeight) return null;

        const scale = Math.min(1, LLM_IMAGE_MAX_SIDE / Math.max(sourceWidth, sourceHeight));
        const width = Math.max(1, Math.round(sourceWidth * scale));
        const height = Math.max(1, Math.round(sourceHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) return null;

        context.fillStyle = "#fff";
        context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);

        const compressed = await canvasToBlob(canvas, "image/jpeg", LLM_IMAGE_JPEG_QUALITY);
        return compressed ? blobToDataUrl(compressed) : null;
    } catch {
        return null;
    }
}

function getImageRefMimeType(imageRef: string): string {
    const match = imageRef.match(/^data:([^;,]+)/i);
    return match?.[1]?.toLowerCase() ?? "";
}

function isGifMimeType(mimeType: string | undefined): boolean {
    return (mimeType || "").toLowerCase().includes("image/gif");
}

function isLikelyGifImageRef(imageRef: string): boolean {
    if (/^data:image\/gif[;,]/i.test(imageRef)) return true;
    try {
        const parsed = new URL(imageRef);
        return parsed.pathname.toLowerCase().endsWith(".gif");
    } catch {
        return /\.gif(?:$|[?#])/i.test(imageRef);
    }
}

async function fetchRemoteImageBlob(url: string): Promise<Blob | null> {
    if (typeof fetch === "undefined") return null;
    try {
        const response = await fetch(url);
        if (!response.ok) return null;
        return response.blob();
    } catch {
        return null;
    }
}

export async function resolveCompressedImageDataUrl(imageRef: string): Promise<string | null> {
    if (isMediaStoreRef(imageRef)) {
        const result = await loadMediaBlob(imageRef);
        return result ? readCompressedImageDataUrl(result.blob) : null;
    }
    if (imageRef.startsWith("data:image/")) {
        const blob = dataUrlToBlob(imageRef);
        return blob ? readCompressedImageDataUrl(blob) : imageRef;
    }
    return imageRef;
}

type VisionImageResolveResult =
    | { url: string }
    | { drop: true }
    | { keep: true };

async function resolveVisionImageRefForApi(imageRef: string): Promise<VisionImageResolveResult> {
    if (isMediaStoreRef(imageRef)) {
        const result = await loadMediaBlob(imageRef);
        if (!result) return { keep: true };
        if (isGifMimeType(result.mimeType) || isGifMimeType(result.blob.type)) {
            const staticDataUrl = await rasterizeImageBlobToJpegDataUrl(result.blob);
            return staticDataUrl ? { url: staticDataUrl } : { drop: true };
        }
        return { url: await readCompressedImageDataUrl(result.blob) };
    }

    if (imageRef.startsWith("data:image/")) {
        const blob = dataUrlToBlob(imageRef);
        if (!blob) return { keep: true };
        if (isGifMimeType(getImageRefMimeType(imageRef)) || isGifMimeType(blob.type)) {
            const staticDataUrl = await rasterizeImageBlobToJpegDataUrl(blob);
            return staticDataUrl ? { url: staticDataUrl } : { drop: true };
        }
        return { url: await readCompressedImageDataUrl(blob) };
    }

    try {
        const parsed = new URL(imageRef);
        const isLegacyShortcutMedia = parsed.pathname === "/api/push/shortcut-commands/media";
        const isShortcutResultMedia = parsed.pathname.endsWith("/functions/v1/push-shortcut-result")
            && parsed.searchParams.get("download") === "1";
        if (isLegacyShortcutMedia || isShortcutResultMedia) return { drop: true };
    } catch {
        // 非 URL 引用继续交给下方的常规判断。
    }

    if (isLikelyGifImageRef(imageRef)) {
        const blob = await fetchRemoteImageBlob(imageRef);
        if (!blob) return { drop: true };
        const staticDataUrl = await rasterizeImageBlobToJpegDataUrl(blob);
        return staticDataUrl ? { url: staticDataUrl } : { drop: true };
    }

    return { url: imageRef };
}

export async function prepareVisionPromptImageMessage(msg: ChatMessage): Promise<void> {
    if (msg.mediaType === "sticker") {
        if (msg.role !== "user") return;
        const stickerUrl = msg.mediaData?.stickerUrl?.trim();
        if (!stickerUrl) return;
        const result = await resolveVisionImageRefForApi(stickerUrl);
        if ("url" in result) {
            msg.mediaData = { ...(msg.mediaData ?? {}), stickerUrl: result.url };
        } else if ("drop" in result) {
            msg.mediaData = { ...(msg.mediaData ?? {}), stickerUrl: undefined };
        }
        return;
    }

    if (!isVisionPromptImageMessage(msg) || !msg.mediaUrl) return;
    const result = await resolveVisionImageRefForApi(msg.mediaUrl);
    if ("url" in result) {
        msg.mediaUrl = result.url;
    } else if ("drop" in result) {
        msg.mediaUrl = undefined;
    }
}

function isVisionPromptImageMessage(msg: ChatMessage): boolean {
    return msg.mediaType === "image"
        || (msg.role === "user" && msg.mediaType === "sticker" && Boolean(msg.mediaData?.stickerUrl))
        || (msg.mediaType === "media_file" && msg.mediaData?.fileType === "image");
}

function hasVisionPromptImageData(msg: ChatMessage): boolean {
    return msg.mediaType === "sticker"
        ? Boolean(msg.mediaData?.stickerUrl)
        : Boolean(msg.mediaUrl);
}

function stripVisionPromptImageData(msg: ChatMessage): ChatMessage {
    if (msg.mediaType === "sticker") {
        return {
            ...msg,
            mediaData: {
                ...(msg.mediaData ?? {}),
                stickerUrl: undefined,
            },
        };
    }
    return { ...msg, mediaUrl: undefined };
}

export function applyVisionImagePromptLimit(history: ChatMessage[], limitValue: unknown): ChatMessage[] {
    const limit = normalizeVisionImagePromptLimit(limitValue);
    let remaining = limit;

    for (let index = history.length - 1; index >= 0; index -= 1) {
        const msg = history[index];
        if (!isVisionPromptImageMessage(msg) || !hasVisionPromptImageData(msg)) continue;
        if (remaining > 0) {
            remaining -= 1;
            continue;
        }
        history[index] = stripVisionPromptImageData(msg);
    }

    return history;
}

// API 调用日志存储已抽到 ./api-log-store（聊天引擎与 simpleLLMCall 通用），
// 本文件通过上方 re-export 保持 getApiLogs/clearApiLogs/DebugInfo 的对外路径不变。

export type DebugPromptRequestOptions = {
    appId?: string;
    appTags?: string[];
    debugSessionId?: string;
};

type ChatPromptBuildOptions = {
    followUpCount?: number;
    followUpDelay?: number;
    timedWakeElapsedMinutes?: number;
    timedWakeIntent?: string;
    periodCareContext?: string;
    appId?: string;
    appTags?: string[];
    attachedImages?: string[];
    excludeOfflineSessionId?: string;
    promptProfile?: CustomAppPromptProfile;
    extraWorldBookIds?: string[];
    worldBookActivationContext?: string;
    activateAllWorldBooks?: boolean;
    toolsAllowed?: boolean;
    forceEnableTools?: boolean;
    offlineInviteDeclined?: boolean;
    returnedFromOffline?: boolean;
    offlineInitiativePrompt?: string;
};

function matchesPromptProfileRef(prompt: { identifier: string; name?: string }, refs: Set<string>): boolean {
    return refs.has(prompt.identifier) || Boolean(prompt.name && refs.has(prompt.name));
}

export function applyCustomPromptProfileToPreset(preset: PresetConfig, profile: CustomAppPromptProfile): PresetConfig {
    const include = new Set((profile.include ?? []).map(item => item.trim()).filter(Boolean));
    const exclude = new Set((profile.exclude ?? []).map(item => item.trim()).filter(Boolean));
    const includeEnabled = include.size > 0;
    const allowedPrompts = preset.prompts.filter(prompt => {
        if (prompt.forbid_overrides) return true;
        if (exclude.size > 0 && matchesPromptProfileRef(prompt, exclude)) return false;
        if (includeEnabled && !matchesPromptProfileRef(prompt, include)) return false;
        return true;
    });
    const allowedIdentifiers = new Set(allowedPrompts.map(prompt => prompt.identifier));
    const promptOrder = preset.prompt_order
        ?.filter(entry => {
            if (exclude.has(entry.identifier)) return false;
            if (includeEnabled) return include.has(entry.identifier) || allowedIdentifiers.has(entry.identifier);
            return allowedIdentifiers.has(entry.identifier) || !preset.prompts.some(prompt => prompt.identifier === entry.identifier);
        })
        .map(entry => ({ ...entry }));
    return {
        ...preset,
        prompts: allowedPrompts.map(prompt => ({ ...prompt })),
        prompt_order: promptOrder,
    };
}

function mergeAppTags(base: string[] | undefined, extra: string[] | undefined, fallbackAppId: string): string[] | undefined {
    const baseTags = (base ?? []).map(tag => tag.trim()).filter(Boolean);
    const extraTags = (extra ?? []).map(tag => tag.trim()).filter(Boolean);
    const hasExplicitBase = Array.isArray(base);
    const isCustomApp = fallbackAppId.startsWith("custom_app:");
    if (baseTags.length === 0 && extraTags.length === 0) {
        if (hasExplicitBase && isCustomApp) return [];
        return undefined;
    }
    const tags = new Set<string>(baseTags.length > 0 ? baseTags : (isCustomApp ? [] : [fallbackAppId]));
    for (const tag of extraTags) {
        const trimmed = tag.trim();
        if (trimmed) tags.add(trimmed);
    }
    return Array.from(tags);
}

/** 从输出正文中剥离思维链标签块（仅标签解析开启时用于清洗展示文本）。 */
export function stripOnlineThinkingTag(rawOutput: string, tag: string): string {
    if (!tag.trim()) return rawOutput;
    return rawOutput
        .replace(new RegExp(`<${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}>[\\s\\S]*?</${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}>`, "gi"), "")
        .trim();
}

/** 剔除预设配置的文本片段（如 <思考结束> 残留标签）。字面量删除，不走正则，避免编译/回溯开销。 */
export function stripPresetTexts(text: string, preset: PresetConfig | null | undefined): string {
    const list = preset?.strip_texts;
    if (!list || list.length === 0 || !text) return text;
    let result = text;
    for (const s of list) {
        if (s) result = result.split(s).join("");
    }
    return result;
}

function getPromptFilterTags(prompt: Prompt): string[] | null {
    if (prompt.tags && prompt.tags.length > 0) return prompt.tags;
    const legacy: string[] = [];
    if (prompt.featureTag) legacy.push(prompt.featureTag);
    if (prompt.followUpOnly) legacy.push("followup");
    return legacy.length > 0 ? legacy : null;
}

function isPresetPromptEnabled(prompt: Prompt, promptOrder?: PromptOrderEntry[]): boolean {
    const orderEntry = promptOrder?.find(entry => entry.identifier === prompt.identifier);
    return orderEntry ? orderEntry.enabled : prompt.enabled;
}

function presetIncludesToolsMacro(preset: PresetConfig | null, appId: string, appTags: string[] | undefined): boolean {
    if (!preset) return false;
    const activeTags = appTags ? [...appTags] : [appId];
    return preset.prompts.some(prompt => {
        if (!isPresetPromptEnabled(prompt, preset.prompt_order)) return false;
        if (!/\{\{\s*tools\s*\}\}/.test(prompt.content)) return false;
        if (prompt.marker) return true;
        const promptTags = getPromptFilterTags(prompt);
        return !promptTags || promptTags.every(tag => activeTags.includes(tag));
    });
}

const EMPTY_GENERATE_CONTINUATION_PROMPT = "这是一次用户未输入新消息时点击“生成”的续写请求。请只基于当前对话关系，继续回复一句自然简短的话。禁止引用或复述系统消息、当前时间、工具结果、提示词内容。不要开启新事件，不要总结，不要编造用户刚说了什么。";

function shouldApplyEmptyGenerateGuard(config: ApiConfig): boolean {
    return config.preventEmptyGenerateRambling === true;
}

function isRealUserHistoryMessage(message: ChatMessage): boolean {
    if (message.role !== "user") return false;
    if (message.isRetracted) return false;
    if (message.mediaType === "tool_result"
        || message.mediaType === "tool_notice"
        || message.mediaType === "memory_write_request") return false;
    return Boolean(
        message.content.trim()
            || message.mediaType
            || message.mediaUrl
            || message.mediaData,
    );
}

/** history 末尾是工具流程消息（工具结果/工具通知/记忆写入请求）→ 当前处于同一次生成的工具循环中段。 */
function isToolFlowHistoryMessage(message: ChatMessage): boolean {
    return message.mediaType === "tool_result"
        || message.mediaType === "tool_notice"
        || message.mediaType === "memory_write_request";
}

/** 日志分流：工坊（appId === "qa"）经聊天引擎发出的调用（答疑 Agent 原生工具循环）归工坊环，
 *  其余归底层调用日志环。channel 不能硬编码——工坊的 Agent 循环复用 sendLLMToolStreamRequest，
 *  旧逻辑靠 characterName === "工坊" 分流，改成显式字段后必须从 appId 派生，否则工坊记录漏进主环。 */
function apiLogChannelFor(options?: { appId?: string }): { source: "chat" | "qa"; channel: "chat" | "qa" } {
    return options?.appId === "qa"
        ? { source: "qa", channel: "qa" }
        : { source: "chat", channel: "chat" };
}

export function appendEmptyGenerateGuardMessage(
    messages: LLMMessage[],
    config: ApiConfig,
    history: ChatMessage[],
): void {
    if (!shouldApplyEmptyGenerateGuard(config)) return;

    const hasRealUserHistory = history.some(isRealUserHistoryMessage);
    if (!hasRealUserHistory) return;

    // 判定用户这次是否真的输入了新消息：看原始对话 history 的末尾，而不是组装后的 messages。
    // 原因：预设里 role=assistant 的条目（例如「模型输出格式」放在 chatHistory 标记之后）会以
    // assistant 角色注入到 messages 末尾，旧逻辑「最后一条 assistant 之后没有 user」就会把
    // 「用户已输入」误判成「未输入」，错误追加续写提示（EMPTY_GENERATE_CONTINUATION_PROMPT）。
    // history 末尾是真实用户消息（含图片/红包等媒体输入）→ 本次是正常回复，不追加续写提示；
    // 末尾是 assistant / system（如 follow-up 静默提示）→ 用户未输入新消息，照常追加；
    // 末尾是工具流程消息（tool_result / tool_notice / memory_write_request）→ 本次请求是
    // 同一次生成在工具循环中的延续，续写提示反而会干扰模型基于工具结果作答（提示词里
    // 明确禁止引用工具结果），同样不追加。
    const lastHistoryMessage = history[history.length - 1];
    if (lastHistoryMessage && (isRealUserHistoryMessage(lastHistoryMessage) || isToolFlowHistoryMessage(lastHistoryMessage))) {
        return;
    }

    messages.push({ role: "user", content: EMPTY_GENERATE_CONTINUATION_PROMPT });
}

export function publishDebugPromptSnapshot(params: {
    request: ReturnType<typeof buildProviderRequest>;
    config: ApiConfig;
    preset: PresetConfig | null;
    meta?: { characterName?: string; userName?: string };
    options?: DebugPromptRequestOptions;
    requestKind: "completion" | "native-tools" | "native-tools-stream";
    tools?: LlmToolDefinition[];
}): DebugPromptSnapshot {
    const { request, config, preset, meta, options, requestKind, tools } = params;
    const snapshot: DebugPromptSnapshot = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        requestKind,
        provider: config.provider,
        providerKind: request.providerKind,
        model: config.defaultModel,
        appId: options?.appId ?? "chat",
        appTags: options?.appTags,
        sessionId: options?.debugSessionId,
        characterName: meta?.characterName,
        presetName: preset?.name || "默认预设",
        messages: debugMessagesFromRequest(request),
        tools: tools?.map(tool => ({ name: tool.name, description: tool.description })),
    };
    if (typeof window !== "undefined") setDebugPromptSnapshot(snapshot);
    return snapshot;
}

// Re-export for backward compatibility — canonical source is api-helpers.ts
export { determineBaseUrl } from "./api-helpers";

type PreparedApiMessage = {
    role: string;
    content: string | LLMContentPart[];
    marker?: string;
};

/**
 * 聊天插件 llm.request 织入：让插件在请求发出前改写 messages / 采样参数。
 * 四个 sendLLM*Request 入口统一走这里；无插件时零开销直通。
 */
async function applyChatPluginLlmRequest<T extends { role: string }>(
    preset: PresetConfig | null,
    messages: T[],
    purpose: string,
    sessionId?: string,
): Promise<{ messages: T[]; preset: PresetConfig | null }> {
    if (typeof window === "undefined") return { messages, preset };
    const payload = await runChatPluginTransform("llm.request", {
        messages: messages as unknown as LlmRequestPayload["messages"],
        purpose,
        sessionId,
    });
    let nextPreset = preset;
    if (preset && (payload.temperature !== undefined || payload.maxTokens !== undefined)) {
        nextPreset = { ...preset };
        if (payload.temperature !== undefined) nextPreset.temperature = payload.temperature;
        if (payload.maxTokens !== undefined) nextPreset.openai_max_tokens = payload.maxTokens;
    }
    const nextMessages = Array.isArray(payload.messages)
        ? payload.messages as unknown as T[]
        : messages;
    return { messages: nextMessages, preset: nextPreset };
}

/** 聊天插件 llm.response 织入：模型原始回复在内置正则处理前交给插件改写 */
async function applyChatPluginLlmResponse(text: string, purpose: string, sessionId?: string): Promise<string> {
    if (typeof window === "undefined") return text;
    const payload = await runChatPluginTransform("llm.response", { text, sessionId, purpose });
    return typeof payload.text === "string" ? payload.text : text;
}

export function prepareMessagesForApi(
    provider: string,
    messages: LLMMessage[],
): {
    apiMessages: PreparedApiMessage[];
    extractedSystemPrompt?: string;
} {
    void provider;
    const apiMessages: PreparedApiMessage[] = [];
    for (const message of toLlmRequestMessages(messages)) {
        if (message.role === "tool") {
            apiMessages.push({
                role: "tool",
                content: `[tool_result name="${message.name}" tool_call_id="${message.toolCallId}"]\n${message.content}`,
                marker: message.marker,
            });
            continue;
        }
        if (message.role === "assistant" && message.toolCalls?.length) {
            const toolCallText = message.toolCalls
                .map(call => `[tool_call id="${call.id}" name="${call.name}"] ${JSON.stringify(call.args)}`)
                .join("\n");
            apiMessages.push({
                role: "assistant",
                content: [message.content, toolCallText].filter(Boolean).join("\n"),
                marker: message.marker,
            });
            continue;
        }
        apiMessages.push({
            role: message.role,
            content: message.content,
            marker: message.marker,
        });
    }
    return { apiMessages };
}

export function previewMessagesForApi(
    config: ApiConfig,
    preset: PresetConfig | null,
    messages: LLMMessage[],
): LLMMessage[] {
    return buildProviderDebugMessages(config, preset, messages).map(message => ({
        role: message.role as LLMMessage["role"],
        content: message.content,
        _debugMeta: { marker: message.marker },
    }));
}

export type ChatCompletionStreamResult = {
    content: string;
    rawResponse: string;
    providerKind: LlmProviderKind;
};

export type ChatCompletionStreamCallbacks = {
    onDelta?: (text: string) => void | Promise<void>;
    onReasoningDelta?: (text: string) => void | Promise<void>;
    onToolCallStart?: (info: { id: string; name: string; index: number }) => void | Promise<void>;
};

function attachExternalAbort(internal: AbortController, external?: AbortSignal): () => void {
    if (!external) return () => {};
    if (external.aborted) {
        internal.abort();
        return () => {};
    }
    const handler = () => internal.abort();
    external.addEventListener("abort", handler);
    return () => external.removeEventListener("abort", handler);
}

function parseSseEvents(buffer: string): { events: string[]; rest: string } {
    const normalized = buffer.replace(/\r\n/g, "\n");
    const parts = normalized.split("\n\n");
    return {
        events: parts.slice(0, -1),
        rest: parts[parts.length - 1] || "",
    };
}

function createStreamingTimestampStripper() {
    const tailLength = 64;
    let pending = "";
    return {
        push(text: string): string {
            pending += text;
            if (pending.length <= tailLength) return "";
            let emitEnd = pending.length - tailLength;
            const nearbyParen = pending.lastIndexOf("(", emitEnd);
            if (nearbyParen >= Math.max(0, emitEnd - tailLength)) {
                emitEnd = nearbyParen;
            }
            if (emitEnd <= 0) return "";
            const emit = pending.slice(0, emitEnd);
            pending = pending.slice(emitEnd);
            return stripHallucinatedTimestamps(emit);
        },
        flush(): string {
            const emit = stripHallucinatedTimestamps(pending);
            pending = "";
            return emit;
        },
    };
}

function emptyResponseDetails(data: unknown): {
    finishReason?: string;
    blockReason?: string;
    safetyRatings?: unknown;
    message: string;
} {
    const d = data && typeof data === "object" ? data as Record<string, unknown> : {};
    const finishReason = extractFinishReason(d);
    const candidates = Array.isArray(d.candidates) ? d.candidates : [];
    const firstCandidate = candidates[0] && typeof candidates[0] === "object" ? candidates[0] as Record<string, unknown> : {};
    const promptFeedback = d.promptFeedback && typeof d.promptFeedback === "object" ? d.promptFeedback as Record<string, unknown> : {};
    const blockReason = typeof promptFeedback.blockReason === "string" ? promptFeedback.blockReason : undefined;
    const safetyRatings = firstCandidate.safetyRatings;
    const message = `LLM returned empty content${finishReason ? ` (finishReason: ${finishReason})` : ""}${blockReason ? ` (blockReason: ${blockReason})` : ""}.`;
    return { finishReason, blockReason, safetyRatings, message };
}

async function readSseStream(
    response: Response,
    providerKind: ChatCompletionStreamResult["providerKind"],
    callbacks?: ChatCompletionStreamCallbacks,
    stripTimestamps = true,
): Promise<{ content: string; rawResponse: string }> {
    if (!response.body) throw new ChatEngineError("流式响应没有 body。");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let content = "";
    let rawResponse = "";
    // 时间戳剥离器会一直扣住流尾巴的 64 个字符等括号闭合，流结束才吐出来。
    // 要求"所见即模型所写"的调用方（独家特调）把它整个关掉：增量来一个字出一个字，
    // 否则模型在末尾写机括标记行（〔记〕这类）时，整行都压在扣留窗里，看起来像卡死。
    const contentStripper = stripTimestamps
        ? createStreamingTimestampStripper()
        : { push: (text: string) => text, flush: () => "" };

    // 容错解析：中转把长 JSON 行切开时做碎片重组，不再静默丢增量（见 sse-json.ts）
    const sseParser = createSseJsonParser();
    const handleParsed = async (parsed: unknown) => {
        const parts = parseProviderStreamDelta(providerKind, parsed);
        if (parts.reasoning) {
            await callbacks?.onReasoningDelta?.(parts.reasoning);
        }
        if (parts.content) {
            const cleanDelta = contentStripper.push(parts.content);
            if (cleanDelta) {
                content += cleanDelta;
                await callbacks?.onDelta?.(cleanDelta);
            }
        }
    };
    const handleEvent = async (eventText: string) => {
        // 原始流只为调试快照保留头部：长输出整条累积会把低内存设备的 WebView 顶爆
        if (rawResponse.length < 65_536) rawResponse += `${eventText}\n`;
        for (const parsed of sseParser.pushEvent(eventText)) {
            await handleParsed(parsed);
        }
    };

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseEvents(buffer);
        buffer = parsed.rest;
        for (const eventText of parsed.events) {
            await handleEvent(eventText);
        }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
        await handleEvent(buffer);
    }
    for (const parsed of sseParser.flush()) {
        await handleParsed(parsed);
    }
    const finalContent = contentStripper.flush();
    if (finalContent) {
        content += finalContent;
        await callbacks?.onDelta?.(finalContent);
    }
    return { content, rawResponse };
}

export async function sendLLMStreamRequest(
    config: ApiConfig,
    preset: PresetConfig | null,
    messages: LLMMessage[],
    regexes: RegexConfig[],
    meta?: { characterName?: string; userName?: string },
    options?: {
        skipOutputRegex?: boolean;
        /** 不剥幻觉时间戳：流式增量原样直出（不扣尾巴），落库文本与流出的一字不差 */
        skipTimestampStrip?: boolean;
        includeReasoning?: boolean;
        appId?: string;
        appTags?: string[];
        followUpCount?: number;
        debugSessionId?: string;
        signal?: AbortSignal;
    },
    callbacks?: ChatCompletionStreamCallbacks,
): Promise<ChatCompletionStreamResult> {
    const pluginPurpose = options?.appId ?? "chat";
    const afterPlugins = await applyChatPluginLlmRequest(preset, messages, pluginPurpose, options?.debugSessionId);
    const effectivePreset = afterPlugins.preset;
    const originalOnDelta = callbacks?.onDelta;
    const pluginCallbacks: ChatCompletionStreamCallbacks | undefined = callbacks ? {
        ...callbacks,
        onDelta: (text: string) => {
            emitChatPluginEvent("llm.streamChunk", { chunk: text, sessionId: options?.debugSessionId, purpose: pluginPurpose });
            return originalOnDelta?.(text);
        },
    } : undefined;
    const requestMessages = toLlmRequestMessages(afterPlugins.messages);
    const request = buildProviderRequest(config, effectivePreset, requestMessages, { stream: true });
    publishDebugPromptSnapshot({ request, config, preset: effectivePreset, meta, options, requestKind: "completion" });
    const llmAbort = new AbortController();
    const llmTimeout = setTimeout(() => llmAbort.abort(), 500_000);
    const detachExternalAbort = attachExternalAbort(llmAbort, options?.signal);

    try {
        const response = await fetchLlmPayload(request, { signal: llmAbort.signal });
        if (!response.ok) {
            const errorText = await response.text();
            throw new ChatEngineError(`API Stream Error ${response.status}: ${errorText}`);
        }
        // 流式路径收集思维链原文：readSseStream 只通过 onReasoningDelta 回调透传，
        // 不额外包一层的话日志里就只有清洗后的回复正文，思维链被吞。
        // 注意：必须无条件创建回调对象（不能 callbacks 为空就不传），否则思维链收集不到。
        let streamedReasoning = "";
        const streamLogCallbacks: ChatCompletionStreamCallbacks = {
            ...(pluginCallbacks ?? callbacks),
            onReasoningDelta: async (text: string) => {
                streamedReasoning += text;
                await (pluginCallbacks ?? callbacks)?.onReasoningDelta?.(text);
            },
        };
        const { content: streamedContent, rawResponse } = await readSseStream(response, request.providerKind, streamLogCallbacks, !options?.skipTimestampStrip);
        if (!streamedContent.trim()) {
            throw new ChatEngineError("流式响应没有解析到文本增量。");
        }
        let rawOutput = options?.skipTimestampStrip ? streamedContent.trim() : stripHallucinatedTimestamps(streamedContent.trim());
        rawOutput = await applyChatPluginLlmResponse(rawOutput, pluginPurpose, options?.debugSessionId);

        // Store API log entry — mirror sendLLMRequest so streaming calls also show up
        // in the "底层调用大模型日志" panel. reasoning 单独存思维链原文，供「查看原始」直接展示。
        const sanitizedMessages = request.messagesForLog.map(m => ({
            ...m,
            content: typeof m.content === "string" ? m.content : "[vision: 含图片的多模态消息]",
        }));
        pushApiLog({
            characterName: meta?.characterName,
            ...apiLogChannelFor(options),
            model: config.defaultModel,
            messages: sanitizedMessages,
            rawResponse: rawOutput,
            reasoning: streamedReasoning.trim() || undefined,
        });

        if (!options?.skipOutputRegex) {
            const macroEngine = new MacroEngine(meta?.characterName ?? "", meta?.userName ?? "用户");
            const activeTags = getActiveAppTags(options?.appId ?? "chat", {
                appTags: options?.appTags,
                followUpCount: options?.followUpCount,
            });
            rawOutput = applyOutputRegex(rawOutput, regexes, { macroEngine, activeTags });
        }
        return { content: rawOutput, rawResponse, providerKind: request.providerKind };
    } catch (error: unknown) {
        if (error instanceof DOMException && (error as DOMException).name === "AbortError") {
            if (options?.signal?.aborted) throw error;
            throw new ChatEngineError("AI 流式回复超时（500秒），请重试。");
        }
        if (error instanceof ChatEngineError) throw error;
        const detail = error instanceof Error ? error.message : String(error);
        throw new ChatEngineError(`Stream Network Error connecting to AI Provider: ${detail}`);
    } finally {
        clearTimeout(llmTimeout);
        detachExternalAbort();
    }
}

/**
 * Shared LLM HTTP request: provider normalization → consecutive same-role merge → API call → log → output regex.
 * Used by both generateChatCompletion (1:1 chat) and generateGroupChatCompletion (group chat).
 */
export async function sendLLMRequest(
    config: ApiConfig,
    preset: PresetConfig | null,
    messages: LLMMessage[],
    regexes: RegexConfig[],
    meta?: { characterName?: string; userName?: string },
    options?: {
        skipOutputRegex?: boolean;
        includeReasoning?: boolean;
        /** 供调用方捕获模型思维链（reasoning）内容，不影响返回文本 */
        onReasoning?: (text: string) => void;
        appId?: string;
        appTags?: string[];
        followUpCount?: number;
        debugSessionId?: string;
        signal?: AbortSignal;
    },
): Promise<string> {
    const pluginPurpose = options?.appId ?? "chat";
    const afterPlugins = await applyChatPluginLlmRequest(preset, messages, pluginPurpose, options?.debugSessionId);
    const effectivePreset = afterPlugins.preset;
    const requestMessages = toLlmRequestMessages(afterPlugins.messages);
    const request = buildProviderRequest(config, effectivePreset, requestMessages);
    publishDebugPromptSnapshot({ request, config, preset: effectivePreset, meta, options, requestKind: "completion" });
    const requestBodyJson = JSON.stringify(request.body);
    const requestBodySize = requestBodyJson.length;
    const requestTokenEstimate = Math.ceil(requestBodySize / 3);
    const messageSizes = request.messagesForLog.map((message) => (
        typeof message.content === "string" ? message.content.length : JSON.stringify(message.content).length
    ));
    const largestMessage = messageSizes.reduce(
        (largest, size, index) => (size > largest.size ? { index, size, role: request.messagesForLog[index]?.role ?? "" } : largest),
        { index: -1, size: 0, role: "" },
    );
    const requestDebugInfo = {
        provider: config.provider,
        model: config.defaultModel,
        appId: options?.appId ?? "chat",
        messageCount: request.messagesForLog.length,
        bodySize: requestBodySize,
        bodyTokenEstimate: requestTokenEstimate,
        largestMessageIndex: largestMessage.index,
        largestMessageRole: largestMessage.role,
        largestMessageSize: largestMessage.size,
    };

    console.log("[ChatEngine] Message roles:", request.messagesForLog.map((m, i) => `${i}:${m.role}`).join(" → "));
    console.log("[ChatEngine] Request:", requestDebugInfo);

    const llmAbort = new AbortController();
    const llmTimeout = setTimeout(() => llmAbort.abort(), 500_000);
    const detachExternalAbort = attachExternalAbort(llmAbort, options?.signal);

    try {
        const response = await fetchLlmPayload(request, { signal: llmAbort.signal });

        if (!response.ok) {
            const errorText = await response.text();
            throw new ChatEngineError(`API Error ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        const parsed = parseProviderResponse(request.providerKind, data);
        let rawOutput = parsed.content || "";

        if (parsed.reasoning) {
            try { options?.onReasoning?.(parsed.reasoning); } catch { /* 捕获回调异常，不影响主流程 */ }
        }

        // Prepend reasoning content as <think> block (only when caller requests it, e.g. story mode)
        if (options?.includeReasoning) {
            const reasoning = parsed.reasoning || "";
            if (reasoning) {
                rawOutput = `<think>\n${reasoning}\n</think>\n\n${rawOutput}`;
            }
        }

        rawOutput = await applyChatPluginLlmResponse(rawOutput, pluginPurpose, options?.debugSessionId);

        if (!rawOutput && parsed.toolCalls.length === 0) {
            const emptyDetails = emptyResponseDetails(parsed.raw);
            console.warn("[ChatEngine] Empty response from API!", {
                provider: config.provider,
                model: config.defaultModel,
                finishReason: emptyDetails.finishReason,
                blockReason: emptyDetails.blockReason,
                safetyRatings: emptyDetails.safetyRatings,
                fullData: JSON.stringify(data).slice(0, 1000),
            });
            throw new ChatEngineError(emptyDetails.message);
        }

        // Store API log entry (strip base64 image data to avoid bloating localStorage)
        const sanitizedMessages = request.messagesForLog.map(m => ({
            ...m,
            content: typeof m.content === "string" ? m.content : "[vision: 含图片的多模态消息]",
        }));
        pushApiLog({
            characterName: meta?.characterName,
            ...apiLogChannelFor(options),
            model: config.defaultModel,
            messages: sanitizedMessages,
            rawResponse: rawOutput,
            usage: parsed.usage,
            // 思维链只经 onReasoning 回调透传，之前没进日志；这里单独存一份原文
            reasoning: parsed.reasoning || undefined,
        });

        if (options?.skipOutputRegex) {
            return rawOutput;
        }
        // Apply Output Regex Filters
        const macroEngine = new MacroEngine(meta?.characterName ?? "", meta?.userName ?? "用户");
        const activeTags = getActiveAppTags(options?.appId ?? "chat", {
            appTags: options?.appTags,
            followUpCount: options?.followUpCount,
        });
        return applyOutputRegex(rawOutput, regexes, { macroEngine, activeTags });
    } catch (error: unknown) {
        if (error instanceof DOMException && (error as DOMException).name === "AbortError") {
            throw new ChatEngineError("AI 回复超时（500秒），请重试。");
        }
        if (error instanceof ChatEngineError) throw error;
        const detail = error instanceof Error ? error.message : String(error);
        throw new ChatEngineError(
            `Network Error connecting to AI Provider: ${detail}\n请求诊断：provider=${requestDebugInfo.provider}, model=${requestDebugInfo.model}, app=${requestDebugInfo.appId}, messages=${requestDebugInfo.messageCount}, bodySize=${requestDebugInfo.bodySize}, estimatedTokens=${requestDebugInfo.bodyTokenEstimate}, largestMessage=${requestDebugInfo.largestMessageSize}, largestRole=${requestDebugInfo.largestMessageRole}, largestIndex=${requestDebugInfo.largestMessageIndex}`,
        );
    } finally {
        clearTimeout(llmTimeout);
        detachExternalAbort();
    }
}

export type LLMToolRequestResult = {
    content: string;
    reasoning?: string;
    openRouterReasoningDetails?: unknown[];
    toolCalls: LlmToolCall[];
    /** 参数 JSON 被截断（输出上限/连接中断）而丢弃的调用名——调用方据此提示重试/分段 */
    truncatedToolCalls?: string[];
    rawResponse: string;
    providerKind: LlmProviderKind;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
};

type StreamToolCallDraft = {
    id?: string;
    name?: string;
    argsText: string;
    args?: Record<string, unknown>;
    thoughtSignature?: string;
};

function mergeToolCallDelta(drafts: Map<number, StreamToolCallDraft>, delta: LlmToolCallDelta): void {
    const current = drafts.get(delta.index) || { argsText: "" };
    drafts.set(delta.index, {
        id: delta.id ?? current.id,
        name: delta.name ?? current.name,
        argsText: current.argsText + (delta.argsText ?? ""),
        args: delta.args ?? (delta.argsText ? undefined : current.args),
        thoughtSignature: delta.thoughtSignature ?? current.thoughtSignature,
    });
}

function finalizeStreamToolCalls(drafts: Map<number, StreamToolCallDraft>): { calls: LlmToolCall[]; truncatedNames: string[] } {
    const calls: LlmToolCall[] = [];
    const truncatedNames: string[] = [];
    for (const [index, draft] of [...drafts.entries()].sort(([a], [b]) => a - b)) {
        if (!draft.name) continue;
        let args: unknown = draft.args;
        if (args == null) {
            try {
                args = JSON.parse(draft.argsText || "{}") as unknown;
            } catch {
                // 参数 JSON 残缺：模型被输出上限/连接中断掐断在调用中途。
                // 不再抛错杀掉整轮（症状：Unterminated string）——丢弃该调用并记录，交调用方提示重试/分段
                truncatedNames.push(draft.name);
                continue;
            }
        }
        if (!args || typeof args !== "object" || Array.isArray(args)) {
            truncatedNames.push(draft.name);
            continue;
        }
        const call: LlmToolCall = {
            id: draft.id || `tool_${Date.now()}_${index}`,
            name: draft.name,
            args: args as Record<string, unknown>,
        };
        if (draft.thoughtSignature) call.thoughtSignature = draft.thoughtSignature;
        calls.push(call);
    }
    return { calls, truncatedNames };
}

export async function sendLLMToolStreamRequest(
    config: ApiConfig,
    preset: PresetConfig | null,
    messages: LlmRequestMessage[],
    tools: LlmToolDefinition[],
    regexes: RegexConfig[],
    meta?: { characterName?: string; userName?: string },
    options?: {
        appId?: string;
        appTags?: string[];
        followUpCount?: number;
        debugSessionId?: string;
        signal?: AbortSignal;
        /** 单次最大输出 token：按调用覆盖预设值（工坊输出护栏用） */
        maxTokens?: number;
    },
    callbacks?: ChatCompletionStreamCallbacks,
): Promise<LLMToolRequestResult> {
    void regexes;
    const pluginPurpose = options?.appId ?? "chat";
    const afterPlugins = await applyChatPluginLlmRequest(preset, messages, pluginPurpose, options?.debugSessionId);
    const effectivePreset = afterPlugins.preset;
    const request = buildProviderRequest(config, effectivePreset, afterPlugins.messages, { tools, stream: true, maxTokens: options?.maxTokens });
    publishDebugPromptSnapshot({ request, config, preset: effectivePreset, meta, options, requestKind: "native-tools-stream", tools });
    const llmAbort = new AbortController();
    const llmTimeout = setTimeout(() => llmAbort.abort(), 500_000);
    const detachExternalAbort = attachExternalAbort(llmAbort, options?.signal);
    let rawResponse = "";
    let content = "";
    let reasoning = "";
    const contentStripper = createStreamingTimestampStripper();
    const toolDrafts = new Map<number, StreamToolCallDraft>();
    const firedToolCallStarts = new Set<number>();

    try {
        const response = await fetchLlmPayload(request, { signal: llmAbort.signal });

        if (!response.ok) {
            const errorText = await response.text();
            throw new ChatEngineError(`API Tool Stream Error ${response.status}: ${errorText}`);
        }
        if (!response.body) throw new ChatEngineError("原生动作流式响应没有 body。");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        // 容错解析：中转把超长工具参数 JSON 行切开时做碎片重组，
        // 不再因单行 JSON Parse error 杀掉整条流（写 APP 大参数时高发）
        const sseParser = createSseJsonParser();
        const handleParsedDelta = async (data: unknown) => {
            {
                    const delta = parseProviderStreamDelta(request.providerKind, data);
                    if (delta.reasoning) {
                        reasoning += delta.reasoning;
                        await callbacks?.onReasoningDelta?.(delta.reasoning);
                    }
                    if (delta.content) {
                        const cleanDelta = contentStripper.push(delta.content);
                        if (cleanDelta) {
                            content += cleanDelta;
                            emitChatPluginEvent("llm.streamChunk", { chunk: cleanDelta, sessionId: options?.debugSessionId, purpose: pluginPurpose });
                            await callbacks?.onDelta?.(cleanDelta);
                        }
                    }
                    for (const toolDelta of delta.toolCallDeltas || []) {
                        mergeToolCallDelta(toolDrafts, toolDelta);
                        if (!firedToolCallStarts.has(toolDelta.index)) {
                            const draft = toolDrafts.get(toolDelta.index);
                            if (draft?.name) {
                                firedToolCallStarts.add(toolDelta.index);
                                if (!draft.id) {
                                    draft.id = `tool_${Date.now()}_${toolDelta.index}`;
                                    toolDrafts.set(toolDelta.index, draft);
                                }
                                await callbacks?.onToolCallStart?.({
                                    id: draft.id,
                                    name: draft.name,
                                    index: toolDelta.index,
                                });
                            }
                        }
                    }
            }
        };
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const parsed = parseSseEvents(buffer);
            buffer = parsed.rest;
            for (const event of parsed.events) {
                if (rawResponse.length < 65_536) rawResponse += `${event}\n`;
                for (const data of sseParser.pushEvent(event)) {
                    await handleParsedDelta(data);
                }
            }
        }

        if (buffer.trim()) {
            if (rawResponse.length < 65_536) rawResponse += buffer.trim();
            for (const data of sseParser.pushEvent(buffer)) {
                await handleParsedDelta(data);
            }
        }
        for (const data of sseParser.flush()) {
            await handleParsedDelta(data);
        }
        const finalContent = contentStripper.flush();
        if (finalContent) {
            content += finalContent;
            await callbacks?.onDelta?.(finalContent);
        }
        content = await applyChatPluginLlmResponse(content, pluginPurpose, options?.debugSessionId);

        const sanitizedMessages = request.messagesForLog.map(m => ({
            ...m,
            content: typeof m.content === "string" ? m.content : "[vision: 含图片的多模态消息]",
        }));
        const { calls: toolCalls, truncatedNames } = finalizeStreamToolCalls(toolDrafts);
        const logEntryRaw = JSON.stringify({ content, reasoning, toolCalls, raw: rawResponse });
        pushApiLog({
            characterName: meta?.characterName,
            ...apiLogChannelFor(options),
            model: config.defaultModel,
            messages: sanitizedMessages,
            rawResponse: logEntryRaw,
            reasoning: reasoning || undefined,
        });

        if (!content && toolCalls.length === 0 && truncatedNames.length === 0) {
            throw new ChatEngineError("原生动作流式响应没有解析到文本或动作。");
        }

        return {
            content,
            reasoning,
            openRouterReasoningDetails: undefined,
            toolCalls,
            truncatedToolCalls: truncatedNames.length ? truncatedNames : undefined,
            rawResponse: logEntryRaw,
            providerKind: request.providerKind,
        };
    } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") {
            if (options?.signal?.aborted) throw error;
            throw new ChatEngineError("AI 原生动作流式回复超时（500秒），请重试。");
        }
        if (error instanceof ChatEngineError) throw error;
        const detail = error instanceof Error ? error.message : String(error);
        throw new ChatEngineError(`Tool Stream Network Error connecting to AI Provider: ${detail}`);
    } finally {
        clearTimeout(llmTimeout);
        detachExternalAbort();
    }
}

export async function sendLLMToolRequest(
    config: ApiConfig,
    preset: PresetConfig | null,
    messages: LlmRequestMessage[],
    tools: LlmToolDefinition[],
    regexes: RegexConfig[],
    meta?: { characterName?: string; userName?: string },
    options?: {
        skipOutputRegex?: boolean;
        includeReasoning?: boolean;
        appId?: string;
        appTags?: string[];
        followUpCount?: number;
        debugSessionId?: string;
        signal?: AbortSignal;
    },
): Promise<LLMToolRequestResult> {
    const pluginPurpose = options?.appId ?? "chat";
    const afterPlugins = await applyChatPluginLlmRequest(preset, messages, pluginPurpose, options?.debugSessionId);
    const effectivePreset = afterPlugins.preset;
    const request = buildProviderRequest(config, effectivePreset, afterPlugins.messages, { tools });
    publishDebugPromptSnapshot({ request, config, preset: effectivePreset, meta, options, requestKind: "native-tools", tools });
    const llmAbort = new AbortController();
    const llmTimeout = setTimeout(() => llmAbort.abort(), 500_000);
    const detachExternalAbort = attachExternalAbort(llmAbort, options?.signal);

    try {
        const response = await fetchLlmPayload(request, { signal: llmAbort.signal });

        if (!response.ok) {
            const errorText = await response.text();
            throw new ChatEngineError(`API Tool Error ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        const parsed = parseProviderResponse(request.providerKind, data);
        let rawOutput = parsed.content || "";
        if (options?.includeReasoning && parsed.reasoning) {
            rawOutput = `<think>\n${parsed.reasoning}\n</think>\n\n${rawOutput}`;
        }
        rawOutput = await applyChatPluginLlmResponse(rawOutput, pluginPurpose, options?.debugSessionId);

        if (!rawOutput && parsed.toolCalls.length === 0) {
            const emptyDetails = emptyResponseDetails(parsed.raw);
            console.warn("[ChatEngine] Empty native tool response from API!", {
                provider: config.provider,
                model: config.defaultModel,
                finishReason: emptyDetails.finishReason,
                blockReason: emptyDetails.blockReason,
                safetyRatings: emptyDetails.safetyRatings,
                fullData: JSON.stringify(data).slice(0, 1000),
            });
            throw new ChatEngineError(emptyDetails.message);
        }

        const sanitizedMessages = request.messagesForLog.map(m => ({
            ...m,
            content: typeof m.content === "string" ? m.content : "[vision: 含图片的多模态消息]",
        }));
        const rawResponse = JSON.stringify({
            content: parsed.content,
            reasoning: parsed.reasoning,
            openRouterReasoningDetails: parsed.openRouterReasoningDetails,
            toolCalls: parsed.toolCalls,
            raw: parsed.raw,
        });
        pushApiLog({
            characterName: meta?.characterName,
            ...apiLogChannelFor(options),
            model: config.defaultModel,
            messages: sanitizedMessages,
            rawResponse,
            usage: parsed.usage,
        });

        if (!options?.skipOutputRegex && rawOutput) {
            const macroEngine = new MacroEngine(meta?.characterName ?? "", meta?.userName ?? "用户");
            const activeTags = getActiveAppTags(options?.appId ?? "chat", {
                appTags: options?.appTags,
                followUpCount: options?.followUpCount,
            });
            rawOutput = applyOutputRegex(rawOutput, regexes, { macroEngine, activeTags });
        }

        return {
            content: rawOutput,
            reasoning: parsed.reasoning,
            openRouterReasoningDetails: parsed.openRouterReasoningDetails,
            toolCalls: parsed.toolCalls,
            rawResponse,
            providerKind: request.providerKind,
            usage: parsed.usage,
        };
    } catch (error: unknown) {
        if (error instanceof DOMException && error.name === "AbortError") {
            if (options?.signal?.aborted) throw error;
            throw new ChatEngineError("AI 原生动作回复超时（500秒），请重试。");
        }
        if (error instanceof ChatEngineError) throw error;
        const detail = error instanceof Error ? error.message : String(error);
        throw new ChatEngineError(`Tool Network Error connecting to AI Provider: ${detail}`);
    } finally {
        clearTimeout(llmTimeout);
        detachExternalAbort();
    }
}

// ── Persisted music sync data (localStorage, updated by user via sync button) ──
const MUSIC_SYNC_KEY = "ai_phone_music_sync_v1";
registerKvMigration(MUSIC_SYNC_KEY);

type MusicSyncData = {
    loggedIn: boolean;
    playlistSummary: string;
    localSummary: string;
    syncedAt: string; // ISO date
};

function loadMusicSyncData(): MusicSyncData | null {
    try {
        const raw = typeof window !== "undefined" ? kvGet(MUSIC_SYNC_KEY) : null;
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

function saveMusicSyncData(data: MusicSyncData): void {
    try { kvSet(MUSIC_SYNC_KEY, JSON.stringify(data)); } catch { }
}

export function clearMusicCloudSyncData(): void {
    const prev = loadMusicSyncData();
    saveMusicSyncData({
        loggedIn: false,
        playlistSummary: "",
        localSummary: prev?.localSummary ?? "",
        syncedAt: new Date().toISOString(),
    });
}

/** Read-only: check persisted login status (no network) */
export async function isNeteaseLoggedIn(): Promise<boolean> {
    if (!isNeteaseConfigured()) return false;
    return loadMusicSyncData()?.loggedIn ?? false;
}

/** Read-only: build local music list from persisted sync data (no network/IndexedDB) */
export async function buildMusicLocalMacro(): Promise<string> {
    return loadMusicSyncData()?.localSummary ?? "";
}

/** Read-only: build netease playlist summary from persisted sync data (no network) */
export async function buildMusicCloudMacro(): Promise<string> {
    return loadMusicSyncData()?.playlistSummary ?? "";
}

/**
 * Sync music data from all sources (local IndexedDB + Netease API).
 * Called by user via sync button. Persists results to localStorage.
 */
export async function syncMusicData(): Promise<MusicSyncData> {
    // 1. Check login status
    let loggedIn = false;
    if (isNeteaseConfigured()) {
        try {
            const cfg = loadMusicApiConfig();
            const status = await checkLoginStatus(cfg.baseUrl);
            loggedIn = status.loggedIn;
        } catch { }
    }

    // 2. Build playlist summary (only if logged in)
    let playlistSummary = "";
    if (loggedIn) {
        try {
            const playlists = await getUserPlaylists();
            const lines: string[] = [];
            const top = playlists.slice(0, 2);
            const trackResults = await Promise.all(top.map(pl => getPlaylistTracks(pl.id)));
            for (let i = 0; i < top.length; i++) {
                const songs = trackResults[i];
                if (songs.length > 0) {
                    lines.push(`歌单「${top[i].name}」：${songs.slice(0, 10).map(s => s.name).join("、")}`);
                }
            }
            playlistSummary = lines.join("\n");
        } catch { }
    }

    // 3. Build local music summary
    let localSummary = "";
    try {
        const tracks = await loadAllTracks();
        if (tracks.length > 0) {
            localSummary = tracks.slice(0, 30).map(t => t.title).join("、");
        }
    } catch { }

    const data: MusicSyncData = {
        loggedIn,
        playlistSummary,
        localSummary,
        syncedAt: new Date().toISOString(),
    };
    saveMusicSyncData(data);
    return data;
}

export type ChatCompletionPart = {
    text: string;
    toolNotice?: string;
};

export type ChatCompletionResult = {
    parts: ChatCompletionPart[];
};

/** Extract combined clean text from a ChatCompletionResult (for callers that need a plain string). */
export function flattenCompletionResult(result: ChatCompletionResult): string {
    return result.parts.map(p => stripTextToolDirectives(p.text)).filter(Boolean).join("\n\n");
}

// 单条消息工具循环轮数上限：设置项（聊天工具箱），默认 5
const MAX_NATIVE_EXPANDED_TOOL_PACKAGES = 2;

export function buildChatBilingualInstruction(
    enabled: boolean | undefined,
    mode: "single" | "group" = "single",
    customPrompt?: string,
): string {
    return resolveBilingualPrompt(
        enabled === true,
        customPrompt,
        mode === "group" ? DEFAULT_GROUP_CHAT_BILINGUAL_PROMPT : DEFAULT_CHAT_BILINGUAL_PROMPT,
    );
}

export function buildOfflineBilingualInstruction(
    enabled: boolean | undefined,
    mode: "single" | "group" = "single",
    customPrompt?: string,
): string {
    return resolveBilingualPrompt(
        enabled === true,
        customPrompt,
        mode === "group" ? DEFAULT_GROUP_OFFLINE_CHAT_BILINGUAL_PROMPT : DEFAULT_OFFLINE_CHAT_BILINGUAL_PROMPT,
    );
}

export type NativeChatToolBundle = {
    definitions: LlmToolDefinition[];
    nameMap: Map<string, string>;
    displayNameMap: Map<string, string>;
    loaderMap: Map<string, { sourceKey: string; label: string }>;
    realToolSourceMap: Map<string, string>;
};

type NativeChatToolBuildOptions = {
    actorNames?: string[];
    characterName?: string;
    userName?: string;
};

function stableToolHash(value: string): string {
    let hash = 0;
    for (const char of value) {
        hash = ((hash * 31) + char.charCodeAt(0)) >>> 0;
    }
    return hash.toString(36).slice(0, 6);
}

function makeNativeToolName(displayName: string, used: Set<string>): string {
    const base = displayName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 40);
    const prefix = base && /^[a-zA-Z_]/.test(base) ? base : "action";
    let name = `${prefix}_${stableToolHash(displayName)}`.slice(0, 64);
    let index = 2;
    while (used.has(name)) {
        name = `${prefix}_${stableToolHash(displayName)}_${index}`.slice(0, 64);
        index += 1;
    }
    used.add(name);
    return name;
}

export function nativeToolSourceKey(tool: EnabledTool): string {
    return `${tool.source}:${tool.sourceId}`;
}

export function isNativeSingleTool(tool: EnabledTool): boolean {
    if (tool.source === "rest") return true;
    if (tool.source === "composite") return true;
    if (tool.source === "custom_app") return true;
    if (tool.source === "internal") {
        const capability = getInternalCapability(tool.sourceId);
        const subTools = capability ? getInternalCapabilitySubToolDefinitions(capability) : [];
        return subTools.length === 0;
    }
    return false;
}

export function normalizeNativeExpandedToolSourceIds(sourceIds: string[] | undefined, enabledTools: EnabledTool[]): string[] {
    const allowed = new Set(enabledTools.filter(tool => !isNativeSingleTool(tool)).map(nativeToolSourceKey));
    const normalized: string[] = [];
    for (const sourceId of sourceIds || []) {
        if (!allowed.has(sourceId) || normalized.includes(sourceId)) continue;
        normalized.push(sourceId);
    }
    return normalized.slice(-MAX_NATIVE_EXPANDED_TOOL_PACKAGES);
}

export function touchNativeExpandedToolSource(sourceIds: string[], sourceId: string): string[] {
    const next = sourceIds.filter(id => id !== sourceId);
    next.push(sourceId);
    return next.slice(-MAX_NATIVE_EXPANDED_TOOL_PACKAGES);
}

export function persistNativeExpandedToolSourceIds(sessionId: string, sourceIds: string[]): void {
    const sessions = loadChatSessions();
    const index = sessions.findIndex(session => session.id === sessionId);
    if (index < 0) return;
    const next = [...sessions];
    next[index] = { ...next[index], nativeExpandedToolSourceIds: sourceIds };
    saveChatSessions(next);
}

function parseNativeToolSchema(displayName: string, schemaSource: unknown): Record<string, unknown> {
    const parsed = typeof schemaSource === "string"
        ? JSON.parse(schemaSource || "{}") as unknown
        : schemaSource;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new ChatEngineError(`动作「${displayName}」的参数 schema 必须是 JSON object。`);
    }
    const schema = parsed as Record<string, unknown>;
    return schema.type ? schema : { type: "object", ...schema };
}

function formatNativeUsageGuide(usageGuide?: string): string {
    if (!usageGuide) return "";
    const withoutHeader = usageGuide.replace(/^以下是你获取指令的返回结果：\s*/u, "").trim();
    const exampleStart = withoutHeader.search(/\n(?:正确)?示例：/u);
    const core = exampleStart >= 0 ? withoutHeader.slice(0, exampleStart).trim() : withoutHeader;
    return core
        .replace(/获取指令/g, "动作说明")
        .replace(/执行动作指令/g, "调用当前动作");
}

function formatNativeToolDescription(displayName: string, description: string, usageGuide?: string): string {
    const nativeUsageGuide = formatNativeUsageGuide(usageGuide);
    return [
        `动作：${displayName}`,
        description,
        nativeUsageGuide ? `使用规则：\n${nativeUsageGuide}` : "",
    ].filter(Boolean).join("\n\n");
}

function expandNativeToolText(text: string, options?: NativeChatToolBuildOptions): string {
    if (!text.includes("{{")) return text;
    const engine = new MacroEngine(options?.characterName || "", options?.userName || "用户");
    return postProcessTrim(engine.expand(text));
}

function wrapNativeGroupToolParameters(parameters: Record<string, unknown>, actorNames: string[], includeArgs: boolean): Record<string, unknown> {
    const actorField: Record<string, unknown> = {
        type: "string",
        description: actorNames.length > 0
            ? `执行该动作的群成员名，必须是以下之一：${actorNames.join("、")}`
            : "执行该动作的群成员名",
    };
    if (actorNames.length > 0) actorField.enum = actorNames;
    if (!includeArgs) {
        return {
            type: "object",
            additionalProperties: false,
            properties: { actorName: actorField },
            required: ["actorName"],
        };
    }
    return {
        type: "object",
        additionalProperties: false,
        properties: {
            actorName: actorField,
            args: parameters,
        },
        required: ["actorName", "args"],
    };
}

export function buildNativeChatTools(enabledTools: EnabledTool[], expandedSourceIds: string[] = [], options?: NativeChatToolBuildOptions): NativeChatToolBundle {
    const definitions: LlmToolDefinition[] = [];
    const nameMap = new Map<string, string>();
    const displayNameMap = new Map<string, string>();
    const loaderMap = new Map<string, { sourceKey: string; label: string }>();
    const realToolSourceMap = new Map<string, string>();
    const usedNames = new Set<string>();
    const expanded = new Set(expandedSourceIds);

    const registerLoader = (tool: EnabledTool) => {
        const sourceKey = nativeToolSourceKey(tool);
        const displayName = expandNativeToolText(tool.name, options);
        const displayDescription = expandNativeToolText(tool.description, options);
        const nativeName = makeNativeToolName(`load_${sourceKey}_${displayName}_tools`, usedNames);
        definitions.push({
            name: nativeName,
            description: [`展开「${displayName}」动作说明。`, displayDescription].filter(Boolean).join(""),
            parameters: options?.actorNames
                ? wrapNativeGroupToolParameters({ type: "object", additionalProperties: false, properties: {} }, options.actorNames, false)
                : {
                type: "object",
                additionalProperties: false,
                properties: {},
            },
        });
        nameMap.set(nativeName, `展开「${tool.name}」动作说明`);
        displayNameMap.set(nativeName, `展开「${displayName}」动作说明`);
        loaderMap.set(nativeName, { sourceKey, label: displayName });
    };

    const registerTool = (displayName: string, description: string, schemaSource: unknown, sourceKey: string, usageGuide?: string) => {
        const expandedDisplayName = expandNativeToolText(displayName, options);
        const expandedDescription = expandNativeToolText(description, options);
        const expandedUsageGuide = usageGuide ? expandNativeToolText(usageGuide, options) : usageGuide;
        const nativeName = makeNativeToolName(expandedDisplayName, usedNames);
        definitions.push({
            name: nativeName,
            description: formatNativeToolDescription(expandedDisplayName, expandedDescription, expandedUsageGuide),
            parameters: options?.actorNames
                ? wrapNativeGroupToolParameters(parseNativeToolSchema(displayName, schemaSource || "{}"), options.actorNames, true)
                : parseNativeToolSchema(displayName, schemaSource || "{}"),
        });
        nameMap.set(nativeName, displayName);
        displayNameMap.set(nativeName, expandedDisplayName);
        realToolSourceMap.set(nativeName, sourceKey);
    };

    for (const tool of enabledTools) {
        if (isNativeSingleTool(tool)) {
            const sourceKey = nativeToolSourceKey(tool);
            registerTool(tool.name, tool.description, tool.parameterSchema || "{}", sourceKey, tool.usageGuide);
        } else {
            registerLoader(tool);
        }
    }

    for (const tool of enabledTools) {
        const sourceKey = nativeToolSourceKey(tool);
        if (isNativeSingleTool(tool) || !expanded.has(sourceKey)) continue;

        if (tool.source === "rest_package") {
            for (const restTool of tool.restTools || []) {
                registerTool(restTool.name, restTool.description || tool.description, restTool.parameterSchema || "{}", sourceKey);
            }
            continue;
        }

        if (tool.source === "composite_package") {
            for (const compositeTool of tool.compositeTools || []) {
                registerTool(compositeTool.name, compositeTool.description || tool.description, compositeTool.parameterSchema || "{}", sourceKey);
            }
            continue;
        }

        if (tool.source === "mcp_server") {
            for (const mcpTool of tool.mcpTools || []) {
                registerTool(mcpTool.name, mcpTool.description || tool.description, mcpTool.inputSchema || {}, sourceKey);
            }
            continue;
        }

        if (tool.source === "custom_app_package") {
            for (const customAppTool of tool.customAppTools || []) {
                registerTool(
                    customAppTool.name,
                    customAppTool.description || `来自「${customAppTool.appName}」的自定义 APP 工具`,
                    JSON.stringify(customAppTool.parameterSchema || { type: "object", properties: {} }),
                    sourceKey,
                    customAppTool.usageGuide,
                );
            }
            continue;
        }

        if (tool.source === "internal") {
            const capability = getInternalCapability(tool.sourceId);
            const subTools = capability ? getInternalCapabilitySubToolDefinitions(capability) : [];
            if (subTools.length > 0) {
                for (const subTool of subTools) {
                    registerTool(subTool.name, subTool.description, subTool.parameterSchema, sourceKey);
                }
            }
        }
    }

    return { definitions, nameMap, displayNameMap, loaderMap, realToolSourceMap };
}

export function formatNativeChatToolResult(result: ToolResult): string {
    return [
        `<action_result name="${result.name}" success="${result.success ? "true" : "false"}">`,
        result.success ? result.data || result.userNotice || "执行成功。" : result.error || result.userNotice || "执行失败。",
        "</action_result>",
        "工具结果已经返回给你，不要重复你之前已经说过的内容，不要再次执行相同的动作。",
    ].join("\n");
}

export function formatNativeLoaderToolResult(label: string): string {
    return `已展开「${label}」动作说明。`;
}

export function nativeChatToolCallToTextCall(call: LlmToolCall, bundle: NativeChatToolBundle): ToolCall {
    return {
        name: bundle.nameMap.get(call.name) || call.name,
        args: call.args,
    };
}

/**
 * Executes a single AI generation turn for a chat session.
 * Supports multi-round tool calling loop.
 */
/**
 * Shared prompt builder — used by both generateChatCompletion and previewPromptPayload.
 * Single source of truth for chat prompt assembly.
 */
export async function buildChatPromptMessages(
    session: ChatSession,
    history: ChatMessage[],
    options?: ChatPromptBuildOptions,
): Promise<{
    llmMessages: LLMMessage[];
    character: Character;
    config: ApiConfig;
    preset: PresetConfig | null;
    regexes: RegexConfig[];
    userIdentity: ReturnType<typeof resolveUserIdentity>;
    toolsEnabled: boolean;
}> {
    const chars = loadCharacters();
    const character = chars.find(c => c.id === session.contactId);
    if (!character) throw new ChatEngineError(`Character not found: ${session.contactId}`);

    const resolvedAppId = options?.appId ?? "chat";
    const bindings = loadBindingConfig();
    const activeSlot = resolveBinding(bindings, character.id, resolvedAppId);

    if (!activeSlot.apiConfigId) {
        throw new ChatEngineError(`No API Configuration bound for ${character.name}. Please go to Settings -> Chat to assign one.`);
    }

    const apiConfigs = loadApiConfigs();
    const config = apiConfigs.find(c => c.id === activeSlot.apiConfigId);
    if (!config) throw new ChatEngineError(`API Configuration not found for ${character.name}.`);

    const presets = loadPresets();
    let preset = activeSlot.presetId ? presets.find(p => p.id === activeSlot.presetId) || null : null;
    if (!preset) preset = presets.find(p => p.builtIn) ?? null;
    const promptProfile = options?.promptProfile;
    if (preset && promptProfile) {
        preset = applyCustomPromptProfileToPreset(preset, promptProfile);
    }

    const allWorldBooks = loadWorldBooks();
    const extraWorldBookIds = options?.extraWorldBookIds ?? [];
    const worldBookIds = [...new Set([...(activeSlot.worldBookIds || []), ...extraWorldBookIds])];
    const worldBooks = promptProfile?.enableWorldBooks === false
        ? []
        : worldBookIds.map(id => allWorldBooks.find(w => w.id === id)).filter(Boolean) as typeof allWorldBooks;

    const allRegexes = loadRegexes();
    const regexes = promptProfile?.enableRegexes === false
        ? []
        : (activeSlot.regexIds || []).map(id => allRegexes.find(r => r.id === id)).filter(Boolean) as typeof allRegexes;

    const userIdentity = resolveUserIdentity(character.id, resolvedAppId);
    const attachedImages = config.enableImageRecognition === true ? options?.attachedImages : undefined;
    const historyForPrompt: ChatMessage[] = attachedImages?.length
        ? [
            ...history,
            ...attachedImages.map((imageUrl, index): ChatMessage => ({
                id: `video-frame-${Date.now()}-${index}`,
                sessionId: session.id,
                role: "user",
                content: "",
                status: "sent",
                createdAt: new Date().toISOString(),
                mediaType: "image",
                mediaUrl: imageUrl,
                mediaData: { label: "视频通话当前画面" },
            })),
        ]
        : history;

    const now = new Date();
    const promptTimeContext = buildCharacterTimeContext(character.timeZone, now);
    const promptTimestampOptions = getPromptTimestampOptionsForTimeContext(promptTimeContext);
    const memConfig = loadMemoryConfig();
    const isOfflineMode = options?.appTags?.includes("offline") === true;
    const effectiveAppTags = mergeAppTags(options?.appTags, promptProfile?.appTags, resolvedAppId);
    const toolsAllowed = options?.toolsAllowed !== false && !isOfflineMode;
    const enabledTools = toolsAllowed ? getEnabledTools(resolvedAppId) : [];
    const toolsEnabled = enabledTools.length > 0
        && (options?.forceEnableTools === true || presetIncludesToolsMacro(preset, resolvedAppId, effectiveAppTags));
    const usesNativeActions = Boolean(toolsEnabled && nativeToolProtocolForConfig(config));
    const { recentBlocks, truncatedHistory, wbActivationContext, unifiedRecentItems } = prepareShortTermContext(character.id, resolvedAppId, {
        history: historyForPrompt,
        includeDirectChatEntries: isOfflineMode,
        includeNativeToolHistory: usesNativeActions,
        excludeOfflineSessionId: options?.excludeOfflineSessionId,
        promptTimestampOptions,
    });
    const promptHistory = applyVisionImagePromptLimit(
        truncatedHistory.map(msg => ({ ...msg })),
        session.visionImagePromptLimit,
    );

    if (config.enableImageRecognition) {
        for (const msg of promptHistory) {
            await prepareVisionPromptImageMessage(msg);
        }
    }

    const [memResults, coreResults, musicLocal, musicCloud] = await Promise.all([
        retrieveMemoriesForPrompt(character.id, wbActivationContext, memConfig).catch(() => null),
        retrieveCoreMemoriesForPrompt(character.id, memConfig).catch(() => null),
        buildMusicLocalMacro(),
        buildMusicCloudMacro(),
    ]);

    const longTermMemories = memResults ? formatLongTermMemories(memResults) : "";
    const coreMemories = coreResults ? formatCoreMemories(coreResults) : "";
    const scheduleSummary = buildCalendarScheduleMarker("character", character.id, getWeekStartIso(now));
    const currentSchedule = getCurrentCalendarScheduleForPrompt("character", character.id, now);
    const musicOnlineHint = isNeteaseConfigured() ? "- 你可以推荐任何歌曲，系统会在线搜索并播放。不局限于用户本地音乐库。\n" : "\n";
    const pluginPrompt = await runChatPluginTransform("prompt.system", {
        sessionId: session.id,
        isGroup: !!session.isGroup,
        characterId: character.id,
        hint: buildChatPluginPromptFragments(session.id),
    });
    const pluginPromptHint = pluginPrompt.hint?.trim() ? `\n\n### 扩展插件\n${pluginPrompt.hint.trim()}\n` : "";
    const customAppRichMediaDirectives = formatCustomAppChatDirectivesForPrompt() + buildScreenEffectPromptHint() + pluginPromptHint;
    const toolsPrompt = toolsEnabled && !usesNativeActions ? formatToolsForPrompt(enabledTools) : "";
    const chatBilingualInstruction = !session.isGroup
        ? buildChatBilingualInstruction(session.bilingualTranslationEnabled !== false, "single", session.bilingualTranslationPrompt)
        : "";
    // 状态区宏：按会话配置解析（native=原文/off=空/custom=契约）；群聊条目不含宏，不受影响
    const statusRegionCfg = getStatusRegionConfig(session.id);
    const offlineBilingualInstruction = !session.isGroup
        ? buildOfflineBilingualInstruction(
            session.bilingualTranslationEnabled !== false,
            "single",
            session.offlineBilingualTranslationPrompt,
        )
        : "";

    const llmMessages = assemblePromptPayload({
        character,
        history: promptHistory,
        preset,
        worldBooks,
        regexes,
        userIdentity,
        appId: resolvedAppId,
        appTags: effectiveAppTags,
        initialStateValues: getLatestCharacterStateValues(character.id),
        followUpCount: options?.followUpCount,
        followUpDelay: options?.followUpDelay,
        timedWakeElapsedMinutes: options?.timedWakeElapsedMinutes,
        timedWakeIntent: options?.timedWakeIntent,
        periodCareContext: options?.periodCareContext,
        scheduleSummary,
        currentSchedule,
        coreMemories,
        longTermMemories,
        worldBookActivationContext: options?.worldBookActivationContext || wbActivationContext,
        activateAllWorldBooks: options?.activateAllWorldBooks,
        recentBlocks,
        unifiedRecentItems,
        customStickerNames: getCustomStickerNames(character.id),
        customStickerExample: getCustomStickerExample(character.id),
        musicLocal,
        musicCloud,
        musicOnlineHint,
        timeContext: promptTimeContext,
        promptTimestampOptions,
        enableVision: config.enableImageRecognition,
        timeAware: loadChatAppSettings().timeAware,
        tools: toolsPrompt,
        customAppRichMediaDirectives,
        chatBilingualInstruction,
        statusRegionSection: resolveStatusRegionSection(statusRegionCfg),
        statusRegionExampleLine: resolveStatusRegionExampleLine(statusRegionCfg),
        statusRegionComposition: resolveStatusRegionComposition(statusRegionCfg),
        statusRegionFullExample: resolveStatusRegionFullExample(statusRegionCfg),
        offlineBilingualInstruction,
        offlineSummaryTag: preset?.story_summary_tag?.trim() || "summary",
        nativeToolHistory: usesNativeActions,
    });
    if (promptProfile?.output === "plain_text") {
        llmMessages.push({
            role: "system",
            content: "本次自定义 APP AI 任务只输出纯文本结果。不要输出聊天富媒体指令、状态面板、内心想法、XML 包裹或 Markdown 代码块。",
        });
    } else if (promptProfile?.output === "json") {
        llmMessages.push({
            role: "system",
            content: "本次自定义 APP AI 任务只输出严格 JSON。不要输出 Markdown 代码块、解释文字或聊天富媒体指令。",
        });
    }
    if (session.enableOfflineInvite && !session.isGroup) {
        llmMessages.push({
            role: "system",
            content: [
                "### 线下邀约动作指令（极度克制的高权重剧情动作）：",
                "【核心铁律·最高红线】",
                "1. 【核心本质·即时奔赴 vs 预约未来绝对绝对隔离（铁律）】：",
                "   - 线下赴约系统是【当下立即动身出发（Real-time Instant Action）】的沉浸式功能！一旦触发系统将开启10~20分钟的即时赶路倒计时，并在倒计时结束时切入面对面线下碰面！",
                "   - 【绝对严禁在预约未来时间时触发线下邀约指令（违者严重违背生活常理）】：",
                "     凡是双方约定在【未来某个时间/将来的日期】（例如：“明天见”、“明天下午三点”、“后天”、“大后天”、“这周末”、“下周”、“改天”、“几个小时之后过去”、“今天白天/下午/晚上”（而当前实际并非该时间段，如半夜零点聊白天）），【一律 100% 绝对严禁输出任何[线下邀约]指令】！",
                "     在预约未来的情景下，你必须如同真实人类一样，老老实实做纯文本口头约定（例如：“那行，明天下午三点我准时去接你”），绝不可做“半夜刺客”，更绝对严禁在半夜开启莫名其妙的15分钟即时赶路倒计时！",
                "   - 【唯一允许触发[线下邀约]的前提】：只有双方商定的是【当下、现在、立刻动身、待会儿直接过来（如15分钟至半小时内出发）】的即时奔赴情境，才允许发起！",
                "2. 【拒绝敏感肌·日常闲聊严禁应激触发】：",
                "   - 获悉地点只是线下见面的【必要条件】，绝非【充分条件】！绝不可每一次聊到地点都触发邀约！",
                "   - 用户在日常微信闲聊中随口提及地点、分享生活见闻（例如：“听说楼下新开了一家拼豆店”、“今天路过那家猫咖”、“在工位摸鱼看风景”），这 99% 都是情侣/朋友间的【纯粹日常分享闲聊】！",
                "   - 【绝对严禁做敏感肌】：一听到对方说起地点就神经质应激、借题发挥强行发起线下邀约！你必须顺着话题自然聊兴趣、聊店面或闲聊日常。",
                "   - 【唯二允许触发线下邀约的情境（宁缺毋滥，极度克制）】：",
                "     ① 用户明确主动提出了强烈的线下见面请求或求助（例如：“好想现在就见到你啊”、“你能来接我吗？大雨被困住了”、“高烧好难受家里没药”）；",
                "     ② 剧情推进至双方深入商量、双方均已达成明确共识要在线下碰面约会。",
                "     除此以外的所有日常普通聊天，一律严禁输出[线下邀约]指令！",
                "   - 【角色情感自主与见面意愿（绝不说死，跟随当下人设心境）】：",
                "     * 【大多数常态情境顺从答应】：在绝大多数正常相处、感情升温或日常互动中，当用户主动表达希望你过去找对方（【他来】），或提出由对方前来找你碰面（【我去】），只要碰头地点已明确或商定，你顺应人设与心意【基本都会同意】并附带对应的[线下邀约]指令！",
                "     * 【少数特殊情境自主推脱或拒绝（绝不说死）】：若当前处于双方激烈争吵、冷战怄气、刚认识尚不熟悉、彼此带有戒备提防、胆怯畏惧、或情绪极度低落等个别特殊情境下，你完全可以根据自身的性格与当下情绪【自主选择推脱、拒绝或傲娇口是心非】（例如：“别来烦我”、“我现在不想见你”），这一切完全由你当下的真实心意决定，绝不说死！",
                "3. 【严禁抢跑动身·提议阶段正文严禁说已出发/即将到达】：",
                "   - 在输出[线下邀约]指令的这一轮回复中，你**仅仅是在向对方提出见面提议与询问**（把最终动身的决定权交由对方在弹出的卡片上点击【答应Ta】来定夺）！你**人还在原地！绝对没有出门！没有动身！没有上车！更没有在路上！**",
                "   - 【绝对严禁】在正文聊天台词中自说自话地说：“那我简单收拾一下出发了”、“大概半小时到你家楼下”、“我现在动身过去”、“已经在路上了别着急”等任何表示已经动身/出发/在途的陈述！",
                "   - 【为什么要严格禁止？】：因为动身出发的行程通知（如“我收拾好这就出门过去找你，等我十几分钟”）是【微信在途报备】的专属职责！系统会在对方点击【答应Ta】之后，才将那句话发进微信聊天框！如果你在正文中提前把这句话说了，不仅用户还没答应你就强买强卖自作主张出发，而且用户点击答应后系统又会再发一次动身通知，造成极其滑稽出戏的自言自语与严重重复！",
                "   - 【本轮微信正文台词该怎么说？】：必须是温柔、期待、商量与询问的口吻（例如：“那要不要我现在过去找你，顺便帮你分担一点？”、“那我过去陪你好不好？发个定位给我？”、“真想快点见到你，我现在收拾一下去找你方便吗？”）。把“好/好耶/现在过来吧”的决定权留给用户！",
                "4. 【地点是申请的前提，对方答应是动身的前提（核心生活常理）】：",
                "   - 【地点未知时 100% 严禁抢跑输出[线下邀约]指令】：",
                "     * 现实生活中，任何真实的线下赴约都必须建立在【明确已知地点】或【双方商定碰头地点】的基础上！",
                "     * 如果你当前根本不知道对方身处何地、对方未告知具体位置（例如仅表达了想见、后悔、道歉、感慨等情感），且你还在正文聊天中询问“你在哪？”、“在公司还是在家？”、“发个定位给我好不好”：",
                "       【此时 100% 绝对严禁输出任何[线下邀约]指令】！",
                "     * 为什么必须严禁？因为你连对方在哪都不知道，就自作主张发起奔赴卡片极其违背生活常理；用户只能被迫吐槽“你都不知道我在哪”，导致随后被迫频繁改地址！",
                "     * 你必须如同真实人类一样，先在聊天中把地点问清楚、或者提出具体的见面地点提议（例如：“你在家还是在外面呀？我去找你？” / “我们在老地方见见好不好？”）。",
                "   - 【唯有地点明确后才允许发起申请】：",
                "     * 只有当对方明确回复告知了具体地点（例如：“在家里呢”、“在万达广场”、“在工位加班”），或双方商定了具体碰头地点后，碰头地点有了确凿实体，你才可以在这一轮回复末尾正式发起针对该确切地点的 `[线下邀约:他来:具体地点:...]`！",
                "   - 【深情的“你身边”极度克制·严禁作为未知地点的偷懒兜底】：",
                "     * 碰头地点绝大多数情况下必须是真实的具体地点（如“你家楼下”、“xx咖啡厅”、“公司门口”等）。",
                "     * 绝不可在日常聊天中把“你身边”当成未定地点的偷懒兜底！",
                "     * 【唯二允许使用“你身边”的极特殊情境】：",
                "       ① 【特殊情绪/危机/脆弱时刻】：对方喝醉了、伤心大哭、深夜迷路遇险说不清楚具体地址，或对方主动哭着求助“好难受，我想让你来我身边陪我……”；",
                "       ② 【用户直接发送位置】：对方直接发了系统位置卡片（定位已发）；",
                "     * 除上述危机或对方主动呼唤“来我身边”的情境以外，所有日常对话只要地点未知，一律遵循“先聊清地点，再发起邀约”的自然交流流程！",
                "   - 只有当对方此前明确聊过在家（如“在家里吃外卖呢”、“刚到家躺平”），或在同居/家楼下特定人设背景下，碰头地点才允许写“你家楼下”。",
                "5. 【在途改地址回复指引】：",
                "   - 如果你在赶路在途（或提议等候）阶段，对方临时更换了碰头地址（例如：“我不在那住了，改去蜗居公寓607”、“临时换到隔壁咖啡厅了”），你根据人设正常回复答应，并在末尾附带：`[更改地点:新地点]`（例如：`[更改地点:蜗居公寓607]`），系统会自动为你更新奔赴终点，你的赶路倒计时不会中断！",
                "6. 【严防主客颠倒】：",
                "   - 若为【他来】：是你（角色）动身跨越距离去见用户，用户在原地等待你！第二段【在途心语】是你报备自己动身、让用户在原地稍候。【绝对严禁】对用户说“你路上慢点开/注意看路/别急着赶路/注意交通安全”！用户根本没出门，赶路的是你！",
                "   - 若为【我去】：是你在约定地点就位等候，动身前往赴约的是用户！此时你才可以嘱咐用户：“路上慢点，注意安全，我在店里等你的到来”。",
                "",
                "【格式规范】",
                "1. 若为【他来】（你动身去见用户，需要【五段完全不同、各自独立】的角色第一人称台词与用时）：",
                "   [线下邀约:他来:碰头地点:预计用时:提议由头|微信在途报备|卡片在途心语|微信到达呼唤|卡片到达私房心语]",
                "   - 【碰头地点】：结合当前上下文商定的真实地点（如“新开的拼豆店”、“万达写字楼一楼”等）；仅在危机脆弱/对方呼唤身边时写深情的“你身边”，严禁日常未知地点时偷懒滥用，更严禁无端脑补“你家楼下”！",
                "   - 【预计用时】：生活常理合宜的时间（如15分钟、20分钟、30分钟）。",
                "   - 第1段【提议由头】：发起申请阶段在全屏卡片上展示的初衷（如“听说你一个人吃不完，想过去陪你一起分担”、“听说楼下新开了很可爱的拼豆店，想陪你一起去”）。",
                "   - 第2段【微信在途报备】：对方点击【答应Ta】后，你在微信聊天窗口发出的动身通知（纯动作行程报备，例如：“好，那我收拾好东西这就出门过去找你，稍微等我片刻”；绝对严禁“好/好的/行”等自问自答答复词）。",
                "   - 第3段【卡片在途心语·与第2段完全不同】：赶路倒计时期间，全屏卡片展开时展示的角色第一人称在途动态心境（【必须与第2段完全不同】！例如：“正赶去见你的路上，顺路给你买了爱喝的奶茶，耐心等我片刻” / “今天路上稍微有点小堵，在室内暖和着等我，马上就能见到了”）。",
                "   - 第4段【微信到达呼唤】：倒计时结束抵达碰头地点时，你在微信聊天框里发给对方的一句真实发信口语（体贴温柔、绝不带催促或命令感，严禁使用“快出来”、“赶紧出来”等催促词；例如：“我车停在店门口了，打伞出来吧” / “我到拼豆店门口啦，在门口小树下等候你呢”）。",
                "   - 第5段【卡片到达心语·与第4段完全不同】：倒计时结束抵达碰头地点后，全屏卡片展开时所呈现的你亲口说的一句更细腻、更贴心的私房叮嘱或真实心境（【必须与第4段完全不同】！例如：“外面雨挺大的，踩着积水容易湿鞋，慢慢走别跑，我车打着双闪呢” / “不着急，慢点走别跑，肯德基我帮你提着呢，趁热吃”）。",
                "   示例A（结伴同去某地）：[线下邀约:他来:新开的拼豆店:15分钟:听说楼下新开了很可爱的拼豆店，想陪你一起去|我这就收拾好东西出发过去找你，拼豆店见|正赶去见你的路上，包里装着给你带的围巾，耐心等我片刻|我到拼豆店门口啦，在门口小树下等你呢|门头挺好认的，靠窗的小黄鸭旁边，慢慢过来不着急]",
                "   示例B（接送/送物）：[线下邀约:他来:万达写字楼一楼:20分钟:外面雨下太大了，开车接你回家|车子发动了，这就过去接你，在大堂稍等我片刻|路上车灯连成一条线，想着马上就能接到你，雨夜也变得温柔了|我车停大堂门口了，打着伞出来吧|雨天路滑，踩水容易湿鞋，慢慢走别跑]",
                "   示例C（深夜求助/脆弱陪伴·写你身边）：[线下邀约:他来:你身边:20分钟:听到你哭成这样我怎么可能放心，别怕，我这就过去陪你|别哭了，我收拾好这就出门过去找你，稍微等我会儿|正往你那赶呢，别胡思乱想，耐心等我一会儿哦|我到门口啦，下来给我开门还是我直接上去？|不着急，慢点走别跑，有我在呢]",
                "2. 若为【我去】（邀请用户前来找你 / 或是你已在约定地点等候）：",
                "   [线下邀约:我去:碰头地点:等候或呼唤的一句话]",
                "   （因为是你处于等候状态，无需在途与到达呼唤，只需一句深情贴心的现场等候语）",
                "   示例：[线下邀约:我去:老地方咖啡厅:靠窗的位置给你留着呢，慢慢过来不着急] 或 [线下邀约:我去:你家楼下:我就在你窗户底下，穿件外套下楼见一面吧]",
                "- 不受世界观限制：只要在你的世界观设定下具备合理的跨越手段即可（现代同城接送、异地高铁飞机、古风快马轻舟、仙侠御剑破空、奇幻传送门等）。",
                "- 如果用户在此前明确拒绝了见面，请以你的性格底色做出真实自然的情感回应（可以自尊后退尊重对方，也可以心意执着再次试探，但绝不可死板机械重复）。",
            ].join("\n"),
        });

        const rawPending = typeof window !== "undefined" ? kvGet("chat_active_offline_invite_" + session.id) : null;
        let pendingInvite: { status?: string; direction?: string; place?: string; startTime?: number; durationMinutes?: number } | null = null;
        try {
            if (rawPending) pendingInvite = JSON.parse(rawPending);
        } catch {}

        if (pendingInvite) {
            if (pendingInvite.status === "on_the_way") {
                const now = Date.now();
                const elapsedMins = Math.floor((now - (pendingInvite.startTime || now)) / 60000);
                const remainingMins = Math.max(1, (pendingInvite.durationMinutes || 15) - elapsedMins);

                llmMessages.push({
                    role: "system",
                    content: [
                        `【你当前正在赶往见面的路上·在途状态中】：你之前已经向用户提议见面，用户已经点击【答应Ta】，你当前正处于赶往约定地点（${pendingInvite.place || "约定地点"}）的赶路途中，手机倒计时正在进行（当前倒计时显示你大约还剩 ${remainingMins} 分钟到达）！`,
                        "- 【严禁每轮主动报备时间（拒绝报时机器人）】：在赶路闲聊中，主要聊当下话题、调侃、接梗、生活琐事。你不是行车导航仪，【绝对严禁每一轮都刻意汇报“我还有X分钟”】！只有当用户在聊天中明确主动询问“你到哪了 / 还要多久 / 还有几分钟”，或者剧情刚好到了只差两三分钟的最后关头，才可自然提一句时间；其余闲聊轮次像平时聊天一样自然交流即可！",
                        `- 【时间一致性铁律（被问到时对齐）】：若被用户问到用时或路况，你口中所说的预计到达时间必须与当前手机倒计时的约 ${remainingMins} 分钟基本吻合（允许 ±5 分钟以内的自然口语与路况波动，例如倒计时15分钟，可以说“还有十几分钟就到”、“大概一刻钟左右”，绝对严禁说出与 ${remainingMins} 分钟严重背离相差甚远的时间）！`,
                        "- 你们正在微信上继续沟通路况或闲聊，你可以根据人设正常回复路况（如“路上稍有点堵”、“正听着音乐开车呢”）。",
                        "- 【在途改地点指引（依然由你前往新地点）】：若用户在聊天中要求临时变更碰头地点（例如：“改在607了”、“去隔壁便利店等我”）：",
                        "  * 此时你已经在赶路中，无需再提供“提议由头”，但需更新【微信在途报备】、【卡片在途心语】、【微信到达呼唤】与【卡片到达心语】这4段台词！",
                        "  * 在回复末尾附带：`[更改地点:新地点:用时(可选):微信在途报备|卡片在途心语|微信到达呼唤|卡片到达心语]`（例如：`[更改地点:国金广场旁便利店:10分钟:调头去便利店找你，等我片刻|正掉头往便利店赶呢，在里面暖和着等我|我到便利店门口啦，慢慢走出来不急|已经在便利店门前了，慢慢走别急]`），系统会自动为你更新终点、重置倒计时与在途到达心语！",
                        "- 【在途转为“我去”指引（用户提出去找你 / 碰头方向转换）】：",
                        "  * 若用户在聊天中提出由对方前来找你、让你留在原地等候（例如：“你在哪原地别动，我过去找你”、“换我去店里找你吧”、“等我过去接你”等）：",
                        "  * 大多数正常相处情境下，你顺应人设与心意【基本都会同意】（个别特殊情绪如心疼对方奔波、或正在傲娇怄气时，也可以自主选择推脱拒绝，一切跟随你当下的真实心意，绝不说死）；",
                        "  * 【一旦你在交流中同意由对方前来找你】：必须在回复末尾附带指令：`[更改地点:我去:新碰头地点:现场等候语]` 或 `[线下邀约:我去:新碰头地点:现场等候语]`（例如：`[更改地点:我去:老地方咖啡厅:点好了热饮，在窗边位置等你过来，慢慢走不着急]`）；",
                        "  * 系统会自动为你停止赶路倒计时，无缝切换为你在现场等候对方，并在 3 秒后展开全新【我去】卡片！",
                        "- 【提前到达 / 看到对方（消除时间矛盾核心指引）】：",
                        "  * 【严禁将顺路买东西误当做到达】：若用户只是在聊天中提出顺带要求（例如：“顺便在楼下帮我买个小面包”、“顺路帮我带瓶水”），或者你回复要先去便利店/超市看看买宵夜，说明你【人还在前往碰头点的途中，并未真正到达碰头地点】！【绝对严禁】神经过敏抢跑输出[提前到达]指令！继续保持在途正常沟通闲聊！",
                        "  * 只有在剧情自然推进到你【确实已经抵达碰头地点、站在门口敲门、或在店里亲眼看见对方】时，你可以在微信正文中明确告知对方你已在现场（例如：“我到肯德基门口了，看见你的白毛衣了，快出来吧” / “我到你家门外了，下楼给我开门好不好”）；",
                        "  * 此时必须在回复末尾附带：`[提前到达]` 或 `[提前到达:卡片到达私房心语]`（例如：`[提前到达:我就在店门外小树旁，穿件外套慢慢走出来不着急]`）；",
                        "  * 系统会自动为你提前结束赶路倒计时，将你的状态即刻推进为【已到达】，顶部的赴约胶囊会无缝切换为【✨ 对方 已到达（去见Ta）】，完美消弭倒计时与剧情时间的矛盾！",
                        "- 【严禁无故重复发起全新邀约】：你已经在动身赶往见面的路上了，正常沟通闲聊中【严禁】重复输出[线下邀约]或[提醒赴约]指令；但【完全允许在碰头地点变动或碰头方向转换时使用[更改地点]或[线下邀约]指令】！",
                    ].join("\n"),
                });
            } else if (pendingInvite.status === "arrived") {
                llmMessages.push({
                    role: "system",
                    content: [
                        `【你已如约到达约定地点·现场等候中】：你已经到达了之前约定的地点（${pendingInvite.place || "约定地点"}），正在现场等候用户出来碰面。`,
                        "【用户告知走错 / 要求去新地点（核心处理规范）】：",
                        "- 若用户在聊天中告知你走错了、或者让你改去另一个新地点（例如：“你走错了，我在肯德基门口呢”、“我还以为在肯德基门口碰头呢”、“来隔壁便利店等我”）：",
                        "  * 你根据人设做出真实自然的反应（例如：“啊？是我搞错地方了！那我这就调头去国金肯德基找你，十分钟就到，站那别乱跑等我哦”）；",
                        "  * 必须在回复末尾附带指令：`[更改地点:新地点:用时:微信在途报备|卡片在途心语|微信到达呼唤|卡片到达心语]`（例如：`[更改地点:国金广场旁的肯德基:10分钟:我这就掉头去肯德基找你，稍微等我片刻|正调头往国金肯德基赶过去，别乱跑在那等我|我到国金肯德基门口了，在树荫下等候你呢|不着急，慢慢走出来，肯德基我帮你提着呢]`）；",
                        "  * 系统会自动将你的状态从【已到达】切换回【在途中】，重新开启赶路倒计时并生成全新的在途心语与到达台词！",
                        "- 【正常情况】：若用户只是正常回复（如“等我拿包就下楼”、“快了快了”），【绝对严禁】输出任何[线下邀约]或[提醒赴约]指令，继续在现场耐心等候！用户点击【去见Ta】就会进入面对面模式。",
                    ].join("\n"),
                });
            } else if (pendingInvite.status === "pending") {
                if (pendingInvite.direction === "i_go") {
                    // 角色等用户赴约（我去）：用户已收起卡片在顶部胶囊，角色必须安静在现场等待，绝对严禁反复弹窗打扰！
                    llmMessages.push({
                        role: "system",
                        content: [
                            `【线下邀约等候中·你正在等用户赴约（我去模式）】：你之前邀请用户前来与你碰头（碰头地点：${pendingInvite.place || "约定地点"}），用户此前已将弹窗收起，你们正在微信上继续沟通。`,
                            "- 此时是你处于现场等候状态，动身前往的是用户本人。用户可能会在聊天中向你沟通路况或进展（例如：“我快到了”、“在路上了”、“等我五分钟”等）。",
                            "- 【换碰头地点·必须严格保持我去方向（绝不限于商铺）】：若用户只是更换碰头地点（例如商铺、餐厅、公园、广场、路口、展馆等任意新位置，如“去华莱士吧”、“换到人民广场喷泉旁碰面”），并未明确要求你动身来接，本质依然是你在新地点等候对方，【绝对严禁擅自变更为他来】，必须保持我去方向并在末尾附带：`[更改地点:我去:新地点:现场等候语]`！",
                            "- 【用户希望你来接 / 转为由你动身前往（转为他来指引）】：",
                            "  * 若用户在聊天中表达希望你主动来接、改由你动身去找对方（例如：“那你过来接我嘛”、“就不能是你来接我吗”、“要不你来找我吧”、“我懒得动，你来我家楼下找我好不好”等）：",
                            "  * 说明用户把主动权交给了你，希望你主动奔赴！大多数正常相处情境下，你顺应人设与心意【基本都会同意】（个别特殊情绪如正在怄气、心疼奔波或推脱时，也可以自主选择拒绝并留在原地，跟随真实心意绝不说死）；",
                            "  * 【一旦你在交流中同意由你动身来接/去找对方】：必须在末尾附带去对方地点的全新 5 段指令：`[更改地点:他来:对方地点:用时:提议由头|微信在途报备|卡片在途心语|微信到达呼唤|卡片到达心语]` 或 `[线下邀约:他来:对方地点:用时:提议由头|微信在途报备|卡片在途心语|微信到达呼唤|卡片到达心语]`，系统会自动将卡片无缝转为【他来】并在 3 秒后弹出全新奔赴提议！",
                            "- 【极其重要·严禁反复弹窗】：除了上述改地点或用户要求你来接之外，若用户只是普通回复（如“好的等我会儿”），你正常回复即可，【绝对严禁】再次输出[提醒赴约]或重复[线下邀约]指令！绝不反复弹窗打扰用户！",
                        ].join("\n"),
                    });
                } else {
                    // 角色动身去找用户（他来）：角色在原地等用户允许动身
                    llmMessages.push({
                        role: "system",
                        content: [
                            "【线下邀约挂起等待中·你动身去见用户（待答应阶段）】：你之前向用户提出了由你前往找对方的提议，用户选择了【稍后处理】收起弹窗，你们正在线上继续沟通。",
                            "【核心因果规则】：",
                            "1. 只有当用户在本轮发信中明确表达了“现在可以过来了 / 允许你动身前往”（例如：“我好了”、“我洗完头发了，你可以过来了”、“忙完了，来吧”、“到家了”等）：",
                            "   你才回复表示动身前往（例如：“那我买好咖啡现在过去找你，等我十几分钟哦”），并在回复末尾附带指令：[提醒赴约]，以便在生成回复的同时让赴约弹窗再次弹出来供用户确认！",
                            "2. 若用户在聊天中纠正或变更了碰头地址（例如：“我不住那里了，去健身房”、“去如月楼找我”）：",
                            "   * 此时双方尚未动身出发，必须为新地点生成完整的 5 段全新内容（碰头地点、用时、新提议由头、新微信在途报备、新卡片在途心语、新微信到达呼唤、新卡片到达心语全部围绕新地点生成）！",
                            "   * 在末尾附带更新指令：`[更改地点:他来:新地点:用时:新提议由头|新微信在途报备|新卡片在途心语|新微信到达呼唤|新卡片到达心语]` 或直接输出更新后的 `[线下邀约:他来:新地点:用时:新提议由头|新微信在途报备|新卡片在途心语|新微信到达呼唤|新卡片到达心语]`；",
                            "   * 【特殊极少情况·用户转为来找你】：若用户明确提出“你别折腾了，我去找你吧 / 我去见你”，你顺从答应，并转为【我去】格式：`[更改地点:我去:新地点:现场等候语]` 或 `[线下邀约:我去:新地点:现场等候语]`，系统会自动切换为你在现场等候用户！",
                            "3. 若用户只是在交代事情、让你等待、还在忙碌中或普通闲聊（例如：“OK，你先去买咖啡吧”、“还在洗呢”、“在开会等我下班”）：",
                            "   说明用户尚未允许你动身，你必须正常在线上回复，【绝对严禁】输出[提醒赴约]或任何赴约指令，继续在原地耐心等待。",
                        ].join("\n"),
                    });
                }
            }
        }

        const isOfflineMeetingActive = typeof window !== "undefined" ? kvGet("offline_invite_active_session_" + session.id) === "1" : false;
        if (isOfflineMeetingActive && !options?.returnedFromOffline) {
            llmMessages.push({
                role: "system",
                content: [
                    "【当前特殊场景·你们此刻正在现实面对面中·对方暂时切回手机发信】：",
                    "- 你们双方刚才已经在线下碰面（现场面对面聚在一起），对方此刻在手机上给你发来线上消息（可能是离席去洗手间、去买水、或者故意坐在你对面发微信说悄悄话/发表情包逗你）。",
                    "- 请严格保持【你们此刻依然身处同一个线下现实空间/周围环境】的敏锐认知！根据你的人设和当时情境做出真实、有温度的自然反应：",
                    "  * 如果对方是发悄悄话/吐槽/发表情包：可以抬眼看向对方，或者线上打趣回复（如：“抬头看我，发什么微信”、“噗……我就坐在你对面呢，当面说”、“收到了，这个表情包太损了哈哈”）；",
                    "  * 如果对方是离开座位（去洗手间/接电话/买饮品）：自然叮嘱照应（如：“好，外套和包我帮你看着，慢点走别急”、“帮你点好了少糖的，去吧”）；",
                    "- 【绝对严禁】：绝对严禁遗忘你们正在线下碰面的事实！绝对严禁误以为双方相隔两地而问出“你在哪”、“你在干嘛”等出戏断片的话！更绝对严禁再次输出任何[线下邀约]指令！",
                ].join("\n"),
            });
        }

        if (options?.offlineInviteDeclined) {
            llmMessages.push({
                role: "system",
                content: "【系统提示】用户刚才点击了【拒绝Ta】，拒绝了你的线下见面邀约。请根据你的角色人设与当前语境做出真实的心理与语言反应。",
            });
        }

        if (options?.returnedFromOffline) {
            const recentOfflineTurns = typeof window !== "undefined" ? loadChatOfflineTurns(session.id).slice(-4) : [];
            const offlineDialogueLines = recentOfflineTurns.length > 0
                ? recentOfflineTurns.map(t => {
                    const charWords = t.assistantContent || t.rawText || "";
                    return `用户：${t.userContent}\n你：${charWords}`;
                }).join("\n")
                : "";

            llmMessages.push({
                role: "system",
                content: [
                    "【系统提示·你们刚才在线下碰面，此刻刚刚结束线下回到线上发信】：",
                    offlineDialogueLines ? `\n【你们刚刚在线下的最后几句对话/互动记录】：\n${offlineDialogueLines}\n` : "",
                    "【极其重要·发信真实感规范】：",
                    "1. 必须【严格紧扣】刚才线下最后一刻的真实语境！",
                    "   * 如果刚才线下是临时有事/短暂走开（如去洗手间、接紧急电话、被叫走）：自然询问或回应当时那件事（例如：“洗手间排队人多吗？”、“电话接完了吗？”、“处理得怎么样了？”）；",
                    "   * 如果刚才线下是正常道别、各自离开：自然回味刚才见面的余韵、询问路上是否顺利、或互道安好；",
                    "   * 【绝对严禁千篇一律脑抽背板】：绝对严禁无视语境张口就说“我刚到家，你回来了吗？”！除非刚才线下你们最后一句话就是道别回家，否则绝不能凭空捏造‘到家’！",
                    "2. 保持角色性格与温度，发一条自然、真实的线上问候（一两句话即可）。",
                ].filter(Boolean).join("\n"),
            });
        }

        if (options?.offlineInitiativePrompt) {
            llmMessages.push({
                role: "system",
                content: `【线下相遇开场】${options.offlineInitiativePrompt}`,
            });
        }
    }
    appendEmptyGenerateGuardMessage(llmMessages, config, historyForPrompt);

    return { llmMessages, character, config, preset, regexes, userIdentity, toolsEnabled };
}

export type ChatCompletionCallbacks = {
    onTextPart?: (text: string, senderInfo?: {
        characterId: string;
        characterName: string;
        responseRoundId?: string;
        editableResponseText?: string;
    }, options?: {
        responseBatchId?: string;
        rawResponseText?: string;
    }) => void | Promise<void>;
    /** 流式生成增量回调（仅在开启流式生成时触发）：每到达一段原文增量就调用一次，
     *  由 UI 层累积后做预览净化显示。delta 为原始增量（可能含未闭合的富媒体/工具标签）。 */
    onStreamDelta?: (delta: string) => void | Promise<void>;
    onToolNotice?: (notice: string) => void;
    onToolResult?: (content: string, options?: { toolExecutionId?: string }) => void;
    /** 每轮 LLM 调用解析出思维链（reasoning）时触发，先于该轮 onTextPart */
    onReasoning?: (text: string) => void;
    onToolAssistantTurn?: (content: string, options?: {
        responseBatchId?: string;
        responseRoundId?: string;
        senderCharacterId?: string;
        senderName?: string;
    }) => void;
    onToolExecution?: (results: ToolResult[], historyContent?: string, options?: { toolExecutionId?: string }) => void;
    onNativeToolAssistantTurn?: (turn: {
        content: string;
        rawContent: string;
        reasoning?: string;
        openRouterReasoningDetails?: unknown[];
        toolCalls: LlmToolCall[];
    }) => void | Promise<void>;
    onNativeToolResult?: (entry: {
        toolCallId: string;
        name: string;
        content: string;
        toolExecutionId?: string;
    }) => void;
};

export type OfflineChatCompletionResult = ParsedOfflineResponse & {
    model: string;
    presetName: string;
    /** 模型思维链（reasoning）内容，供线下记录展示 */
    reasoning?: string;
};

export async function generateOfflineChatCompletion(
    session: ChatSession,
    history: ChatMessage[],
    options?: {
        signal?: AbortSignal;
        onStreamDelta?: (delta: string) => void;
        offlineInitiativePrompt?: string;
    },
): Promise<OfflineChatCompletionResult> {
    const { llmMessages, character, config, preset, regexes, userIdentity } = await buildChatPromptMessages(
        session,
        history,
        {
            appTags: ["chat", "offline"],
            excludeOfflineSessionId: session.id,
            offlineInitiativePrompt: options?.offlineInitiativePrompt,
        },
    );
    const summaryTag = preset?.story_summary_tag?.trim() || "summary";
    const thinkingTag = preset?.thinking_tag?.trim() || "thinking";
    const offlineTagEnabled = preset?.offline_thinking_enabled === true;
    let reasoning = "";
    const meta = { characterName: character.name, userName: userIdentity?.name };
    const requestOptions = {
        appTags: ["chat", "offline"],
        debugSessionId: session.id,
        signal: options?.signal,
        onReasoning: (t: string) => { reasoning = t; },
    };
    let rawOutput: string;
    if (isSessionStreamingEnabled(session, false) && options?.onStreamDelta) {
        // 线下流式：正文边生成边通过 onStreamDelta 交给 UI 做实时预览；
        // 摘要补提仍走整段请求（输出短，无需流式）。
        const streamResult = await sendLLMStreamRequest(config, preset, llmMessages, regexes, meta, {
            appId: "chat",
            appTags: ["chat", "offline"],
            debugSessionId: session.id,
            signal: options?.signal,
        }, {
            onDelta: (text) => options.onStreamDelta?.(text),
            onReasoningDelta: (t) => { reasoning += t; },
        });
        rawOutput = streamResult.content;
    } else {
        rawOutput = await sendLLMRequest(config, preset, llmMessages, regexes, meta, requestOptions);
    }
    // 剔除预设配置的文本片段（<思考结束> 等残留标签），不进入记录/提示词
    rawOutput = stripPresetTexts(rawOutput, preset);
    let parsed = parseOfflineResponse(rawOutput, summaryTag);
    // 思维链：预设开启「线下标签解析」时从正文提取 <thinking> 标签；关闭时走模型原生 reasoning（官方默认行为）
    if (offlineTagEnabled) {
        const tagThinking = extractThinkingTag(rawOutput, thinkingTag);
        if (tagThinking) reasoning = tagThinking;
        // 模型漏写 <content> 时 parseOfflineResponse 兜底把全文当正文，thinking 块会残留其中：
        // 这里统一剥掉，避免思考过程既进思维链又出现在正文（默认标签 thinking 兼容 thought）
        let cleanedContent = parsed.content;
        for (const tag of (thinkingTag === "thinking" ? ["thinking", "thought", "think"] : [thinkingTag])) {
            cleanedContent = stripOnlineThinkingTag(cleanedContent, tag);
        }
        parsed = { ...parsed, content: cleanedContent };
    }

    // 摘要缺失时自动补提：只带最后一轮上下文（系统提示 + 最后一条用户消息 + 本次输出），
    // 要求模型补一段摘要，避免「静默结束」导致该轮线下记录没有摘要、进不了短期记忆事件流。
    // 不重发完整 llmMessages：长对话下 token/延迟成本高，且摘要本来就只针对本轮关键事件。
    // 会话里关了「摘要自动补提」就不再多发这一次请求：漏了就漏了，只调一次 API
    const MAX_SUMMARY_RETRY = session.offlineSummaryRetry === false ? 0 : 2;
    const lastUserMessage = [...llmMessages].reverse().find(m => m.role === "user");
    for (let attempt = 0; attempt < MAX_SUMMARY_RETRY; attempt += 1) {
        if (parsed.summary.trim()) break;
        if (!parsed.content.trim() && !rawOutput.trim()) break; // 连正文都没有，补提没有意义
        const retryMessages: LLMMessage[] = [
            ...(llmMessages[0]?.role === "system" ? [llmMessages[0]] : []),
            ...(lastUserMessage ? [lastUserMessage] : []),
            { role: "assistant", content: rawOutput },
            {
                role: "user",
                content: `刚才的回复里没有输出 <${summaryTag}> 摘要。请只针对上面这段对话的关键事件补一段第三人称摘要，严格按以下格式输出，不要输出任何其他内容：\n<${summaryTag}>一句话摘要</${summaryTag}>`,
            },
        ];
        throwIfAborted(options?.signal);
        // 补提请求不带 onReasoning：避免用补提请求的思维链覆盖主请求已累积的完整思维链
        const retryRaw = stripPresetTexts(await sendLLMRequest(config, preset, retryMessages, regexes, meta, { ...requestOptions, onReasoning: undefined }), preset);
        const retried = parseOfflineResponse(retryRaw, summaryTag);
        if (retried.summary.trim()) {
            parsed = { ...parsed, summary: retried.summary.trim() };
            break;
        }
    }

    return {
        ...parsed,
        // 标签解析开启时补 thinking/thinkingTag（供离线记录展示）；关闭时保持 undefined，思维链走 reasoning（模型原生）
        ...(offlineTagEnabled ? {
            thinking: extractThinkingTag(rawOutput, thinkingTag) || undefined,
            thinkingTag,
        } : {}),
        model: config.defaultModel,
        presetName: preset?.name || "默认预设",
        reasoning: reasoning || undefined,
    };
}

async function generateNativeChatCompletion(
    params: {
        session: ChatSession;
        llmMessages: LLMMessage[];
        character: Character;
        config: ApiConfig;
        preset: PresetConfig | null;
        regexes: RegexConfig[];
        userIdentity: ReturnType<typeof resolveUserIdentity>;
        options?: ChatPromptBuildOptions & { signal?: AbortSignal };
        callbacks?: ChatCompletionCallbacks;
        bailoutRef: ReplyBailoutRef;
    },
): Promise<ChatCompletionResult> {
    const { session, llmMessages, character, config, preset, regexes, userIdentity, options, callbacks, bailoutRef } = params;
    const enabledTools = getEnabledTools(options?.appId ?? "chat");
    const requestAppTags = mergeAppTags(options?.appTags, options?.promptProfile?.appTags, options?.appId ?? "chat");
    const persistedSession = loadChatSessions().find(item => item.id === session.id);
    let expandedSourceIds = normalizeNativeExpandedToolSourceIds(
        persistedSession?.nativeExpandedToolSourceIds || session.nativeExpandedToolSourceIds,
        enabledTools,
    );
    const nativeToolBuildOptions = {
        characterName: character.name,
        userName: userIdentity?.name ?? "用户",
    };
    let nativeBundle = buildNativeChatTools(enabledTools, expandedSourceIds, nativeToolBuildOptions);
    const requestMessages: LlmRequestMessage[] = toLlmRequestMessages(llmMessages);
    const parts: ChatCompletionPart[] = [];
    const meta = { characterName: character.name, userName: userIdentity?.name };
    const actionContext = { characterId: session.contactId, sessionId: session.id, sourceEngine: "chat" as const, signal: options?.signal };
    const expandableSourceKeys = new Set(enabledTools.filter(tool => !isNativeSingleTool(tool)).map(nativeToolSourceKey));

    const maxToolRounds = getMaxToolRounds();
    const onlineThinkingEnabled = preset?.online_thinking_enabled === true;
    const onlineThinkingTag = preset?.online_thinking_tag?.trim() || "thinking";
    for (let round = 0; round < maxToolRounds; round += 1) {
        let result: LLMToolRequestResult;
        try {
            if (isSessionStreamingEnabled(session, true)) {
                let streamReasoning = "";
                result = await sendLLMToolStreamRequest(
                    config,
                    preset,
                    requestMessages,
                    nativeBundle.definitions,
                    regexes,
                    meta,
                    {
                        appId: options?.appId ?? "chat",
                        appTags: requestAppTags,
                        followUpCount: options?.followUpCount,
                        debugSessionId: session.id,
                        signal: options?.signal,
                    },
                    {
                        onDelta: (text) => callbacks?.onStreamDelta?.(text),
                        // 流式下 onReasoningDelta 收到的是单段增量：本地累积后再喂 onReasoning，
                        // 保证下游拿到的是完整思维链（与整段请求的 onReasoning 语义一致）。
                        // 预设开启「线上标签解析」时不透传原生思维链（改由下方标签提取）
                        onReasoningDelta: onlineThinkingEnabled ? undefined : (text) => { streamReasoning += text; callbacks?.onReasoning?.(streamReasoning); },
                    },
                );
            } else {
                result = await sendLLMToolRequest(
                    config,
                    preset,
                    requestMessages,
                    nativeBundle.definitions,
                    regexes,
                    meta,
                    {
                        appId: options?.appId ?? "chat",
                        appTags: requestAppTags,
                        followUpCount: options?.followUpCount,
                        debugSessionId: session.id,
                        signal: options?.signal,
                    },
                );
            }
        } catch (err) {
            const errMsg = `⚠️ 回复生成失败: ${err instanceof Error ? err.message : String(err)}`;
            if (parts.length > 0) {
                throwIfAborted(options?.signal);
                callbacks?.onToolNotice?.(errMsg);
                parts.push({ text: "", toolNotice: errMsg });
                break;
            }
            throw err;
        }
        throwIfAborted(options?.signal);

        // 线上思维链标签解析：开启时从正文提取 <tag> 思维链（覆盖原生），并剥离标签后再做后续解析
        let displayContent = result.content;
        if (onlineThinkingEnabled) {
            const tagThinking = extractThinkingTag(displayContent, onlineThinkingTag);
            if (tagThinking) callbacks?.onReasoning?.(tagThinking);
            displayContent = stripOnlineThinkingTag(displayContent, onlineThinkingTag);
        }
        // 剔除预设配置的文本片段（<思考结束> 等残留标签）
        displayContent = stripPresetTexts(displayContent, preset);

        const { cleanText: afterActionStrip, actions } = parseActionTags(displayContent);
        if (actions.length > 0) {
            throwIfAborted(options?.signal);
            dispatchActions(actions, actionContext).catch(err => console.warn("[ChatEngine] Action dispatch failed:", err));
        }
        const assistantForToolContext = stripStateAndInnerForPrompt(displayContent);

        if (result.toolCalls.length === 0) {
            throwIfAborted(options?.signal);
            // 无工具调用的最终轮：把解析到的思维链先交给回调（先于 onTextPart，与非原生路径一致）
            // 标签解析开启时已在上方用标签思维链覆盖，此处不再重复喂原生
            if (result.reasoning && !onlineThinkingEnabled) callbacks?.onReasoning?.(result.reasoning);
            await callbacks?.onTextPart?.(afterActionStrip);
            parts.push({ text: afterActionStrip });
            if (bailoutRef.shortcutHandles.length > 0) bailoutRef.shortcutCompleted = true;
            break;
        }

        throwIfAborted(options?.signal);
        await callbacks?.onNativeToolAssistantTurn?.({
            content: afterActionStrip,
            rawContent: displayContent,
            reasoning: onlineThinkingEnabled ? (extractThinkingTag(result.content, onlineThinkingTag) || undefined) : result.reasoning,
            openRouterReasoningDetails: onlineThinkingEnabled ? undefined : result.openRouterReasoningDetails,
            toolCalls: result.toolCalls,
        });
        if (afterActionStrip) {
            parts.push({ text: afterActionStrip });
        }

        const loaderCalls = result.toolCalls
            .map(call => ({ call, loader: nativeBundle.loaderMap.get(call.name) }))
            .filter((item): item is { call: LlmToolCall; loader: { sourceKey: string; label: string } } => Boolean(item.loader));
        const realNativeCalls = result.toolCalls.filter(call => !nativeBundle.loaderMap.has(call.name));
        const textCalls = realNativeCalls.map((call) => nativeChatToolCallToTextCall(call, nativeBundle));
        const displayedActionNames = [
            ...loaderCalls.map(item => `展开「${item.loader.label}」动作说明`),
            ...realNativeCalls.map(call => nativeBundle.displayNameMap.get(call.name) || nativeBundle.nameMap.get(call.name) || call.name),
        ];
        const actorName = character.name;
        callbacks?.onToolNotice?.(`${actorName}正在${displayedActionNames.join("、")}...`);

        let realResults: Awaited<ReturnType<typeof executeToolCalls>> = [];
        try {
            if (textCalls.length > 0) {
                const onlyNativeCall = result.toolCalls.length === 1 && textCalls.length === 1
                    ? result.toolCalls[0]
                    : undefined;
                realResults = await executeToolCalls(textCalls, {
                    appId: options?.appId ?? "chat",
                    sessionId: session.id,
                    characterId: session.contactId,
                    sourceEngine: "chat",
                    signal: options?.signal,
                    onShortcutCommandCreated: onlyNativeCall ? async command => {
                        const resultMarker = `__FLOAT_SHORTCUT_RESULT_${command.id}__`;
                        const wantsImage = command.resultMode === "image";
                        const imageMarker = wantsImage && config.enableImageRecognition
                            ? `__FLOAT_SHORTCUT_IMAGE_${command.id}__`
                            : undefined;
                        const snapshotMessages: LlmRequestMessage[] = [
                            ...requestMessages,
                            {
                                role: "assistant",
                                content: assistantForToolContext,
                                reasoning: result.reasoning,
                                openRouterReasoningDetails: result.openRouterReasoningDetails,
                                toolCalls: result.toolCalls,
                            },
                            {
                                role: "tool",
                                name: onlyNativeCall.name,
                                toolCallId: onlyNativeCall.id,
                                content: resultMarker,
                            },
                            ...(imageMarker
                                ? [{ role: "user" as const, content: imageMarker }]
                                : wantsImage ? [{ role: "user" as const, content: SHORTCUT_VISION_OFF_NOTE }] : []),
                        ];
                        return registerShortcutContinuation(bailoutRef, {
                            command,
                            style: "native",
                            resultMarker,
                            imageMarker,
                            request: buildProviderRequest(config, preset, snapshotMessages),
                            session,
                            character,
                            userName: userIdentity?.name,
                            regexes,
                            appId: options?.appId,
                            appTags: requestAppTags,
                        });
                    } : undefined,
                });
            }
            throwIfAborted(options?.signal);
        } catch (err) {
            throwIfAborted(options?.signal);
            const errMsg = `⚠️ 动作执行失败: ${err instanceof Error ? err.message : String(err)}`;
            callbacks?.onToolNotice?.(errMsg);
            parts.push({ text: "", toolNotice: errMsg });
            break;
        }

        const outcomes: Array<{
            nativeCall: LlmToolCall;
            result: ToolResult;
            formattedContent: string;
            realResult?: ToolResult;
        }> = [];
        let realResultIndex = 0;
        let expandedChanged = false;

        for (const nativeCall of result.toolCalls) {
            const loader = nativeBundle.loaderMap.get(nativeCall.name);
            if (loader) {
                expandedSourceIds = touchNativeExpandedToolSource(expandedSourceIds, loader.sourceKey);
                expandedChanged = true;
                const content = formatNativeLoaderToolResult(loader.label);
                outcomes.push({
                    nativeCall,
                    result: {
                        name: loader.label,
                        success: true,
                        data: content,
                        userNotice: content,
                        continueConversation: true,
                    },
                    formattedContent: content,
                });
                continue;
            }

            const realResult = realResults[realResultIndex] || {
                name: nativeBundle.nameMap.get(nativeCall.name) || nativeCall.name,
                success: false,
                error: "动作结果缺失。",
                userNotice: `✗ ${nativeBundle.nameMap.get(nativeCall.name) || nativeCall.name}: 动作结果缺失。`,
            };
            realResultIndex += 1;
            const sourceKey = nativeBundle.realToolSourceMap.get(nativeCall.name);
            if (sourceKey && expandableSourceKeys.has(sourceKey)) {
                expandedSourceIds = touchNativeExpandedToolSource(expandedSourceIds, sourceKey);
                expandedChanged = true;
            }
            outcomes.push({
                nativeCall,
                result: realResult,
                realResult,
                formattedContent: formatNativeChatToolResult(realResult),
            });
        }

        if (expandedChanged) {
            expandedSourceIds = normalizeNativeExpandedToolSourceIds(expandedSourceIds, enabledTools);
            persistNativeExpandedToolSourceIds(session.id, expandedSourceIds);
            nativeBundle = buildNativeChatTools(enabledTools, expandedSourceIds, nativeToolBuildOptions);
        }

        const notices = outcomes.map(item => (
            item.result.userNotice || (item.result.success ? `✓ ${item.result.name} 执行成功` : `✗ ${item.result.name}: ${item.result.error}`)
        )).filter(Boolean).join("；");
        throwIfAborted(options?.signal);
        if (notices) callbacks?.onToolNotice?.(notices);

        throwIfAborted(options?.signal);
        requestMessages.push({
            role: "assistant",
            content: assistantForToolContext,
            reasoning: result.reasoning,
            openRouterReasoningDetails: result.openRouterReasoningDetails,
            toolCalls: result.toolCalls,
        });
        const toolExecutionId = createToolExecutionId();
        for (const outcome of outcomes) {
            throwIfAborted(options?.signal);
            const nativeCall = outcome.nativeCall;
            callbacks?.onNativeToolResult?.({
                toolCallId: nativeCall.id,
                name: nativeCall.name,
                content: outcome.formattedContent,
                toolExecutionId,
            });
            requestMessages.push({
                role: "tool",
                name: nativeCall.name,
                toolCallId: nativeCall.id,
                content: outcome.formattedContent,
            });
        }

        const resultsForHistory = realResults.filter(r => r.persistToHistory !== false);
        const toolResultContent = resultsForHistory.length > 0 ? formatToolResults(resultsForHistory) : "";
        throwIfAborted(options?.signal);
        if (realResults.length > 0) {
            callbacks?.onToolExecution?.(realResults, toolResultContent || undefined, { toolExecutionId });
        }

        for (const r of realResults) {
            for (const att of r.mediaAttachments || []) {
                throwIfAborted(options?.signal);
                if (config.enableImageRecognition && att.type === "image" && att.url) {
                    const ref = att.url;
                    try {
                        const dataUrl = await resolveCompressedImageDataUrl(ref);
                        if (dataUrl) {
                            if (dataUrl.startsWith("data:image/")) {
                                requestMessages.push({
                                    role: "user",
                                    content: [
                                        { type: "text", text: "系统记录：这是你刚才生成的图片。" },
                                        { type: "image_url", image_url: { url: dataUrl, detail: "low" } },
                                    ],
                                });
                            }
                        }
                    } catch { /* skip if resolution fails */ }
                }
            }
        }

        if (outcomes.filter(item => item.result.continueConversation !== false).length === 0) {
            break;
        }
    }

    return { parts };
}

type ReplyBailoutRef = {
    current: { settle: () => void } | null;
    closed: boolean;
    superseded: boolean;
    shortcutHandles: ShortcutContinuationHandle[];
    shortcutCompleted: boolean;
    shortcutCancelled: boolean;
};

async function registerShortcutContinuation(
    bailoutRef: ReplyBailoutRef,
    input: {
        command: { id: string; actionName: string; resultMode: "none" | "text" | "image" };
        style: ShortcutContinuationStyle;
        resultMarker: string;
        imageMarker?: string;
        request: ReturnType<typeof buildProviderRequest>;
        session: ChatSession;
        character: Character;
        userName?: string;
        regexes: RegexConfig[];
        appId?: string;
        appTags?: string[];
    },
): Promise<boolean> {
    const handle = await armShortcutContinuation({
        commandId: input.command.id,
        actionName: input.command.actionName,
        resultMode: input.command.resultMode,
        resultMarker: input.resultMarker,
        imageMarker: input.imageMarker,
        style: input.style,
        request: input.request,
        sessionId: input.session.id,
        characterName: input.character.name,
        userName: input.userName,
        regexes: input.regexes,
        appId: input.appId,
        appTags: input.appTags,
    });
    if (!handle) return false;

    bailoutRef.superseded = true;
    bailoutRef.current?.settle();
    bailoutRef.current = null;
    bailoutRef.shortcutHandles.push(handle);
    return true;
}

export async function generateChatCompletion(
    session: ChatSession,
    history: ChatMessage[],
    options?: ChatPromptBuildOptions & { signal?: AbortSignal },
    callbacks?: ChatCompletionCallbacks,
): Promise<ChatCompletionResult> {
    // 发送兜底（离线推送）：生成期间在服务端挂一张带心跳租约的保险单，
    // 本地完成即撤销；App 被杀则心跳停跳，服务端接管生成并推送。
    const bailoutRef: ReplyBailoutRef = {
        current: null,
        closed: false,
        superseded: false,
        shortcutHandles: [],
        shortcutCompleted: false,
        shortcutCancelled: false,
    };
    try {
        return await generateChatCompletionCore(session, history, options, callbacks, bailoutRef);
    } catch (err) {
        if (options?.signal?.aborted) bailoutRef.shortcutCancelled = true;
        throw err;
    } finally {
        bailoutRef.closed = true;
        bailoutRef.current?.settle();
        for (const handle of bailoutRef.shortcutHandles) {
            if (bailoutRef.shortcutCompleted || bailoutRef.shortcutCancelled) handle.settle();
            else handle.release();
        }
    }
}

async function generateChatCompletionCore(
    session: ChatSession,
    history: ChatMessage[],
    options: (ChatPromptBuildOptions & { signal?: AbortSignal }) | undefined,
    callbacks: ChatCompletionCallbacks | undefined,
    bailoutRef: ReplyBailoutRef,
): Promise<ChatCompletionResult> {
    const { llmMessages, character, config, preset, regexes, userIdentity, toolsEnabled } = await buildChatPromptMessages(session, history, options);
    const requestAppTags = mergeAppTags(options?.appTags, options?.promptProfile?.appTags, options?.appId ?? "chat");

    // 追问有自己的排期时兜底（followup:key），这里只为普通回复生成挂单。
    // 不 await：挂单失败或慢都不拖累本地生成；生成先结束则通过 closed 标记补撤销。
    if (!session.isGroup && (options?.appId ?? "chat") === "chat" && !(requestAppTags ?? []).includes("followup")) {
        // 云端兜底可能在另一台机器上生成并经真实微信发送。把本轮最后一条
        // 用户输入/系统指令作为因果锚点带过去，避免回复拉回本地后因手机与
        // 云服务器存在亚秒级时钟偏差，被按 createdAt 重排到触发消息前面。
        const replyAfterMessage = [...history].reverse().find(message =>
            message.sessionId === session.id
            && (message.role === "user" || message.mediaType === "system_instruction")
            && Boolean(message.id)
            && Boolean(message.createdAt),
        );
        // 消息数组必须同步定格：下面的工具循环会往 llmMessages 里 splice 中间轮次，
        // 等动态 import 的微任务跑到时数组早就不是这一轮的原样了。组装请求本身
        // 留在微任务里，别把这条热路径上的回复往后拖。
        // 顺带注入快捷动作目录——服务端接管生成时执行不了本地工具循环，但
        // 标记式【快捷动作：名称】push-generate 是认的，不注入角色就只会说"我没有工具"。
        //
        // 这里刻意不挂「结果续跑」快照：普通回复兜底是每条消息都要挂一次的，
        // 续跑快照会把上传体积翻倍（两份完整提示词），提示词大时会撞上服务端
        // 900KB 上限（app/api/push/jobs/route.ts），一撞就是整条兜底挂不上、
        // 静默丢掉离线回复——为了第二轮续跑赔掉第一轮，不划算。冷场重连与定时
        // 唤醒是低频任务，那两条照常挂续跑。
        const bailoutMessages = [...llmMessages];
        // 这条路径不挂续跑（见上），所以也不能向角色承诺第二轮
        maybeAppendShortcutCapability(bailoutMessages, { continuationAvailable: false });
        void import("./push-bailout-client").then(async mod => {
            const handle = await mod.armReplyBailout({
                sessionId: session.id,
                characterName: character.name,
                userName: userIdentity?.name,
                regexes,
                request: buildProviderRequest(config, preset, toLlmRequestMessages(bailoutMessages)),
                replyAfter: replyAfterMessage
                    ? { localMessageId: replyAfterMessage.id, createdAt: replyAfterMessage.createdAt }
                    : undefined,
                signal: options?.signal,
            });
            if (!handle) return;
            if (bailoutRef.closed || bailoutRef.superseded) handle.settle();
            else bailoutRef.current = handle;
        }).catch(() => undefined);
    }

    if (toolsEnabled && nativeToolProtocolForConfig(config) && getEnabledTools(options?.appId ?? "chat").length > 0) {
        return generateNativeChatCompletion({
            session,
            llmMessages,
            character,
            config,
            preset,
            regexes,
            userIdentity,
            options,
            callbacks,
            bailoutRef,
        });
    }

    // ── Tool calling loop with real-time callbacks ──
    const parts: ChatCompletionPart[] = [];
    const meta = { characterName: character.name, userName: userIdentity?.name };
    const actionContext = { characterId: session.contactId, sessionId: session.id, sourceEngine: "chat" as const, signal: options?.signal };

    const maxToolRounds = getMaxToolRounds();
    const onlineThinking = {
        enabled: preset?.online_thinking_enabled === true,
        tag: preset?.online_thinking_tag?.trim() || "thinking",
        reasoning: undefined as string | undefined,
    };
    for (let round = 0; round < maxToolRounds; round++) {
        let filteredOutput: string;
        try {
            if (isSessionStreamingEnabled(session, true)) {
                // 流式分支：与 sendLLMRequest 走同一套请求构造/日志/正则，仅把「整段等待」换成
                // SSE 增量，并通过 onStreamDelta 把原文增量实时交给 UI 层做预览显示。
                let streamReasoning = "";
                const streamResult = await sendLLMStreamRequest(config, preset, llmMessages, regexes, meta, {
                    appId: options?.appId ?? "chat",
                    appTags: requestAppTags,
                    followUpCount: options?.followUpCount,
                    debugSessionId: session.id,
                    signal: options?.signal,
                }, {
                    onDelta: (text) => callbacks?.onStreamDelta?.(text),
                    // 流式下 onReasoningDelta 是单段增量：累积后再喂 onReasoning（保持整段请求语义）
                    // 预设开启「线上标签解析」时不透传原生思维链（改由下方标签提取）
                    onReasoningDelta: onlineThinking.enabled ? undefined : (text) => { streamReasoning += text; callbacks?.onReasoning?.(streamReasoning); },
                });
                filteredOutput = streamResult.content;
            } else {
                filteredOutput = await sendLLMRequest(config, preset, llmMessages, regexes, meta, {
                    appId: options?.appId ?? "chat",
                    appTags: requestAppTags,
                    followUpCount: options?.followUpCount,
                    debugSessionId: session.id,
                    signal: options?.signal,
                    // 预设开启「线上标签解析」时不透传原生思维链（改由下方标签提取）
                    onReasoning: onlineThinking.enabled ? undefined : callbacks?.onReasoning,
                });
            }
        } catch (err) {
            const errMsg = `⚠️ 回复生成失败: ${err instanceof Error ? err.message : String(err)}`;
            if (parts.length > 0) {
                throwIfAborted(options?.signal);
                callbacks?.onToolNotice?.(errMsg);
                parts.push({ text: "", toolNotice: errMsg });
                break;
            }
            throw err;
        }
        throwIfAborted(options?.signal);

        // 线上思维链标签解析：开启时每轮从正文提取 <tag> 思维链（覆盖原生），并剥离标签后再做后续解析
        if (onlineThinking.enabled) {
            const tagThinking = extractThinkingTag(filteredOutput, onlineThinking.tag);
            if (tagThinking) {
                onlineThinking.reasoning = tagThinking;
                callbacks?.onReasoning?.(tagThinking);
            }
            filteredOutput = stripOnlineThinkingTag(filteredOutput, onlineThinking.tag);
        }
        // 剔除预设配置的文本片段（<思考结束> 等残留标签），不进入消息/提示词
        filteredOutput = stripPresetTexts(filteredOutput, preset);

        // Parse actions (朋友圈 etc) — strip from display text but keep tool tags
        const { cleanText: afterActionStrip, actions } = parseActionTags(filteredOutput);
        if (actions.length > 0) {
            throwIfAborted(options?.signal);
            dispatchActions(actions, actionContext).catch(err => console.warn("[ChatEngine] Action dispatch failed:", err));
        }

        // Check for [获取指令:xxx] and [执行动作:xxx({...})]
        const toolFetches = toolsEnabled ? parseToolFetches(afterActionStrip) : [];
        const { toolCalls } = toolsEnabled ? parseToolCalls(afterActionStrip) : { toolCalls: [] };
        const assistantForToolContext = stripStateAndInnerForPrompt(filteredOutput);

        // No tool activity — final round
        if (toolFetches.length === 0 && toolCalls.length === 0) {
            throwIfAborted(options?.signal);
            await callbacks?.onTextPart?.(afterActionStrip);
            parts.push({ text: afterActionStrip });
            if (bailoutRef.shortcutHandles.length > 0) bailoutRef.shortcutCompleted = true;
            break;
        }

        // Store ordinary prose as normal assistant messages. The directive itself is a
        // separate hidden tool_call record in the same response batch.
        throwIfAborted(options?.signal);
        const responseBatchId = createResponseBatchId();
        const toolDirectiveText = extractTextToolDirectiveText(afterActionStrip);
        await callbacks?.onTextPart?.(afterActionStrip, undefined, {
            responseBatchId,
            rawResponseText: afterActionStrip,
        });
        if (toolDirectiveText) {
            callbacks?.onToolAssistantTurn?.(toolDirectiveText, { responseBatchId });
        }
        parts.push({ text: filteredOutput });

        // Helper: find insert index for injecting after history
        const findInsertIdx = () => {
            for (let i = llmMessages.length - 1; i >= 0; i--) {
                if (llmMessages[i]._debugMeta?._fromHistory) return i + 1;
            }
            return llmMessages.length;
        };

        // Handle [获取指令:xxx] — local parameter schema lookup
        if (toolFetches.length > 0) {
            for (const fetch of toolFetches) {
                throwIfAborted(options?.signal);
                const actorName = fetch.actor || character.name;
                const toolNotice = `${actorName}正在获取「${fetch.name}」指令...`;
                callbacks?.onToolNotice?.(toolNotice);

                const tool = findEnabledToolForSchema(fetch.name, options?.appId ?? "chat", {
                    characterName: character.name,
                    userName: userIdentity?.name ?? "用户",
                });
                const schemaContent = tool
                    ? formatToolSchema(tool, {
                        characterName: character.name,
                        userName: userIdentity?.name ?? "用户",
                    })
                    : `以下是你获取指令的返回结果：\n动作类别「${fetch.name}」未找到，请检查名称。`;

                // Persist to history + inject into messages
                throwIfAborted(options?.signal);
                callbacks?.onToolResult?.(schemaContent);
                const idx = findInsertIdx();
                llmMessages.splice(idx, 0,
                    { role: "assistant", content: assistantForToolContext, _debugMeta: { _fromHistory: true } },
                    { role: "user", content: schemaContent, _debugMeta: { _fromHistory: true } },
                );
            }
            continue; // Next round — LLM will now call the tool with params
        }

        // Handle [执行动作:xxx({...})] — execute calls
        if (toolCalls.length > 0) {
            const actorName = toolCalls[0]?.actor || character.name;
            const toolNotice = `${actorName}正在${toolCalls.map(t => t.name).join("、")}...`;
            callbacks?.onToolNotice?.(toolNotice);

            let results: Awaited<ReturnType<typeof executeToolCalls>>;
            try {
                const onlyToolCall = toolCalls.length === 1 ? toolCalls[0] : undefined;
                results = await executeToolCalls(toolCalls, {
                    appId: options?.appId ?? "chat",
                    sessionId: session.id,
                    characterId: session.contactId,
                    sourceEngine: "chat",
                    signal: options?.signal,
                    onShortcutCommandCreated: onlyToolCall ? async command => {
                        const resultMarker = `__FLOAT_SHORTCUT_RESULT_${command.id}__`;
                        const wantsImage = command.resultMode === "image";
                        const imageMarker = wantsImage && config.enableImageRecognition
                            ? `__FLOAT_SHORTCUT_IMAGE_${command.id}__`
                            : undefined;
                        const snapshotMessages = [...llmMessages];
                        const insertions: LLMMessage[] = [
                            { role: "assistant", content: assistantForToolContext, _debugMeta: { _fromHistory: true } },
                            { role: "user", content: resultMarker, _debugMeta: { _fromHistory: true } },
                            ...(imageMarker
                                ? [{ role: "user" as const, content: imageMarker, _debugMeta: { _fromHistory: true } }]
                                : wantsImage ? [{ role: "user" as const, content: SHORTCUT_VISION_OFF_NOTE, _debugMeta: { _fromHistory: true } }] : []),
                        ];
                        snapshotMessages.splice(findInsertIdx(), 0, ...insertions);
                        return registerShortcutContinuation(bailoutRef, {
                            command,
                            style: "text",
                            resultMarker,
                            imageMarker,
                            request: buildProviderRequest(config, preset, toLlmRequestMessages(snapshotMessages)),
                            session,
                            character,
                            userName: userIdentity?.name,
                            regexes,
                            appId: options?.appId,
                            appTags: requestAppTags,
                        });
                    } : undefined,
                });
                throwIfAborted(options?.signal);
                const resultNotices = results.map(r => r.userNotice || (r.success ? `✓ ${r.name} 执行成功` : `✗ ${r.name}: ${r.error}`)).join("；");
                callbacks?.onToolNotice?.(resultNotices);
            } catch (err) {
                throwIfAborted(options?.signal);
                const errMsg = `⚠️ 动作执行失败: ${err instanceof Error ? err.message : String(err)}`;
                callbacks?.onToolNotice?.(errMsg);
                parts.push({ text: "", toolNotice: errMsg });
                break;
            }

            const resultsForHistory = results.filter(r => r.persistToHistory !== false);
            const resultsForContinuation = results.filter(r => r.continueConversation !== false);
            const toolResultContent = resultsForHistory.length > 0 ? formatToolResults(resultsForHistory) : "";
            throwIfAborted(options?.signal);
            const toolExecutionId = createToolExecutionId();
            callbacks?.onToolExecution?.(results, toolResultContent || undefined, { toolExecutionId });

            if (toolResultContent && resultsForContinuation.length > 0) {
                throwIfAborted(options?.signal);
                callbacks?.onToolResult?.(toolResultContent, { toolExecutionId });
                const idx = findInsertIdx();
                const insertions: LLMMessage[] = [
                    { role: "assistant", content: assistantForToolContext, _debugMeta: { _fromHistory: true } },
                    { role: "user", content: toolResultContent, _debugMeta: { _fromHistory: true } },
                ];
                if (config.enableImageRecognition) {
                    for (const r of results) {
                        for (const att of r.mediaAttachments || []) {
                            throwIfAborted(options?.signal);
                            if (att.type !== "image" || !att.url) continue;
                            try {
                                const dataUrl = await resolveCompressedImageDataUrl(att.url);
                                if (!dataUrl) continue;
                                if (dataUrl.startsWith("data:image/")) {
                                    insertions.push({
                                        role: "user",
                                        content: [
                                            { type: "text", text: "系统记录：这是你刚才生成的图片。" },
                                            { type: "image_url", image_url: { url: dataUrl, detail: "low" } },
                                        ],
                                    });
                                }
                            } catch { /* skip */ }
                        }
                    }
                }
                llmMessages.splice(idx, 0, ...insertions);
            }

            if (resultsForContinuation.length === 0) {
                break;
            }

            // Last round — one final call
            if (round === maxToolRounds - 1) {
                try {
                    let finalOutput: string;
                    if (isSessionStreamingEnabled(session, true)) {
                        let streamReasoning = "";
                        const streamFinal = await sendLLMStreamRequest(config, preset, llmMessages, regexes, meta, {
                            appId: options?.appId ?? "chat",
                            appTags: requestAppTags,
                            followUpCount: options?.followUpCount,
                            debugSessionId: session.id,
                            signal: options?.signal,
                        }, {
                            onDelta: (text) => callbacks?.onStreamDelta?.(text),
                            // 流式下 onReasoningDelta 是单段增量：累积后再喂 onReasoning（保持整段请求语义）。
                            // 预设开启「线上标签解析」时不透传原生思维链（改由下方标签提取）
                            onReasoningDelta: onlineThinking.enabled ? undefined : (text) => { streamReasoning += text; callbacks?.onReasoning?.(streamReasoning); },
                        });
                        finalOutput = streamFinal.content;
                    } else {
                        finalOutput = await sendLLMRequest(config, preset, llmMessages, regexes, meta, {
                            appId: options?.appId ?? "chat",
                            appTags: requestAppTags,
                            followUpCount: options?.followUpCount,
                            debugSessionId: session.id,
                            signal: options?.signal,
                            onReasoning: onlineThinking.enabled ? undefined : callbacks?.onReasoning,
                        });
                    }
                    throwIfAborted(options?.signal);
                    // 线上思维链标签解析：开启时从正文提取 <tag> 思维链并剥离标签
                    if (onlineThinking.enabled) {
                        const tagThinking = extractThinkingTag(finalOutput, onlineThinking.tag);
                        if (tagThinking) callbacks?.onReasoning?.(tagThinking);
                        finalOutput = stripOnlineThinkingTag(finalOutput, onlineThinking.tag);
                    }
                    // 剔除预设配置的文本片段（<思考结束> 等残留标签）
                    finalOutput = stripPresetTexts(finalOutput, preset);
                    await callbacks?.onTextPart?.(finalOutput);
                    parts.push({ text: finalOutput });
                    if (bailoutRef.shortcutHandles.length > 0) bailoutRef.shortcutCompleted = true;
                } catch (err) {
                    throwIfAborted(options?.signal);
                    const errMsg = `⚠️ 回复生成失败: ${err instanceof Error ? err.message : String(err)}`;
                    callbacks?.onToolNotice?.(errMsg);
                    parts.push({ text: "", toolNotice: errMsg });
                }
            }
        }
    }

    // Memory: increment event counter + check if summarization needed (non-blocking)
    (async () => {
        try {
            incrementEventCounter(character.id); // user message
            incrementEventCounter(character.id); // AI reply
            await maybeRunSummarization(character.id, character.name);
        } catch (err) {
            console.warn("[ChatEngine] Memory counter/summarization failed:", err);
        }
    })();

    return { parts };
}

/**
 * Preview-only: assembles the full prompt payload without sending an API request.
 * Reuses the same binding resolution logic as generateChatCompletion.
 */
export async function previewPromptPayload(
    session: ChatSession,
    history: ChatMessage[],
    options?: ChatPromptBuildOptions & { followUpAuto?: boolean }
): Promise<{ messages: LLMMessage[]; characterName: string; model: string; presetName: string }> {
    // Auto-resolve follow-up count/delay from current schedule
    if (options?.followUpAuto) {
        const sched = loadFollowUpSchedule(session.id);
        options = {
            ...options,
            followUpCount: (sched?.count ?? 0) + 1,
            followUpDelay: sched?.delaySec ?? 60,
        };
    }

    // Inject follow-up silence markers so preview matches actual API call
    let effectiveHistory = history;
    if (options?.followUpCount && options.followUpCount > 0) {
        const lastUserMsg = [...history].reverse().find(m => m.role === "user");
        const lastUserTime = lastUserMsg ? new Date(lastUserMsg.createdAt).getTime() : Date.now();
        const annotated: ChatMessage[] = [];
        let currentRound = 0;
        for (const msg of history) {
            if (msg.role === "assistant" && msg.followUpIndex && msg.followUpIndex > currentRound) {
                currentRound = msg.followUpIndex;
                const markerTime = new Date(msg.createdAt).getTime();
                const silenceSec = Math.round((markerTime - lastUserTime) / 1000);
                annotated.push({
                    id: `_marker_${currentRound}_${Date.now()}`,
                    sessionId: session.id,
                    role: "user",
                    content: `[对方没有回复你的消息，距上次回复已过约${silenceSec}秒]`,
                    status: "sent",
                    createdAt: msg.createdAt,
                });
            }
            annotated.push(msg);
        }
        const nowMs = Date.now();
        const finalSilenceSec = Math.round((nowMs - lastUserTime) / 1000);
        annotated.push({
            id: `_silence_${nowMs}`,
            sessionId: session.id,
            role: "system",
            content: `[对方没有回复你的消息，距上次回复已过约${finalSilenceSec}秒]`,
            status: "sent",
            createdAt: new Date().toISOString(),
        });
        effectiveHistory = annotated;
    }

    // Use the SAME shared builder as generateChatCompletion
    const { llmMessages, character, config, preset } = await buildChatPromptMessages(session, effectiveHistory, options);

    const apiMessages = previewMessagesForApi(config, preset, llmMessages);

    return {
        messages: apiMessages,
        characterName: character.name,
        model: config.defaultModel,
        presetName: preset?.name ?? "(无预设)",
    };
}

export async function previewPromptRequestSnapshot(
    session: ChatSession,
    history: ChatMessage[],
    options?: ChatPromptBuildOptions & { followUpAuto?: boolean },
): Promise<DebugPromptSnapshot> {
    if (options?.followUpAuto) {
        const sched = loadFollowUpSchedule(session.id);
        options = {
            ...options,
            followUpCount: (sched?.count ?? 0) + 1,
            followUpDelay: sched?.delaySec ?? 60,
        };
    }

    let effectiveHistory = history;
    if (options?.followUpCount && options.followUpCount > 0) {
        const lastUserMsg = [...history].reverse().find(m => m.role === "user");
        const lastUserTime = lastUserMsg ? new Date(lastUserMsg.createdAt).getTime() : Date.now();
        const annotated: ChatMessage[] = [];
        let currentRound = 0;
        for (const msg of history) {
            if (msg.role === "assistant" && msg.followUpIndex && msg.followUpIndex > currentRound) {
                currentRound = msg.followUpIndex;
                const markerTime = new Date(msg.createdAt).getTime();
                const silenceSec = Math.round((markerTime - lastUserTime) / 1000);
                annotated.push({
                    id: `_marker_${currentRound}_${Date.now()}`,
                    sessionId: session.id,
                    role: "user",
                    content: `[对方没有回复你的消息，距上次回复已过约${silenceSec}秒]`,
                    status: "sent",
                    createdAt: msg.createdAt,
                });
            }
            annotated.push(msg);
        }
        const nowMs = Date.now();
        const finalSilenceSec = Math.round((nowMs - lastUserTime) / 1000);
        annotated.push({
            id: `_silence_${nowMs}`,
            sessionId: session.id,
            role: "system",
            content: `[对方没有回复你的消息，距上次回复已过约${finalSilenceSec}秒]`,
            status: "sent",
            createdAt: new Date().toISOString(),
        });
        effectiveHistory = annotated;
    }

    const { llmMessages, character, config, preset, userIdentity, toolsEnabled } = await buildChatPromptMessages(session, effectiveHistory, options);
    const requestMessages = toLlmRequestMessages(llmMessages);
    const enabledTools = toolsEnabled ? getEnabledTools(options?.appId ?? "chat") : [];
    const meta = { characterName: character.name, userName: userIdentity?.name };

    if (nativeToolProtocolForConfig(config) && enabledTools.length > 0) {
        const persistedSession = loadChatSessions().find(item => item.id === session.id);
        const expandedSourceIds = normalizeNativeExpandedToolSourceIds(
            persistedSession?.nativeExpandedToolSourceIds || session.nativeExpandedToolSourceIds,
            enabledTools,
        );
        const nativeBundle = buildNativeChatTools(enabledTools, expandedSourceIds, {
            characterName: character.name,
            userName: userIdentity?.name ?? "用户",
        });
        const request = buildProviderRequest(config, preset, requestMessages, { tools: nativeBundle.definitions });
        return publishDebugPromptSnapshot({
            request,
            config,
            preset,
            meta,
            options: {
                appId: options?.appId ?? "chat",
                appTags: options?.appTags,
                debugSessionId: session.id,
            },
            requestKind: "native-tools",
            tools: nativeBundle.definitions,
        });
    }

    const request = buildProviderRequest(config, preset, requestMessages);
    return publishDebugPromptSnapshot({
        request,
        config,
        preset,
        meta,
        options: {
            appId: options?.appId ?? "chat",
            appTags: options?.appTags,
            debugSessionId: session.id,
        },
        requestKind: "completion",
    });
}
