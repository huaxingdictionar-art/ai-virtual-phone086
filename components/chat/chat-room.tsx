"use client";

import { forwardRef, Fragment, memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChatSession, ChatMessage, CHAT_APP_SETTINGS_UPDATED_EVENT, CHAT_INITIAL_VISIBLE_MESSAGE_COUNT, CHAT_LOAD_MORE_MESSAGE_COUNT, CHAT_REQUEST_REPLY_EVENT, loadChatAppSettings, loadChatMessages, loadChatContacts, loadChatSessions, saveChatSessions, pushChatMessage, updateChatMessage, deleteChatMessage, deleteChatMessagesFrom, deleteChatMessagesByIds, retractChatMessage, editChatMessage, updateMessageMediaData, replaceResponseBatchWithParts, replaceGroupResponseRound, replaceChatSessionMessages, isReadingDiscussMessage, isSystemInstructionMessage, createResponseBatchId, createResponseRoundId, getLatestStateValues, getLatestCharacterStateValues, compareChatMessages, isSessionStreamingEnabled } from "@/lib/chat-storage";
import { cleanStreamText, splitStreamPreviewSegments, stripLiteralTexts, stripXmlTagBlocks } from "@/lib/stream-preview";
import type { StateValue } from "@/lib/chat-storage";
import { parseStateValues, mergeStateValues } from "@/lib/state-value-parser";
import { parseAIResponse, type ParsedMessagePart } from "@/lib/rich-message-parser";
import { isKnownStickerLabel } from "@/lib/sticker-data";
import { translateReasoningText } from "@/lib/reasoning-translate";
import { MessageBubble, MediaDetailModal, prewarmStickerCache, BilingualTextBlock, isStandaloneHtmlPreviewContent, normalizeTextBubbleContent } from "./message-bubble";
import { GeneratedImageErrorDialog } from "./generated-image-error-dialog";
import { PhotoInputModal, TextPhotoModal, VoiceRecordModal, RedPacketModal, LocationInputModal, SystemInstructionModal } from "./rich-input-modals";
import { EmojiPanel, StickerPanel } from "./emoji-panel";
import { StickerSearchSuggest } from "./sticker-search-suggest";
import { StateValuesPanel } from "./state-values-panel";
import { generateChatCompletion, generateOfflineChatCompletion, flattenCompletionResult, ChatEngineError } from "@/lib/chat-engine";
import { formatOfflineTurnXml as formatOfflineTurnXmlShared, buildOfflinePromptHistory as buildOfflinePromptHistoryShared } from "@/lib/offline-prompt-builder";
import { getStatusRegionConfig, isCustomStatusRegionActive } from "@/lib/chat-status-region";
import { CustomStatusFrame } from "@/components/chat/custom-status-frame";
import { sendBrowserNotification } from "@/lib/browser-notification";
import { dispatchChatMessageNotice } from "@/lib/chat-notification-events";
import { shouldSendChatInputOnEnter } from "@/lib/chat-input-keyboard";
import { useChatBottomReserve } from "./use-chat-bottom-reserve";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import { createPortal } from "react-dom";

import { loadCharacters } from "@/lib/character-storage";
import { Character } from "@/lib/character-types";
import { loadCustomAppChatPlusActions, type RegisteredCustomAppChatPlusAction } from "@/lib/custom-app-chat-directives";
import { CUSTOM_APPS_UPDATED_EVENT, getInstalledCustomApp } from "@/lib/custom-app-storage";
import { toCustomAppIconId, type InstalledCustomApp } from "@/lib/custom-app-types";
import { CustomAppRunner } from "@/components/app-market/custom-app-runner";
import { CustomAppForegroundBoundary } from "@/components/app-market/custom-app-failure";

import { ChatSettingsPanel } from "./chat-settings-panel";
import { VoiceCallScreen } from "./voice-call-screen";
import { VideoCallScreen } from "./video-call-screen";
import { GroupCallScreen } from "./group-call-screen";
import { TransferTargetModal } from "./transfer-target-modal";
import { GiftPickerModal } from "./gift-picker-modal";
import { ConfirmDialog } from "@/components/ui/modal";
import { deleteWeixinCloudMessagesFromCloud, emitWeixinSyncToast, syncAllWeixinBotRuntimesToCloud } from "@/lib/weixin-cloud-sync";
import { loadBindingConfig, loadPresets, loadRegexes, resolveBinding, resolveUserIdentity } from "@/lib/settings-storage";
import { generateGroupChatCompletion, generateGroupOfflineChatCompletion, parseGroupChatResponse, buildEditableGroupRoundText } from "@/lib/group-chat-engine";
import { appendChatOfflineTurn, deleteChatOfflineTurn, deleteChatOfflineTurnsFrom, extractThinkingTag, loadChatOfflineTurns, parseOfflineResponse, saveChatOfflineTurns, updateChatOfflineTurn, type ChatOfflineTurn } from "@/lib/chat-offline-storage";
import { applyDisplayRegex, applyEditRegex } from "@/lib/llm-prompt-assembler";
import { scheduleFollowUp, cancelFollowUp, cancelBackgroundGeneration, isBackgroundReplyGenerating } from "@/lib/follow-up-service";
import { useKeyboardDismissAutoSend } from "@/components/chat/use-keyboard-dismiss-auto-send";
import { cancelBailoutKey } from "@/lib/push-bailout-client";
import { PENDING_REPLY_PREFIX } from "@/lib/friend-request-engine";
import { OfflineInviteModal, OfflineInviteCapsule, getRemainingMinutes, type OfflineInviteData } from "./offline-invite-modal";
import type { UserIdentity } from "@/components/settings/user-identity";
import { AlertCircle, Blocks, Check, Trash2, User, ChevronLeft, ChevronRight, Clapperboard, Clock, Gift, Languages, Loader2, MoreHorizontal, X } from "lucide-react";
import { setDebugChatState } from "@/lib/debug-store";
import { SessionCustomCSS } from "@/components/ui/session-custom-css";
import { downloadFile } from "@/lib/download-utils";
import { setChatActive } from "@/lib/music-action-queue";
import { getMusicControlBridge } from "@/lib/music-control-bridge";
import { findPlayableMatch, getNeteaseLyrics, getNeteaseSongDetail } from "@/lib/music-service";
import { approveMemoryWriteRequest } from "@/lib/tool-executor";
import type { MemoryWriteRequest, ToolResult } from "@/lib/tool-executor";
import { formatChatUiTime } from "@/lib/chat-time";
import { parseActionTags } from "@/lib/action-parser";
import { kvGet, kvSet, kvRemove } from "@/lib/kv-db";
import { creditWalletBalance, payWithWalletBalance } from "@/lib/wallet-storage";
import { loadDeliveredShoppingGifts, type ShoppingGiftCandidate } from "@/lib/shopping-gift-utils";
import { settleShoppingPaymentRequest } from "@/lib/shopping-payment-request";
import type { RegexConfig } from "@/lib/settings-types";
import { MacroEngine } from "@/lib/macro-engine";
import {
    createPendingChatGeneratedImageData,
    generateAndApplyChatGeneratedImage,
    isPendingChatGeneratedImageMessage,
} from "@/lib/generated-image-retry";
import { scrollElementWithinContainer } from "@/lib/dom-scroll";
import { ChatFallbackAvatar } from "./chat-fallback-avatar";
import { ChatScreenEffectOverlay, type ActiveScreenEffect } from "./chat-screen-effect";
import {
    formatChatDiceResultMessage,
    isDiceOnlyMessage,
    matchChatScreenEffectRule,
    rollChatDiceFace,
} from "@/lib/chat-screen-effects";
import { abortableDelay, throwIfAborted } from "@/lib/abort-utils";
import { GROUP_SELF_KEY, canGroupAdminAct, applyGroupAdminAction, buildGroupAdminNoticeText, getGroupMemberDisplayName, getGroupMuteRemainingMs, getGroupRole, isGroupMuted, formatMuteRemainingLabel, resolveGroupMemberKeyByName, type GroupAdminAction } from "@/lib/group-admin";
import { extractTextToolDirectiveText } from "@/lib/text-tool-protocol";
import { emitChatPluginEvent, getChatPluginHookBus, runChatPluginTransform } from "@/lib/chat-plugin-hooks";
import { CHAT_PLUGIN_TOAST_EVENT, getChatPluginRuntime } from "@/lib/chat-plugin-runtime";
import { ChatPluginSlot } from "@/components/chat/chat-plugin-slot";

// ── Call system message detection ──────────────────────────
// Call messages are stored with user/assistant role for correct prompt alternation,
// but should render as centered system notifications in the UI.
const CALL_SYS_RE = /\[我(?:向.+)?(?:发起了|挂断了|拒绝了|取消了)(?:群?(?:语音|视频)通话)/;
function isCallSysMsg(msg: ChatMessage): boolean {
    return CALL_SYS_RE.test(msg.content);
}
/** Returns the effective UI role: call messages render as "system" regardless of stored role */
const ACTION_MEDIA_TYPES = new Set(["poke", "accept_red_packet", "decline_red_packet", "accept_transfer", "decline_transfer", "accept_payment_request", "decline_payment_request", "group_admin_notice"]);
// 拍一拍/群管理通知/通话留痕渲染成灰色系统小字，没有 💭 面板入口——
// 状态栏/内心独白/状态值挂上去会被显示层吞掉，挂载时必须跳过它们
function canCarryFoldedPanel(part: { content?: string; mediaType?: ChatMessage["mediaType"] }): boolean {
    if (part.mediaType === "poke" || part.mediaType === "group_admin_notice") return false;
    return !CALL_SYS_RE.test(part.content || "");
}
function uiRole(msg: ChatMessage): string {
    if (msg.role === "system" || ACTION_MEDIA_TYPES.has(msg.mediaType || "")) return "system";
    if (isCallSysMsg(msg)) return "system";
    return msg.role;
}

function isChatRoomElementVisible(element: HTMLElement | null): boolean {
    if (!element || !element.isConnected) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden";
}

function splitOfflineParagraphs(text: string): string[] {
    const normalized = text.replace(/\r\n?/g, "\n").trim();
    if (!normalized) return [];
    const splitPlainText = (value: string) => value
        .split(/\n\s*\n+/)
        .map(part => part.trim())
        .filter(Boolean);

    const parts: string[] = [];
    const fenceRx = /(^|\n)([ \t]*)(```|~~~)[^\n]*\n[\s\S]*?\n[ \t]*\3(?=\n|$)/g;
    let cursor = 0;
    let match: RegExpExecArray | null;

    while ((match = fenceRx.exec(normalized)) !== null) {
        const fenceStart = match.index + match[1].length;
        const before = normalized.slice(cursor, fenceStart);
        parts.push(...splitPlainText(before));

        const fencedBlock = normalized.slice(fenceStart, fenceRx.lastIndex).trim();
        if (fencedBlock) parts.push(fencedBlock);
        cursor = fenceRx.lastIndex;
    }

    parts.push(...splitPlainText(normalized.slice(cursor)));
    return parts;
}

function hasOfflineHtmlPreview(text: string): boolean {
    return splitOfflineParagraphs(text).some(part => isStandaloneHtmlPreviewContent(part));
}

const OfflineAssistantTextBlock = memo(function OfflineAssistantTextBlock({
    text,
    defaultExpanded,
}: {
    text: string;
    defaultExpanded: boolean;
}) {
    const paragraphs = useMemo(() => splitOfflineParagraphs(text), [text]);
    if (paragraphs.length <= 1) {
        return <BilingualTextBlock text={text} mode="markdown" defaultExpanded={defaultExpanded} htmlFrameVariant="offline" />;
    }
    return (
        <div className="chat-offline-paragraph-stack">
            {paragraphs.map((paragraph, index) => (
                <div className="chat-offline-paragraph" key={`${index}-${paragraph.slice(0, 16)}`}>
                    <BilingualTextBlock text={paragraph} mode="markdown" defaultExpanded={defaultExpanded} htmlFrameVariant="offline" />
                </div>
            ))}
        </div>
    );
});

const CHAT_VISUAL_MEDIA_TYPES = new Set([
    "sticker",
    "dice",
    "red_packet",
    "transfer",
    "payment_request",
    "gift",
    "contact_card",
    "image",
    "location",
    "music_share",
    "xiaohongshu_note_share",
    "app_card",
    "audio",
    "video",
    "quote",
    "media_file",
]);

const WEIXIN_CLOUD_DELETE_TIMEOUT_MS = 15000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
        promise.then(
            value => {
                window.clearTimeout(timer);
                resolve(value);
            },
            error => {
                window.clearTimeout(timer);
                reject(error);
            },
        );
    });
}

function getWeixinCloudDeleteTargetCount(messages: ChatMessage[]): number {
    const targets = new Set<string>();
    for (const message of messages) {
        const sync = message.cloudSync;
        if (sync?.source !== "weixin-cloud") continue;
        if (!sync.botId || !sync.externalId) continue;
        targets.add(`${sync.botId}\u0000${sync.externalId}`);
    }
    return targets.size;
}

const CHAT_MEDIA_BUBBLE_TYPES = new Set([
    "sticker",
    "dice",
    "red_packet",
    "transfer",
    "payment_request",
    "gift",
    "contact_card",
    "image",
    "location",
    "music_share",
    "xiaohongshu_note_share",
    "app_card",
    "media_file",
]);

const STANDALONE_CARD_BUBBLE_STYLE = {
    background: "transparent",
    border: "none",
    boxShadow: "none",
    backdropFilter: "none",
    WebkitBackdropFilter: "none",
    padding: 0,
    overflow: "visible",
} as const;

function getChatFlowVisibleContent(msg: ChatMessage, displayContent?: string): string {
    return normalizeTextBubbleContent(displayContent ?? msg.content);
}

function isChatVisualMedia(msg: ChatMessage): boolean {
    return !!msg.mediaType && CHAT_VISUAL_MEDIA_TYPES.has(msg.mediaType);
}
/** 思维链触发条的单行摘要：取首个非空行并剥离 markdown 标记（**、`、# 等），避免星号原样显示 */
function reasoningPreviewLine(text: string): string {
    for (const rawLine of text.split("\n")) {
        const line = rawLine
            .replace(/```+/g, "")
            .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
            .replace(/\*\*([^*]+)\*\*/g, "$1")
            .replace(/__([^_]+)__/g, "$1")
            .replace(/\*([^*]+)\*/g, "$1")
            .replace(/`([^`]+)`/g, "$1")
            .replace(/^\s*#{1,6}\s+/, "")
            .replace(/^\s*>\s+/, "")
            .replace(/^\s*[-*+]\s+/, "")
            .replace(/[*`]+/g, "")
            .trim();
        if (line) return line;
    }
    return "思考过程";
}

function isHiddenChatFlowMessage(msg: ChatMessage, displayContent?: string): boolean {
    if (msg.mediaType === "tool_result" || msg.mediaType === "tool_call") return true;
    return !isChatVisualMedia(msg)
        && !getChatFlowVisibleContent(msg, displayContent)
        && uiRole(msg) !== "system"
        && !msg.statusPanel
        && !msg.innerMonologue
        && !msg.reasoningText;
}

// ── Background generation tracking ──────────────────────────
const GENERATING_PREFIX = "chat-generating:";
const CHAT_BG_COMPLETE = "chat-bg-complete";
const CHAT_OFFLINE_MODE_PREFIX = "chat-offline-mode:";
const CHAT_THEATER_MODE_PREFIX = "chat-theater-mode:";
const GENERATING_LOCK_TTL_MS = 5 * 60 * 1000;
const OFFLINE_INITIAL_LOAD = 10;
const OFFLINE_LOAD_MORE_COUNT = 10;

type PendingNativeToolCall = {
    id: string;
    name: string;
};

type ActiveGenerationRun = {
    runId: string;
    controller: AbortController;
    pendingNativeToolCalls: PendingNativeToolCall[];
};

type GenerationRunGuard = {
    signal?: AbortSignal;
    isActive?: () => boolean;
};

type AssistantMessageDraft = Omit<ChatMessage, "id" | "createdAt" | "status"> & { status?: ChatMessage["status"] };

const PENDING_OFFLINE_INVITE_DECLINE_PREFIX = "chat_offline_invite_declined_";
const ACTIVE_OFFLINE_INVITE_PREFIX = "chat_active_offline_invite_";
const OFFLINE_INVITE_ACTIVE_SESSION_PREFIX = "chat_offline_invite_active_session_";

function extractDurationMinutes(text: string, fallback: number = 15): number {
    if (!text) return fallback;

    // 1. 常见小时/半小时/刻钟表达
    if (/(?:一个半小时|1\.5小时|1个半小时)/.test(text)) return 90;
    if (/(?:一个小时|1小时|1个?小时)/.test(text)) return 60;
    if (/(?:半个多小时)/.test(text)) return 40;
    if (/(?:半(?:个)?小时)/.test(text)) return 30;
    if (/(?:一刻钟)/.test(text)) return 15;

    // 2. 华提出的敏锐体验洞察：口语中的“十几分钟/十来分钟”必须精准锚定在 15 分钟（10~20 分钟区间），保持对话与倒计时默契一致！
    if (/(?:十几|十来|十多|一二十)\s*(?:分钟|分)/.test(text)) return 15;
    if (/(?:二三十|二十多|二十来)\s*(?:分钟|分)/.test(text)) return 25;
    if (/(?:三四十|三十多|三十来)\s*(?:分钟|分)/.test(text)) return 35;
    if (/(?:四五十|四十多|四十来)\s*(?:分钟|分)/.test(text)) return 45;
    if (/(?:两三|三两|三五|几)\s*(?:分钟|分)/.test(text)) return 5;

    // 3. 阿拉伯数字 + 分钟 (如 15分钟, 20分, 45 mins)
    const numMatch = text.match(/(\d+)\s*(?:分钟|分|mins?|min)/i);
    if (numMatch) {
        const val = parseInt(numMatch[1], 10);
        if (!isNaN(val) && val > 0 && val <= 180) return val;
    }

    // 4. 中文数字组合 + 分钟 (严格按大数/复合数优先匹配，防止五分钟截胡十五分钟)
    const zhMap: [RegExp, number][] = [
        [/(?:九十五|95)\s*(?:分钟|分)/, 95],
        [/(?:九十分钟|90分钟|九十分)/, 90],
        [/(?:八十五|85)\s*(?:分钟|分)/, 85],
        [/(?:八十分钟|80分钟|八十分)/, 80],
        [/(?:七十五|75)\s*(?:分钟|分)/, 75],
        [/(?:七十分钟|70分钟|七十分)/, 70],
        [/(?:六十五|65)\s*(?:分钟|分)/, 65],
        [/(?:六十分钟|60分钟|六十分)/, 60],
        [/(?:五十五|55)\s*(?:分钟|分)/, 55],
        [/(?:五十分钟|50分钟|五十分)/, 50],
        [/(?:四十五|45)\s*(?:分钟|分)/, 45],
        [/(?:四十分钟|40分钟|四十分)/, 40],
        [/(?:三十五|35)\s*(?:分钟|分)/, 35],
        [/(?:三十分钟|30分钟|三十分)/, 30],
        [/(?:二十五|两十五|25)\s*(?:分钟|分)/, 25],
        [/(?:二十|两十|20)\s*(?:分钟|分)/, 20],
        [/(?:十五|15)\s*(?:分钟|分)/, 15],
        [/(?:十二|12)\s*(?:分钟|分)/, 12],
        [/(?:十分钟|10分钟|十分)/, 10],
        [/(?:八分钟|8分钟|八分)/, 8],
        [/(?:七分钟|7分钟|七分)/, 7],
        [/(?:六分钟|6分钟|六分)/, 6],
        [/(?:五分钟|5分钟|五分)/, 5],
        [/(?:四分钟|4分钟|四分)/, 4],
        [/(?:三分钟|3分钟|三分)/, 3],
        [/(?:两分钟|二分钟|2分钟|两分)/, 2],
        [/(?:一分钟|1分钟|一分)/, 1],
    ];

    for (const [pattern, val] of zhMap) {
        if (pattern.test(text)) {
            return val;
        }
    }

    return fallback;
}

function restoreOfflineInviteFromMessages(
    historyMessages: ChatMessage[],
    fallbackInvite?: OfflineInviteData | null,
    targetRetryMsg?: ChatMessage | null
): OfflineInviteData | null {
    if (fallbackInvite?.sourceBatchId === "mock_offline_invite") {
        return fallbackInvite;
    }

    // 若未传入 fallbackInvite（如单聊刚导入或无 KV 水合）：自动从历史消息中寻找最初发起提议的生命之根
    let baseInvite: OfflineInviteData | null = fallbackInvite ? { ...fallbackInvite } : null;
    if (!baseInvite) {
        const rootMsg = historyMessages.find(m => m.mediaType === "offline_invite" || m.mediaData?.offlineInvite);
        if (!rootMsg || !rootMsg.mediaData?.offlineInvite) {
            return null;
        }
        const data = rootMsg.mediaData.offlineInvite;
        baseInvite = {
            direction: data.direction || "he_comes",
            status: "pending",
            theme: data.theme || "default",
            place: data.place || "约定地点",
            reason: data.reason || "",
            onTheWayMessage: data.onTheWayMessage,
            transitCardMessage: data.transitCardMessage,
            arrivedMessage: data.arrivedMessage,
            arrivalCardMessage: data.arrivalCardMessage,
            durationMinutes: data.durationMinutes || 15,
            initialPlace: data.initialPlace || data.place || "你身边",
            sourceBatchId: rootMsg.responseBatchId || data.sourceBatchId || rootMsg.id,
            initialBatchId: rootMsg.responseBatchId || data.sourceBatchId || rootMsg.id,
        };
    }

    const rootId = baseInvite.initialBatchId || baseInvite.sourceBatchId;
    const hasRoot = rootId
        ? historyMessages.some(m =>
            (m.responseBatchId && m.responseBatchId === rootId) ||
            m.id === rootId ||
            (baseInvite.relatedBatchIds && m.responseBatchId && baseInvite.relatedBatchIds.includes(m.responseBatchId)) ||
            m.mediaData?.offlineInvite ||
            (m.role === "system" && m.content && (
                m.content.includes("你已同意赴约") ||
                m.content.includes("线下赴约提议") ||
                m.content.includes("正在动身赶往") ||
                m.content.includes("已直接动身") ||
                m.content.includes("前往") ||
                m.content.includes("正在重新赶往") ||
                m.content.includes("已到达") ||
                m.content.includes("已提前到达") ||
                m.content.includes("就位等候")
            ))
          )
        : historyMessages.some(m =>
            m.mediaType === "offline_invite" ||
            m.mediaType === "offline_invite_system_notice" ||
            m.mediaType === "offline_invite_arrive_notice" ||
            m.mediaData?.offlineInvite ||
            (m.role === "system" && m.content && (
                m.content.includes("你已同意赴约") ||
                m.content.includes("线下赴约提议") ||
                m.content.includes("正在动身赶往") ||
                m.content.includes("已直接动身") ||
                m.content.includes("前往") ||
                m.content.includes("正在重新赶往") ||
                m.content.includes("已到达") ||
                m.content.includes("已提前到达") ||
                m.content.includes("就位等候")
            ))
          );

    if (!hasRoot && (!baseInvite || !baseInvite.status)) {
        return null;
    }

    let restored: OfflineInviteData = { ...baseInvite };

    // 1. 倒序查找 historyMessages 中最后一条带有碰头地点的变动/邀约消息或系统记录，提取当时的碰头信息
    for (let i = historyMessages.length - 1; i >= 0; i--) {
        const msg = historyMessages[i];
        const data = msg.mediaData?.offlineInvite;
        if (data?.place) {
            restored = {
                ...restored,
                direction: data.direction || baseInvite.direction,
                theme: data.theme || baseInvite.theme || "default",
                place: data.place,
                reason: data.reason || baseInvite.reason,
                onTheWayMessage: data.onTheWayMessage || baseInvite.onTheWayMessage,
                transitCardMessage: data.transitCardMessage || baseInvite.transitCardMessage,
                arrivedMessage: data.arrivedMessage || baseInvite.arrivedMessage,
                arrivalCardMessage: data.arrivalCardMessage || baseInvite.arrivalCardMessage,
                durationMinutes: data.timeStr ? extractDurationMinutes(data.timeStr, baseInvite.durationMinutes || 15) : (data.durationMinutes || baseInvite.durationMinutes),
                sourceBatchId: msg.responseBatchId || data.sourceBatchId || baseInvite.sourceBatchId,
            };
            break;
        }

        // 兜底：从系统小灰字记录中精准提取当时的碰头地点！
        if (msg.role === "system" && msg.content) {
            const placeMatch = msg.content.match(/(?:赴约(?:提议)?地点已更改为|正在动身赶往|前往|正在重新赶往|已(?:提前|如约)?到达|已在)[「"“]([^」"”]+)[」"”]/) ||
                               msg.content.match(/(?:赴约(?:提议)?地点已更改为|正在动身赶往|前往|正在重新赶往|已(?:提前|如约)?到达|已在)(你身边)/);
            if (placeMatch && placeMatch[1]) {
                restored.place = placeMatch[1].trim();
                break;
            }
        }
    }

    // 2. 华敏锐洞察的卡片台词同步与原版定制心语继承铁律：
    // 若在历史中曾经为该地点生成过专属的心语（非机械模板），优先继承原版台词，彻底杜绝人机感！
    let hasCustomTextForPlace = false;
    if (restored.place) {
        for (let i = historyMessages.length - 1; i >= 0; i--) {
            const data = historyMessages[i].mediaData?.offlineInvite;
            if (data?.place === restored.place && (data.transitCardMessage || data.arrivalCardMessage)) {
                if (data.transitCardMessage) restored.transitCardMessage = data.transitCardMessage;
                if (data.arrivalCardMessage) restored.arrivalCardMessage = data.arrivalCardMessage;
                if (data.onTheWayMessage) restored.onTheWayMessage = data.onTheWayMessage;
                if (data.arrivedMessage) restored.arrivedMessage = data.arrivedMessage;
                hasCustomTextForPlace = true;
                break;
            }
        }
    }

    // 若地点发生了回退变动且历史中没有任何专属台词，才使用通用温情文案兜底
    if (!hasCustomTextForPlace && restored.place && baseInvite.place && restored.place !== baseInvite.place) {
        const p = restored.place === "你身边" ? "你身边" : `「${restored.place}」`;
        if (restored.direction === "he_comes") {
            restored.transitCardMessage = `正重新赶往${p}的途中，稍候片刻。`;
            restored.onTheWayMessage = `我正往${p}赶呢，一会儿就到。`;
            restored.arrivedMessage = `我已经到${p}了，在附近等你，不用着急慢慢走。`;
            restored.arrivalCardMessage = `已经赶到${p}了，在安静等候你，慢慢走别急。`;
        } else {
            restored.arrivalCardMessage = `已经在${p}坐下了，不着急慢慢来。`;
            restored.arrivedMessage = `我在${p}等你过来呢。`;
        }
    }

    // 3. 核心因果链修复：状态判定必须以历史中【最后发生的事件】为准！
    // 坚决杜绝旧地点的旧到达记录污染后续新地点的在途状态！
    let lastArriveIdx = -1;
    for (let i = historyMessages.length - 1; i >= 0; i--) {
        const m = historyMessages[i];
        if (
            m.mediaType === "offline_invite_early_arrive" ||
            m.mediaType === "offline_invite_arrive_notice" ||
            m.mediaData?.offlineInvite?.status === "arrived" ||
            (m.role === "system" && m.content && (m.content.includes("已提前到达") || m.content.includes("已如约到达") || (m.content.includes("已在") && m.content.includes("就位等候"))))
        ) {
            lastArriveIdx = i;
            break;
        }
    }

    let lastMovingIdx = -1;
    for (let i = historyMessages.length - 1; i >= 0; i--) {
        const m = historyMessages[i];
        if (
            m.mediaType === "offline_invite_change_place" ||
            m.mediaData?.offlineInvite?.status === "on_the_way" ||
            (m.role === "system" && m.content && (m.content.includes("正在重新赶往") || m.content.includes("赴约地点已更改为") || m.content.includes("正在动身赶往") || m.content.includes("你已同意赴约")))
        ) {
            lastMovingIdx = i;
            break;
        }
    }

    const hasAcceptedInHistory = historyMessages.some(m =>
        m.role === "system" && m.content && m.content.includes("你已同意赴约")
    );

    if (lastArriveIdx > lastMovingIdx && lastArriveIdx !== -1) {
        restored.status = "arrived";
        const arriveMsg = historyMessages[lastArriveIdx];
        restored.isEarlyArrived = Boolean(
            arriveMsg.mediaType === "offline_invite_early_arrive" ||
            arriveMsg.mediaData?.offlineInvite?.isEarlyArrived ||
            (arriveMsg.role === "system" && arriveMsg.content && arriveMsg.content.includes("已提前到达"))
        );
    } else {
        restored.isEarlyArrived = false;
        if (restored.direction === "i_go") {
            restored.status = "pending";
            restored.startTime = undefined;
        } else if (hasAcceptedInHistory && restored.direction === "he_comes") {
            restored.status = "on_the_way";
            const duration = restored.durationMinutes || 15;
            const agreeIdx = historyMessages.findIndex(m => m.role === "system" && m.content && m.content.includes("你已同意赴约"));
            const agreeMsg = agreeIdx !== -1 ? historyMessages[agreeIdx] : null;
            const messagesAfterAgree = agreeIdx !== -1 ? historyMessages.slice(agreeIdx + 1) : [];

            // 🌸 华确立的物理时间锚点法则与单调递减铁律：
            // 若当前已有在途中赴约且拥有有效物理 startTime，
            // 并且并非处于【用户显式重试/回溯指定消息（targetRetryMsg 存在）】的场景下，
            // 绝对保持原有的真实 startTime，绝不被任何历史消息快照逆流篡改！
            if (!targetRetryMsg && baseInvite?.status === "on_the_way" && baseInvite.startTime) {
                restored.startTime = baseInvite.startTime;
                restored.durationMinutes = baseInvite.durationMinutes || duration;
                restored.status = "on_the_way";
                return restored;
            }

            // 1. 最高优先：检查当前被重试的目标消息（那一轮专属的定格时间），或在显式重试模式下倒序查找目标点之前的在途定格时间！
            let stampedMsg: ChatMessage | null = null;
            if (targetRetryMsg && targetRetryMsg.role === "assistant" && (targetRetryMsg.mediaData?.inTransitRemainingSeconds || targetRetryMsg.mediaData?.inTransitRemainingMinutes)) {
                stampedMsg = targetRetryMsg;
            } else if (targetRetryMsg) {
                for (let i = historyMessages.length - 1; i >= 0; i--) {
                    const m = historyMessages[i];
                    if (m.role === "assistant" && (m.mediaData?.inTransitRemainingSeconds || m.mediaData?.inTransitRemainingMinutes)) {
                        stampedMsg = m;
                        break;
                    }
                }
            }

            if (stampedMsg && (stampedMsg.mediaData?.inTransitRemainingSeconds || stampedMsg.mediaData?.inTransitRemainingMinutes)) {
                // 命中该轮历史消息定格时间：毫秒级精准断点续存！
                const remSec = stampedMsg.mediaData.inTransitRemainingSeconds ?? ((stampedMsg.mediaData.inTransitRemainingMinutes || 15) * 60);
                const remMins = stampedMsg.mediaData.inTransitRemainingMinutes || Math.max(1, Math.ceil(remSec / 60));
                const targetDuration = Math.max(duration, remMins);
                restored.durationMinutes = targetDuration;
                const elapsedSec = Math.max(0, (targetDuration * 60) - remSec);
                restored.startTime = Date.now() - (elapsedSec * 1000);
                restored.frozenRemainingMinutes = remMins; // 🌸 保留冻结参考，防止下次继续回溯时基准丢失！
            } else {
                // 2. 次高优先：真实物理时间差推算法（检查消息真实创建时间差 createdAt）
                const refMsg = targetRetryMsg || (historyMessages.length > 0 ? historyMessages[historyMessages.length - 1] : null);
                let restoredFromTimestamp = false;
                if (agreeMsg && refMsg && agreeMsg.createdAt && refMsg.createdAt) {
                    const startMs = new Date(agreeMsg.createdAt).getTime();
                    const curMs = new Date(refMsg.createdAt).getTime();
                    const elapsedMs = Math.max(0, curMs - startMs);
                    const totalMs = duration * 60000;
                    if (elapsedMs >= 30000 && elapsedMs < totalMs) {
                        const remMs = Math.max(60000, totalMs - elapsedMs);
                        const remMins = Math.ceil(remMs / 60000);
                        restored.durationMinutes = duration;
                        restored.startTime = Date.now() - (totalMs - remMs);
                        restored.frozenRemainingMinutes = remMins;
                        restoredFromTimestamp = true;
                    }
                }

                if (!restoredFromTimestamp) {
                    // 3. 智能轮次平滑推算与到达冻结时间继承（快速测试 / 历史无时间戳但在途有多轮互动的情形）
                    const totalRoundsAfterAgree = messagesAfterAgree.filter(m => m.role === "assistant").length + (targetRetryMsg ? 1 : 0);
                    const isBackToDepartureLine = messagesAfterAgree.length <= 1 && (!targetRetryMsg || totalRoundsAfterAgree <= 1);

                    if (!isBackToDepartureLine && totalRoundsAfterAgree > 1) {
                        const endMins = (baseInvite?.frozenRemainingMinutes && baseInvite.frozenRemainingMinutes > 0)
                            ? Math.min(baseInvite.frozenRemainingMinutes, duration - 1)
                            : 2;
                        const currentRoundIdx = messagesAfterAgree.filter(m => m.role === "assistant").length;
                        const totalEstimatedRounds = Math.max(totalRoundsAfterAgree, 5);
                        const progress = Math.min(1, Math.max(0, currentRoundIdx / totalEstimatedRounds));
                        const estimatedRemMins = Math.max(1, Math.round(duration - progress * (duration - endMins)));
                        restored.durationMinutes = duration;
                        restored.startTime = Date.now() - (duration - estimatedRemMins) * 60000;
                        restored.frozenRemainingMinutes = estimatedRemMins;
                    } else {
                        // 4. 起跑线：回溯到了刚同意出发的最初出门点，倒计时满额（如 15 分钟）重新开始！
                        restored.durationMinutes = duration;
                        restored.startTime = Date.now();
                        restored.frozenRemainingMinutes = undefined;
                    }
                }
            }
        } else if (!hasAcceptedInHistory && restored.direction === "he_comes") {
            restored.status = "pending";
            restored.startTime = undefined;
        }
    }

    // 修剪关联节点列表：仅保留依然存在于当前 historyMessages 中的批次 ID
    const historyBatchIds = new Set(historyMessages.map(m => m.responseBatchId).filter(Boolean));
    const validRelated = (baseInvite.relatedBatchIds || []).filter(id => historyBatchIds.has(id));
    restored.relatedBatchIds = validRelated;

    return restored;
}

type ManagedGenerationOptions = {
    history: ChatMessage[];
    errorPrefix?: string;
    onDecline?: () => void | Promise<void>;
    offlineInviteDeclined?: boolean;
    returnedFromOffline?: boolean;
};

const activeGenerationRuns = new Map<string, ActiveGenerationRun>();
const activeOfflineGenerationRuns = new Map<string, Omit<ActiveGenerationRun, "pendingNativeToolCalls">>();

function generationLockKey(sessionId: string): string {
    return GENERATING_PREFIX + sessionId;
}

function setGenerationLock(sessionId: string): void {
    kvSet(generationLockKey(sessionId), JSON.stringify({ startedAt: Date.now() }));
}

function clearGenerationLock(sessionId: string): void {
    kvRemove(generationLockKey(sessionId));
}

function hasActiveGenerationLock(sessionId: string): boolean {
    const key = generationLockKey(sessionId);
    const raw = kvGet(key);
    if (!raw) return false;
    let startedAt = 0;
    try {
        const parsed = JSON.parse(raw);
        startedAt = Number(parsed?.startedAt) || 0;
    } catch {
        startedAt = 0;
    }
    if (!startedAt || Date.now() - startedAt > GENERATING_LOCK_TTL_MS) {
        kvRemove(key);
        return false;
    }
    return true;
}

function createGenerationRun(sessionId: string): ActiveGenerationRun {
    const existing = activeGenerationRuns.get(sessionId);
    existing?.controller.abort();
    const run: ActiveGenerationRun = {
        runId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        controller: new AbortController(),
        pendingNativeToolCalls: [],
    };
    activeGenerationRuns.set(sessionId, run);
    return run;
}

function isGenerationRunActive(sessionId: string, runId: string): boolean {
    const run = activeGenerationRuns.get(sessionId);
    return Boolean(run && run.runId === runId && !run.controller.signal.aborted);
}

function finishGenerationRun(sessionId: string, runId: string): boolean {
    const run = activeGenerationRuns.get(sessionId);
    if (!run || run.runId !== runId) return false;
    activeGenerationRuns.delete(sessionId);
    return true;
}

function trackNativeToolCalls(sessionId: string, runId: string, calls: PendingNativeToolCall[]): void {
    const run = activeGenerationRuns.get(sessionId);
    if (!run || run.runId !== runId) return;
    const existingIds = new Set(run.pendingNativeToolCalls.map(call => call.id));
    for (const call of calls) {
        if (call.id && !existingIds.has(call.id)) {
            run.pendingNativeToolCalls.push(call);
            existingIds.add(call.id);
        }
    }
}

function resolveNativeToolCall(sessionId: string, runId: string, toolCallId: string): void {
    const run = activeGenerationRuns.get(sessionId);
    if (!run || run.runId !== runId) return;
    run.pendingNativeToolCalls = run.pendingNativeToolCalls.filter(call => call.id !== toolCallId);
}

function cancelGenerationRun(sessionId: string): ActiveGenerationRun | null {
    const run = activeGenerationRuns.get(sessionId);
    if (!run) return null;
    run.controller.abort();
    activeGenerationRuns.delete(sessionId);
    return run;
}

function isAbortLikeError(error: unknown): boolean {
    if (!error) return false;
    if (error instanceof DOMException && error.name === "AbortError") return true;
    if (error instanceof Error) {
        return error.name === "AbortError" || /aborted|abort/i.test(error.message);
    }
    return false;
}

function throwIfGenerationStopped(guard?: GenerationRunGuard): void {
    throwIfAborted(guard?.signal);
    if (guard?.isActive && !guard.isActive()) {
        throw new DOMException("Aborted", "AbortError");
    }
}

function createOfflineGenerationRun(sessionId: string): Omit<ActiveGenerationRun, "pendingNativeToolCalls"> {
    const existing = activeOfflineGenerationRuns.get(sessionId);
    existing?.controller.abort();
    const run = {
        runId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        controller: new AbortController(),
    };
    activeOfflineGenerationRuns.set(sessionId, run);
    return run;
}

function isOfflineGenerationRunActive(sessionId: string, runId: string): boolean {
    const run = activeOfflineGenerationRuns.get(sessionId);
    return Boolean(run && run.runId === runId && !run.controller.signal.aborted);
}

function finishOfflineGenerationRun(sessionId: string, runId: string): boolean {
    const run = activeOfflineGenerationRuns.get(sessionId);
    if (!run || run.runId !== runId) return false;
    activeOfflineGenerationRuns.delete(sessionId);
    return true;
}

function cancelOfflineGenerationRun(sessionId: string): boolean {
    const run = activeOfflineGenerationRuns.get(sessionId);
    if (!run) return false;
    run.controller.abort();
    activeOfflineGenerationRuns.delete(sessionId);
    return true;
}

// ── Rich media reprocessing on mount ──────────────────────────

const TIME_GAP = 1 * 60 * 1000;

function shouldShowTimestamp(currentMsg: string, prevMsg: string | null): boolean {
    if (!prevMsg) return true; // First message always shows time
    return new Date(currentMsg).getTime() - new Date(prevMsg).getTime() > TIME_GAP;
}

type ChatRoomProps = {
    session: ChatSession;
    onBack: () => void;
    /** 会话在设置页被删除后回调：由外层卸载本聊天室并回到列表 */
    onDeleted?: () => void;
};

type OfflineActionTarget = {
    turnId: string;
    role: "user" | "assistant";
};

type ContextMenuAnchor = {
    x: number;
    y: number;
};

type RenderChatMessage = ChatMessage & {
    displayProjected?: boolean;
    displaySourceId?: string;
};

type ScrollAnchorSnapshot = {
    messageId: string;
    offsetDelta: number;
};

type PendingMessageJump = {
    messageId: string;
    fallbackMessageId?: string;
};

const TRANSIENT_MESSAGE_PREFIX = "ui-transient-";
type RichModalKind = "photo" | "text_photo" | "red_packet" | "transfer" | "location" | "transfer_target" | "voice_msg" | "gift" | "system_instruction";
type ChatTextInputHandle = {
    appendText: (text: string, options?: { focus?: boolean }) => void;
    clear: () => void;
};
type OfflineTextInputHandle = {
    clear: () => void;
    setText: (text: string) => void;
    restoreIfEmpty: (text: string) => void;
};

function isTransientMessage(msg: Pick<ChatMessage, "id"> | string): boolean {
    return (typeof msg === "string" ? msg : msg.id).startsWith(TRANSIENT_MESSAGE_PREFIX);
}

function copyTextToClipboard(text: string): void {
    const fallbackCopy = () => {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try { document.execCommand("copy"); } catch {}
        document.body.removeChild(ta);
    };
    if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).catch(fallbackCopy);
    } else {
        fallbackCopy();
    }
}

function MemoryWriteRequestCard({
    msg,
    onApprove,
    onIgnore,
}: {
    msg: ChatMessage;
    onApprove: (msg: ChatMessage) => void | Promise<void>;
    onIgnore: (msg: ChatMessage) => void;
}) {
    const status = msg.mediaData?.memoryRequestStatus || "pending";
    const content = msg.mediaData?.memoryContent || msg.content;
    const reason = msg.mediaData?.memoryReason;
    const importance = msg.mediaData?.memoryImportance;
    const statusText = status === "approved" ? "已写入长期记忆" : status === "ignored" ? "已忽略本次写入" : "等待你确认";

    return (
        <div className="w-[280px] rounded-2xl border border-[var(--c-border)] bg-[var(--c-card)]/95 backdrop-blur px-4 py-3 flex flex-col gap-3 ui-bubble-shadow">
            <div className="flex items-center justify-between gap-3">
                <span className="menu-label">对方想记住这件事</span>
                <span className="menu-desc !mt-0 shrink-0">{statusText}</span>
            </div>
            <div className="rounded-xl bg-[var(--c-input)]/70 px-3 py-2">
                <p className="menu-desc !mt-0 leading-6 whitespace-pre-wrap">{content}</p>
            </div>
            {(reason || typeof importance === "number") && (
                <div className="flex flex-col gap-1">
                    {reason && <span className="menu-desc !mt-0">原因：{reason}</span>}
                    {typeof importance === "number" && <span className="menu-desc !mt-0">重要性：{importance.toFixed(2)}</span>}
                </div>
            )}
            {status === "pending" ? (
                <div className="flex gap-2">
                    <button onClick={() => void onApprove(msg)} className="ui-btn ui-btn-primary flex-1">确认写入</button>
                    <button onClick={() => onIgnore(msg)} className="ui-btn ui-btn-outline flex-1">忽略</button>
                </div>
            ) : null}
        </div>
    );
}

function SystemInstructionCard({ content }: { content: string }) {
    return (
        <>
            <div className="chat-system-instruction-head">
                <span className="chat-system-instruction-title">系统指令</span>
            </div>
            <div className="chat-system-instruction-body">{content}</div>
        </>
    );
}

type CustomChatPlusPresentation = "panel" | "modal" | "fullscreen" | "none";

type ActiveCustomChatPlus = {
    app: InstalledCustomApp;
    action: RegisteredCustomAppChatPlusAction;
    presentation: Exclude<CustomChatPlusPresentation, "fullscreen">;
    launchContext: Record<string, unknown>;
};

function getCustomChatPlusPresentation(action: RegisteredCustomAppChatPlusAction): CustomChatPlusPresentation {
    if (action.presentation === "fullscreen" || action.presentation === "app") return "fullscreen";
    if (action.presentation === "modal") return "modal";
    if (action.presentation === "none") return "none";
    return "panel";
}

function normalizeCustomPanelHeight(value: unknown): string | undefined {
    const text = String(value ?? "").trim();
    if (!text) return undefined;
    if (/^\d{2,3}$/.test(text)) return `${Math.max(220, Math.min(680, Number(text)))}px`;
    if (/^\d{2,3}px$/.test(text)) return text;
    if (/^\d{2,3}vh$/.test(text)) return text;
    if (/^calc\([^)]+\)$/.test(text)) return text;
    return undefined;
}

const ChatTextInputBar = memo(forwardRef<ChatTextInputHandle, {
    characterName: string;
    characterId: string;
    stickerCharacterIds?: string[];
    isGroup: boolean;
    isSpectator: boolean;
    muteUntilMs: number;
    isGenerating: boolean;
    theaterMode: boolean;
    enterToSendEnabled: boolean;
    quotingMessage: ChatMessage | null;
    showEmojiPanel: boolean;
    showStickerPanel: boolean;
    showPlusMenu: boolean;
    customPlusActions: RegisteredCustomAppChatPlusAction[];
    onClearQuote: () => void;
    onToggleOfflineMode: () => void;
    onClosePanels: () => void;
    onToggleEmojiPanel: () => void;
    onToggleStickerPanel: () => void;
    onTogglePlusMenu: () => void;
    onToggleTheaterMode: () => void;
    onCloseTheaterMode: () => void;
    onOpenRichModal: (modal: RichModalKind) => void;
    onOpenCustomPlusAction: (action: RegisteredCustomAppChatPlusAction) => void;
    onStartVideoCall: () => void;
    onStartVoiceCall: () => void;
    onSendText: (text: string, options?: { autoReply?: boolean }) => boolean;
    onStopGeneration: () => void;
    onTriggerAIResponse: () => void;
	onSendSticker: (name: string, url?: string) => void;
    offlineMeetingActive?: boolean;
}>(function ChatTextInputBar({
    characterName,
    characterId,
    stickerCharacterIds,
    isGroup,
    isSpectator,
    muteUntilMs,
    isGenerating,
    theaterMode,
    enterToSendEnabled,
    quotingMessage,
    showEmojiPanel,
    showStickerPanel,
    showPlusMenu,
    customPlusActions,
    onClearQuote,
    onToggleOfflineMode,
    onClosePanels,
    onToggleEmojiPanel,
    onToggleStickerPanel,
    onTogglePlusMenu,
    onToggleTheaterMode,
    onCloseTheaterMode,
    onOpenRichModal,
    onOpenCustomPlusAction,
    onStartVideoCall,
    onStartVoiceCall,
    onSendText,
    onStopGeneration,
    onTriggerAIResponse,
    onSendSticker,
    offlineMeetingActive,
}, ref) {
    const [inputText, setInputText] = useState("");
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    // 表情包搜索联想：ESC/失焦置 true 隐藏，输入变化重新开启
    const [suggestClosed, setSuggestClosed] = useState(false);
    // 围观群/被禁言：输入与富媒体入口全部锁定，只留线下切换和生成按钮
    const [muteNowTick, setMuteNowTick] = useState(() => Date.now());
    useEffect(() => {
        if (!muteUntilMs || muteUntilMs <= Date.now()) return;
        const timer = window.setInterval(() => setMuteNowTick(Date.now()), 30000);
        return () => window.clearInterval(timer);
    }, [muteUntilMs]);
    const muteRemainingMs = muteUntilMs > muteNowTick ? muteUntilMs - muteNowTick : 0;
    const inputLocked = isSpectator || muteRemainingMs > 0;

    const resetTextareaHeight = () => {
        if (textareaRef.current) textareaRef.current.style.height = "auto";
    };

    const appendText = useCallback((text: string, options?: { focus?: boolean }) => {
        setInputText(prev => prev + text);
        requestAnimationFrame(() => {
            const ta = textareaRef.current;
            if (!ta) return;
            ta.style.height = "auto";
            ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
            if (options?.focus !== false) ta.focus();
        });
    }, []);

    useImperativeHandle(ref, () => ({
        appendText,
        clear: () => {
            setInputText("");
            resetTextareaHeight();
        },
    }), [appendText]);

    const handleSubmit = () => {
        if (inputLocked) return;
        if (isGenerating) {
            onStopGeneration();
            return;
        }
        const trimmed = inputText.trim();
        if (!trimmed) return;
        if (!onSendText(trimmed)) return;
        setInputText("");
        resetTextareaHeight();
        onClosePanels();
    };

    const panelOpen = showEmojiPanel || showStickerPanel || showPlusMenu;
    const suggestCharacterIds = useMemo(
        () => (isGroup ? (stickerCharacterIds || []) : characterId ? [characterId] : []),
        [isGroup, stickerCharacterIds, characterId],
    );
    const suggestEnabled = !inputLocked && !panelOpen && !suggestClosed && inputText.trim().length > 0;
    const plusMenuItems = [
        { icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--c-text)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>, label: "照片墙", onClick: () => onOpenRichModal("photo") },
        { icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--c-text)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><line x1="7" y1="8" x2="17" y2="8" /><line x1="7" y1="12" x2="14" y2="12" /><line x1="7" y1="16" x2="11" y2="16" /></svg>, label: "文字图片", onClick: () => onOpenRichModal("text_photo") },
        { icon: <AlertCircle size={22} strokeWidth={1.5} color="var(--c-text)" />, label: "系统指令", onClick: () => onOpenRichModal("system_instruction") },
        { icon: <Clapperboard size={22} strokeWidth={1.5} color={theaterMode ? "var(--c-icon-active)" : "var(--c-text)"} />, label: "番外指令模式", active: theaterMode, onClick: onToggleTheaterMode },
        { icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--c-text)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>, label: "视频通话", onClick: onStartVideoCall },
        { icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--c-text)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="22" /></svg>, label: "语音通话", onClick: onStartVoiceCall },
        { icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--c-text)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2" /><line x1="2" y1="10" x2="22" y2="10" /></svg>, label: "红包", onClick: () => onOpenRichModal("red_packet") },
        { icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--c-text)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><text x="12" y="16" textAnchor="middle" fontSize="12" fill="var(--c-text)" stroke="none">¥</text></svg>, label: "转账", onClick: () => onOpenRichModal(isGroup ? "transfer_target" : "transfer") },
        { icon: <Gift size={22} strokeWidth={1.5} color="var(--c-text)" />, label: "礼物", onClick: () => onOpenRichModal("gift") },
        { icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--c-text)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>, label: "位置", onClick: () => onOpenRichModal("location") },
        { icon: <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--c-text)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" y1="19" x2="12" y2="22" /><line x1="8" y1="22" x2="16" y2="22" /></svg>, label: "语音条", onClick: () => onOpenRichModal("voice_msg") },
        ...customPlusActions.map(action => ({
            icon: action.appIconDataUrl
                ? <span className="chat-plus-custom-app-icon" style={{ backgroundImage: `url(${action.appIconDataUrl})` }} aria-hidden="true" />
                : <Blocks size={22} strokeWidth={1.5} color="var(--c-text)" />,
            label: action.label,
            onClick: () => onOpenCustomPlusAction(action),
        })),
    ];

    return (
        <div className="chat-input-bar chat-room-main-pane flex flex-col" data-ui="input">
            {theaterMode && (
                <div className="chat-theater-mode-strip" role="status">
                    <span className="chat-theater-mode-icon" aria-hidden="true">
                        <Clapperboard size={16} strokeWidth={1.8} />
                    </span>
                    <span className="chat-theater-mode-title">番外指令模式</span>
                    <button
                        type="button"
                        className="chat-theater-mode-close"
                        onClick={onCloseTheaterMode}
                        aria-label="关闭番外指令模式"
                        title="关闭番外指令模式"
                    >
                        <X size={14} strokeWidth={2} />
                    </button>
                </div>
            )}
            {quotingMessage && (
                <div className="chat-quote-bar">
                    <div className="flex-1 ts-12 text-[var(--c-icon)] overflow-hidden text-ellipsis whitespace-nowrap">
                        引用 {quotingMessage.role === "user" ? "你" : characterName}: {quotingMessage.content.slice(0, 40)}
                    </div>
                    <button onClick={onClearQuote} className="ui-bare-btn text-[var(--c-icon)] ts-16 leading-none p-[2px]">✕</button>
                </div>
            )}

            {suggestEnabled && (
                <StickerSearchSuggest
                    query={inputText}
                    characterIds={suggestCharacterIds}
                    onSend={(name, url) => {
                        onSendSticker(name, url);
                        setInputText("");
                        resetTextareaHeight();
                    }}
                    onClose={() => setSuggestClosed(true)}
                />
            )}
            <textarea
                ref={textareaRef}
                rows={1}
                value={inputText}
                onChange={e => {
                    setInputText(e.target.value);
                    setSuggestClosed(false);
                    e.target.style.height = "auto";
                    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
                }}
                onFocus={(e) => {
                    if (panelOpen) {
                        e.target.blur();
                        onClosePanels();
                        const target = e.target as HTMLTextAreaElement;
                        requestAnimationFrame(() => requestAnimationFrame(() => target.focus()));
                    }
                    setSuggestClosed(false);
                }}
                onBlur={() => setSuggestClosed(true)}
                onKeyDown={e => {
                    if (e.key === "Escape") {
                        setSuggestClosed(true);
                        return;
                    }
                    if (shouldSendChatInputOnEnter(e, enterToSendEnabled)) {
                        e.preventDefault();
                        handleSubmit();
                    }
                }}
                enterKeyHint={enterToSendEnabled ? "send" : "enter"}
                className="chat-input-textarea"
                disabled={inputLocked}
                placeholder={inputLocked
                    ? (isSpectator ? "围观中，你不在这个群里" : `禁言中，剩余${Math.ceil(muteRemainingMs / 60000)}分钟`)
                    : (theaterMode ? "写下番外指令..." : (offlineMeetingActive ? "对方就在你身边呢…（可发悄悄话或打个招呼）" : undefined))}
            />

            <div className="chat-input-actions">
                <button
                    onClick={onToggleOfflineMode}
                    className="ui-bare-btn text-[var(--c-text)] chat-offline-toggle"
                    aria-label="线下模式"
                    title="线下模式"
                >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0Z" />
                        <circle cx="12" cy="10" r="3" />
                    </svg>
                </button>
                <button onClick={onToggleEmojiPanel} disabled={inputLocked} className="ui-bare-btn text-[var(--c-text)]" style={inputLocked ? { opacity: 0.35 } : undefined}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></svg>
                </button>
                <button onClick={onToggleStickerPanel} disabled={inputLocked} className="ui-bare-btn text-[var(--c-text)]" style={inputLocked ? { opacity: 0.35 } : undefined}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3Z" /><polyline points="14 3 14 8 21 8" /><path d="M8 13h0" /><path d="M16 13h0" /><path d="M10 17c.5.3 1.2.5 2 .5s1.5-.2 2-.5" /></svg>
                </button>
                <button onClick={onTogglePlusMenu} disabled={inputLocked} className="ui-bare-btn text-[var(--c-text)]" style={inputLocked ? { opacity: 0.35 } : undefined}>
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" /></svg>
                </button>
                <button
                    onClick={handleSubmit}
                    disabled={!isGenerating && (inputLocked || !inputText.trim())}
                    style={inputLocked && !isGenerating ? { opacity: 0.35 } : undefined}
                    className="ui-bare-btn text-[var(--c-text)]"
                    aria-label={isGenerating ? "停止本轮生成" : "发送"}
                    title={isGenerating ? "停止本轮生成" : "发送"}
                >
                    {isGenerating ? (
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <circle cx="12" cy="12" r="10" />
                            <rect x="9" y="9" width="6" height="6" rx="1" />
                        </svg>
                    ) : (
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                    )}
                </button>
                {!isGenerating && (
                    <button
                        className="ui-bare-btn text-[var(--c-text)]"
                        title={!inputLocked && inputText.trim() ? "发送输入框内容并触发回复" : "触发 AI 主动回复"}
                        onClick={() => {
                            const trimmed = inputText.trim();
                            // 输入框已有文字：发送输入框内容并立即触发模型回复（一次按键完成），
                            // 避免「打完字却忘记发送」；没文字时才只触发 AI 主动回复
                            if (!inputLocked && trimmed) {
                                if (!onSendText(trimmed, { autoReply: true })) return;
                                setInputText("");
                                resetTextareaHeight();
                            } else {
                                onTriggerAIResponse();
                            }
                            onClosePanels();
                        }}
                    >
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.582a.5.5 0 0 1 0 .963L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z" />
                            <path d="M20 3v4" /><path d="M22 5h-4" />
                        </svg>
                    </button>
                )}
            </div>

            {showPlusMenu && (
                <div className="chat-plus-menu">
                    {plusMenuItems.map((item, i) => (
                        <div key={`${item.label}-${i}`} onClick={item.onClick} className="chat-plus-menu-item flex flex-col items-center gap-1.5 cursor-pointer" {...(item.active ? { "data-active": "" } : {})}>
                            <div className="chat-plus-icon-box">
                                {item.icon}
                            </div>
                            <span className="ts-11 text-[var(--c-text)]">{item.label}</span>
                        </div>
                    ))}
                </div>
            )}
            {showPlusMenu && (
                <ChatPluginSlot name="chat.inputToolbar" slotProps={{ isGroup }} className="chat-plugin-input-toolbar" />
            )}

            {showEmojiPanel && (
                <EmojiPanel
                    onSelect={(emoji) => appendText(emoji, { focus: false })}
                    onEffectSend={(text) => {
                        if (inputLocked || isGenerating) return;
                        onSendText(text);
                        onClosePanels();
                    }}
                />
            )}

            {showStickerPanel && (
                <StickerPanel
                    onSend={onSendSticker}
                    characterId={characterId}
                    characterIds={stickerCharacterIds}
                />
            )}
        </div>
    );
}));

const OfflineTextInputBar = memo(forwardRef<OfflineTextInputHandle, {
    isOfflineGenerating: boolean;
    isSpectator: boolean;
    showEmojiPanel: boolean;
    enterToSendEnabled: boolean;
    onToggleOfflineMode: () => void;
    onCloseEmojiPanel: () => void;
    onToggleEmojiPanel: () => void;
    onSendText: (text: string) => boolean;
    onStopGeneration: () => void;
}>(function OfflineTextInputBar({
    isOfflineGenerating,
    isSpectator,
    showEmojiPanel,
    enterToSendEnabled,
    onToggleOfflineMode,
    onCloseEmojiPanel,
    onToggleEmojiPanel,
    onSendText,
    onStopGeneration,
}, ref) {
    const [inputText, setInputText] = useState("");
    const inputTextRef = useRef("");
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);

    const resetTextareaHeight = () => {
        if (textareaRef.current) textareaRef.current.style.height = "auto";
    };

    const resizeTextarea = useCallback(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.style.height = "auto";
        ta.style.height = Math.min(ta.scrollHeight, 120) + "px";
    }, []);

    const setTextAndResize = useCallback((text: string) => {
        inputTextRef.current = text;
        setInputText(text);
        requestAnimationFrame(resizeTextarea);
    }, [resizeTextarea]);

    const appendText = useCallback((text: string, options?: { focus?: boolean }) => {
        const nextText = inputTextRef.current + text;
        inputTextRef.current = nextText;
        setInputText(nextText);
        requestAnimationFrame(() => {
            resizeTextarea();
            if (options?.focus !== false) textareaRef.current?.focus();
        });
    }, [resizeTextarea]);

    useImperativeHandle(ref, () => ({
        clear: () => {
            inputTextRef.current = "";
            setInputText("");
            resetTextareaHeight();
        },
        setText: setTextAndResize,
        restoreIfEmpty: (text: string) => {
            if (inputTextRef.current.trim()) return;
            setTextAndResize(text);
        },
    }), [setTextAndResize]);

    const handleSubmit = () => {
        if (isOfflineGenerating) {
            onSendText(inputTextRef.current);
            return;
        }
        const trimmed = inputTextRef.current.trim();
        if (!trimmed && !isSpectator) return;
        if (!onSendText(trimmed)) return;
        inputTextRef.current = "";
        setInputText("");
        resetTextareaHeight();
    };

    return (
        <div className="chat-input-bar chat-room-main-pane flex flex-col" data-ui="input">
            <textarea
                ref={textareaRef}
                rows={1}
                value={inputText}
                onChange={e => {
                    inputTextRef.current = e.target.value;
                    setInputText(e.target.value);
                    e.target.style.height = "auto";
                    e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
                }}
                onFocus={(e) => {
                    if (showEmojiPanel) {
                        e.target.blur();
                        onCloseEmojiPanel();
                        const target = e.target as HTMLTextAreaElement;
                        requestAnimationFrame(() => requestAnimationFrame(() => target.focus()));
                    }
                }}
                onKeyDown={e => {
                    if (shouldSendChatInputOnEnter(e, enterToSendEnabled)) {
                        e.preventDefault();
                        handleSubmit();
                    }
                }}
                enterKeyHint={enterToSendEnabled ? "send" : "enter"}
                className="chat-input-textarea"
                disabled={isSpectator}
                placeholder={isSpectator ? "围观中，点右侧按钮推进他们的线下互动" : undefined}
            />
            <div className="chat-input-actions">
                <button
                    type="button"
                    onClick={onToggleOfflineMode}
                    disabled={isOfflineGenerating}
                    className="ui-bare-btn text-[var(--c-text)]"
                    aria-label="返回线上模式"
                    title="返回线上模式"
                >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4Z" />
                        <path d="M8 9h8" />
                        <path d="M8 13h5" />
                    </svg>
                </button>
                <button
                    onClick={onToggleEmojiPanel}
                    disabled={isSpectator}
                    className="ui-bare-btn text-[var(--c-text)]"
                    style={isSpectator ? { opacity: 0.35 } : undefined}
                    aria-label="表情"
                    title="表情"
                >
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><path d="M8 14s1.5 2 4 2 4-2 4-2" /><line x1="9" y1="9" x2="9.01" y2="9" /><line x1="15" y1="9" x2="15.01" y2="9" /></svg>
                </button>
                <button
                    type="button"
                    onClick={() => { if (isOfflineGenerating) onStopGeneration(); else handleSubmit(); }}
                    disabled={!isOfflineGenerating && !isSpectator && !inputText.trim()}
                    className="ui-bare-btn text-[var(--c-text)]"
                    aria-label={isOfflineGenerating ? "停止线下生成" : "发送"}
                    title={isOfflineGenerating ? "停止线下生成" : "发送"}
                >
                    {isOfflineGenerating ? (
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <circle cx="12" cy="12" r="10" />
                            <rect x="9" y="9" width="6" height="6" rx="1" />
                        </svg>
                    ) : (
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                    )}
                </button>
            </div>
            {showEmojiPanel && (
                <EmojiPanel onSelect={(emoji) => appendText(emoji, { focus: false })} />
            )}
        </div>
    );
}));

export function ChatRoom({ session, onBack, onDeleted }: ChatRoomProps) {
    const [liveCSS, setLiveCSS] = useState(session.customCSS || "");
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [transientMessages, setTransientMessages] = useState<ChatMessage[]>([]);
    const [stickerReady, setStickerReady] = useState(false);
    const [character, setCharacter] = useState<Character | null>(() => {
        const chars = loadCharacters();
        return chars.find(c => c.id === session.contactId) || null;
    });
    const [isGenerating, setIsGenerating] = useState(false);
    const [offlineMode, setOfflineMode] = useState(false);
    const [theaterMode, setTheaterMode] = useState(() => kvGet(CHAT_THEATER_MODE_PREFIX + session.id) === "1");
    const [offlineTurns, setOfflineTurns] = useState<ChatOfflineTurn[]>([]);
    const [offlineVisibleCount, setOfflineVisibleCount] = useState(OFFLINE_INITIAL_LOAD);
    const [pendingOfflineUserText, setPendingOfflineUserText] = useState("");
    const [isOfflineGenerating, setIsOfflineGenerating] = useState(false);
    const [activeOfflineInvite, setActiveOfflineInvite] = useState<OfflineInviteData | null>(() => {
        if (!session.enableOfflineInvite || session.isGroup) return null;
        try {
            const raw = kvGet(ACTIVE_OFFLINE_INVITE_PREFIX + session.id);
            if (!raw) {
                // 🌸 华确立的线下碰面最高事实法则：若当前已处于线下赴约中，绝不从历史重新水合在途/到达邀约！
                if (kvGet(OFFLINE_INVITE_ACTIVE_SESSION_PREFIX + session.id) === "1") {
                    return null;
                }
                // 兼容数据备份恢复/跨端导入场景：若无独立 KV 键，但聊天记录中存在未完结的线下赴约节点，自动从消息水合（Auto-hydrate）恢复现场！
                const currentMsgs = loadChatMessages(session.id);
                if (currentMsgs.length > 0) {
                    const hydrated = restoreOfflineInviteFromMessages(currentMsgs, null);
                    if (hydrated) {
                        kvSet(ACTIVE_OFFLINE_INVITE_PREFIX + session.id, JSON.stringify(hydrated));
                        return hydrated;
                    }
                }
                return null;
            }
            const parsed: OfflineInviteData = JSON.parse(raw);
            const currentMsgs = loadChatMessages(session.id);
            // 华的精妙发现：若触发该邀约的最初发起消息已被删除，绝不留下悬空卡死胶囊，直接清理！
            const rootId = parsed.initialBatchId || parsed.sourceBatchId;
            if (rootId === "mock_offline_invite") {
                return parsed;
            }
            const hasRoot = currentMsgs.some(m =>
                (rootId && (m.responseBatchId === rootId || m.id === rootId)) ||
                (parsed.relatedBatchIds && m.responseBatchId && parsed.relatedBatchIds.includes(m.responseBatchId)) ||
                m.mediaData?.offlineInvite ||
                (m.role === "system" && m.content && (
                    m.content.includes("你已同意赴约") ||
                    m.content.includes("线下赴约提议") ||
                    m.content.includes("正在动身赶往") ||
                    m.content.includes("前往") ||
                    m.content.includes("正在重新赶往") ||
                    m.content.includes("已到达") ||
                    m.content.includes("已提前到达") ||
                    m.content.includes("就位等候")
                ))
            );
            if (!hasRoot) {
                kvRemove(ACTIVE_OFFLINE_INVITE_PREFIX + session.id);
                return null;
            }
            return parsed;
        } catch {
            return null;
        }
    });
    const activeOfflineInviteRef = useRef<OfflineInviteData | null>(activeOfflineInvite);
    activeOfflineInviteRef.current = activeOfflineInvite;

    const [isOfflineInviteMinimized, setIsOfflineInviteMinimized] = useState(() => {
        if (!session.enableOfflineInvite || session.isGroup) return false;
        try {
            const raw = kvGet(ACTIVE_OFFLINE_INVITE_PREFIX + session.id);
            if (raw) {
                const parsed: OfflineInviteData = JSON.parse(raw);
                return parsed.status === "on_the_way";
            }
        } catch {}
        return false;
    });
    const [showConfirmExitOfflineInvite, setShowConfirmExitOfflineInvite] = useState(false);
    // 华提出的黄金体验：删除邀约/赴约消息前弹窗确认，提示将同时取消相关赴约状态
    const [pendingInviteDeleteConfirm, setPendingInviteDeleteConfirm] = useState<{
        title: string;
        message: string | React.ReactNode;
        confirmLabel?: string;
        cancelLabel?: string;
        variant?: "danger" | "action" | "default";
        onConfirm: () => void;
    } | null>(null);

    // 🌸 华专属打造的黄金体验：线下赴约进行时回溯重试选择确认弹窗（仅重试保全线下 vs 回溯并取消线下）
    const [offlineRetryConfirm, setOfflineRetryConfirm] = useState<{
        msgId: string;
        targetMsg: ChatMessage;
        msgIndex: number;
        truncatedMessages: ChatMessage[];
        truncatesInitialRoot: boolean;
        contextMessages: ChatMessage[];
    } | null>(null);

    // 华提出的生命根源与变动节点界定：最初发起消息是根，后续改地址消息是关联节点
    const isOfflineInviteRootMessage = useCallback((msg: ChatMessage) => {
        const invite = activeOfflineInviteRef.current;
        const isMeetingActive = !session.isGroup && kvGet(OFFLINE_INVITE_ACTIVE_SESSION_PREFIX + session.id) === "1";
        // 🌸 华确立的法则：即使在线下碰面进行中（invite 暂时为 null），只要该消息属于邀约发起根或变动节点，坚决识别并予以保护！
        if (!invite && !isMeetingActive) return false;
        if (invite?.sourceBatchId === "mock_offline_invite") return false;
        const rootId = invite?.initialBatchId || invite?.sourceBatchId;
        if (rootId && msg.responseBatchId === rootId) {
            return true;
        }
        if (invite?.relatedBatchIds && msg.responseBatchId && invite.relatedBatchIds.includes(msg.responseBatchId)) {
            return true;
        }
        return Boolean(
            msg.mediaType === "offline_invite" ||
            msg.mediaType === "offline_invite_early_arrive" ||
            msg.mediaType === "offline_invite_change_place" ||
            msg.mediaType === "offline_invite_arrive_notice" ||
            msg.mediaData?.offlineInvite
        );
    }, [session.id, session.isGroup]);

    // 华提出的防误触保护：线下赴约专属系统记录小灰字（防误碰）
    const isOfflineInviteSystemMessage = useCallback((msg: ChatMessage) => {
        if (msg.role !== "system") return false;
        if (msg.mediaType === "offline_invite_system_notice") return true;
        const text = msg.content || "";
        return /(?:向你发起了.*线下赴约提议|你已同意赴约|赴约地点已更改为|赴约地点已变更为|赴约提议地点已更改为|赴约提议已变更为|碰头方式已变更为|已得知新地点，正在重新赶往|已直接动身赶往|已如约到达|已提前到达|已在.*就位等候|你婉拒了.*线下赴约提议|本次线下赴约已结束，双方已返回线上)/.test(text);
    }, []);

    const getInviteDeleteConfirmMessage = useCallback((_msg?: ChatMessage): string => {
        return "删除的内容中包含本次线下赴约的发起或变动消息，删除后将直接清除当前的赴约状态。若只想回退赴约状态，可取消并重试消息。";
    }, []);

    // 华提出的黄金体验：[提醒赴约] 消息出现后留足 4 秒供用户安稳读消息，随后再自动平滑弹出
    const remindExpandTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // 记录最新一次含有 [提醒赴约] 的批次 ID，用于区分用户是“等角色说了动身后答应”还是“中途自助点击答应”
    const lastRemindBatchIdRef = useRef<string | null>(null);

    useEffect(() => {
        return () => {
            if (remindExpandTimerRef.current) {
                clearTimeout(remindExpandTimerRef.current);
                remindExpandTimerRef.current = null;
            }
        };
    }, []);

    const sanitizeTransitMessage = useCallback((rawText?: string, direction?: "he_comes" | "i_go", place?: string): string => {
        let trimmed = rawText?.trim() || "";
        if (direction === "he_comes") {
            // 华敏锐发现的绝妙细节：动身消息绝对不能带有“好、好的、行、没问题、知道了”等答复性词汇！
            // 因为上一句很可能是角色提议“我们一起去好不好？”，如果角色又自答“好”，会造成突兀的自问自答和语境脱节！
            // 纯粹的动身动作报备，必须直接说“我出门了/我现在过去/我上路了/这就动身”！
            
            // 1. 强力剥离所有开头的应答词：如“好，/好的，/好啊，/行，/行啊，/行吧，/没问题，/知道了，/收到，/嗯，/成，”等
            trimmed = trimmed.replace(/^(?:好[的啊呀吧嘞啦]?[，,！!。\s]*|行[的啊呀吧嘞啦]?[，,！!。\s]*|没问题[，,！!。\s]*|知道了[，,！!。\s]*|收到[，,！!。\s]*|嗯[嗯]?[，,！!。\s]*|成[，,！!。\s]*|OK[，,！!。\s]*|ok[，,！!。\s]*)+/i, "");
            // 如果剥离后以“那我这就/那我/那”开头，转为更自然的“我这就/我现在”
            trimmed = trimmed.replace(/^那(?:我)?/, "我");
            trimmed = trimmed.trim();

            // 2. 华敏锐发现的漏洞：明明是他来，模型却可能错误说“你路上慢点开/注意看路/别急着赶路”等主客颠倒的话，代码强制纠偏！
            // 3. 同时拒绝千篇一律的“在家里等我”，因地制宜！
            if (!trimmed || /你?(?:路上慢点|注意看路|别急着赶路|路上小心|开车慢点|路上注意安全|注意交通安全)/.test(trimmed)) {
                return place ? `我这就动身过去找你，在${place}稍等我一会儿。` : "我这就动身过去找你，稍等我一会儿，很快就到。";
            }
            return trimmed;
        }
        if (!trimmed) {
            return place ? `路上慢点，注意安全，我在${place}等你。` : "路上慢点，注意安全，我在老地方等你。";
        }
        return trimmed;
    }, []);

    const getArrivalChatMessage = useCallback((invite: OfflineInviteData): string => {
        // 华敏锐发现的硬编码漏洞：坚决杜绝生硬写死的固定句式与带“~”号的死模板！
        // 必须优先使用角色根据自己人设、世界观和具体碰头场景亲口生成的【到达呼唤台词】！
        const rawArrived = invite.arrivedMessage?.trim();
        if (rawArrived) {
            return rawArrived;
        }
        const place = invite.place ? invite.place.trim() : "";
        if (invite.direction === "he_comes") {
            if (place === "你身边") {
                return "我到了，在附近等你，慢慢走出来就好。";
            }
            return place ? `我到了，在${place}等你，慢慢走别着急。` : "我到了，在附近等你，随时可以出来。";
        }
        return place ? `我在${place}就位等你了，慢慢过来不着急。` : "我已经就位等你了，慢慢过来。";
    }, []);

    const updateActiveOfflineInvite = useCallback((invite: OfflineInviteData | null) => {
        activeOfflineInviteRef.current = invite;
        setActiveOfflineInvite(invite);
        if (invite) {
            kvSet(ACTIVE_OFFLINE_INVITE_PREFIX + session.id, JSON.stringify(invite));
        } else {
            kvRemove(ACTIVE_OFFLINE_INVITE_PREFIX + session.id);
        }
    }, [session.id]);

    useEffect(() => {
        if (!activeOfflineInvite || activeOfflineInvite.status !== "on_the_way") return;
        const checkArrival = () => {
            const remaining = getRemainingMinutes(activeOfflineInvite.startTime, activeOfflineInvite.durationMinutes || 15);
            if (remaining <= 0) {
                const arriveBatchId = `offline_arrive_${Date.now()}`;
                const arrivedInvite: OfflineInviteData = {
                    ...activeOfflineInvite,
                    status: "arrived",
                    relatedBatchIds: Array.from(new Set([...(activeOfflineInvite.relatedBatchIds || []), arriveBatchId])),
                };
                updateActiveOfflineInvite(arrivedInvite);
                setIsOfflineInviteMinimized(false);

                // 华提出的黄金体验节点③【行程到达】：倒计时结束到达时，在聊天流中留下到达事实系统记录
                const charName = character?.name || "对方";
                const isOriginByYourSide = activeOfflineInvite.initialPlace === "你身边" || (!activeOfflineInvite.initialPlace && activeOfflineInvite.place === "你身边");
                const rawPlace = activeOfflineInvite.place?.trim();
                const placeStr = isOriginByYourSide ? "你身边" : (rawPlace ? (rawPlace === "你身边" ? "你身边" : `「${rawPlace}」`) : "约定地点");
                const sysArriveMsg = pushChatMessage({
                    sessionId: session.id,
                    role: "system",
                    content: activeOfflineInvite.direction === "he_comes"
                        ? `${charName} 已如约到达${placeStr}`
                        : `${charName} 已在${placeStr}就位等候`,
                    mediaType: "offline_invite_system_notice",
                    mediaData: { offlineInvite: arrivedInvite },
                });
                setMessages(prev => [...prev, sysArriveMsg]);

                // 华提出的黄金细节：倒计时走完到达时，隔 1 秒后在微信聊天框发出到达微信消息，模拟打字时间！
                const arrivalChatText = getArrivalChatMessage(activeOfflineInvite);
                window.setTimeout(() => {
                    const newMsg = pushChatMessage({
                        sessionId: session.id,
                        role: "assistant",
                        content: arrivalChatText,
                        responseBatchId: arriveBatchId,
                        mediaType: "offline_invite_arrive_notice",
                    });
                    setMessages(prev => [...prev, newMsg]);
                }, 1000);
            }
        };
        checkArrival();
        const timer = setInterval(checkArrival, 1000);
        return () => clearInterval(timer);
    }, [activeOfflineInvite, getArrivalChatMessage, session.id, updateActiveOfflineInvite]);
    // 流式生成预览：线上（单聊/群聊）与线下各一份，生成中实时刷新，结束后清空
    const [streamPreview, setStreamPreview] = useState<null | {
        /** 单聊：按空行定型的分段气泡列表，最后一段在打字 */
        texts?: string[];
        parts?: { characterId: string; characterName: string; texts: string[] }[];
    }>(null);
    const [offlineStreamPreview, setOfflineStreamPreview] = useState<null | { content: string; summary: string }>(null);
    const streamAccumRef = useRef("");
    const offlineStreamAccumRef = useRef("");
    // 群聊/单聊流式预览解析的 rAF 合并帧（限频：一帧最多解析一次全文）
    const streamParseFrameRef = useRef(0);
    // 线下模式流式预览解析的 rAF 合并帧（独立于线上，避免互相干扰）
    const offlineStreamFrameRef = useRef(0);
    const [activeOfflineTarget, setActiveOfflineTarget] = useState<OfflineActionTarget | null>(null);
    const [editingOfflineTarget, setEditingOfflineTarget] = useState<OfflineActionTarget | null>(null);
    const [editingOfflineContent, setEditingOfflineContent] = useState("");
    const [regexRevision, setRegexRevision] = useState(0);
    // Whether there are unsent user messages waiting for AI generation
    const [pendingGenerate, setPendingGenerate] = useState(false);
    const [chatToast, setChatToast] = useState<string | null>(null);
    const chatToastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

    // ── Toast helpers ──
    const clearChatToast = useCallback(() => {
        clearTimeout(chatToastTimer.current);
        setChatToast(null);
    }, []);

    const showChatToast = useCallback((text: string, duration = 2000) => {
        clearTimeout(chatToastTimer.current);
        setChatToast(text);
        if (duration > 0) {
            chatToastTimer.current = setTimeout(() => setChatToast(null), duration);
        }
    }, []);

    const showPersistentChatToast = useCallback((text: string) => {
        clearTimeout(chatToastTimer.current);
        setChatToast(text);
    }, []);
    // 自动生图失败：弹一次弹窗提示，关掉即消失（同一轮里多张失败只提示第一条）
    const [imageGenerationFailure, setImageGenerationFailure] = useState<string | null>(null);
    const [cloudDeletePending, setCloudDeletePending] = useState<{ count: number } | null>(null);
    const [showPlusMenu, setShowPlusMenu] = useState(false);
    const [customPlusActions, setCustomPlusActions] = useState<RegisteredCustomAppChatPlusAction[]>(() => loadCustomAppChatPlusActions());
    const [activeCustomChatPlus, setActiveCustomChatPlus] = useState<ActiveCustomChatPlus | null>(null);
    const [showSettings, setShowSettings] = useState(false);
    const [showVoiceCall, setShowVoiceCall] = useState(false);
    const [showVideoCall, setShowVideoCall] = useState(false);
    const [callInitiator, setCallInitiator] = useState<"user" | "character">("user");
    const [callInitiatorName, setCallInitiatorName] = useState<string>("");
    const [userIdentity, setUserIdentity] = useState<UserIdentity | null>(null);
    const [enterToSendEnabled, setEnterToSendEnabled] = useState(() => loadChatAppSettings().enterToSendEnabled === true);

    // Rich media input modals
    const [richModal, setRichModal] = useState<RichModalKind | null>(null);
    const [transferTarget, setTransferTarget] = useState<Character | null>(null);
    // Media detail modal (red packet / transfer detail view)
    const [mediaDetailMsg, setMediaDetailMsg] = useState<ChatMessage | null>(null);
    // Quote reply
    const [quotingMessage, setQuotingMessage] = useState<ChatMessage | null>(null);
    // Emoji panel
    const [showEmojiPanel, setShowEmojiPanel] = useState(false);
    const [showStickerPanel, setShowStickerPanel] = useState(false);
    const chatTextInputRef = useRef<ChatTextInputHandle | null>(null);
    const offlineTextInputRef = useRef<OfflineTextInputHandle | null>(null);

    useEffect(() => {
        const syncEnterToSend = () => {
            setEnterToSendEnabled(loadChatAppSettings().enterToSendEnabled === true);
        };
        window.addEventListener(CHAT_APP_SETTINGS_UPDATED_EVENT, syncEnterToSend);
        return () => window.removeEventListener(CHAT_APP_SETTINGS_UPDATED_EVENT, syncEnterToSend);
    }, []);

    useEffect(() => {
        const syncCustomPlusActions = () => setCustomPlusActions(loadCustomAppChatPlusActions());
        window.addEventListener(CUSTOM_APPS_UPDATED_EVENT, syncCustomPlusActions);
        return () => window.removeEventListener(CUSTOM_APPS_UPDATED_EVENT, syncCustomPlusActions);
    }, []);

    useEffect(() => {
        setTheaterMode(kvGet(CHAT_THEATER_MODE_PREFIX + session.id) === "1");
    }, [session.id]);

    // 聊天插件：进入聊天广播 session.opened
    useEffect(() => {
        emitChatPluginEvent("session.opened", { sessionId: session.id, isGroup: !!session.isGroup });
    }, [session.id, session.isGroup]);

    // 聊天插件：监听插件 toast（支持常驻加载态 + 手动关闭）
    const chatToastIdRef = useRef<string | null>(null);
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent<{ id?: string; text: string; durationMs?: number; close?: boolean }>).detail || { text: "" };
            // 关闭请求：仅当关闭的是当前正在显示的那条时才清除
            if (detail.close) {
                if (chatToastIdRef.current === detail.id) {
                    clearTimeout(chatToastTimer.current);
                    setChatToast(null);
                    chatToastIdRef.current = null;
                }
                return;
            }
            if (!detail.text) return;
            clearTimeout(chatToastTimer.current);
            chatToastIdRef.current = detail.id ?? null;
            setChatToast(detail.text);
            // durationMs <= 0 表示常驻（加载态），不自动消失；缺省用 2400ms
            if (detail.durationMs === undefined || detail.durationMs > 0) {
                chatToastTimer.current = setTimeout(() => {
                    setChatToast(null);
                    chatToastIdRef.current = null;
                }, detail.durationMs ?? 2400);
            }
        };
        window.addEventListener(CHAT_PLUGIN_TOAST_EVENT, handler);
        return () => window.removeEventListener(CHAT_PLUGIN_TOAST_EVENT, handler);
    }, []);

    const [bgImageResolved, setBgImageResolved] = useState<string | null>(null);
    const [bgLoading, setBgLoading] = useState(!!session.backgroundImage);

    const wrapperRef = useRef<HTMLDivElement>(null);

    // 全屏特效：命中触发词的新消息播放表情雨/礼花（微信同款）
    const [activeScreenEffect, setActiveScreenEffect] = useState<ActiveScreenEffect | null>(null);
    const screenFxSeenRef = useRef<Set<string>>(new Set());
    const screenFxMountedAtRef = useRef(Date.now());

    useEffect(() => {
        const seen = screenFxSeenRef.current;
        let fired = activeScreenEffect !== null;
        for (const msg of messages) {
            if (seen.has(msg.id)) continue;
            seen.add(msg.id);
            if (msg.role !== "user" && msg.role !== "assistant") continue;
            // 只对本次打开聊天室之后产生的消息生效，历史加载/翻页不触发
            if (new Date(msg.createdAt).getTime() < screenFxMountedAtRef.current) continue;
            // 骰子气泡：气泡自己翻滚定格，这里同步播全屏骰子（点数一致）
            if (msg.mediaType === "dice") {
                if (fired) continue;
                const face = Math.min(6, Math.max(1, Number(msg.mediaData?.diceFace) || 1));
                setActiveScreenEffect({ runId: msg.id, effect: "dice", emojis: "", diceFace: face });
                fired = true;
                continue;
            }
            if (msg.mediaType || !msg.content) continue;
            const hit = matchChatScreenEffectRule(msg.content);
            if (!hit) continue;
            if (hit.effect === "dice") {
                // 单独一条骰子图标（角色发的）：原地转成骰子气泡（内容保持图标），
                // 点数由系统旁白公布，避免结果挂在角色消息上被模仿
                const face = rollChatDiceFace();
                const patch = {
                    mediaType: "dice" as const,
                    mediaData: { ...msg.mediaData, diceFace: face },
                };
                updateChatMessage(msg.id, patch);
                setMessages(prev => prev.map(m => (m.id === msg.id ? { ...m, ...patch } : m)));
                const diceAside = pushChatMessage({
                    sessionId: session.id,
                    role: "system",
                    content: formatChatDiceResultMessage(face),
                });
                setMessages(prev => [...prev, diceAside]);
                if (!fired) {
                    setActiveScreenEffect({ runId: msg.id, effect: "dice", emojis: "", diceFace: face });
                    fired = true;
                }
                continue;
            }
            if (fired) continue;
            setActiveScreenEffect({ runId: msg.id, ...hit });
            fired = true;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages]);

    useEffect(() => {
        if (!session.backgroundImage) {
            setBgImageResolved(null);
            setBgLoading(false);
            return;
        }
        if (session.backgroundImage.startsWith("data:") || session.backgroundImage.startsWith("http")) {
            setBgImageResolved(session.backgroundImage);
            setBgLoading(false);
            return;
        }
        // It's an ID — load from IndexedDB
        setBgLoading(true);
        import("@/lib/chat-asset-storage").then(({ getChatImageFromIndexedDB }) => {
            getChatImageFromIndexedDB(session.backgroundImage!).then(dataUrl => {
                if (dataUrl) {
                    setBgImageResolved(dataUrl);
                }
                setBgLoading(false);
            });
        });
    }, [session.backgroundImage]);

    // Message Actions state
    const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
    const [contextMenuAnchor, setContextMenuAnchor] = useState<ContextMenuAnchor | null>(null);
    const [isMultiSelectMode, setIsMultiSelectMode] = useState(false);
    const [selectedMessageIds, setSelectedMessageIds] = useState<Set<string>>(new Set());
    const [showConfirmMultiDelete, setShowConfirmMultiDelete] = useState(false);
    const [expandedMonologueId, setExpandedThinkingId] = useState<string | null>(null);
    // 思维链底部弹窗：存当前查看的 reasoning 文本，null = 关闭
    const [reasoningSheetText, setReasoningSheetText] = useState<string | null>(null);
    // 思维链翻译（弹窗内点击翻译按钮生成，切换弹窗内容时重置）
    const [reasoningTranslation, setReasoningTranslation] = useState<string | null>(null);
    const [reasoningTranslating, setReasoningTranslating] = useState(false);
    const [reasoningTranslateError, setReasoningTranslateError] = useState<string | null>(null);
    // 译文显示模式：对照（中文在上）/ 仅中文 / 仅原文
    const [reasoningViewMode, setReasoningViewMode] = useState<"both" | "zh" | "orig">("both");
    useEffect(() => {
        setReasoningTranslation(null);
        setReasoningTranslating(false);
        setReasoningTranslateError(null);
        setReasoningViewMode("both");
    }, [reasoningSheetText]);
    const handleTranslateReasoning = async () => {
        if (!reasoningSheetText || reasoningTranslating) return;
        if (reasoningTranslation) { setReasoningTranslation(null); setReasoningViewMode("both"); return; }
        setReasoningTranslating(true);
        setReasoningTranslateError(null);
        try {
            const result = await translateReasoningText(reasoningSheetText);
            if (result.content) { setReasoningTranslation(result.content); setReasoningViewMode("both"); }
            else setReasoningTranslateError(result.error || "翻译失败，请重试");
        } catch {
            setReasoningTranslateError("翻译失败，请重试");
        } finally {
            setReasoningTranslating(false);
        }
    };
    const [voiceTextIds, setVoiceTextIds] = useState<Set<string>>(new Set());
    const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
    const [editingContent, setEditingContent] = useState("");
    const [editingResponseBatchId, setEditingResponseBatchId] = useState<string | null>(null);
    const [editingResponseRoundId, setEditingResponseRoundId] = useState<string | null>(null);
    const [editingResponseContent, setEditingResponseContent] = useState("");
    const [expandedVoiceCallIds, setExpandedVoiceCallIds] = useState<Set<string>>(new Set());
    const [highlightMessageId, setHighlightMessageId] = useState<string | null>(null);
    const [hasMore, setHasMore] = useState(false);
    const INITIAL_LOAD = CHAT_INITIAL_VISIBLE_MESSAGE_COUNT;
    const LOAD_MORE_COUNT = CHAT_LOAD_MORE_MESSAGE_COUNT;


    const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
    const startPosRef = useRef<{ x: number, y: number } | null>(null);
    const longPressTriggeredRef = useRef(false);

    const scrollRef = useRef<HTMLDivElement>(null);
    const mountedRef = useRef(true);
    const isGeneratingRef = useRef(false);
    const visibleMessagesRef = useRef<ChatMessage[]>([]);
    const hasMoreRef = useRef(false);
    const offlineGenerationInputRef = useRef("");
    useEffect(() => () => { mountedRef.current = false; }, []);
    useEffect(() => { visibleMessagesRef.current = messages; }, [messages]);
    useEffect(() => { hasMoreRef.current = hasMore; }, [hasMore]);
    useChatBottomReserve(
        wrapperRef,
        scrollRef,
        `${session.id}:${offlineMode}:${isMultiSelectMode}:${showEmojiPanel}:${showStickerPanel}:${showPlusMenu}:${theaterMode}:${!!quotingMessage}`,
    );

    const selectStoredMessageWindow = useCallback((allMsgs: ChatMessage[]) => {
        if (allMsgs.length <= INITIAL_LOAD) {
            return { nextMessages: allMsgs, nextHasMore: false };
        }

        const visibleStoredMessages = visibleMessagesRef.current.filter(msg => !isTransientMessage(msg));
        const currentVisibleCount = Math.max(visibleStoredMessages.length, INITIAL_LOAD);

        if (!hasMoreRef.current && visibleStoredMessages.length >= allMsgs.length) {
            return { nextMessages: allMsgs, nextHasMore: false };
        }

        const firstVisibleId = visibleStoredMessages[0]?.id;
        const firstVisibleIndex = firstVisibleId
            ? allMsgs.findIndex(msg => msg.id === firstVisibleId)
            : -1;
        const startIndex = firstVisibleIndex >= 0
            ? firstVisibleIndex
            : Math.max(0, allMsgs.length - currentVisibleCount);

        return {
            nextMessages: allMsgs.slice(startIndex),
            nextHasMore: startIndex > 0,
        };
    }, []);

    const applyStoredMessageWindow = useCallback((allMsgs: ChatMessage[]) => {
        const { nextMessages, nextHasMore } = selectStoredMessageWindow(allMsgs);
        visibleMessagesRef.current = nextMessages;
        hasMoreRef.current = nextHasMore;
        setHasMore(nextHasMore);
        setMessages(nextMessages);
    }, [selectStoredMessageWindow]);

    const syncMessagesFromStorage = useCallback(() => {
        const stored = loadChatMessages(session.id);
        applyStoredMessageWindow(stored);

        // 华提出的“皮之不存，毛将焉附”原则：
        // 若当前有正在进行的邀约/在途状态，且该状态是由某条邀约源消息发起的，
        // 一旦用户删除了该条发起消息（单条删除、删除以下、多选删除等），
        // 相关的邀约/在途状态立即干干净净自动取消，弹窗/胶囊彻底移除，绝不留悬空死状态！
        const currentInvite = activeOfflineInviteRef.current;
        if (currentInvite && currentInvite.sourceBatchId !== "mock_offline_invite") {
            const rootId = currentInvite.initialBatchId || currentInvite.sourceBatchId;
            const hasRoot = stored.some(m =>
                (rootId && (m.responseBatchId === rootId || m.id === rootId)) ||
                (currentInvite.relatedBatchIds && m.responseBatchId && currentInvite.relatedBatchIds.includes(m.responseBatchId)) ||
                m.mediaData?.offlineInvite ||
                (m.role === "system" && m.content && (
                    m.content.includes("你已同意赴约") ||
                    m.content.includes("线下赴约提议") ||
                    m.content.includes("正在动身赶往") ||
                    m.content.includes("前往") ||
                    m.content.includes("正在重新赶往") ||
                    m.content.includes("已到达") ||
                    m.content.includes("已提前到达") ||
                    m.content.includes("就位等候")
                ))
            );
            if (!hasRoot) {
                kvRemove(OFFLINE_INVITE_ACTIVE_SESSION_PREFIX + session.id);
                kvRemove(PENDING_OFFLINE_INVITE_DECLINE_PREFIX + session.id);
                updateActiveOfflineInvite(null);
                setIsOfflineInviteMinimized(false);
                if (remindExpandTimerRef.current) {
                    clearTimeout(remindExpandTimerRef.current);
                    remindExpandTimerRef.current = null;
                }
                showChatToast("邀约发起消息已删除，相关赴约状态已自动取消");
            } else {
                // 🌸 华确立的线下碰面最高事实法则：若当前处于活跃的线下赴约进行中，绝不自动复活线上在途/到达卡片，顶栏稳稳保持线下碰面！
                const isMeetingActive = !session.isGroup && kvGet(OFFLINE_INVITE_ACTIVE_SESSION_PREFIX + session.id) === "1";
                if (isMeetingActive) {
                    return;
                }
                const restored = restoreOfflineInviteFromMessages(stored, currentInvite);
                if (restored && restored.status !== currentInvite.status) {
                    updateActiveOfflineInvite(restored);
                }
            }
        }
    }, [applyStoredMessageWindow, session.id, updateActiveOfflineInvite, showChatToast]);

    const closeContextMenu = () => {
        setActiveMessageId(null);
        setActiveOfflineTarget(null);
        setContextMenuAnchor(null);
    };

    const openMessageContextMenu = (msgId: string, anchor: ContextMenuAnchor) => {
        setActiveOfflineTarget(null);
        setContextMenuAnchor(anchor);
        setActiveMessageId(msgId);
    };

    const openOfflineContextMenu = (target: OfflineActionTarget, anchor: ContextMenuAnchor) => {
        setActiveMessageId(null);
        setContextMenuAnchor(anchor);
        setActiveOfflineTarget(target);
    };

    const getContextMenuInitialStyle = () => {
        const anchor = contextMenuAnchor;
        if (!anchor) return { left: 0, top: 0 };
        return { left: anchor.x, top: Math.max(8, anchor.y - 90) };
    };

    const positionFloatingContextMenu = (el: HTMLDivElement | null) => {
        if (!el || !contextMenuAnchor) return;
        const margin = 8;
        const gap = 12;
        const anchor = contextMenuAnchor;
        const menuW = el.offsetWidth;
        const menuH = el.offsetHeight;
        const viewportW = window.innerWidth;
        const viewportH = window.innerHeight;
        let left = anchor.x - menuW / 2;
        left = Math.max(margin, Math.min(left, viewportW - menuW - margin));
        const placeBelow = anchor.y - menuH - gap < margin;
        let top = placeBelow ? anchor.y + gap : anchor.y - menuH - gap;
        top = Math.max(margin, Math.min(top, viewportH - menuH - margin));
        el.style.left = `${left}px`;
        el.style.top = `${top}px`;
        el.style.right = "auto";
        el.style.bottom = "auto";
        const tri = el.querySelector("[data-menu-triangle]") as HTMLElement | null;
        if (tri) {
            const triLeft = Math.max(14, Math.min(anchor.x - left, menuW - 14));
            tri.style.left = `${triLeft}px`;
            tri.style.right = "auto";
            tri.style.transform = "translateX(-50%)";
            if (placeBelow) {
                tri.style.top = "-6px";
                tri.style.bottom = "auto";
                tri.style.borderTop = "none";
                tri.style.borderBottom = "6px solid var(--ctx-menu-bg, #2c2c2c)";
            } else {
                tri.style.top = "auto";
                tri.style.bottom = "-6px";
                tri.style.borderBottom = "none";
                tri.style.borderTop = "6px solid var(--ctx-menu-bg, #2c2c2c)";
            }
        }
    };

    // --- Music action queue: send music operations as system messages ---
    useEffect(() => {
        const flushCallback = (text: string) => {
            const sysMsg = pushChatMessage({ sessionId: session.id, role: "system", content: text });
            setMessages(prev => [...prev, sysMsg]);
        };
        setChatActive(true, flushCallback);
        return () => { setChatActive(false); };
    }, [session.id]);

    // --- Follow-up: listen for background service events ---
    useEffect(() => {
        const onStarted = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.sessionId === session.id) {
                console.log("[ChatRoom] followup-started received, setting isGenerating=true");
                setIsGenerating(true);
            }
        };
        const onMessageSaved = (e: Event) => {
            const detail = (e as CustomEvent<{ sessionId?: string; message?: ChatMessage }>).detail;
            if (detail?.sessionId !== session.id || !detail.message) return;
            setMessages(prev => (
                prev.some(item => item.id === detail.message!.id)
                    ? prev
                    : [...prev, detail.message!]
            ));
        };
        const onFired = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.sessionId === session.id) {
                console.log("[ChatRoom] followup-fired received, reloading messages, setting isGenerating=false");
                // Reload messages from storage (the service already saved them)
                syncMessagesFromStorage();
                setIsGenerating(false);
            }
        };
        window.addEventListener("followup-started", onStarted);
        window.addEventListener("followup-message-saved", onMessageSaved);
        window.addEventListener("followup-fired", onFired);
        // 生成中途才进入聊天室会错过 followup-started 事件，
        // 挂载时主动查一次后台生成状态，把「正在输入」补回来
        if (isBackgroundReplyGenerating(session.id)) {
            setIsGenerating(true);
        }
        return () => {
            window.removeEventListener("followup-started", onStarted);
            window.removeEventListener("followup-message-saved", onMessageSaved);
            window.removeEventListener("followup-fired", onFired);
        };
    }, [session.id, syncMessagesFromStorage]);

    // Listen for live CSS updates from 小卷
    useEffect(() => {
        const onCSSUpdate = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.sessionId === session.id) {
                setLiveCSS(detail.css || "");
            }
        };
        window.addEventListener("chat-session-css-updated", onCSSUpdate);
        return () => window.removeEventListener("chat-session-css-updated", onCSSUpdate);
    }, [session.id]);

    // Listen for WeChat bridge: reload from storage (preserves rich formatting)
    useEffect(() => {
        const onWeixinUpdate = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.sessionId === session.id) {
                syncMessagesFromStorage();
            }
        };
        const onWeixinGenerating = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.sessionId === session.id) {
                setIsGenerating(Boolean(detail.generating));
                isGeneratingRef.current = Boolean(detail.generating);
            }
        };
        window.addEventListener("weixin-messages-updated", onWeixinUpdate);
        window.addEventListener("weixin-generating", onWeixinGenerating);
        return () => {
            window.removeEventListener("weixin-messages-updated", onWeixinUpdate);
            window.removeEventListener("weixin-generating", onWeixinGenerating);
        };
    }, [session.id, syncMessagesFromStorage]);

    // Listen for messages inserted by other apps, such as share-to-chat cards.
    useEffect(() => {
        const onExternalMessageUpdate = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.sessionId === session.id) {
                syncMessagesFromStorage();
            }
        };
        window.addEventListener("chat-messages-updated", onExternalMessageUpdate);
        return () => window.removeEventListener("chat-messages-updated", onExternalMessageUpdate);
    }, [session.id, syncMessagesFromStorage]);

    // --- Background generation: reload messages when a bg API call completes ---
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.sessionId === session.id) {
                syncMessagesFromStorage();
                isGeneratingRef.current = false;
                setIsGenerating(false);
                clearGenerationLock(session.id);
            }
        };
        window.addEventListener(CHAT_BG_COMPLETE, handler);
        return () => window.removeEventListener(CHAT_BG_COMPLETE, handler);
    }, [session.id, syncMessagesFromStorage]);


    // Group chat: map of characterId → Character for quick lookup
    const groupCharMap = useMemo(() => {
        if (!session.isGroup) return new Map<string, Character>();
        const chars = loadCharacters();
        const map = new Map<string, Character>();
        for (const id of session.participantIds || []) {
            const c = chars.find(ch => ch.id === id);
            if (c) map.set(id, c);
        }
        return map;
    }, [session.isGroup, session.participantIds]);

    // Flat array of group characters for components that need it
    const groupCharacters = useMemo(() => [...groupCharMap.values()], [groupCharMap]);
    const groupCharacterNames = useMemo(() => groupCharacters.map(item => item.name).filter(Boolean).join("、"), [groupCharacters]);

    const activeRegexes = useMemo<RegexConfig[]>(() => {
        const bindings = loadBindingConfig();
        const activeSlot = resolveBinding(bindings, session.isGroup ? undefined : session.contactId, session.isGroup ? "group_chat" : "chat");
        const allRegexes = loadRegexes();
        return (activeSlot.regexIds || [])
            .map(id => allRegexes.find(regex => regex.id === id))
            .filter((regex): regex is RegexConfig => Boolean(regex));
    }, [regexRevision, session.contactId, session.isGroup]);

    // 流式预览的标签净化配置：与引擎同源（当前会话绑定的预设）。预设开启标签式思维链时，
    // 生成过程中的预览也要按同一套标签剥掉思考过程/摘要，否则最终消息里被引擎剥掉的内容
    // 会先在预览气泡里闪现（cleanStreamText 自身不猜配置型标签名，由这里统一传入）。
    const streamPreviewTagConfig = useMemo(() => {
        const bindings = loadBindingConfig();
        const slot = resolveBinding(bindings, session.isGroup ? undefined : session.contactId, session.isGroup ? "group_chat" : "chat");
        const preset = loadPresets().find(item => item.id === slot.presetId) || null;
        const withThoughtCompat = (tag: string): string[] => (tag === "thinking" ? ["thinking", "thought", "think"] : [tag]);
        return {
            online: preset?.online_thinking_enabled === true
                ? withThoughtCompat(preset.online_thinking_tag?.trim() || "thinking")
                : [],
            offlineThinking: preset?.offline_thinking_enabled === true
                ? withThoughtCompat(preset.thinking_tag?.trim() || "thinking")
                : [],
            summaryTag: preset?.story_summary_tag?.trim() || "summary",
            // 预设「剔除文本」：引擎最终会删，预览阶段同步删，避免闪现（字面量删除，成本极低）
            stripTexts: (preset?.strip_texts || []).filter(Boolean),
        };
    }, [regexRevision, session.contactId, session.isGroup]);

    const displayRegexMacroEngine = useMemo(() => {
        const charName = session.isGroup
            ? (session.groupName || groupCharacterNames || "群聊")
            : (character?.name || "对方");
        const engine = new MacroEngine(charName, userIdentity?.name || "你");
        engine.group = groupCharacterNames || (session.isGroup ? (session.groupName || "群聊") : "");
        return engine;
    }, [character?.name, groupCharacterNames, session.groupName, session.isGroup, userIdentity?.name]);

    const getRegexActiveTags = useCallback((isOffline: boolean) => (
        session.isGroup
            ? ["group_chat", isOffline ? "offline" : "text"]
            : ["chat", isOffline ? "offline" : "text"]
    ), [session.isGroup]);

    const renderDisplayText = useCallback((
        text: string,
        placement: 1 | 2 | 5 | 6,
        isOffline = false,
    ) => {
        if (!text || activeRegexes.length === 0) return text;
        return applyDisplayRegex(text, activeRegexes, placement, {
            macroEngine: displayRegexMacroEngine,
            activeTags: getRegexActiveTags(isOffline),
        });
    }, [activeRegexes, displayRegexMacroEngine, getRegexActiveTags]);

    const getMessageDisplayContent = useCallback((message: RenderChatMessage): string => (
        message.displayProjected
            ? message.content
            : renderDisplayText(message.content, message.role === "user" ? 1 : 2, false)
    ), [renderDisplayText]);

    const applyEditTextRegex = useCallback((
        text: string,
        placement: 1 | 2 | 5 | 6,
        isOffline = false,
    ) => {
        if (!text || activeRegexes.length === 0) return text;
        return applyEditRegex(text, activeRegexes, placement, {
            macroEngine: displayRegexMacroEngine,
            activeTags: getRegexActiveTags(isOffline),
        });
    }, [activeRegexes, displayRegexMacroEngine, getRegexActiveTags]);

    // 「丢弃角色输出的无效表情包」开关：滤除名称不在角色表情包/内置表情中的 sticker part
    const stripInvalidStickerParts = useCallback((parts: ParsedMessagePart[], senderCharacterId?: string): ParsedMessagePart[] => {
        if (session.discardInvalidStickers !== true) return parts;
        const characterIds = senderCharacterId
            ? [senderCharacterId]
            : (session.isGroup ? (session.participantIds ?? []) : [session.contactId]);
        return parts.filter(part => part.mediaType !== "sticker"
            || isKnownStickerLabel(part.mediaData?.label || "", characterIds));
    }, [session.discardInvalidStickers, session.isGroup, session.participantIds, session.contactId]);

    const normalizeDisplayParts = useCallback((parts: ReturnType<typeof parseAIResponse>["parts"]) => {
        const charN = character?.name || "对方";
        const userN = userIdentity?.name || "你";
        return parts.flatMap(part => {
            if (
                part.mediaType === "voice_call" ||
                part.mediaType === "video_call" ||
                part.mediaType === "accept_red_packet" ||
                part.mediaType === "decline_red_packet" ||
                part.mediaType === "accept_transfer" ||
                part.mediaType === "decline_transfer" ||
                part.mediaType === "accept_payment_request" ||
                part.mediaType === "decline_payment_request"
            ) {
                return [];
            }
            if (part.mediaType === "music") {
                const title = part.mediaData?.musicTitle || part.mediaData?.label;
                return title ? [{ content: `[音乐:${title}]` }] : [];
            }
            if (part.mediaType === "group_admin_notice") {
                const d = part.mediaData;
                if (!d?.adminAction || !d.adminActorName) return [];
                return [{
                    content: buildGroupAdminNoticeText(d.adminAction, d.adminActorName, d.adminTargetName || "", d.adminMuteMinutes),
                    mediaType: "group_admin_notice" as const,
                    mediaData: d,
                }];
            }
            if (part.mediaType === "poke") {
                const pokeSender = (part.mediaData?.pokeSender === "我" ? charN : part.mediaData?.pokeSender) || charN;
                const pokeTarget = part.mediaData?.pokeTarget || userN;
                return [{
                    content: `${pokeSender} 拍了拍 ${pokeTarget}`,
                    mediaType: "poke" as const,
                    mediaData: { pokeSender, pokeTarget },
                }];
            }
            return [part];
        }).filter(part => part.mediaType || part.content.trim());
    }, [character?.name, userIdentity?.name]);

    useEffect(() => {
        const refreshRegexes = () => setRegexRevision(value => value + 1);
        window.addEventListener("settings-regexes-updated", refreshRegexes);
        window.addEventListener("settings-bindings-updated", refreshRegexes);
        window.addEventListener("settings-presets-updated", refreshRegexes);
        return () => {
            window.removeEventListener("settings-regexes-updated", refreshRegexes);
            window.removeEventListener("settings-bindings-updated", refreshRegexes);
            window.removeEventListener("settings-presets-updated", refreshRegexes);
        };
    }, []);

    const availableShoppingGifts = useMemo(
        () => loadDeliveredShoppingGifts(),
        [messages],
    );

    useEffect(() => {
        setUserIdentity(resolveUserIdentity(session.contactId, "chat"));
        setTransientMessages([]);
        setOfflineMode(kvGet(CHAT_OFFLINE_MODE_PREFIX + session.id) === "1");
        setOfflineVisibleCount(OFFLINE_INITIAL_LOAD);
        offlineTextInputRef.current?.clear();
        setPendingOfflineUserText("");
        setIsOfflineGenerating(false);
        setActiveOfflineTarget(null);
        setContextMenuAnchor(null);
        setIsMultiSelectMode(false);
        setSelectedMessageIds(new Set());
        setShowConfirmMultiDelete(false);
        setEditingOfflineTarget(null);
        setEditingOfflineContent("");
        setOfflineTurns(loadChatOfflineTurns(session.id));

        // Prewarm sticker cache for all relevant characters, then load messages
        const allMsgs = loadChatMessages(session.id);
        const msgs = allMsgs.length > INITIAL_LOAD ? allMsgs.slice(-INITIAL_LOAD) : allMsgs;
        const nextHasMore = allMsgs.length > INITIAL_LOAD;
        hasMoreRef.current = nextHasMore;
        setHasMore(nextHasMore);
        const charIds = session.isGroup && session.participantIds
            ? session.participantIds
            : [session.contactId];
        Promise.all(charIds.map(id => prewarmStickerCache(id))).then(() => {
            setStickerReady(true);
            needsInitialScrollRef.current = true;
            prevMsgCountRef.current = 0;
            visibleMessagesRef.current = msgs;
            setMessages(msgs);
        });

        // If a background generation is still in progress, show loading indicator.
        // Old or expired locks are cleared so the room cannot stay frozen forever.
        if (hasActiveGenerationLock(session.id)) {
            isGeneratingRef.current = true;
            setIsGenerating(true);
        } else {
            isGeneratingRef.current = false;
            setIsGenerating(false);
        }

        // Auto-reply logic for newly added friends with a greeting
        const freshSession = loadChatSessions().find(s => s.id === session.id);
        const alreadyReplied = freshSession?.autoReplied;

        if (session.isGroup && !alreadyReplied && msgs.length === 1 && msgs[0].role === "system") {
            // Group chat initial greeting: single API call for all members
            const sessions2 = loadChatSessions();
            const sessIdx2 = sessions2.findIndex(s => s.id === session.id);
            if (sessIdx2 !== -1) {
                sessions2[sessIdx2].autoReplied = true;
                saveChatSessions(sessions2);
            }

            void runManagedGeneration({ history: msgs });
        } else if (!session.isGroup && !alreadyReplied &&
            msgs.length === 2 &&
            msgs[0].role === "system" && msgs[0].content.includes("已添加了") &&
            msgs[1].role === "user") {

            const sessions = loadChatSessions();
            const sessIdx = sessions.findIndex(s => s.id === session.id);
            if (sessIdx !== -1) {
                sessions[sessIdx].autoReplied = true;
                saveChatSessions(sessions);
            }

            void runManagedGeneration({ history: msgs, onDecline: triggerReply });
        }

        // Friend request accepted: trigger AI reply (localStorage flag set by handleAcceptFriendRequest)
        const pendingKey = PENDING_REPLY_PREFIX + session.id;
        if (kvGet(pendingKey)) {
            kvRemove(pendingKey);
            void runManagedGeneration({ history: msgs, onDecline: triggerReply });
        }
    }, [session.id]);

    const needsInitialScrollRef = useRef(true);
    const prevMsgCountRef = useRef(0);
    const loadingMoreRef = useRef(false);
    const loadMoreScrollRestoreRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
    const offlineLoadMoreRestoreRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);
    const loadMoreAnchorRef = useRef<ScrollAnchorSnapshot | null>(null);
    const loadMoreResizeObserverRef = useRef<ResizeObserver | null>(null);
    const loadMoreAnchorTimerRef = useRef<number | null>(null);
    const initialScrollVersionRef = useRef(0);
    const pendingSearchJumpRef = useRef<PendingMessageJump | null>(null);
    const searchJumpHighlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const stopLoadMoreAnchorTracking = useCallback(() => {
        loadMoreResizeObserverRef.current?.disconnect();
        loadMoreResizeObserverRef.current = null;
        if (loadMoreAnchorTimerRef.current !== null) {
            window.clearTimeout(loadMoreAnchorTimerRef.current);
            loadMoreAnchorTimerRef.current = null;
        }
        loadMoreAnchorRef.current = null;
    }, []);

    useEffect(() => stopLoadMoreAnchorTracking, [stopLoadMoreAnchorTracking]);
    useEffect(() => () => {
        if (searchJumpHighlightTimerRef.current) clearTimeout(searchJumpHighlightTimerRef.current);
    }, []);

    const flashMessageHighlight = useCallback((messageId: string) => {
        setHighlightMessageId(messageId);
        if (searchJumpHighlightTimerRef.current) {
            clearTimeout(searchJumpHighlightTimerRef.current);
        }
        searchJumpHighlightTimerRef.current = setTimeout(() => {
            setHighlightMessageId(current => current === messageId ? null : current);
            searchJumpHighlightTimerRef.current = null;
        }, 2000);
    }, []);

    const captureScrollAnchor = useCallback((): ScrollAnchorSnapshot | null => {
        const el = scrollRef.current;
        if (!el) return null;
        const containerRect = el.getBoundingClientRect();
        const candidates = Array.from(el.querySelectorAll<HTMLElement>('[id^="message-"]'));
        for (const candidate of candidates) {
            const rect = candidate.getBoundingClientRect();
            if (rect.bottom <= containerRect.top) continue;
            if (rect.top >= containerRect.bottom) continue;
            return {
                messageId: candidate.id.replace(/^message-/, ""),
                offsetDelta: candidate.offsetTop - el.scrollTop,
            };
        }
        return null;
    }, []);

    const restoreScrollAnchor = useCallback((anchor: ScrollAnchorSnapshot | null): boolean => {
        const el = scrollRef.current;
        if (!el || !anchor) return false;
        const target = document.getElementById(`message-${anchor.messageId}`);
        if (!target) return false;
        el.scrollTop = target.offsetTop - anchor.offsetDelta;
        return true;
    }, []);

    const watchLoadMoreAnchorImages = useCallback((anchor: ScrollAnchorSnapshot | null) => {
        const el = scrollRef.current;
        if (!el || !anchor) {
            stopLoadMoreAnchorTracking();
            return;
        }
        const target = document.getElementById(`message-${anchor.messageId}`);
        if (!target) {
            stopLoadMoreAnchorTracking();
            return;
        }

        loadMoreResizeObserverRef.current?.disconnect();
        loadMoreResizeObserverRef.current = null;
        if (loadMoreAnchorTimerRef.current !== null) {
            window.clearTimeout(loadMoreAnchorTimerRef.current);
            loadMoreAnchorTimerRef.current = null;
        }

        const targetTop = target.getBoundingClientRect().top;
        const imagesAboveAnchor = Array.from(el.querySelectorAll("img"))
            .filter(img => img.getBoundingClientRect().top < targetTop);

        if (imagesAboveAnchor.length === 0) {
            stopLoadMoreAnchorTracking();
            return;
        }

        const restoreAfterImageResize = () => {
            if (loadMoreAnchorRef.current !== anchor) return;
            restoreScrollAnchor(anchor);
            requestAnimationFrame(() => restoreScrollAnchor(anchor));
        };

        if (typeof ResizeObserver !== "undefined") {
            const observer = new ResizeObserver(restoreAfterImageResize);
            imagesAboveAnchor.forEach(img => observer.observe(img));
            loadMoreResizeObserverRef.current = observer;
        }

        imagesAboveAnchor.forEach(img => {
            img.addEventListener("load", restoreAfterImageResize, { once: true });
            img.addEventListener("error", restoreAfterImageResize, { once: true });
            img.decode?.().then(restoreAfterImageResize).catch(() => {});
        });

        loadMoreAnchorTimerRef.current = window.setTimeout(() => {
            if (loadMoreAnchorRef.current === anchor) {
                stopLoadMoreAnchorTracking();
            }
        }, 3000);
    }, [restoreScrollAnchor, stopLoadMoreAnchorTracking]);

    const loadMore = useCallback(() => {
        if (!hasMore || loadingMoreRef.current) return;
        stopLoadMoreAnchorTracking();
        loadingMoreRef.current = true;
        initialScrollVersionRef.current += 1;
        const el = scrollRef.current;
        if (el) {
            loadMoreAnchorRef.current = captureScrollAnchor();
            loadMoreScrollRestoreRef.current = {
                scrollHeight: el.scrollHeight,
                scrollTop: el.scrollTop,
            };
        }
        const allMsgs = loadChatMessages(session.id);
        const currentCount = messages.length;
        const nextCount = Math.min(currentCount + LOAD_MORE_COUNT, allMsgs.length);
        if (nextCount <= currentCount) {
            hasMoreRef.current = false;
            setHasMore(false);
            stopLoadMoreAnchorTracking();
            loadMoreScrollRestoreRef.current = null;
            loadingMoreRef.current = false;
            return;
        }
        const nextMessages = allMsgs.slice(-nextCount);
        const nextHasMore = nextCount < allMsgs.length;
        visibleMessagesRef.current = nextMessages;
        hasMoreRef.current = nextHasMore;
        setHasMore(nextHasMore);
        setMessages(nextMessages);
    }, [captureScrollAnchor, hasMore, messages.length, session.id, stopLoadMoreAnchorTracking]);
    // useLayoutEffect: runs synchronously after DOM mutation, before browser paint
    // Prevents flash of wrong scroll position, works reliably under transform: scale()
    const displayMessages = useMemo(() => {
        return [...messages, ...transientMessages]
            .map((msg, index) => ({ msg, index }))
            .sort((a, b) => {
                const orderDiff = compareChatMessages(a.msg, b.msg);
                return orderDiff !== 0 ? orderDiff : a.index - b.index;
            })
            .map(item => item.msg);
    }, [messages, transientMessages]);

    useLayoutEffect(() => {
        const el = scrollRef.current;
        const anchor = loadMoreAnchorRef.current;
        const loadMoreRestore = loadMoreScrollRestoreRef.current;
        if (loadMoreRestore) {
            if (el && !restoreScrollAnchor(anchor)) {
                el.scrollTop = loadMoreRestore.scrollTop + (el.scrollHeight - loadMoreRestore.scrollHeight);
            }
            loadMoreScrollRestoreRef.current = null;
            loadingMoreRef.current = false;
            prevMsgCountRef.current = displayMessages.length;
            watchLoadMoreAnchorImages(anchor);
            return;
        }

        const pendingJump = pendingSearchJumpRef.current;
        if (pendingJump && el) {
            const jumpIds = pendingJump.fallbackMessageId && pendingJump.fallbackMessageId !== pendingJump.messageId
                ? [pendingJump.messageId, pendingJump.fallbackMessageId]
                : [pendingJump.messageId];
            const targetId = jumpIds.find(id => document.getElementById(`message-${id}`));
            const target = targetId ? document.getElementById(`message-${targetId}`) as HTMLElement | null : null;
            if (targetId && target) {
                pendingSearchJumpRef.current = null;
                scrollElementWithinContainer(el, target, { behavior: "smooth", block: "center" });
                flashMessageHighlight(targetId);
            } else {
                pendingSearchJumpRef.current = null;
            }
            prevMsgCountRef.current = displayMessages.length;
            return;
        }

        if (needsInitialScrollRef.current && displayMessages.length > 0 && el) {
            needsInitialScrollRef.current = false;
            prevMsgCountRef.current = displayMessages.length;
            const scrollVersion = ++initialScrollVersionRef.current;

            // Wait for all images inside the scroll container to finish loading, then scroll once
            const imgs = Array.from(el.querySelectorAll("img"));
            const pending = imgs.filter(img => !img.complete);
            console.log(`[SCROLL] imgs total=${imgs.length}, pending=${pending.length}`);

            if (pending.length === 0) {
                el.scrollTop = el.scrollHeight;
                console.log(`[SCROLL] done (no pending), sH=${el.scrollHeight}`);
            } else {
                let loaded = 0;
                const onDone = () => {
                    loaded++;
                    if (loaded >= pending.length) {
                        if (initialScrollVersionRef.current !== scrollVersion || loadingMoreRef.current) return;
                        el.scrollTop = el.scrollHeight;
                        console.log(`[SCROLL] done (all loaded), sH=${el.scrollHeight}`);
                    }
                };
                for (const img of pending) {
                    img.addEventListener("load", onDone, { once: true });
                    img.addEventListener("error", onDone, { once: true });
                }
            }
        } else if (displayMessages.length > prevMsgCountRef.current && el) {
            el.scrollTop = el.scrollHeight;
        }
        prevMsgCountRef.current = displayMessages.length;
    }, [displayMessages, flashMessageHighlight, restoreScrollAnchor, watchLoadMoreAnchorImages]);

    // 华敏锐发现的体验痛点：从线下切回线上时，必须自动平滑停留在最新一条消息底部，坚决杜绝手动滑到底部的繁琐操作
    useLayoutEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
        isNearBottomRef.current = true;
        if (!offlineMode) {
            requestAnimationFrame(() => {
                if (scrollRef.current) {
                    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                    isNearBottomRef.current = true;
                }
            });
        }
    }, [offlineMode, offlineTurns.length, isOfflineGenerating, pendingOfflineUserText]);

    // 流式预览增量更新时跟随滚动到底：仅在用户本来就停在底部附近时跟随，
    // 用户上翻历史/查看旧消息时绝不拽回底部（否则长回复生成中根本无法阅读）。
    const isNearBottomRef = useRef(true);
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const onScroll = () => {
            // 距底部 < 120px 视为"在底部附近"；用户上翻即停用自动跟随
            isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
        };
        el.addEventListener("scroll", onScroll, { passive: true });
        return () => el.removeEventListener("scroll", onScroll);
    }, []);
    // 只在接近底部时才跟随，且用 rAF 合并到下一帧，避免每帧 setState 后 layout 抖动
    const streamFollowRef = useRef(0);
    const followStreamScroll = useCallback(() => {
        if (streamFollowRef.current) return;
        streamFollowRef.current = window.requestAnimationFrame(() => {
            streamFollowRef.current = 0;
            if (!isNearBottomRef.current) return;
            const el = scrollRef.current;
            if (el) el.scrollTop = el.scrollHeight;
        });
    }, []);
    useLayoutEffect(() => {
        if (!streamPreview && !offlineStreamPreview) return;
        followStreamScroll();
    }, [streamPreview, offlineStreamPreview, offlineMode, followStreamScroll]);

    // 卸载时清理挂起的流式预览 rAF 帧，防止切会话后回调残留触发 setState
    useEffect(() => {
        return () => {
            if (streamParseFrameRef.current) cancelAnimationFrame(streamParseFrameRef.current);
            if (offlineStreamFrameRef.current) cancelAnimationFrame(offlineStreamFrameRef.current);
            if (streamFollowRef.current) cancelAnimationFrame(streamFollowRef.current);
            streamParseFrameRef.current = 0;
            offlineStreamFrameRef.current = 0;
            streamFollowRef.current = 0;
        };
    }, []);

    // Sync current session+messages to debug store for DebugPromptPanel
    useEffect(() => {
        setDebugChatState({ session, messages });
        return () => { setDebugChatState(null); };
    }, [session, messages]);

    // Listen for AI-initiated call triggers from follow-up service
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent).detail;
            if (detail?.sessionId === session.id) {
                // Only handle call if this ChatRoom is currently visible
                if (!isChatRoomElementVisible(wrapperRef.current)) return;
                setCallInitiator("character");
                if (detail.type === "voice") setShowVoiceCall(true);
                else if (detail.type === "video") setShowVideoCall(true);
                // Dismiss the global incoming-call bar (if showing)
                window.dispatchEvent(new CustomEvent("incoming-call-dismiss"));
            }
        };
        window.addEventListener("ai-call-trigger", handler);
        return () => window.removeEventListener("ai-call-trigger", handler);
    }, [session.id]);

    // Helper: handle AI accepting/declining user's red packet or transfer
    const buildAssistantActionEditMeta = (rawResponseText: string) => ({
        responseBatchId: createResponseBatchId(),
        rawResponseText,
    });

    const handleAIMediaAction = (actionType: string, charN: string, userN: string) => {
        // Find the target message in current messages (most recent matching user message with pending status)
        const targetMediaType = actionType.includes("payment_request")
            ? "payment_request"
            : actionType.includes("red_packet") ? "red_packet" : "transfer";
        const targetMsg = [...messages].reverse().find(
            m => m.role === "user" && m.mediaType === targetMediaType && m.mediaData?.status === "pending"
        );
        if (!targetMsg) return;

        let newStatus: "opened" | "received" | "declined" | "paid";
        let sysText: string;
        let rawResponseText: string;
        if (actionType === "accept_red_packet") {
            newStatus = "opened";
            const amt = targetMsg.mediaData?.amount;
            const amtStr = amt != null ? `，金额:${amt}元` : "";
            sysText = `${charN}领取了${userN}的红包${amtStr}`;
            rawResponseText = `[${charN}领取了${userN}的红包]`;
        } else if (actionType === "decline_red_packet") {
            newStatus = "declined";
            sysText = `${charN}退回了${userN}的红包`;
            rawResponseText = `[${charN}退回了${userN}的红包]`;
        } else if (actionType === "accept_transfer") {
            newStatus = "received";
            sysText = `${charN}领取了${userN}的转账`;
            rawResponseText = `[${charN}领取了${userN}的转账]`;
        } else if (actionType === "accept_payment_request") {
            newStatus = "paid";
            sysText = `${charN}接受了${userN}的代付请求`;
            rawResponseText = `[${charN}接受了${userN}的代付]`;
            settleShoppingPaymentRequest({
                orderId: targetMsg.mediaData?.shoppingOrderId,
                requestId: targetMsg.mediaData?.paymentRequestId,
                accepted: true,
                payerCharacterId: session.contactId,
                payerCharacterName: charN,
            });
        } else if (actionType === "decline_payment_request") {
            newStatus = "declined";
            sysText = `${charN}拒绝了${userN}的代付请求`;
            rawResponseText = `[${charN}拒绝了${userN}的代付]`;
            settleShoppingPaymentRequest({
                orderId: targetMsg.mediaData?.shoppingOrderId,
                requestId: targetMsg.mediaData?.paymentRequestId,
                accepted: false,
                payerCharacterId: session.contactId,
                payerCharacterName: charN,
            });
        } else {
            newStatus = "declined";
            sysText = `${charN}拒收了${userN}的转账`;
            rawResponseText = `[${charN}拒收了${userN}的转账]`;
        }

        const refundReason = actionType === "decline_red_packet" ? "红包退回" : actionType === "decline_transfer" ? "转账退回" : null;
        const updatedMediaData = {
            ...(refundReason ? refundOutgoingMoneyMessage(targetMsg, refundReason) : targetMsg.mediaData),
            status: newStatus,
            ...(targetMediaType === "payment_request" ? {
                paymentResolvedAt: new Date().toISOString(),
                paymentPayerId: session.contactId,
                paymentPayerName: charN,
            } : {}),
        };
        updateMessageMediaData(targetMsg.id, updatedMediaData);
        setMessages(prev => prev.map(m =>
            m.id === targetMsg.id ? { ...m, mediaData: updatedMediaData } : m
        ));
        // Insert action notification (correct role + mediaType for prompt formatting)
        const sysMsg = pushChatMessage({
            sessionId: session.id,
            role: "assistant",
            content: sysText,
            mediaType: actionType as ChatMessage["mediaType"],
            ...buildAssistantActionEditMeta(rawResponseText),
        });
        setMessages(prev => [...prev, sysMsg]);
    };

    // ── 群聊红包/转账动作处理 ──
    // 获取消息发送人显示名（user→用户名，assistant→角色名）
    const getMsgSender = (m: ChatMessage) =>
        m.role === "user" ? (userIdentity?.name || "你") : (m.senderName || "未知");

    // 红包：按 ownerName 匹配发送人，领取/退回
    // 拼手气红包：随机分配金额（二倍均值法）
    const calcRedPacketShare = (totalAmount: number, claimedAmounts: Record<string, number>, totalRecipients: number): number => {
        const claimedTotal = Object.values(claimedAmounts).reduce((s, v) => s + v, 0);
        const remaining = totalAmount - claimedTotal;
        const claimedCount = Object.keys(claimedAmounts).length;
        const leftCount = totalRecipients - claimedCount;
        if (leftCount <= 1) return Math.round(remaining * 100) / 100; // 最后一个人拿剩余
        const avg = remaining / leftCount;
        const max = avg * 2;
        const share = Math.max(0.01, Math.random() * max);
        return Math.round(Math.min(share, remaining - 0.01 * (leftCount - 1)) * 100) / 100;
    };

    const handleGroupRedPacketAction = (action: "accept" | "decline", claimerName: string, ownerName?: string) => {
        // 从 localStorage 读最新数据，避免 processGroupParts 循环中多人领取时闭包过期
        const freshMessages = loadChatMessages(session.id);
        const targetMsg = [...freshMessages].reverse().find(m => {
            if (m.mediaType !== "red_packet") return false;
            if (m.mediaData?.status !== "pending" && m.mediaData?.status !== "opened") return false;
            // 已被领完的跳过
            if (m.mediaData?.status === "opened") {
                const cnt = m.mediaData?.count || 1;
                if ((m.mediaData?.claimedBy?.length || 0) >= cnt) return false;
            }
            if (!ownerName) return true;
            return getMsgSender(m) === ownerName;
        });
        if (!targetMsg) return;
        // 已领过的不能重复领
        if (targetMsg.mediaData?.claimedBy?.includes(claimerName)) return;
        const owner = ownerName || getMsgSender(targetMsg);
        const ownerDisplay = owner === (userIdentity?.name) ? "你" : owner;
        // 发红包的人自己不能领
        if (claimerName === owner) return;
        const totalRecipients = targetMsg.mediaData?.count || 1;
        // 已领满则拒绝
        if ((targetMsg.mediaData?.claimedBy?.length || 0) >= totalRecipients) return;
        if (action === "accept") {
            const prevAmounts = targetMsg.mediaData?.claimedAmounts || {};
            const share = calcRedPacketShare(targetMsg.mediaData?.amount || 0, prevAmounts, totalRecipients);
            const claimedBy = [...(targetMsg.mediaData?.claimedBy || []), claimerName];
            const claimedAmounts = { ...prevAmounts, [claimerName]: share };
            // 所有人都领完才标记 opened，否则保持 pending 让其他人继续领
            const allClaimed = claimedBy.length >= totalRecipients;
            const newStatus = allClaimed ? "opened" as const : "pending" as const;
            const updatedData = { ...targetMsg.mediaData, status: newStatus, claimedBy, claimedAmounts };
            updateMessageMediaData(targetMsg.id, updatedData);
            setMessages(prev => prev.map(m => m.id === targetMsg.id ? { ...m, mediaData: updatedData } : m));
            const sysMsg = pushChatMessage({
                sessionId: session.id,
                role: "assistant",
                content: `${claimerName}领取了${ownerDisplay}的红包，金额:${share}元`,
                mediaType: "accept_red_packet",
                mediaData: { claimer: claimerName, owner: ownerDisplay },
                senderName: claimerName,
                ...buildAssistantActionEditMeta(`[${claimerName}领取了${ownerDisplay}的红包]`),
            });
            setMessages(prev => [...prev, sysMsg]);
        } else {
            const sysMsg = pushChatMessage({
                sessionId: session.id,
                role: "assistant",
                content: `${claimerName}退回了${ownerDisplay}的红包`,
                mediaType: "decline_red_packet",
                mediaData: { claimer: claimerName, owner: ownerDisplay },
                senderName: claimerName,
                ...buildAssistantActionEditMeta(`[${claimerName}退回了${ownerDisplay}的红包]`),
            });
            setMessages(prev => [...prev, sysMsg]);
        }
    };

    // 转账：按 ownerName 匹配发送人，且验证 claimerName === recipientName
    const handleGroupTransferAction = (action: "accept" | "decline", claimerName: string, ownerName?: string) => {
        const freshMessages = loadChatMessages(session.id);
        const targetMsg = [...freshMessages].reverse().find(m => {
            if (m.mediaType !== "transfer" || m.mediaData?.status !== "pending") return false;
            if (!ownerName) return true;
            const sender = m.mediaData?.senderName || getMsgSender(m);
            return sender === ownerName;
        });
        if (!targetMsg) return;
        // 验证：只有收款人才能接受/拒收
        const recipient = targetMsg.mediaData?.recipientName;
        if (recipient && recipient !== claimerName) return; // 非收款人，操作无效
        const owner = ownerName || targetMsg.mediaData?.senderName || getMsgSender(targetMsg);
        const ownerDisplay = owner === (userIdentity?.name) ? "你" : owner;
        const newStatus = action === "accept" ? "received" as const : "declined" as const;
        const refundData = action === "decline" && targetMsg.role === "user"
            ? refundOutgoingMoneyMessage(targetMsg, "转账退回")
            : targetMsg.mediaData;
        const updatedData = { ...refundData, status: newStatus };
        updateMessageMediaData(targetMsg.id, updatedData);
        setMessages(prev => prev.map(m => m.id === targetMsg.id ? { ...m, mediaData: updatedData } : m));
        const isAccept = action === "accept";
        const sysText = isAccept
            ? `${claimerName}领取了${ownerDisplay}的转账`
            : `${claimerName}退回了${ownerDisplay}的转账`;
        const sysMsg = pushChatMessage({
            sessionId: session.id,
            role: "assistant",
            content: sysText,
            mediaType: isAccept ? "accept_transfer" : "decline_transfer",
            mediaData: { claimer: claimerName, owner: ownerDisplay },
            senderName: claimerName,
            ...buildAssistantActionEditMeta(
                isAccept
                    ? `[${claimerName}领取了${ownerDisplay}的转账]`
                    : `[${claimerName}退回了${ownerDisplay}的转账]`
            ),
        });
        setMessages(prev => [...prev, sysMsg]);
    };

    const handleGroupPaymentRequestAction = (action: "accept" | "decline", claimerName: string, ownerName?: string) => {
        const freshMessages = loadChatMessages(session.id);
        const targetMsg = [...freshMessages].reverse().find(m => {
            if (m.mediaType !== "payment_request" || m.mediaData?.status !== "pending") return false;
            if (!ownerName) return true;
            const sender = m.mediaData?.paymentRequesterName || m.mediaData?.senderName || getMsgSender(m);
            return sender === ownerName;
        });
        if (!targetMsg) return;
        const owner = ownerName || targetMsg.mediaData?.paymentRequesterName || targetMsg.mediaData?.senderName || getMsgSender(targetMsg);
        const ownerDisplay = owner === (userIdentity?.name) ? "你" : owner;
        const isAccept = action === "accept";
        const updatedData = {
            ...targetMsg.mediaData,
            status: isAccept ? "paid" as const : "declined" as const,
            paymentResolvedAt: new Date().toISOString(),
            paymentPayerName: claimerName,
        };
        if (targetMsg.role === "user") {
            settleShoppingPaymentRequest({
                orderId: targetMsg.mediaData?.shoppingOrderId,
                requestId: targetMsg.mediaData?.paymentRequestId,
                accepted: isAccept,
                payerCharacterName: claimerName,
            });
        }
        updateMessageMediaData(targetMsg.id, updatedData);
        setMessages(prev => prev.map(m => m.id === targetMsg.id ? { ...m, mediaData: updatedData } : m));
        const sysText = isAccept
            ? `${claimerName}接受了${ownerDisplay}的代付请求`
            : `${claimerName}拒绝了${ownerDisplay}的代付请求`;
        const sysMsg = pushChatMessage({
            sessionId: session.id,
            role: "assistant",
            content: sysText,
            mediaType: isAccept ? "accept_payment_request" : "decline_payment_request",
            mediaData: { claimer: claimerName, owner: ownerDisplay },
            senderName: claimerName,
            ...buildAssistantActionEditMeta(
                isAccept
                    ? `[${claimerName}接受了${ownerDisplay}的代付]`
                    : `[${claimerName}拒绝了${ownerDisplay}的代付]`
            ),
        });
        setMessages(prev => [...prev, sysMsg]);
    };

    // Group admin action from AI output: validate permission + apply.
    // Returns display fields, or null when the tag must be silently dropped.
    const applyAIGroupAdminAction = (actorCharacterId: string, data: ChatMessage["mediaData"]) => {
        if (!session.isGroup || !data?.adminAction) return null;
        const action = data.adminAction as GroupAdminAction;
        const userN = userIdentity?.name || "用户";
        const actorKey = resolveGroupMemberKeyByName(session, data.adminActorName || "", userN);
        // 执行人必须是输出该标签的角色本人
        if (!actorKey || actorKey !== actorCharacterId) return null;
        const targetKey = resolveGroupMemberKeyByName(session, data.adminTargetName || "", userN, { includeOutsiders: action === "invite" });
        if (!targetKey) return null;
        if (!canGroupAdminAct(session, actorKey, action, targetKey)) return null;
        applyGroupAdminAction(session, action, actorKey, targetKey, data.adminMuteMinutes);
        const actorDisplay = getGroupMemberDisplayName(actorKey, userN);
        const targetDisplay = getGroupMemberDisplayName(targetKey, userN);
        return {
            content: buildGroupAdminNoticeText(action, actorDisplay, targetDisplay, data.adminMuteMinutes),
            mediaData: {
                adminAction: action,
                adminActorName: actorDisplay,
                adminTargetName: targetDisplay,
                ...(action === "mute" ? { adminMuteMinutes: data.adminMuteMinutes || 10 } : {}),
            } as ChatMessage["mediaData"],
            senderName: actorDisplay,
        };
    };

    // Helper: process group chat AI response parts with media filtering
    const processGroupParts = async (
        results: { characterId: string; characterName: string; responseText: string }[],
        msgsSetter: typeof setMessages,
        guard?: GenerationRunGuard,
        roundReasoning?: string,
        // 流式生成已让用户看着内容长出来了：落库改为立即放出，跳过 800ms 模拟打字节奏，
        // 否则预览流完一遍后消息又逐条「重播」一遍，观感像两次流式
        revealOptions?: { instantReveal?: boolean },
    ) => {
        throwIfGenerationStopped(guard);
        const responseRoundId = createResponseRoundId();
        const editableResponseText = buildEditableGroupRoundText(results);
        // 群聊一轮回复只有一份思维链，挂到本轮第一条落库消息上
        let reasoningAttached = !roundReasoning;
        const takeRoundReasoning = (): string | undefined => {
            if (reasoningAttached) return undefined;
            reasoningAttached = true;
            return roundReasoning;
        };
        const imageReplacementTasks: Promise<unknown>[] = [];
        const currentStateByCharacter = new Map<string, StateValue[]>();
        const getCurrentStateForCharacter = (characterId: string): StateValue[] => {
            const cached = currentStateByCharacter.get(characterId);
            if (cached) return cached;
            const latest = getLatestCharacterStateValues(characterId);
            currentStateByCharacter.set(characterId, latest);
            return latest;
        };
        let isFirst = true;
        for (const r of results) {
            throwIfGenerationStopped(guard);
            // 被踢出或禁言中的角色本轮不再发声
            if (!(session.participantIds || []).includes(r.characterId)) continue;
            if (isGroupMuted(session, r.characterId)) continue;
            const responseBatchId = createResponseBatchId();
            const { parts: rawParts, stateValues, freshStateValues, statusPanel, innerMonologue } = parseAIResponse(r.responseText, getCurrentStateForCharacter(r.characterId));
            const parts = stripInvalidStickerParts(rawParts, r.characterId);
            let attachedState = false;
            let savedAnyPart = false;
            for (const part of parts) {
                throwIfGenerationStopped(guard);
                // Filter action types
                if (part.mediaType === "voice_call" || part.mediaType === "video_call") {
                    if (session.isSpectator) continue; // 围观群不能把用户卷进群通话
                    const callType = part.mediaType === "voice_call" ? "voice" : "video";
                    const isHidden = !mountedRef.current || !isChatRoomElementVisible(wrapperRef.current);
                    if (isHidden) {
                        window.dispatchEvent(new CustomEvent("ai-call-trigger", {
                            detail: { sessionId: session.id, type: callType, characterName: r.characterName },
                        }));
                    } else {
                        setCallInitiator("character");
                        setCallInitiatorName(r.characterName);
                        if (callType === "voice") setShowVoiceCall(true);
                        else setShowVideoCall(true);
                    }
                    continue;
                }
                if (part.mediaType === "accept_red_packet") {
                    throwIfGenerationStopped(guard);
                    const claimer = part.mediaData?.claimer || r.characterName;
                    const owner = part.mediaData?.owner;
                    handleGroupRedPacketAction("accept", claimer, owner);
                    continue;
                }
                if (part.mediaType === "decline_red_packet") {
                    throwIfGenerationStopped(guard);
                    const claimer = part.mediaData?.claimer || r.characterName;
                    const owner = part.mediaData?.owner;
                    handleGroupRedPacketAction("decline", claimer, owner);
                    continue;
                }
                if (part.mediaType === "accept_transfer") {
                    throwIfGenerationStopped(guard);
                    const claimer = part.mediaData?.claimer || r.characterName;
                    const owner = part.mediaData?.owner;
                    handleGroupTransferAction("accept", claimer, owner);
                    continue;
                }
                if (part.mediaType === "decline_transfer") {
                    throwIfGenerationStopped(guard);
                    const claimer = part.mediaData?.claimer || r.characterName;
                    const owner = part.mediaData?.owner;
                    handleGroupTransferAction("decline", claimer, owner);
                    continue;
                }
                if (part.mediaType === "accept_payment_request") {
                    throwIfGenerationStopped(guard);
                    const claimer = part.mediaData?.claimer || r.characterName;
                    const owner = part.mediaData?.owner;
                    handleGroupPaymentRequestAction("accept", claimer, owner);
                    continue;
                }
                if (part.mediaType === "decline_payment_request") {
                    throwIfGenerationStopped(guard);
                    const claimer = part.mediaData?.claimer || r.characterName;
                    const owner = part.mediaData?.owner;
                    handleGroupPaymentRequestAction("decline", claimer, owner);
                    continue;
                }
                if (part.mediaType === "group_admin_notice") {
                    if (!isFirst && !revealOptions?.instantReveal) await abortableDelay(800, guard?.signal);
                    throwIfGenerationStopped(guard);
                    const applied = applyAIGroupAdminAction(r.characterId, part.mediaData);
                    if (!applied) continue; // 无权限/名字不合法：整个标签静默丢弃
                    isFirst = false;
                    // 带上段落自己的 batch 元数据（与拍一拍同款）：
                    // 投影层按 batch 连续排布，缺了会被后续气泡挤到整段末尾
                    const msg = pushChatMessage({
                        sessionId: session.id, role: "assistant",
                        content: applied.content,
                        mediaType: "group_admin_notice",
                        mediaData: applied.mediaData,
                        responseBatchId,
                        rawResponseText: r.responseText,
                        responseRoundId,
                        editableResponseText,
                        // 系统小字样式不显示面板，不在这里挂载（见 canCarryFoldedPanel）
                        senderCharacterId: r.characterId,
                        senderName: applied.senderName,
                    });
                    savedAnyPart = true;
                    msgsSetter(prev => [...prev, msg]);
                    continue;
                }
                // Poke: keep it as a poke media message so UI renders it as a system notice.
                if (part.mediaType === "poke") {
                    const pokeSender = (part.mediaData?.pokeSender === "我" ? r.characterName : part.mediaData?.pokeSender) || r.characterName;
                    const pokeTarget = part.mediaData?.pokeTarget || "某人";
                    if (!isFirst && !revealOptions?.instantReveal) await abortableDelay(800, guard?.signal);
                    throwIfGenerationStopped(guard);
                    isFirst = false;
                    const msg = pushChatMessage({
                        sessionId: session.id, role: "assistant",
                        content: `${pokeSender} 拍了拍 ${pokeTarget}`,
                        mediaType: "poke",
                        mediaData: { pokeSender, pokeTarget },
                        responseBatchId,
                        rawResponseText: r.responseText,
                        responseRoundId,
                        editableResponseText,
                        // 系统小字样式不显示面板，不在这里挂载（见 canCarryFoldedPanel）
                        senderCharacterId: r.characterId,
                        senderName: pokeSender,
                    });
                    savedAnyPart = true;
                    msgsSetter(prev => [...prev, msg]);
                    dispatchChatMessageNotice({
                        sessionId: session.id,
                        senderName: session.groupName || "群聊",
                        body: `${pokeSender}: ${msg.content}`.slice(0, 80),
                        isGroup: true,
                    });
                    continue;
                }
                if (!isFirst && !revealOptions?.instantReveal) await abortableDelay(800, guard?.signal);
                throwIfGenerationStopped(guard);
                isFirst = false;
                const attachHere = !attachedState && canCarryFoldedPanel(part);
                const draft = buildAssistantMessageDraft(part, {
                    sessionId: session.id,
                    role: "assistant",
                    content: part.content,
                    mediaType: part.mediaType,
                    mediaData: part.mediaData,
                    responseBatchId,
                    rawResponseText: r.responseText,
                    responseRoundId,
                    editableResponseText,
                    statusPanel: attachHere && statusPanel ? statusPanel : undefined,
                    statusRegionMode: customStatusActive && attachHere && statusPanel ? "custom" as const : undefined,
                    innerMonologue: attachHere && innerMonologue ? innerMonologue : undefined,
                    reasoningText: takeRoundReasoning(),
                    stateValues: attachHere && stateValues.length > 0 ? stateValues : undefined,
                    freshStateValues: attachHere ? freshStateValues : undefined,
                    senderCharacterId: r.characterId,
                    senderName: r.characterName,
                }, guard);
                throwIfGenerationStopped(guard);
                const msg = pushChatMessage(draft);
                imageReplacementTasks.push(scheduleGeneratedImageReplacement(msg, r.characterId, guard));
                if (attachHere) attachedState = true;
                savedAnyPart = true;
                msgsSetter(prev => [...prev, msg]);
                const body = msg.content.trim()
                    || (msg.mediaType === "media_file" && msg.mediaData?.fileType === "image" && msg.mediaData?.label
                        ? `发了一张照片: ${msg.mediaData.label}`
                        : (msg.mediaType ? "发来一条消息" : ""));
                dispatchChatMessageNotice({
                    sessionId: session.id,
                    senderName: session.groupName || "群聊",
                    body: `${r.characterName}: ${body}`.slice(0, 80),
                    isGroup: true,
                });
            }
            // 面板没落到任何正常气泡上（纯静默，或整段只有拍一拍/群管理通知）→ 补空消息驮面板
            if (!attachedState && (statusPanel || innerMonologue || stateValues.length > 0)) {
                throwIfGenerationStopped(guard);
                const msg = pushChatMessage({
                    sessionId: session.id,
                    role: "assistant",
                    content: "",
                    responseBatchId,
                    rawResponseText: r.responseText,
                    responseRoundId,
                    editableResponseText,
                    statusPanel,
                    statusRegionMode: customStatusActive && statusPanel ? "custom" as const : undefined,
                    innerMonologue,
                    reasoningText: takeRoundReasoning(),
                    stateValues: stateValues.length > 0 ? stateValues : undefined,
                    freshStateValues,
                    senderCharacterId: r.characterId,
                    senderName: r.characterName,
                });
                msgsSetter(prev => [...prev, msg]);
            }
            if (stateValues.length > 0) {
                currentStateByCharacter.set(r.characterId, stateValues);
            }
        }
        if (imageReplacementTasks.length > 0) {
            await Promise.allSettled(imageReplacementTasks);
            throwIfGenerationStopped(guard);
        }
    };

    // AI auto-play: search & play a song by title/artist when AI recommends music
    const autoPlayMusic = async (title: string, charName: string, artist?: string) => {
        const musicBridge = getMusicControlBridge();
        if (!musicBridge) { console.warn("[AutoPlay] MusicPlayer not available"); return; }
        try {
            const found = await findPlayableMatch(title, artist);
            if (!found) {
                const playMsg = pushChatMessage({ sessionId: session.id, role: "system", content: `${charName}播放了「${title}」`, mediaType: "music_notify" });
                const failMsg = pushChatMessage({ sessionId: session.id, role: "system", content: "没有找到这个音乐哦~", mediaType: "music_not_found", mediaData: { musicTitle: title } });
                setMessages(prev => [...prev, playMsg, failMsg]);
                return;
            }

            let playedTitle = title;
            const { result: match, playUrl } = found;
            if (match.source === "local" && match.localTrack) {
                await musicBridge.playTrack(match.localTrack);
                playedTitle = match.localTrack.title;
            } else if (match.source === "netease" && match.neteaseResult && playUrl) {
                const r = match.neteaseResult;
                const detail = await getNeteaseSongDetail(r.id);
                const lyrics = await getNeteaseLyrics(r.id);
                playedTitle = detail?.name || r.name;
                await musicBridge.playTrack({
                    id: `netease_${r.id}`,
                    title: playedTitle,
                    artist: detail?.artists || r.artists,
                    duration: r.duration / 1000,
                    coverUrl: detail?.coverUrl,
                    lyrics,
                    liked: false,
                    addedAt: new Date().toISOString(),
                });
            }
            const okMsg = pushChatMessage({ sessionId: session.id, role: "system", content: `${charName}播放了「${playedTitle}」`, mediaType: "music_notify" });
            setMessages(prev => [...prev, okMsg]);
        } catch (err) {
            console.warn("[AutoPlay] Failed:", err);
            const playMsg = pushChatMessage({ sessionId: session.id, role: "system", content: `${charName}播放了「${title}」`, mediaType: "music_notify" });
            const failMsg = pushChatMessage({ sessionId: session.id, role: "system", content: "没有找到这个音乐哦~" });
            setMessages(prev => [...prev, playMsg, failMsg]);
        }
    };


    const clearStuckGeneration = () => {
        const cancelledRun = cancelGenerationRun(session.id);
        cancelBackgroundGeneration(session.id);
        cancelBailoutKey(`reply:${session.id}`);
        if (cancelledRun?.pendingNativeToolCalls.length) {
            for (const call of cancelledRun.pendingNativeToolCalls) {
                pushChatMessage({
                    sessionId: session.id,
                    role: "tool",
                    content: "本次动作已被用户取消。",
                    mediaType: "tool_result",
                    nativeToolResult: {
                        toolCallId: call.id,
                        name: call.name,
                        content: "本次动作已被用户取消。",
                    },
                });
            }
        }
        isGeneratingRef.current = false;
        setIsGenerating(false);
        clearGenerationLock(session.id);
        setPendingGenerate(true);
        syncMessagesFromStorage();
        showChatToast("已停止本轮生成");
    };

    const clearOfflineGeneration = () => {
        const cancelled = cancelOfflineGenerationRun(session.id);
        if (!cancelled && !isOfflineGenerating) return;
        const pendingText = offlineGenerationInputRef.current || pendingOfflineUserText;
        offlineTextInputRef.current?.restoreIfEmpty(pendingText);
        setPendingOfflineUserText("");
        offlineGenerationInputRef.current = "";
        setIsOfflineGenerating(false);
        showChatToast("已停止线下生成");
    };

    const stripEditableToolTags = (text: string) => text
        .replace(/\[[^\]]*?(?:获取指令|获取工具)[:：][^\]]*\]/g, "")
        .replace(/\[[^\]]*?(?:执行动作|工具调用)[:：][^\]]*?[（(][\s\S]*?[)）]\]/g, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();

    const cleanEditableAssistantText = (text: string) => {
        const { cleanText } = parseActionTags(text);
        return stripEditableToolTags(cleanText);
    };

    const hasKnownGroupSenderPrefix = (text: string) => {
        return groupCharacters.some((groupCharacter) => {
            const escapedName = groupCharacter.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            return new RegExp(`^\\[${escapedName}\\]:\\s*`, "m").test(text);
        });
    };

    const buildAssistantMessageDraft = (
        part: ParsedMessagePart,
        draft: AssistantMessageDraft,
        guard?: GenerationRunGuard,
    ): AssistantMessageDraft => {
        if (draft.mediaType === "tool_notice" || part.mediaType !== "image") return draft;

        const description = part.mediaData?.label?.trim();
        if (!description) return draft;

        throwIfGenerationStopped(guard);
        return {
            ...draft,
            mediaType: "image",
            mediaData: {
                ...createPendingChatGeneratedImageData(part.mediaData, description),
                inTransitRemainingSeconds: draft.mediaData?.inTransitRemainingSeconds,
                inTransitRemainingMinutes: draft.mediaData?.inTransitRemainingMinutes,
            },
        };
    };

    const scheduleGeneratedImageReplacement = (
        message: ChatMessage,
        characterId?: string,
        guard?: GenerationRunGuard,
    ): Promise<ChatMessage | null> => {
        if (!isPendingChatGeneratedImageMessage(message)) return Promise.resolve(null);
        return generateAndApplyChatGeneratedImage(message, characterId || session.contactId, { signal: guard?.signal })
            .catch(error => {
                if (!isAbortLikeError(error)) {
                    console.warn("[ImageGeneration] Failed to generate chat image:", error);
                    const reason = error instanceof Error ? error.message : String(error);
                    setImageGenerationFailure(prev => prev ?? reason);
                }
                return null;
            });
    };

    // ── Music Card Click-to-Play ──
    const handleMusicCardPlay = async (title: string, artist?: string) => {
        const musicBridge = getMusicControlBridge();
        if (!musicBridge) { showChatToast("音乐播放器未就绪"); return; }
        showPersistentChatToast("加载音乐中...");
        try {
            const found = await findPlayableMatch(title, artist);
            if (!found) {
                showChatToast("没有找到该音乐哦~");
                return;
            }
            const { result: match, playUrl } = found;
            if (match.source === "local" && match.localTrack) {
                await musicBridge.playTrack(match.localTrack);
            } else if (match.source === "netease" && match.neteaseResult && playUrl) {
                const r = match.neteaseResult;
                const detail = await getNeteaseSongDetail(r.id);
                const lyrics = await getNeteaseLyrics(r.id);
                await musicBridge.playTrack({
                    id: `netease_${r.id}`,
                    title: detail?.name || r.name,
                    artist: detail?.artists || r.artists,
                    duration: r.duration / 1000,
                    coverUrl: detail?.coverUrl,
                    lyrics,
                    liked: false,
                    addedAt: new Date().toISOString(),
                });
            }
            clearChatToast();
        } catch {
            showChatToast("没有找到该音乐哦~");
        }
    };

    // Helper: Split AI response by \n\n into multiple messages (online chat mode)
    // Uses shared parseAIResponse for rich-media support.
    // Returns { hasVisible, stateValues, hasDecline } — hasVisible is false if the AI chose [静默].
    const splitAndSaveAIMessages = async (
        aiResponseText: string,
        options?: {
            responseBatchId?: string;
            rawResponseText?: string;
            reasoningText?: string;
            /** 流式生成场景：用户已看过内容逐段长出，落库立即放出、跳过模拟打字节奏 */
            instantReveal?: boolean;
        } & GenerationRunGuard,
    ): Promise<{ hasVisible: boolean; stateValues: StateValue[]; triggerCall?: "voice" | "video"; hasDecline?: boolean }> => {
        throwIfGenerationStopped(options);
        const responseBatchId = options?.responseBatchId || createResponseBatchId();
        const rawResponseText = options?.rawResponseText ?? aiResponseText;
        const previousState = session.isGroup
            ? getLatestStateValues(session.id)
            : getLatestCharacterStateValues(session.contactId);

        const { parts: rawParts, stateValues, freshStateValues, statusPanel, innerMonologue } = parseAIResponse(aiResponseText, previousState);
        const parts = stripInvalidStickerParts(rawParts);
        throwIfGenerationStopped(options);

        // Detect call triggers and AI media actions, filter them out
        let triggerCall: "voice" | "video" | undefined;
        let hasDecline = false;
        let shouldAutoExpandInviteModalAfterTyping = false;
        const charN = character?.name || "对方";
        const userN = userIdentity?.name || "你";
        const filteredParts: typeof parts = [];
        const afterPublishEffects: Array<((message: ChatMessage) => void) | undefined> = [];
        const pushFilteredPart = (part: (typeof parts)[number], afterPublish?: (message: ChatMessage) => void) => {
            filteredParts.push(part);
            afterPublishEffects.push(afterPublish);
        };
        for (const p of parts) {
            throwIfGenerationStopped(options);
            if (p.mediaType === "voice_call") { triggerCall = "voice"; continue; }
            if (p.mediaType === "video_call") { triggerCall = "video"; continue; }
            if (p.mediaType === "offline_invite_remind") {
                // 仅对“他来”（角色动身找用户）且处于 pending 状态时响应，重新唤醒弹窗
                const curInvite = activeOfflineInviteRef.current;
                if (session.enableOfflineInvite && !session.isGroup && curInvite && curInvite.status === "pending" && curInvite.direction === "he_comes") {
                    const currentMins = curInvite.durationMinutes || 15;
                    // 若角色最新回复中提到了具体时间，则更新；若没提，保留之前商定好的时间，绝不无故回退重置
                    const parsedMins = extractDurationMinutes(rawResponseText || "", currentMins);
                    const updatedInvite: OfflineInviteData = {
                        ...curInvite,
                        durationMinutes: parsedMins,
                    };
                    updateActiveOfflineInvite(updatedInvite);
                    setIsOfflineInviteMinimized(true);
                    lastRemindBatchIdRef.current = responseBatchId;
                    shouldAutoExpandInviteModalAfterTyping = true;
                }
                continue;
            }
            if (p.mediaType === "offline_invite" || p.mediaType === "offline_invite_change_place") {
                if (session.enableOfflineInvite && !session.isGroup && p.mediaData?.offlineInvite) {
                    if (offlineMode) {
                        continue;
                    }

                    const curInvite = activeOfflineInviteRef.current;
                    const incoming = p.mediaData.offlineInvite;
                    const rawTimeStr = incoming.timeStr || "";
                    const rawReason = incoming.reason || "";
                    // 华提出的黄金细节：正文是用户肉眼所见的第一依据！若角色的对话台词中亲口说了具体时间（如“等我十几分钟”、“大概半小时”），
                    // 倒计时必须以正文亲口许诺的时间为最高优先，坚决杜绝正文说十几分钟倒计时却跳出30/40分钟的割裂出戏！
                    const cleanSpeechText = (rawResponseText || "").replace(/\[(?:线下邀约|提醒赴约|更改地点|强行动身|强行赴约|霸道奔赴|执意赶来|执意奔赴)[^\]]*\]/g, "");
                    const speechMins = extractDurationMinutes(cleanSpeechText, 0);
                    const tagMins = extractDurationMinutes(rawTimeStr, 0);
                    const reasonMins = extractDurationMinutes(rawReason, 0);
                    const parsedMins = speechMins > 0 ? speechMins : (tagMins > 0 ? tagMins : (reasonMins > 0 ? reasonMins : 15));

                    if (!curInvite) {
                        if (p.mediaType === "offline_invite_change_place") {
                            continue;
                        }

                        // 华敏锐指出的核心生活常理：地点是申请的前提，对方答应是出发的前提！
                        // 若大模型在未知地点、正文还在发问“你在哪 / 在哪见 / 发个定位”时，抢跑发起了“你身边”或未定地点的提议：
                        // 且用户前置消息并非危机/脆弱求助，属于大模型自嗨违规抢跑！直接拦截该邀约，让角色老老实实纯文本向用户问清地点！
                        const asksForLocation = /(?:你在[哪哪儿里]|在[哪哪儿里]|去[哪哪儿里]|在哪个地方|发个?定位|你在家还是|在公司还是|到你身边找你好不好|去你身边找你好不好)/.test(cleanSpeechText);
                        const isByYourSide = !incoming.place || incoming.place === "你身边";
                        const recentUserMessages = messages.filter(m => m.role === "user").slice(-3);
                        const isCrisisOrHelp = recentUserMessages.some(m =>
                            m.mediaType === "location" ||
                            /(?:哭|眼泪|难受|好痛|好怕|救命|救我|喝醉|醉了|迷路|车祸|医院|走丢|好想见你|好想你在身边|快来陪我|来我身边)/.test(m.content || "")
                        );

                        if (asksForLocation && isByYourSide && !isCrisisOrHelp) {
                            continue;
                        }

                        const isForced = incoming.status === "on_the_way" || incoming.theme === "forced";
                        const inviteTheme = incoming.theme || (isForced ? "forced" : "default");
                        const inviteData: OfflineInviteData = {
                            direction: incoming.direction || "he_comes",
                            theme: inviteTheme,
                            place: incoming.place,
                            reason: incoming.reason,
                            onTheWayMessage: sanitizeTransitMessage(
                                incoming.onTheWayMessage,
                                incoming.direction || "he_comes",
                                incoming.place
                            ),
                            transitCardMessage: incoming.transitCardMessage,
                            arrivedMessage: incoming.arrivedMessage,
                            arrivalCardMessage: incoming.arrivalCardMessage,
                            status: isForced ? "on_the_way" : "pending",
                            startTime: isForced ? Date.now() : undefined,
                            durationMinutes: parsedMins,
                            initialPlace: incoming.place?.trim() || "你身边",
                            initialBatchId: responseBatchId,
                            sourceBatchId: responseBatchId,
                            relatedBatchIds: [responseBatchId],
                        };

                        updateActiveOfflineInvite(inviteData);
                        setIsOfflineInviteMinimized(true);

                        // 华提出的黄金体验节点①【发起提议/强行动身】：在聊天流中立即留下居中小灰字系统记录（记忆锚点）
                        const charName = character?.name || "对方";
                        const rawPlace = inviteData.place?.trim();
                        const placeStr = (inviteData.initialPlace === "你身边" || rawPlace === "你身边") ? "你身边" : (rawPlace ? `「${rawPlace}」` : "你身边");

                        let noticeContent = "";
                        if (isForced) {
                            noticeContent = `${charName} 已直接动身赶往${placeStr}`;
                        } else if (inviteTheme === "alert") {
                            noticeContent = inviteData.direction === "he_comes"
                                ? `${charName} “请求”前往${placeStr === "你身边" ? "你身边" : placeStr}找你碰面`
                                : `${charName} “邀请你”前往${placeStr}与Ta见面`;
                        } else {
                            noticeContent = `${charName} 向你发起了前往${placeStr === "你身边" ? "你身边的" : `${placeStr}的`}线下赴约提议`;
                        }

                        const sysMsg = pushChatMessage({
                            sessionId: session.id,
                            role: "system",
                            content: noticeContent,
                            mediaType: "offline_invite_system_notice",
                            mediaData: { offlineInvite: inviteData },
                        });
                        setMessages(prev => [...prev, sysMsg]);

                        // 若为强行动身，隔 1 秒在微信聊天框发出第 2 段在途动身微信消息（因为角色已经动身在路上了！）
                        if (isForced) {
                            const transitChatText = inviteData.onTheWayMessage || "我拿了车钥匙这就出门去找你，等我片刻。";
                            window.setTimeout(() => {
                                const newMsg = pushChatMessage({
                                    sessionId: session.id,
                                    role: "assistant",
                                    content: transitChatText,
                                    responseBatchId,
                                });
                                setMessages(prev => [...prev, newMsg]);
                            }, 1000);
                        }

                        // 标记在打字结束后留足 3 秒供用户读完文本，再平滑自动展开大卡片
                        shouldAutoExpandInviteModalAfterTyping = true;
                        continue;
                    }

                    // ====== curInvite 已存在：无论大模型输出 [线下邀约] 还是 [更改地点]，统一处理赴约变动与方向转换 ======
                    const oldPlace = curInvite.place?.trim() || "";
                    const newPlace = incoming.place?.trim() || oldPlace;
                    const oldDirection = curInvite.direction || "he_comes";
                    const newDirection = incoming.direction || oldDirection;
                    const isDirectionChanged = Boolean(incoming.direction && incoming.direction !== oldDirection);
                    const isPlaceChanged = Boolean(newPlace && oldPlace && newPlace !== oldPlace);
                    const wasOnTheWay = curInvite.status === "on_the_way";
                    const wasArrived = curInvite.status === "arrived";
                    const wasPending = curInvite.status === "pending";

                    const charName = character?.name || "对方";
                    const placeStr = newPlace === "你身边" ? "你身边" : `「${newPlace}」`;
                    const newBatchIds = Array.from(new Set([
                        ...(curInvite.relatedBatchIds || []),
                        curInvite.initialBatchId,
                        curInvite.sourceBatchId,
                        responseBatchId,
                    ].filter(Boolean) as string[]));

                    if (newDirection === "i_go") {
                        // 切换为 / 保持【我去】：角色处于现场等候，旧的【他来】所有在途报备、在途心语、到达呼唤、到达心语全部彻底作废！
                        const newReason = incoming.reason?.trim() || (wasPending ? curInvite.reason : "");
                        const updatedInvite: OfflineInviteData = {
                            direction: "i_go",
                            theme: incoming.theme || curInvite.theme || "default",
                            place: newPlace,
                            reason: newReason,
                            status: "pending",
                            initialPlace: curInvite.initialPlace || curInvite.place || "你身边",
                            initialBatchId: curInvite.initialBatchId || curInvite.sourceBatchId || responseBatchId,
                            sourceBatchId: curInvite.sourceBatchId || responseBatchId,
                            relatedBatchIds: newBatchIds,
                        };
                        updateActiveOfflineInvite(updatedInvite);
                        setIsOfflineInviteMinimized(true);

                        if (isDirectionChanged || isPlaceChanged) {
                            let noticeContent = "";
                            if (isDirectionChanged) {
                                if (wasOnTheWay) {
                                    noticeContent = isPlaceChanged
                                        ? `赴约地点已更改为${placeStr}，对方正在现场等候你碰面`
                                        : (newPlace === "你身边" ? "碰头方式已变更为由你前去找对方" : `碰头方式已变更为由你前往${placeStr}找对方`);
                                } else if (wasArrived) {
                                    noticeContent = isPlaceChanged
                                        ? `赴约地点已更改为${placeStr}，对方正在现场等候你碰面`
                                        : (newPlace === "你身边" ? "碰头方式已变更为由你前去找对方" : `碰头方式已变更为由你前往${placeStr}找对方`);
                                } else {
                                    noticeContent = isPlaceChanged
                                        ? `赴约地点已更改为${placeStr}，对方正在现场等候你碰面`
                                        : (newPlace === "你身边" ? "赴约提议已变更为由你前去找对方" : `赴约提议已变更为由你前往${placeStr}找对方`);
                                }
                            } else {
                                noticeContent = `赴约提议地点已更改为${placeStr}`;
                            }

                            const sysMsg = pushChatMessage({
                                sessionId: session.id,
                                role: "system",
                                content: noticeContent,
                                mediaType: "offline_invite_system_notice",
                                mediaData: { offlineInvite: updatedInvite },
                            });
                            setMessages(prev => [...prev, sysMsg]);
                        }

                        // 华提出的核心铁律：【我去】模式下打字发完消息后留足 3 秒平滑弹窗！
                        shouldAutoExpandInviteModalAfterTyping = true;
                    } else {
                        // 切换为 / 保持【他来】
                        if (wasArrived && isPlaceChanged) {
                            // 角色到达后用户告知改地点：重新在途赶路！
                            const durationMins = parsedMins > 0 ? parsedMins : 5;
                            const newTransitCardMessage = incoming.transitCardMessage?.trim()
                                || (newPlace === "你身边" ? "正重新赶去你身边，稍等我片刻，马上就到。" : `正重新赶往${newPlace}的途中，稍候片刻。`);
                            const newArrivedMessage = incoming.arrivedMessage?.trim()
                                || (newPlace === "你身边" ? "我到了，在附近等你，不用着急慢慢走。" : `我已经到${newPlace}了，在附近等你，不用着急慢慢走。`);
                            const newArrivalCardMessage = incoming.arrivalCardMessage?.trim()
                                || (newPlace === "你身边" ? "已经在你身边了，安静等候碰面的那一刻。" : `已经赶到${newPlace}了，在安静等候你，慢慢走别急。`);

                            const updatedInvite: OfflineInviteData = {
                                direction: "he_comes",
                                theme: incoming.theme || curInvite.theme || "default",
                                place: newPlace,
                                reason: incoming.reason?.trim() || curInvite.reason,
                                status: "on_the_way",
                                durationMinutes: durationMins,
                                startTime: Date.now(),
                                transitCardMessage: newTransitCardMessage,
                                arrivedMessage: newArrivedMessage,
                                arrivalCardMessage: newArrivalCardMessage,
                                initialPlace: curInvite.initialPlace || curInvite.place || "你身边",
                                initialBatchId: curInvite.initialBatchId || curInvite.sourceBatchId || responseBatchId,
                                sourceBatchId: curInvite.sourceBatchId || responseBatchId,
                                relatedBatchIds: newBatchIds,
                            };
                            updateActiveOfflineInvite(updatedInvite);

                            const sysMsg = pushChatMessage({
                                sessionId: session.id,
                                role: "system",
                                content: `${charName} 已得知新地点，正在重新赶往${placeStr}`,
                                mediaType: "offline_invite_system_notice",
                                mediaData: { offlineInvite: updatedInvite },
                            });
                            setMessages(prev => [...prev, sysMsg]);

                            setIsOfflineInviteMinimized(true);
                            shouldAutoExpandInviteModalAfterTyping = true;
                        } else if (wasOnTheWay && isPlaceChanged) {
                            // 在途中改地点（外卖中途改地址）：平滑更新地点，不打断倒计时（除非特别指定了新用时）
                            const newTransitCardMessage = incoming.transitCardMessage?.trim()
                                || (newPlace === "你身边" ? "正重新赶去你身边，稍等我片刻，马上就到。" : `正重新赶往${newPlace}的途中，稍候片刻。`);
                            const newArrivedMessage = incoming.arrivedMessage?.trim()
                                || (newPlace === "你身边" ? "我到了，在附近等你，不用着急慢慢走。" : `我已经到${newPlace}了，在附近等你，不用着急慢慢走。`);
                            const newArrivalCardMessage = incoming.arrivalCardMessage?.trim()
                                || (newPlace === "你身边" ? "已经在你身边了，安静等候碰面的那一刻。" : `已经赶到${newPlace}了，在安静等候你，慢慢走别急。`);

                            const updatedInvite: OfflineInviteData = {
                                ...curInvite,
                                direction: "he_comes",
                                theme: incoming.theme || curInvite.theme || "default",
                                place: newPlace,
                                transitCardMessage: newTransitCardMessage,
                                arrivedMessage: newArrivedMessage,
                                arrivalCardMessage: newArrivalCardMessage,
                                initialPlace: curInvite.initialPlace || curInvite.place || "你身边",
                                ...(parsedMins > 0 && parsedMins !== curInvite.durationMinutes ? { durationMinutes: parsedMins, startTime: Date.now() } : {}),
                                sourceBatchId: curInvite.sourceBatchId || responseBatchId,
                                relatedBatchIds: newBatchIds,
                            };
                            updateActiveOfflineInvite(updatedInvite);

                            const sysMsg = pushChatMessage({
                                sessionId: session.id,
                                role: "system",
                                content: `赴约地点已更改为${placeStr}`,
                                mediaType: "offline_invite_system_notice",
                                mediaData: { offlineInvite: updatedInvite },
                            });
                            setMessages(prev => [...prev, sysMsg]);

                            setIsOfflineInviteMinimized(true);
                            shouldAutoExpandInviteModalAfterTyping = true;
                        } else if (wasPending) {
                            const isIncomingForced = incoming.status === "on_the_way" || incoming.theme === "forced";
                            if (isIncomingForced) {
                                // 🌸 华提出的绝妙高光：角色被拒绝/冷战后彻底急眼，自己有腿，强行动身杀向你身边！
                                const durationMins = parsedMins > 0 ? parsedMins : (curInvite.durationMinutes || 15);
                                const sanitizedOnTheWay = incoming.onTheWayMessage?.trim()
                                    ? sanitizeTransitMessage(incoming.onTheWayMessage, "he_comes", newPlace)
                                    : "我拿了车钥匙这就出门去找你，等我片刻。";

                                const updatedInvite: OfflineInviteData = {
                                    ...curInvite,
                                    direction: "he_comes",
                                    theme: "forced",
                                    place: newPlace,
                                    reason: incoming.reason?.trim() || curInvite.reason,
                                    status: "on_the_way",
                                    durationMinutes: durationMins,
                                    startTime: Date.now(),
                                    onTheWayMessage: sanitizedOnTheWay,
                                    transitCardMessage: incoming.transitCardMessage || curInvite.transitCardMessage,
                                    arrivedMessage: incoming.arrivedMessage || curInvite.arrivedMessage,
                                    arrivalCardMessage: incoming.arrivalCardMessage || curInvite.arrivalCardMessage,
                                    initialPlace: curInvite.initialPlace || curInvite.place || "你身边",
                                    sourceBatchId: curInvite.sourceBatchId || responseBatchId,
                                    relatedBatchIds: newBatchIds,
                                };
                                updateActiveOfflineInvite(updatedInvite);

                                const sysMsg = pushChatMessage({
                                    sessionId: session.id,
                                    role: "system",
                                    content: `${charName} 已直接动身赶往${placeStr}`,
                                    mediaType: "offline_invite_system_notice",
                                    mediaData: { offlineInvite: updatedInvite },
                                });
                                setMessages(prev => [...prev, sysMsg]);

                                window.setTimeout(() => {
                                    const newMsg = pushChatMessage({
                                        sessionId: session.id,
                                        role: "assistant",
                                        content: sanitizedOnTheWay,
                                        responseBatchId,
                                    });
                                    setMessages(prev => [...prev, newMsg]);
                                }, 1000);

                                setIsOfflineInviteMinimized(true);
                                shouldAutoExpandInviteModalAfterTyping = true;
                            } else {
                                // 待答应阶段改地点，或从【我去】转为【他来】，或重试/再次确认提议
                                const sanitizedOnTheWay = incoming.onTheWayMessage?.trim()
                                    ? sanitizeTransitMessage(incoming.onTheWayMessage, "he_comes", newPlace)
                                    : sanitizeTransitMessage(undefined, "he_comes", newPlace);

                                const updatedInvite: OfflineInviteData = {
                                    ...curInvite,
                                    direction: "he_comes",
                                    theme: incoming.theme || curInvite.theme || "default",
                                    place: newPlace,
                                    reason: incoming.reason?.trim() || curInvite.reason,
                                    onTheWayMessage: sanitizedOnTheWay,
                                    transitCardMessage: incoming.transitCardMessage || curInvite.transitCardMessage,
                                    arrivedMessage: incoming.arrivedMessage || curInvite.arrivedMessage,
                                    arrivalCardMessage: incoming.arrivalCardMessage || curInvite.arrivalCardMessage,
                                    status: "pending",
                                    durationMinutes: parsedMins > 0 ? parsedMins : curInvite.durationMinutes,
                                    initialPlace: curInvite.initialPlace || curInvite.place || "你身边",
                                    initialBatchId: curInvite.initialBatchId || curInvite.sourceBatchId || responseBatchId,
                                    sourceBatchId: curInvite.sourceBatchId || responseBatchId,
                                    relatedBatchIds: newBatchIds,
                                };
                                updateActiveOfflineInvite(updatedInvite);

                                if (isDirectionChanged || isPlaceChanged) {
                                    const noticeContent = isDirectionChanged
                                        ? "赴约提议已变更为由对方前来找你"
                                        : `赴约提议地点已更改为${placeStr}`;

                                    const sysMsg = pushChatMessage({
                                        sessionId: session.id,
                                        role: "system",
                                        content: noticeContent,
                                        mediaType: "offline_invite_system_notice",
                                        mediaData: { offlineInvite: updatedInvite },
                                    });
                                    setMessages(prev => [...prev, sysMsg]);
                                }

                                setIsOfflineInviteMinimized(true);
                                shouldAutoExpandInviteModalAfterTyping = true;
                            }
                        }
                    }
                    continue;
                }
            }
            if (p.mediaType === "offline_invite_early_arrive") {
                const curEarlyInvite = activeOfflineInviteRef.current;
                if (session.enableOfflineInvite && !session.isGroup && curEarlyInvite && curEarlyInvite.status === "on_the_way") {
                    // 华敏锐实测与洞察：大模型自身具备高级语义理解，支持多语言角色（中文/英文/日文等）。
                    // 仅当包含明确处于在途、跑腿或顺路买东西语境时做防误伤防御；全语言角色自由感知到达！
                    const speech = (rawResponseText || "").replace(/\[[^\]]+\]/g, "");
                    const isStillMovingOrErrand = /(?:去便利店|顺便|顺路|去买|在路上|路上有点|这就出门|快到了|还要一会儿|买小面包|等我|on my way|stop by|buying)/i.test(speech);
                    if (isStillMovingOrErrand) {
                        continue;
                    }

                    const customArrivalCard = p.mediaData?.offlineInvite?.arrivalCardMessage?.trim();
                    const remainingMins = getRemainingMinutes(curEarlyInvite.startTime, curEarlyInvite.durationMinutes || 15);
                    const arrivedInvite: OfflineInviteData = {
                        ...curEarlyInvite,
                        status: "arrived",
                        isEarlyArrived: true,
                        frozenRemainingMinutes: remainingMins,
                        arrivalCardMessage: customArrivalCard || curEarlyInvite.arrivalCardMessage,
                        relatedBatchIds: Array.from(new Set([
                            ...(curEarlyInvite.relatedBatchIds || []),
                            curEarlyInvite.initialBatchId,
                            curEarlyInvite.sourceBatchId,
                            responseBatchId,
                        ].filter(Boolean) as string[])),
                    };
                    updateActiveOfflineInvite(arrivedInvite);

                    // 华指出的核心铁律：提前到达也是新卡片/状态切换，打字发完消息 3 秒后平滑弹窗！
                    setIsOfflineInviteMinimized(true);
                    shouldAutoExpandInviteModalAfterTyping = true;

                    // 华提出的黄金体验：提前到达时，在聊天流中留下到达事实记录
                    const charName = character?.name || "对方";
                    const isOriginByYourSide = curEarlyInvite.initialPlace === "你身边" || (!curEarlyInvite.initialPlace && curEarlyInvite.place === "你身边");
                    const rawPlace = curEarlyInvite.place?.trim();
                    const placeStr = isOriginByYourSide ? "你身边" : (rawPlace ? (rawPlace === "你身边" ? "你身边" : `「${rawPlace}」`) : "约定地点");
                    const sysMsg = pushChatMessage({
                        sessionId: session.id,
                        role: "system",
                        content: `${charName} 已提前到达${placeStr}`,
                        mediaType: "offline_invite_system_notice",
                        mediaData: { offlineInvite: arrivedInvite },
                    });
                    setMessages(prev => [...prev, sysMsg]);
                }
                continue;
            }
            if (p.mediaType === "accept_red_packet" || p.mediaType === "decline_red_packet"
                || p.mediaType === "accept_transfer" || p.mediaType === "decline_transfer"
                || p.mediaType === "accept_payment_request" || p.mediaType === "decline_payment_request") {
                if (p.mediaType === "decline_red_packet" || p.mediaType === "decline_transfer" || p.mediaType === "decline_payment_request") {
                    hasDecline = true;
                }
                throwIfGenerationStopped(options);
                handleAIMediaAction(p.mediaType, charN, userN);
                continue;
            }
            // Music: convert to plain text [音乐:xxx] (stays in history for AI), auto-play
            if (p.mediaType === "music") {
                const mTitle = p.mediaData?.musicTitle || p.mediaData?.label;
                if (mTitle) {
                    pushFilteredPart(
                        { content: `[音乐:${mTitle}]` },
                        () => autoPlayMusic(mTitle, charN, p.mediaData?.musicArtist || undefined),
                    );
                    continue;
                }
            }
            // Poke: keep mediaType so UI renders it as a system notice, while preserving response order.
            if (p.mediaType === "poke") {
                const pokeSender = (p.mediaData?.pokeSender === "我" ? charN : p.mediaData?.pokeSender) || charN;
                const pokeTarget = p.mediaData?.pokeTarget || userN;
                pushFilteredPart({
                    content: `${pokeSender} 拍了拍 ${pokeTarget}`,
                    mediaType: "poke",
                    mediaData: { pokeSender, pokeTarget },
                });
                continue;
            }
            pushFilteredPart(p);
        }

        // 🌸 华确立的黄金体验法则：在途闲聊中，每一轮 AI 回复都打上那一轮专属的实时倒计时时间戳！
        // 只记住 AI 回复那一轮，不记住用户；回溯时凭此时间戳实现毫秒级精准断点续存，绝不被机械重置为满额时间！
        const currentInTransitInvite = (
            session.enableOfflineInvite &&
            !session.isGroup &&
            activeOfflineInviteRef.current?.status === "on_the_way" &&
            activeOfflineInviteRef.current?.direction === "he_comes"
        ) ? activeOfflineInviteRef.current : null;

        let inTransitCountdownSnapshot: { seconds: number; minutes: number } | null = null;
        if (currentInTransitInvite) {
            const now = Date.now();
            const elapsedMs = Math.max(0, now - (currentInTransitInvite.startTime || now));
            const totalMs = (currentInTransitInvite.durationMinutes || 15) * 60000;
            const remainingMs = Math.max(0, totalMs - elapsedMs);
            const remainingSeconds = Math.max(1, Math.round(remainingMs / 1000));
            const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60000));
            inTransitCountdownSnapshot = {
                seconds: remainingSeconds,
                minutes: remainingMinutes,
            };
        }

        if (filteredParts.length === 0) {
            // Silence: only status panel / inner monologue / reasoning, no visible chat text
            if (statusPanel || innerMonologue || options?.reasoningText) {
                throwIfGenerationStopped(options);
                const aiMsg = pushChatMessage({
                    sessionId: session.id,
                    role: "assistant",
                    content: "",
                    responseBatchId,
                    rawResponseText,
                    statusPanel,
                    statusRegionMode: customStatusActive && statusPanel ? "custom" as const : undefined,
                    innerMonologue,
                    reasoningText: options?.reasoningText,
                    stateValues: stateValues.length > 0 ? stateValues : undefined,
                    freshStateValues,
                    mediaData: inTransitCountdownSnapshot ? {
                        inTransitRemainingSeconds: inTransitCountdownSnapshot.seconds,
                        inTransitRemainingMinutes: inTransitCountdownSnapshot.minutes,
                    } : undefined,
                });
                setMessages(prev => [...prev, aiMsg]);
            }
            return { hasVisible: false, stateValues, triggerCall, hasDecline };
        }

        // Build rich-media drafts first, then publish them in the same order as the UI display.
        const messageDrafts: Array<{ draft: AssistantMessageDraft; afterPublish?: (message: ChatMessage) => Promise<unknown> | void }> = [];
        const imageReplacementTasks: Promise<unknown>[] = [];
        // 面板挂到第一条能显示它的消息上；全是拍一拍等系统样式时补空消息驮面板
        let metaIdx = filteredParts.findIndex(canCarryFoldedPanel);
        if (metaIdx === -1 && (statusPanel || innerMonologue || stateValues.length > 0)) {
            pushFilteredPart({ content: "" });
            metaIdx = filteredParts.length - 1;
        }
        for (let idx = 0; idx < filteredParts.length; idx += 1) {
            throwIfGenerationStopped(options);
            const part = filteredParts[idx];
            const mediaType = part.mediaType;
            const draft = buildAssistantMessageDraft(part, {
                sessionId: session.id,
                role: "assistant",
                content: part.content,
                mediaType,
                mediaData: inTransitCountdownSnapshot ? {
                    ...part.mediaData,
                    inTransitRemainingSeconds: inTransitCountdownSnapshot.seconds,
                    inTransitRemainingMinutes: inTransitCountdownSnapshot.minutes,
                } : part.mediaData,
                responseBatchId,
                rawResponseText,
                statusPanel: idx === metaIdx && statusPanel ? statusPanel : undefined,
                statusRegionMode: customStatusActive && idx === metaIdx && statusPanel ? "custom" as const : undefined,
                innerMonologue: idx === metaIdx && innerMonologue ? innerMonologue : undefined,
                reasoningText: idx === metaIdx ? options?.reasoningText : undefined,
                stateValues: idx === metaIdx && stateValues.length > 0 ? stateValues : undefined,
                freshStateValues: idx === metaIdx ? freshStateValues : undefined,
            }, options);
            throwIfGenerationStopped(options);
            messageDrafts.push({
                draft,
                afterPublish: isPendingChatGeneratedImageMessage(draft)
                    ? (message) => scheduleGeneratedImageReplacement(message, session.contactId, options)
                    : afterPublishEffects[idx],
            });
        }

        const mediaLabels: Record<string, string> = {
            red_packet: "发了一个红包",
            transfer: "发了一笔转账",
            payment_request: "发起了代付请求",
            sticker: "发了一个表情",
            image: "发了一张照片",
            location: "分享了位置",
            audio: "发了一条语音",
            music_share: "分享了音乐",
            xiaohongshu_note_share: "分享了一条小红书帖子",
            app_card: "分享了一张应用卡片",
            quote: "引用回复",
        };
        const getNoticeBody = (m: ChatMessage): string => {
            const text = m.content.trim();
            if (text) return text;
            if (!m.mediaType) return "";
            if (m.mediaType === "sticker") return `发了一个表情 ${m.mediaData?.label || ""}`.trim();
            if (m.mediaType === "image") return m.mediaData?.label ? `发了一张照片: ${m.mediaData.label}` : "发了一张照片";
            if (m.mediaType === "media_file" && m.mediaData?.fileType === "image") {
                return m.mediaData?.label ? `发了一张照片: ${m.mediaData.label}` : "发了一张照片";
            }
            if (m.mediaType === "location") return `分享了位置: ${m.mediaData?.label || ""}`.trim();
            if (m.mediaType === "audio") return `发了一条语音: ${m.mediaData?.label || ""}`.trim();
            if (m.mediaType === "music_share") return `分享了音乐: ${m.mediaData?.musicTitle || ""}`.trim();
            if (m.mediaType === "xiaohongshu_note_share") return `分享了一条小红书帖子: ${m.mediaData?.xiaohongshuTitle || ""}`.trim();
            if (m.mediaType === "app_card") return `分享了${m.mediaData?.appName || "APP"}卡片: ${m.mediaData?.appCardTitle || m.mediaData?.appCardSummary || ""}`.trim();
            if (m.mediaType === "quote") return `引用回复: ${m.mediaData?.quotePreview || ""}`.trim();
            if (m.mediaType === "payment_request") return `发起了代付请求: ${m.mediaData?.paymentRequestAmountLabel || m.mediaData?.amount || ""}`.trim();
            return mediaLabels[m.mediaType] || "";
        };
        const dispatchVisibleNotice = (m: ChatMessage): void => {
            const body = getNoticeBody(m);
            if (!body) return;
            dispatchChatMessageNotice({
                sessionId: session.id,
                senderName: charN,
                avatar: character?.avatar || null,
                body: body.slice(0, 80),
            });
        };

        const publishVisibleMessage = (entry: { draft: AssistantMessageDraft; afterPublish?: (message: ChatMessage) => void }): ChatMessage => {
            throwIfGenerationStopped(options);
            const msg = pushChatMessage(entry.draft);
            setMessages(prev => [...prev, msg]);
            dispatchVisibleNotice(msg);
            const body = getNoticeBody(msg);
            if (body) {
                sendBrowserNotification(charN, { body: body.slice(0, 60), icon: character?.avatar || undefined });
            }
            const afterPublishResult = entry.afterPublish?.(msg);
            if (afterPublishResult) imageReplacementTasks.push(Promise.resolve(afterPublishResult));
            return msg;
        };

        // Display messages one by one with staggered delays; update preview and notice with the same rhythm.
        // 流式预览已经按段展示过一遍时（instantReveal）直接全部放出，避免二次「重播」。
        if (messageDrafts.length <= 1 || options?.instantReveal) {
            messageDrafts.forEach(publishVisibleMessage);
        } else {
            publishVisibleMessage(messageDrafts[0]);
            for (let i = 1; i < messageDrafts.length; i++) {
                await abortableDelay(800, options?.signal);
                throwIfGenerationStopped(options);
                publishVisibleMessage(messageDrafts[i]);
            }
        }
        if (imageReplacementTasks.length > 0) {
            await Promise.allSettled(imageReplacementTasks);
            throwIfGenerationStopped(options);
        }

        // 🌸 华确立的“新卡片3秒必弹律”：所有气泡打字彻底完毕后，留足 3 秒供用户读完文本，再平滑自动展开大卡片
        if (shouldAutoExpandInviteModalAfterTyping) {
            if (remindExpandTimerRef.current) {
                clearTimeout(remindExpandTimerRef.current);
            }
            remindExpandTimerRef.current = setTimeout(() => {
                setIsOfflineInviteMinimized(false);
                remindExpandTimerRef.current = null;
            }, 3000);
        }

        return { hasVisible: true, stateValues, triggerCall, hasDecline };
    };

    // Helper: handle AI-triggered call from splitAndSaveAIMessages result
    const handleCallTrigger = (triggerCall?: "voice" | "video") => {
        if (!triggerCall) return;
        setCallInitiator("character");
        if (triggerCall === "voice") setShowVoiceCall(true);
        else setShowVideoCall(true);
    };

    const persistHiddenToolResult = (content?: string, toolExecutionId?: string) => {
        if (!content) return;
        pushChatMessage({
            sessionId: session.id,
            role: "tool",
            content,
            mediaType: "tool_result",
            toolExecutionId,
        });
    };

    const persistHiddenAssistantToolCall = (content?: string, options?: {
        responseBatchId?: string;
        responseRoundId?: string;
        senderCharacterId?: string;
        senderName?: string;
    }) => {
        if (!content) return;
        pushChatMessage({
            sessionId: session.id,
            role: "assistant",
            content,
            mediaType: "tool_call",
            responseBatchId: options?.responseBatchId,
            responseRoundId: options?.responseRoundId,
            senderCharacterId: options?.senderCharacterId,
            senderName: options?.senderName,
        });
    };

    const persistToolNotice = (content?: string) => {
        if (!content) return;
        const msg = pushChatMessage({
            sessionId: session.id,
            role: "system",
            content,
            mediaType: "tool_notice",
        });
        setMessages(prev => [...prev, msg]);
    };

    const appendTransientMessage = (
        role: ChatMessage["role"],
        content: string,
        mediaType?: ChatMessage["mediaType"],
        mediaData?: ChatMessage["mediaData"],
    ) => {
        const transientMsg: ChatMessage = {
            id: `${TRANSIENT_MESSAGE_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            sessionId: session.id,
            role,
            content,
            status: "sent",
            createdAt: new Date().toISOString(),
            ...(mediaType ? { mediaType } : {}),
            ...(mediaData ? { mediaData } : {}),
        };
        setTransientMessages(prev => [...prev, transientMsg]);
    };

    const updateTransientMessage = (msgId: string, updater: (msg: ChatMessage) => ChatMessage) => {
        setTransientMessages(prev => prev.map(msg => msg.id === msgId ? updater(msg) : msg));
    };

    const removeTransientMessage = (msgId: string) => {
        setTransientMessages(prev => prev.filter(msg => msg.id !== msgId));
    };

    const handleToolExecution = (results: ToolResult[], guard?: GenerationRunGuard, toolExecutionId?: string) => {
        throwIfGenerationStopped(guard);
        const pending = results.find(result => result.pendingApproval && result.pendingRequest);
        if (pending?.pendingRequest) {
            throwIfGenerationStopped(guard);
            appendTransientMessage("system", pending.pendingRequest.content, "memory_write_request", {
                memoryContent: pending.pendingRequest.content,
                memoryReason: pending.pendingRequest.reason,
                memoryImportance: pending.pendingRequest.importance,
                memoryRequestStatus: "pending",
            });
        }
        for (const result of results) {
            for (const att of result.mediaAttachments || []) {
                throwIfGenerationStopped(guard);
                const msg = pushChatMessage({
                    sessionId: session.id,
                    role: "assistant",
                    content: att.title || "",
                    mediaType: "media_file",
                    mediaUrl: att.url,
                    mediaData: { fileType: att.type, fileName: att.title },
                    toolExecutionId,
                    ...(session.isGroup ? {
                        senderCharacterId: result.actorCharacterId,
                        senderName: result.actorName,
                    } : {}),
                });
                setMessages(prev => [...prev, msg]);
            }
        }
    };

    const handleApproveMemoryWrite = async (msg: ChatMessage) => {
        if (msg.mediaType !== "memory_write_request") return;
        persistHiddenToolResult("确认写入记忆");
        const request: MemoryWriteRequest = {
            capabilityId: "memory_write",
            sessionId: session.id,
            characterId: session.contactId,
            content: msg.mediaData?.memoryContent || msg.content,
            importance: msg.mediaData?.memoryImportance ?? 0.8,
            ...(msg.mediaData?.memoryReason ? { reason: msg.mediaData.memoryReason } : {}),
        };

        const result = await approveMemoryWriteRequest(request);
        if (result.success) {
            updateTransientMessage(msg.id, current => ({
                ...current,
                mediaData: {
                    ...current.mediaData,
                    memoryRequestStatus: "approved",
                },
            }));
        }

        persistToolNotice(result.userNotice || (result.success ? "已写入长期记忆" : (result.error || "记忆写入失败")));
    };

    const handleIgnoreMemoryWrite = (msg: ChatMessage) => {
        if (msg.mediaType !== "memory_write_request") return;
        persistHiddenToolResult("忽略写入记忆");
        updateTransientMessage(msg.id, current => ({
            ...current,
            mediaData: {
                ...current.mediaData,
                memoryRequestStatus: "ignored",
            },
        }));
        persistToolNotice("已忽略本次记忆写入");
    };

    // Helper: transform stored system message to UI display text
    // Stored (prompt): [XX向YY发起了语音通话] / [我向XX发起了语音通话]
    // UI: XX向群聊发起了视频通话 / 你向XX发起了语音通话 / XX向你发起了语音通话
    const formatSysMsgForUI = (content: string, msg?: ChatMessage): string => {
        let text = content;
        const charN = character?.name || "对方";
        const userN = userIdentity?.name;
        // Call initiation: [我向XX发起了语音/视频通话]
        text = text.replace(/\[我向(.+?)发起了((?:群?(?:语音|视频)通话))\]/, (_, target, callType) => {
            // 单聊：target=用户名 → 角色发起；target=角色名 → 用户发起
            // 群聊：target=群聊，用 role 判断
            if (userN && target === userN) return `${charN}向你发起了${callType}`;
            if (target === "群聊" && msg?.role === "assistant") {
                const sender = msg.senderName || charN;
                return `${sender}向群聊发起了${callType}`;
            }
            return `你向${target}发起了${callType}`;
        });
        // Follow-up AI initiated: [我发起了语音/视频通话]
        text = text.replace(/\[我发起了((?:语音|视频)通话)\]/, `${charN}发起了$1`);
        // Hangup: [我挂断了XX通话] (duration now in mediaData, not content)
        text = text.replace(/\[我挂断了(.+?通话)\](?:\(时长\s*(.+?)\))?/, (_, callType, dur) =>
            dur ? `你挂断了${callType}，时长 ${dur}` : `你挂断了${callType}`
        );
        // Reject: [我拒绝了XX通话]
        text = text.replace(/\[我拒绝了(.+?通话)\]/, `你拒绝了$1`);
        // Cancel: [我取消了XX通话]
        text = text.replace(/\[我取消了(.+?通话)\]/, `你取消了$1`);
        // General user name → "你"
        if (userN) text = text.replace(new RegExp(userN, "g"), "你");
        // Friend add normalization
        text = text.replace(/^.+(?=已添加了)/, "你");
        text = text.replace(/^.+向(.+)发起了好友申请\n.+通过了好友申请$/, "你已添加了$1，现在可以开始聊天了。");
        text = text.replace(/，备注：[\s\S]*$/, "");
        return text;
    };

    // QQ 式头衔徽标：群主/管理员，按当前群身份实时计算（被踢/卸任后旧消息不再显示）
    const renderGroupRoleBadge = (senderCharacterId?: string) => {
        if (!session.isGroup || !senderCharacterId) return null;
        if (!(session.participantIds || []).includes(senderCharacterId)) return null;
        const role = getGroupRole(session, senderCharacterId);
        if (role === "owner") return <span className="chat-role-badge chat-role-badge-owner">群主</span>;
        if (role === "admin") return <span className="chat-role-badge chat-role-badge-admin">管理员</span>;
        return null;
    };

    const runManagedGeneration = async ({
        history,
        errorPrefix = "发送失败",
        onDecline,
        offlineInviteDeclined,
        returnedFromOffline,
    }: ManagedGenerationOptions) => {
        if (isGeneratingRef.current) {
            if (activeGenerationRuns.has(session.id)) return;
            // 上一轮被外部取消/顶替后收尾提前返回过，标记已是陈旧状态：复位后继续本次请求
            isGeneratingRef.current = false;
            setIsGenerating(false);
            clearGenerationLock(session.id);
        }

        const generationRun = createGenerationRun(session.id);
        const generationRunId = generationRun.runId;
        const isCurrentGeneration = () => isGenerationRunActive(session.id, generationRunId);
        const generationGuard: GenerationRunGuard = { signal: generationRun.controller.signal, isActive: isCurrentGeneration };
        let shouldRunDeclineReply = false;

        isGeneratingRef.current = true;
        setIsGenerating(true);
        setGenerationLock(session.id);

        try {
            if (session.isGroup) {
                let roundReasoning: string | undefined;
                const results = await generateGroupChatCompletion(
                    session,
                    history,
                    {
                        onReasoning: (t) => { roundReasoning = t; },
                        onStreamDelta: (delta) => {
                            if (!isCurrentGeneration()) return;
                            streamAccumRef.current += delta;
                            // 群聊全文解析较重：合并到 rAF 下一帧执行，避免一帧多段增量重复解析
                            if (streamParseFrameRef.current) return;
                            streamParseFrameRef.current = window.requestAnimationFrame(() => {
                                streamParseFrameRef.current = 0;
                                if (!isCurrentGeneration()) return;
                                const nameToId = new Map(groupCharacters.map(item => [item.name, item.id]));
                                const rawParts = parseGroupChatResponse(streamAccumRef.current, nameToId);
                                const parts = rawParts
                                    .filter(item => item.responseText.trim())
                                    .map(item => ({
                                        characterId: item.characterId,
                                        characterName: item.characterName,
                                        texts: splitStreamPreviewSegments(cleanStreamText(item.responseText, { stripXmlTags: streamPreviewTagConfig.online, stripLiterals: streamPreviewTagConfig.stripTexts })),
                                    }));
                                setStreamPreview({ parts });
                            });
                        },
                        onTextPart: () => {
                            if (streamParseFrameRef.current) {
                                cancelAnimationFrame(streamParseFrameRef.current);
                                streamParseFrameRef.current = 0;
                            }
                            streamAccumRef.current = "";
                            setStreamPreview(null);
                        },
                    },
                    {
                        signal: generationRun.controller.signal,
                        appTags: theaterMode ? ["group_chat"] : undefined,
                    },
                );
                if (!isCurrentGeneration()) return;
                await processGroupParts(results, setMessages, generationGuard, roundReasoning, { instantReveal: isSessionStreamingEnabled(session, true) });
            } else {
                let capturedReasoning: string | undefined;
                const cr = await generateChatCompletion(
                    session,
                    history,
                    {
                        appTags: theaterMode ? ["chat"] : ["chat", "text"],
                        signal: generationRun.controller.signal,
                        offlineInviteDeclined,
                        returnedFromOffline,
                    },
                    {
                        onReasoning: (t) => { capturedReasoning = t; },
                        onStreamDelta: (delta) => {
                            if (!isCurrentGeneration()) return;
                            streamAccumRef.current += delta;
                            // 预览更新合并到 rAF 下一帧：每帧最多一次全文净化+setState，避免高频增量卡顿
                            if (streamParseFrameRef.current) return;
                            streamParseFrameRef.current = window.requestAnimationFrame(() => {
                                streamParseFrameRef.current = 0;
                                if (!isCurrentGeneration()) return;
                                setStreamPreview({ texts: splitStreamPreviewSegments(cleanStreamText(streamAccumRef.current, { stripXmlTags: streamPreviewTagConfig.online, stripLiterals: streamPreviewTagConfig.stripTexts })) });
                            });
                        },
                        onTextPart: () => {
                            if (streamParseFrameRef.current) {
                                cancelAnimationFrame(streamParseFrameRef.current);
                                streamParseFrameRef.current = 0;
                            }
                            streamAccumRef.current = "";
                            setStreamPreview(null);
                        },
                    },
                );
                if (!isCurrentGeneration()) return;
                const result = await splitAndSaveAIMessages(flattenCompletionResult(cr), { ...generationGuard, reasoningText: capturedReasoning, instantReveal: isSessionStreamingEnabled(session, true) });
                if (!isCurrentGeneration()) return;
                scheduleFollowUp(session.id, 0, result.stateValues);
                handleCallTrigger(result.triggerCall);
                shouldRunDeclineReply = Boolean(result.hasDecline);
            }
        } catch (error: any) {
            if (!isCurrentGeneration() || isAbortLikeError(error)) return;
            const errorMsg = pushChatMessage({
                sessionId: session.id,
                role: "system",
                content: `⚠️ ${errorPrefix}: ${error?.message || String(error)}`,
            });
            setMessages(prev => [...prev, errorMsg]);
        } finally {
            if (finishGenerationRun(session.id, generationRunId)) {
                isGeneratingRef.current = false;
                setIsGenerating(false);
                clearGenerationLock(session.id);
                if (!mountedRef.current) {
                    window.dispatchEvent(new CustomEvent(CHAT_BG_COMPLETE, { detail: { sessionId: session.id } }));
                }
            } else if (!activeGenerationRuns.has(session.id)) {
                // 本轮被外部取消且没有新一轮接手：仍需复位，否则「生成中」标记永久卡死，
                // 后续联动/追问的回复请求会被静默吞掉
                isGeneratingRef.current = false;
                setIsGenerating(false);
                clearGenerationLock(session.id);
            }
        }

        if (shouldRunDeclineReply && onDecline) await onDecline();
    };

    // Helper: trigger one AI reply based on current chat history (for events like call connect/hangup, decline)
    const triggerReply = async () => {
        const latestMessages = loadChatMessages(session.id);
        applyStoredMessageWindow(latestMessages);
        await runManagedGeneration({ history: latestMessages });
    };

    // ── Rich media send helpers ──
    const getMoneyMediaAmount = (mediaData: ChatMessage["mediaData"]): number => {
        const amount = Number(mediaData?.amount ?? 0);
        return Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100) / 100) : 0;
    };

    const debitOutgoingMoneyMessage = (
        mediaType: ChatMessage["mediaType"],
        mediaData: ChatMessage["mediaData"],
    ): { ok: boolean; mediaData?: ChatMessage["mediaData"] } => {
        if (mediaType !== "red_packet" && mediaType !== "transfer") return { ok: true, mediaData };
        const amount = getMoneyMediaAmount(mediaData);
        if (amount <= 0) {
            showChatToast("金额无效");
            return { ok: false };
        }
        const isRedPacket = mediaType === "red_packet";
        const result = payWithWalletBalance({
            amount,
            title: isRedPacket ? "发红包" : "发转账",
            detail: `${session.isGroup ? session.groupName || "群聊" : character?.name || "聊天"}：${isRedPacket ? "发红包" : "发转账"} ${amount.toFixed(2)} 元`,
            category: isRedPacket ? "红包" : "转账",
        });
        if (!result.ok || !result.transaction) {
            showChatToast(result.error ?? "余额不足");
            return { ok: false };
        }
        return {
            ok: true,
            mediaData: {
                ...mediaData,
                walletTransactionId: result.transaction.id,
            },
        };
    };

    const refundOutgoingMoneyMessage = (msg: ChatMessage, reason: "红包退回" | "转账退回"): ChatMessage["mediaData"] => {
        const data = msg.mediaData;
        if (!data?.walletTransactionId || data.walletRefundTransactionId) return data;
        const amount = getMoneyMediaAmount(data);
        if (amount <= 0) return data;
        const result = creditWalletBalance(amount, reason, `${reason}：${data.label || msg.content || "聊天款项"}`, "聊天退款");
        if (!result.ok || !result.transaction) return data;
        return {
            ...data,
            walletRefundTransactionId: result.transaction.id,
        };
    };

    const creditIncomingMoneyMessage = (msg: ChatMessage, actionType: string): ChatMessage => {
        if (actionType !== "accept_red_packet" && actionType !== "accept_transfer") return msg;
        const data = msg.mediaData;
        if (data?.walletDepositTransactionId) return msg;
        const userName = userIdentity?.name || "你";
        const amount = actionType === "accept_red_packet"
            ? Number(data?.claimedAmounts?.[userName] ?? data?.amount ?? 0)
            : Number(data?.amount ?? 0);
        const safeAmount = Number.isFinite(amount) ? Math.max(0, Math.round(amount * 100) / 100) : 0;
        if (safeAmount <= 0) return msg;
        const result = creditWalletBalance(
            safeAmount,
            actionType === "accept_red_packet" ? "领取红包" : "收款",
            `${actionType === "accept_red_packet" ? "领取红包" : "收款"}：${data?.label || msg.content || "聊天款项"}`,
            actionType === "accept_red_packet" ? "红包" : "转账",
        );
        if (!result.ok || !result.transaction) return msg;
        const updatedData = {
            ...data,
            walletDepositTransactionId: result.transaction.id,
        };
        updateMessageMediaData(msg.id, updatedData);
        return { ...msg, mediaData: updatedData };
    };

    const sendRichMessage = (mediaType: ChatMessage["mediaType"], mediaData: ChatMessage["mediaData"], content: string = "", mediaUrl?: string): boolean => {
        if (!ensureGroupSpeakPermission()) return false;
        if (isGenerating) {
            showChatToast("请先等待对方回复");
            return false;
        }
        cancelFollowUp(session.id);

        if (mediaType === "poke") {
            const pokeSender = userIdentity?.name || "你";
            const pokeTarget = mediaData?.pokeTarget || character?.name || "对方";
            const sysMsg = pushChatMessage({
                sessionId: session.id,
                role: "user",
                content: `${pokeSender} 拍了拍 ${pokeTarget}`,
                mediaType: "poke",
                mediaData: { pokeSender, pokeTarget },
            });
            setMessages(prev => [...prev, sysMsg]);
            setPendingGenerate(true);
            return true;
        }

        const walletDebit = debitOutgoingMoneyMessage(mediaType, mediaData);
        if (!walletDebit.ok) return false;

        const newMsg = pushChatMessage({
            sessionId: session.id,
            role: "user",
            content,
            mediaType,
            mediaData: walletDebit.mediaData,
            ...(mediaUrl ? { mediaUrl } : {}),
        });
        setMessages(prev => [...prev, newMsg]);
        setPendingGenerate(true);
        return true;
    };

    const sendSystemInstruction = (content: string): boolean => {
        if (isGenerating) {
            showChatToast("请先等待对方回复");
            return false;
        }
        const trimmed = content.trim();
        if (!trimmed) return false;

        cancelFollowUp(session.id);
        setQuotingMessage(null);

        const newMsg = pushChatMessage({
            sessionId: session.id,
            role: "system",
            content: trimmed,
            mediaType: "system_instruction",
        });
        setMessages(prev => [...prev, newMsg]);
        setPendingGenerate(true);
        return true;
    };

    const handleOpenCustomPlusAction = useCallback((action: RegisteredCustomAppChatPlusAction) => {
        setShowPlusMenu(false);
        setShowEmojiPanel(false);
        setShowStickerPanel(false);
        setRichModal(null);
        const app = getInstalledCustomApp(action.appId);
        if (!app) {
            showChatToast("这个自定义 APP 已不存在");
            setCustomPlusActions(loadCustomAppChatPlusActions());
            return;
        }
        const presentation = getCustomChatPlusPresentation(action);
        const launchContext = {
            source: "chat_plus_action",
            sessionId: session.id,
            characterId: session.contactId,
            characterName: character?.name,
            isGroup: Boolean(session.isGroup),
            groupName: session.groupName,
            participantIds: session.participantIds ?? [],
            participants: groupCharacters.map(item => ({ id: item.id, name: item.name })),
            actionId: action.id,
            actionLabel: action.label,
            entry: action.entry,
            directiveId: action.directiveId,
            sceneId: action.sceneId,
            sceneTag: action.sceneTag,
            appTags: action.tags,
            data: action.data,
            presentation,
            panelHeight: action.panelHeight,
            appId: action.appId,
            appName: action.appName,
        };
        if (presentation === "fullscreen") {
            window.dispatchEvent(new CustomEvent("open-app", {
                detail: {
                    appId: toCustomAppIconId(action.appId),
                    launchContext,
                },
            }));
            return;
        }
        setActiveCustomChatPlus({
            app,
            action,
            presentation,
            launchContext,
        });
    }, [character?.name, groupCharacters, session.contactId, session.groupName, session.id, session.isGroup, session.participantIds]);

    const sendShoppingGiftMessage = (gift: ShoppingGiftCandidate, recipient?: Character): boolean => {
        if (session.isGroup && !recipient) {
            showChatToast("请选择收礼对象");
            return false;
        }
        const sent = sendRichMessage("gift", {
            label: gift.productName,
            giftName: gift.productName,
            shoppingGiftId: gift.id,
            giftOrderId: gift.orderId,
            giftItemId: gift.itemId,
            giftMerchantLabel: gift.merchantLabel,
            giftPriceLabel: gift.priceLabel,
            giftPreviewIcon: gift.previewIcon,
            giftTone: gift.tone,
            giftDeliveredAt: gift.deliveredAt,
            giftSentAt: new Date().toISOString(),
            senderName: userIdentity?.name || "你",
            ...(recipient ? { recipientId: recipient.id, recipientName: recipient.name } : {}),
        });
        if (sent) showChatToast("礼物已送出");
        return sent;
    };

    const triggerAIResponse = async () => {
        if (isGeneratingRef.current) {
            if (activeGenerationRuns.has(session.id)) return;
            // 上一轮被外部取消/顶替后收尾提前返回过，标记已是陈旧状态：复位后继续本次请求
            isGeneratingRef.current = false;
            setIsGenerating(false);
            clearGenerationLock(session.id);
        }
        const generationRun = createGenerationRun(session.id);
        const generationRunId = generationRun.runId;
        const isCurrentGeneration = () => isGenerationRunActive(session.id, generationRunId);
        const generationGuard: GenerationRunGuard = { signal: generationRun.controller.signal, isActive: isCurrentGeneration };
        let shouldRunDeclineReply = false;
        isGeneratingRef.current = true;
        setIsGenerating(true);
        setPendingGenerate(false);
        setGenerationLock(session.id);
        streamAccumRef.current = "";
        setStreamPreview(null);
        try {
            const latestMessages = loadChatMessages(session.id);
            if (session.isGroup) {
                const streamedImageReplacementTasks: Promise<unknown>[] = [];
                // 每轮 LLM 调用的思维链：中间轮挂到该轮首条气泡，最终轮传给 processGroupParts
                let pendingGroupReasoning: string | undefined;
                const results = await generateGroupChatCompletion(session, latestMessages, {
                    onReasoning: (t) => { pendingGroupReasoning = t; },
                    onStreamDelta: (delta) => {
                        if (!isCurrentGeneration()) return;
                        streamAccumRef.current += delta;
                        // 群聊全文解析较重：合并到 rAF 下一帧执行，避免一帧多段增量重复解析
                        if (streamParseFrameRef.current) return;
                        streamParseFrameRef.current = window.requestAnimationFrame(() => {
                            streamParseFrameRef.current = 0;
                            if (!isCurrentGeneration()) return;
                            const nameToId = new Map(groupCharacters.map(item => [item.name, item.id]));
                            const rawParts = parseGroupChatResponse(streamAccumRef.current, nameToId);
                            const parts = rawParts
                                .filter(item => item.responseText.trim())
                                .map(item => ({
                                    characterId: item.characterId,
                                    characterName: item.characterName,
                                    texts: splitStreamPreviewSegments(cleanStreamText(item.responseText, { stripXmlTags: streamPreviewTagConfig.online, stripLiterals: streamPreviewTagConfig.stripTexts })),
                                }));
                            setStreamPreview({ parts });
                        });
                    },
                    onTextPart: async (text, senderInfo, options) => {
                        if (!isCurrentGeneration()) return;
                        // 本轮群聊内容经 onTextPart 落库后重置，供下一轮（工具轮）重新预览
                        if (streamParseFrameRef.current) {
                            cancelAnimationFrame(streamParseFrameRef.current);
                            streamParseFrameRef.current = 0;
                        }
                        streamAccumRef.current = "";
                        setStreamPreview(null);
                        if (!text.trim() || !senderInfo) return;
                        const cleanedEditableText = cleanEditableAssistantText(text);
                        if (!cleanedEditableText) return;
                        const roundReasoning = pendingGroupReasoning;
                        pendingGroupReasoning = undefined;
                        const responseBatchId = options?.responseBatchId || createResponseBatchId();
                        const rawResponseText = options?.rawResponseText ?? text;
                        const responseRoundId = senderInfo.responseRoundId || createResponseRoundId();
                        const editableResponseText = senderInfo.editableResponseText || `[${senderInfo.characterName}]: ${cleanedEditableText}`;
                        const previousState = getLatestCharacterStateValues(senderInfo.characterId);
                        const { parts: rawParts, stateValues, freshStateValues, statusPanel, innerMonologue } = parseAIResponse(text, previousState);
                        const parts = stripInvalidStickerParts(rawParts, senderInfo.characterId);
                        let attachedState = false;
                        let savedAnyPart = false;
                        for (const part of parts) {
                            throwIfGenerationStopped(generationGuard);
                            if (!part.content.trim() && !part.mediaType) continue;
                            const draft = buildAssistantMessageDraft(part, {
                                sessionId: session.id,
                                role: "assistant",
                                content: part.content,
                                mediaType: part.mediaType,
                                mediaData: part.mediaData,
                                responseBatchId,
                                rawResponseText,
                                responseRoundId,
                                editableResponseText,
                                statusPanel: !attachedState && statusPanel ? statusPanel : undefined,
                                statusRegionMode: customStatusActive && !attachedState && statusPanel ? "custom" as const : undefined,
                                innerMonologue: !attachedState && innerMonologue ? innerMonologue : undefined,
                                reasoningText: !attachedState ? roundReasoning : undefined,
                                stateValues: !attachedState && stateValues.length > 0 ? stateValues : undefined,
                                freshStateValues: !attachedState ? freshStateValues : undefined,
                                senderCharacterId: senderInfo.characterId,
                                senderName: senderInfo.characterName,
                            }, generationGuard);
                            throwIfGenerationStopped(generationGuard);
                            const msg = pushChatMessage(draft);
                            streamedImageReplacementTasks.push(scheduleGeneratedImageReplacement(msg, senderInfo.characterId, generationGuard));
                            attachedState = true;
                            savedAnyPart = true;
                            setMessages(prev => [...prev, msg]);
                        }
                        if (!savedAnyPart && (statusPanel || innerMonologue || roundReasoning)) {
                            throwIfGenerationStopped(generationGuard);
                            const msg = pushChatMessage({
                                sessionId: session.id,
                                role: "assistant",
                                content: "",
                                mediaType: undefined,
                                responseBatchId,
                                rawResponseText,
                                responseRoundId,
                                editableResponseText,
                                statusPanel,
                                statusRegionMode: customStatusActive && statusPanel ? "custom" as const : undefined,
                                innerMonologue,
                                reasoningText: roundReasoning,
                                stateValues: stateValues.length > 0 ? stateValues : undefined,
                                freshStateValues,
                                senderCharacterId: senderInfo.characterId,
                                senderName: senderInfo.characterName,
                            });
                            setMessages(prev => [...prev, msg]);
                        }
                    },
                    onToolNotice: (notice) => {
                        if (!isCurrentGeneration()) return;
                        persistToolNotice(notice);
                    },
                    onToolResult: (content, options) => {
                        if (!isCurrentGeneration()) return;
                        pushChatMessage({
                            sessionId: session.id,
                            role: "tool",
                            content,
                            mediaType: "tool_result",
                            toolExecutionId: options?.toolExecutionId,
                        });
                    },
                    onToolAssistantTurn: (content, options) => {
                        if (!isCurrentGeneration()) return;
                        persistHiddenAssistantToolCall(content, options);
                    },
                    onToolExecution: (results, _historyContent, options) => {
                        if (!isCurrentGeneration()) return;
                        handleToolExecution(results, generationGuard, options?.toolExecutionId);
                    },
                    onNativeToolAssistantTurn: async ({ content, rawContent, reasoning, openRouterReasoningDetails, toolCalls }) => {
                        if (!isCurrentGeneration()) return;
                        const nameToId = new Map(groupCharacters.map(item => [item.name, item.id]));
                        const visibleResults = parseGroupChatResponse(content, nameToId)
                            .filter(item => item.responseText.trim());
                        if (visibleResults.length > 0) {
                            await processGroupParts(visibleResults, setMessages, generationGuard, reasoning, { instantReveal: isSessionStreamingEnabled(session, true) });
                        }

                        throwIfGenerationStopped(generationGuard);
                        const firstActorName = typeof toolCalls[0]?.args?.actorName === "string"
                            ? toolCalls[0].args.actorName.trim()
                            : "";
                        const firstActor = groupCharacters.find(item => item.name === firstActorName);
                        pushChatMessage({
                            sessionId: session.id,
                            role: "assistant",
                            content: "",
                            rawResponseText: rawContent,
                            nativeToolCalls: toolCalls,
                            nativeToolReasoning: reasoning,
                            nativeToolOpenRouterReasoningDetails: openRouterReasoningDetails,
                            senderCharacterId: firstActor?.id,
                            senderName: firstActorName || firstActor?.name,
                        });
                        trackNativeToolCalls(session.id, generationRunId, toolCalls.map(call => ({ id: call.id, name: call.name })));
                    },
                    onNativeToolResult: ({ toolCallId, name, content, toolExecutionId }) => {
                        if (!isCurrentGeneration()) return;
                        pushChatMessage({
                            sessionId: session.id,
                            role: "tool",
                            content,
                            mediaType: "tool_result",
                            toolExecutionId,
                            nativeToolResult: { toolCallId, name, content },
                        });
                        resolveNativeToolCall(session.id, generationRunId, toolCallId);
                    },
                }, {
                    signal: generationRun.controller.signal,
                    appTags: theaterMode ? ["group_chat"] : undefined,
                });
                if (!isCurrentGeneration()) return;
                if (streamedImageReplacementTasks.length > 0) {
                    await Promise.allSettled(streamedImageReplacementTasks);
                    throwIfGenerationStopped(generationGuard);
                }
                await processGroupParts(results, setMessages, generationGuard, pendingGroupReasoning, { instantReveal: isSessionStreamingEnabled(session, true) });
            } else {
                let lastSendResult: Awaited<ReturnType<typeof splitAndSaveAIMessages>> | undefined;
                // 每轮 LLM 调用的思维链，onReasoning 先于该轮 onTextPart 触发
                let pendingReasoning: string | undefined;

                const hasPendingDecline = Boolean(kvGet(PENDING_OFFLINE_INVITE_DECLINE_PREFIX + session.id));
                if (hasPendingDecline) {
                    kvRemove(PENDING_OFFLINE_INVITE_DECLINE_PREFIX + session.id);
                }
                const result = await generateChatCompletion(session, latestMessages, {
                    appTags: theaterMode ? ["chat"] : ["chat", "text"],
                    signal: generationRun.controller.signal,
                    offlineInviteDeclined: hasPendingDecline,
                }, {
                    onReasoning: (t) => { pendingReasoning = t; },
                    onStreamDelta: (delta) => {
                        if (!isCurrentGeneration()) return;
                        streamAccumRef.current += delta;
                        // 预览更新合并到 rAF 下一帧：每帧最多一次全文净化+setState，避免高频增量卡顿
                        if (streamParseFrameRef.current) return;
                        streamParseFrameRef.current = window.requestAnimationFrame(() => {
                            streamParseFrameRef.current = 0;
                            if (!isCurrentGeneration()) return;
                            setStreamPreview({ texts: splitStreamPreviewSegments(cleanStreamText(streamAccumRef.current, { stripXmlTags: streamPreviewTagConfig.online, stripLiterals: streamPreviewTagConfig.stripTexts })) });
                        });
                    },
                    onTextPart: async (text, _senderInfo, options) => {
                        if (!isCurrentGeneration()) return;
                        // 本轮流式已结束且内容经 splitAndSaveAIMessages 落库：清掉预览、重置累积，
                        // 供下一轮（工具轮）重新累积预览
                        if (streamParseFrameRef.current) {
                            cancelAnimationFrame(streamParseFrameRef.current);
                            streamParseFrameRef.current = 0;
                        }
                        streamAccumRef.current = "";
                        setStreamPreview(null);
                        if (text.trim()) {
                            const reasoningText = pendingReasoning;
                            pendingReasoning = undefined;
                            lastSendResult = await splitAndSaveAIMessages(text, { ...options, ...generationGuard, reasoningText, instantReveal: isSessionStreamingEnabled(session, true) });
                        }
                    },
                    onToolNotice: (notice) => {
                        if (!isCurrentGeneration()) return;
                        persistToolNotice(notice);
                    },
                    onToolResult: (content, options) => {
                        if (!isCurrentGeneration()) return;
                        // Persist to history for future LLM context, hidden from UI
                        persistHiddenToolResult(content, options?.toolExecutionId);
                    },
                    onToolAssistantTurn: (content, options) => {
                        if (!isCurrentGeneration()) return;
                        persistHiddenAssistantToolCall(content, options);
                    },
                    onNativeToolAssistantTurn: async ({ content, rawContent, reasoning, openRouterReasoningDetails, toolCalls }) => {
                        if (!isCurrentGeneration()) return;
                        // Publish the visible turn (text + stickers / images / red packets /
                        // etc.) through the same splitter as normal replies, so rich media
                        // isn't dropped and blank-line-separated text becomes separate
                        // bubbles. The native tool-call metadata then rides on a separate
                        // empty carrier message — mirroring the group-chat path above.
                        if (content.trim()) {
                            await splitAndSaveAIMessages(content, { ...generationGuard, reasoningText: reasoning, instantReveal: isSessionStreamingEnabled(session, true) });
                        }
                        if (!isCurrentGeneration()) return;
                        const carrier = pushChatMessage({
                            sessionId: session.id,
                            role: "assistant",
                            content: "",
                            rawResponseText: rawContent,
                            nativeToolCalls: toolCalls,
                            nativeToolReasoning: reasoning,
                            nativeToolOpenRouterReasoningDetails: openRouterReasoningDetails,
                        });
                        setMessages(prev => [...prev, carrier]);
                        trackNativeToolCalls(session.id, generationRunId, toolCalls.map(call => ({ id: call.id, name: call.name })));
                    },
                    onNativeToolResult: ({ toolCallId, name, content, toolExecutionId }) => {
                        if (!isCurrentGeneration()) return;
                        const msg = pushChatMessage({
                            sessionId: session.id,
                            role: "tool",
                            content,
                            mediaType: "tool_result",
                            toolExecutionId,
                            nativeToolResult: { toolCallId, name, content },
                        });
                        setMessages(prev => [...prev, msg]);
                        resolveNativeToolCall(session.id, generationRunId, toolCallId);
                    },
                    onToolExecution: (results, _historyContent, options) => {
                        if (!isCurrentGeneration()) return;
                        handleToolExecution(results, generationGuard, options?.toolExecutionId);
                    },
                });
                if (!isCurrentGeneration()) return;

                if (lastSendResult) {
                    scheduleFollowUp(session.id, 0, lastSendResult.stateValues);
                    const isHidden = !mountedRef.current || !isChatRoomElementVisible(wrapperRef.current);
                    if (isHidden && lastSendResult.triggerCall) {
                        window.dispatchEvent(new CustomEvent("ai-call-trigger", {
                            detail: { sessionId: session.id, type: lastSendResult.triggerCall },
                        }));
                    } else {
                        handleCallTrigger(lastSendResult.triggerCall);
                    }
                    shouldRunDeclineReply = Boolean(lastSendResult.hasDecline);
                }
            }
        } catch (error: any) {
            if (!isCurrentGeneration() || isAbortLikeError(error)) return;
            const errorMsg = pushChatMessage({
                sessionId: session.id,
                role: "system",
                content: `⚠️ 发送失败: ${error?.message || String(error)}`
            });
            setMessages(prev => [...prev, errorMsg]);
        } finally {
            if (finishGenerationRun(session.id, generationRunId)) {
                isGeneratingRef.current = false;
                setIsGenerating(false);
                clearGenerationLock(session.id);
                if (!mountedRef.current) {
                    window.dispatchEvent(new CustomEvent(CHAT_BG_COMPLETE, { detail: { sessionId: session.id } }));
                }
                // If user sent more messages while AI was generating, show the generate button again
                const latestMsgs = loadChatMessages(session.id);
                const last = latestMsgs[latestMsgs.length - 1];
                if (last && last.role === "user") {
                    setPendingGenerate(true);
                }
            } else if (!activeGenerationRuns.has(session.id)) {
                // 本轮被外部取消且没有新一轮接手：仍需复位，否则「生成中」标记永久卡死，
                // 后续联动/追问的回复请求会被静默吞掉
                isGeneratingRef.current = false;
                setIsGenerating(false);
                clearGenerationLock(session.id);
            }
        }
        if (shouldRunDeclineReply) await triggerReply();
    };

    // 收起键盘（或关掉表情/加号面板）并安静 N 秒后自动触发回复，
    // 等价于替用户点一次「触发回复」。判定全在 hook 内部，配置关掉后与手动模式一致。
    useKeyboardDismissAutoSend(wrapperRef, {
        active: !offlineMode && !isMultiSelectMode,
        pending: pendingGenerate,
        generating: isGenerating,
        panelOpen: showEmojiPanel || showStickerPanel || showPlusMenu,
        sessionId: session.id,
        onTrigger: () => { void triggerAIResponse(); },
    });

    useEffect(() => {
        const handleCustomAppReplyRequest = (event: Event) => {
            const detail = (event as CustomEvent<{
                sessionId?: string;
                characterId?: string;
                handled?: boolean;
                busy?: boolean;
            }>).detail;
            const requestSessionId = typeof detail?.sessionId === "string" ? detail.sessionId : "";
            const requestCharacterId = typeof detail?.characterId === "string" ? detail.characterId : "";
            const matches = requestSessionId
                ? requestSessionId === session.id
                : Boolean(requestCharacterId && !session.isGroup && requestCharacterId === session.contactId);
            if (!matches) return;

            if (detail) detail.handled = true;
            syncMessagesFromStorage();
            // 真在生成中：如实告知调用方（避免记成「已生成回应」），本轮结束后 pendingGenerate 兜底
            if (isGeneratingRef.current && activeGenerationRuns.has(session.id)) {
                if (detail) detail.busy = true;
                return;
            }
            void triggerAIResponse();
        };

        window.addEventListener(CHAT_REQUEST_REPLY_EVENT, handleCustomAppReplyRequest);
        return () => window.removeEventListener(CHAT_REQUEST_REPLY_EVENT, handleCustomAppReplyRequest);
    }, [session.contactId, session.id, session.isGroup, syncMessagesFromStorage, triggerAIResponse]);

    // 围观群/被禁言时用户不能发言
    const ensureGroupSpeakPermission = (): boolean => {
        if (!session.isGroup) return true;
        if (session.isSpectator) {
            showChatToast("围观群不能发言，只能点生成");
            return false;
        }
        const muteMs = getGroupMuteRemainingMs(session, GROUP_SELF_KEY);
        if (muteMs > 0) {
            showChatToast(`你已被禁言，剩余${formatMuteRemainingLabel(muteMs)}`);
            return false;
        }
        return true;
    };

    const handleSendText = (text: string, options?: { autoReply?: boolean }): boolean => {
        if (!ensureGroupSpeakPermission()) return false;
        if (isGenerating) {
            showChatToast("请先等待对方回复");
            return false;
        }
        const trimmed = text.trim();
        if (!trimmed) return false;

        // 🌸 华专属：零 API 消耗快速演练命令（直接本地激活状态机，不产生任何网络请求与 API 扣费）
        if (trimmed === "/mock-invite-he" || trimmed === "/测试他来") {
            const mockInvite: OfflineInviteData = {
                direction: "he_comes",
                status: "pending",
                place: "你家楼下",
                reason: "听说你今天加班辛苦了，我买了杯热热的桂花乌龙，等下给你送过去好吗？",
                onTheWayMessage: "在路上了，在家乖乖等我，很快就能见到你了。",
                arrivedMessage: "已经到你家楼下了，穿件外套下来吧。",
                durationMinutes: 20,
                sourceBatchId: "mock_offline_invite",
            };
            if (remindExpandTimerRef.current) {
                clearTimeout(remindExpandTimerRef.current);
            }
            remindExpandTimerRef.current = setTimeout(() => {
                updateActiveOfflineInvite(mockInvite);
                setIsOfflineInviteMinimized(false);
                remindExpandTimerRef.current = null;
            }, 3000);
            showChatToast("【模拟演练】已触发「他来」提议（胶囊与弹窗将于3秒后同时出现）");
            return true;
        }
        if (trimmed === "/mock-invite-i" || trimmed === "/测试我去") {
            const mockInvite: OfflineInviteData = {
                direction: "i_go",
                status: "pending",
                place: "老地方猫咖",
                reason: "靠窗的位置给你留着呢，小猫咪也醒了，慢慢过来不着急。",
                durationMinutes: 0,
                sourceBatchId: "mock_offline_invite",
            };
            if (remindExpandTimerRef.current) {
                clearTimeout(remindExpandTimerRef.current);
            }
            remindExpandTimerRef.current = setTimeout(() => {
                updateActiveOfflineInvite(mockInvite);
                setIsOfflineInviteMinimized(false);
                remindExpandTimerRef.current = null;
            }, 3000);
            showChatToast("【模拟演练】已触发「我去」邀约（胶囊与弹窗将于3秒后同时出现）");
            return true;
        }
        if (trimmed === "/mock-invite-clear" || trimmed === "/清除邀约") {
            if (remindExpandTimerRef.current) {
                clearTimeout(remindExpandTimerRef.current);
                remindExpandTimerRef.current = null;
            }
            updateActiveOfflineInvite(null);
            setIsOfflineInviteMinimized(false);
            kvRemove(ACTIVE_OFFLINE_INVITE_PREFIX + session.id);
            kvRemove(OFFLINE_INVITE_ACTIVE_SESSION_PREFIX + session.id);
            showChatToast("【模拟演练·0 API消耗】已清空邀约状态");
            return true;
        }

        // 🌸 华专属：测试快照与时光机（免去重复从头聊起的巨大精力损耗，秒级存盘与读盘，无损冻结倒计时）
        if (/^\/(?:快照|save|snap|保存快照)(?:\s+.*)?$/i.test(trimmed)) {
            const currentMsgs = loadChatMessages(session.id);
            const currentInvite = activeOfflineInviteRef.current;
            let statusLabel = "普通闲聊";
            let remLabel = "";
            let frozenRemMins: number | undefined;

            if (currentInvite) {
                if (currentInvite.status === "on_the_way") {
                    const dur = currentInvite.durationMinutes || 15;
                    const rem = getRemainingMinutes(currentInvite.startTime, dur);
                    frozenRemMins = rem;
                    statusLabel = "在途中";
                    remLabel = `(剩${rem}分)`;
                } else if (currentInvite.status === "arrived") {
                    frozenRemMins = currentInvite.frozenRemainingMinutes ?? 2;
                    statusLabel = currentInvite.isEarlyArrived ? "提前到达" : "已到达";
                    remLabel = `(定格${frozenRemMins}分)`;
                } else if (currentInvite.status === "pending") {
                    statusLabel = "待答应";
                }
            }

            const rawName = trimmed.replace(/^\/(?:快照|save|snap|保存快照)\s*/i, "").trim();
            const snapName = rawName || `快照_${statusLabel}${remLabel}`;

            // 深拷贝加固 invite，确保 initialBatchId 与倒计时定格时间 100% 完整无损
            const inviteSnapshot: OfflineInviteData | null = currentInvite ? {
                ...currentInvite,
                initialBatchId: currentInvite.initialBatchId || currentInvite.sourceBatchId,
                frozenRemainingMinutes: frozenRemMins ?? currentInvite.frozenRemainingMinutes,
            } : null;

            const snapData = {
                name: snapName,
                timestamp: Date.now(),
                sessionId: session.id,
                invite: inviteSnapshot,
                savedRemainingMinutes: frozenRemMins,
                messages: currentMsgs,
            };
            const snapKey = `chat_test_snapshot_${session.id}_${snapName}`;
            localStorage.setItem(snapKey, JSON.stringify(snapData));

            // 更新该会话的快照索引表
            const indexKey = `chat_test_snapshots_index_${session.id}`;
            let list: { name: string; timestamp: number; msgCount: number; status?: string; remainingMinutes?: number }[] = [];
            try {
                const rawIdx = localStorage.getItem(indexKey);
                if (rawIdx) list = JSON.parse(rawIdx);
            } catch {}
            list = list.filter(item => item.name !== snapName);
            list.push({
                name: snapName,
                timestamp: snapData.timestamp,
                msgCount: currentMsgs.length,
                status: currentInvite?.status,
                remainingMinutes: frozenRemMins,
            });
            localStorage.setItem(indexKey, JSON.stringify(list));

            showChatToast(`📸 已存快照「${snapName}」！\n(状态: ${statusLabel}${remLabel ? " " + remLabel : ""}, 消息数: ${currentMsgs.length})\n随时输入 /load 即可秒级回到此处~`);
            return true;
        }

        if (/^\/(?:读档|load|restore|恢复快照)(?:\s+.*)?$/i.test(trimmed)) {
            let snapName = trimmed.replace(/^\/(?:读档|load|restore|恢复快照)\s*/i, "").trim();
            const indexKey = `chat_test_snapshots_index_${session.id}`;
            let list: { name: string; timestamp: number; msgCount: number; status?: string; remainingMinutes?: number }[] = [];
            try {
                const rawIdx = localStorage.getItem(indexKey);
                if (rawIdx) list = JSON.parse(rawIdx);
            } catch {}

            if (!snapName) {
                // 未指定名字时，默认读取最近一次保存的快照
                if (list.length > 0) {
                    snapName = list[list.length - 1].name;
                } else {
                    snapName = "默认快照";
                }
            }

            const snapKey = `chat_test_snapshot_${session.id}_${snapName}`;
            const raw = localStorage.getItem(snapKey);
            if (!raw) {
                const snapListHint = list.length > 0 ? `\n现有快照：${list.map(s => s.name).join("、")}` : "";
                showChatToast(`未找到快照「${snapName}」${snapListHint}\n可输入 /快照列表 查看详细列表`);
                return true;
            }

            try {
                const snapData = JSON.parse(raw);
                if (Array.isArray(snapData.messages)) {
                    // 华专属贴心保护：读档前将当前现场暂存，防止误触读错档，支持 /load-undo 原地撤销！
                    const currentBeforeMsgs = loadChatMessages(session.id);
                    localStorage.setItem(`chat_test_snapshot_before_load_${session.id}`, JSON.stringify({
                        timestamp: Date.now(),
                        sessionId: session.id,
                        invite: activeOfflineInviteRef.current,
                        messages: currentBeforeMsgs,
                    }));

                    // 1. 深度恢复 invite 并动态水合现实时间锚点（Time-Freezing Hydration）
                    let inviteToRestore: OfflineInviteData | null = snapData.invite ? { ...snapData.invite } : null;
                    if (inviteToRestore) {
                        const dur = inviteToRestore.durationMinutes || 15;
                        if (inviteToRestore.status === "on_the_way") {
                            // 华敏锐确立的核心测试原则：无论现实过去多久，读盘时倒计时精确无损回到存盘那一刻的剩余时间！
                            const targetRemMins = typeof inviteToRestore.frozenRemainingMinutes === "number" && inviteToRestore.frozenRemainingMinutes > 0
                                ? inviteToRestore.frozenRemainingMinutes
                                : (typeof snapData.savedRemainingMinutes === "number" && snapData.savedRemainingMinutes > 0 ? snapData.savedRemainingMinutes : 15);
                            const finalDuration = Math.max(dur, targetRemMins);
                            inviteToRestore.durationMinutes = finalDuration;
                            const elapsedSec = Math.max(0, (finalDuration - targetRemMins) * 60);
                            inviteToRestore.startTime = Date.now() - elapsedSec * 1000;
                            inviteToRestore.frozenRemainingMinutes = targetRemMins;
                        }
                    }

                    // 2. 覆盖消息并更新活跃邀约
                    replaceChatSessionMessages(session.id, snapData.messages);
                    updateActiveOfflineInvite(inviteToRestore);

                    // 3. UI 状态绝对对齐：在途必定最小化为顶部微光呼吸胶囊，待答应或已到达必定展开全屏大卡片弹窗！
                    setIsOfflineInviteMinimized(inviteToRestore?.status === "on_the_way");

                    // 4. 同步界面可视消息流
                    syncMessagesFromStorage();

                    const statusStr = inviteToRestore
                        ? (inviteToRestore.status === "on_the_way" ? `在途中 (剩余 ${inviteToRestore.frozenRemainingMinutes || 15} 分钟)` : (inviteToRestore.status === "arrived" ? "已到达" : "待答应"))
                        : "普通单聊";
                    showChatToast(`✨ 已成功秒级读档回到「${snapName}」！\n(赴约状态: ${statusStr}, 消息数: ${snapData.messages.length})\n若读错档可打 /load-undo 撤销~`);
                } else {
                    showChatToast("快照数据格式不符，读取失败");
                }
            } catch {
                showChatToast("读取快照出错");
            }
            return true;
        }

        if (trimmed === "/load-undo" || trimmed === "/撤销读档" || trimmed === "/undo-load") {
            const rawUndo = localStorage.getItem(`chat_test_snapshot_before_load_${session.id}`);
            if (!rawUndo) {
                showChatToast("当前没有可撤销的读档记录");
                return true;
            }
            try {
                const undoData = JSON.parse(rawUndo);
                if (Array.isArray(undoData.messages)) {
                    replaceChatSessionMessages(session.id, undoData.messages);
                    updateActiveOfflineInvite(undoData.invite || null);
                    setIsOfflineInviteMinimized(undoData.invite?.status === "on_the_way");
                    syncMessagesFromStorage();
                    localStorage.removeItem(`chat_test_snapshot_before_load_${session.id}`);
                    showChatToast("↩️ 已成功撤销读档，恢复至读档前的现场！");
                }
            } catch {
                showChatToast("撤销读档失败");
            }
            return true;
        }

        if (trimmed === "/快照列表" || trimmed === "/snaps" || trimmed === "/snaplist") {
            const indexKey = `chat_test_snapshots_index_${session.id}`;
            let list: { name: string; timestamp: number; msgCount: number; status?: string; remainingMinutes?: number }[] = [];
            try {
                const rawIdx = localStorage.getItem(indexKey);
                if (rawIdx) list = JSON.parse(rawIdx);
            } catch {}

            if (list.length === 0) {
                showChatToast("当前单聊还没有保存过快照，可输入 /save [名称] 随时存盘~");
            } else {
                const summary = list.map((item, idx) => {
                    const timeStr = new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
                    let stLabel = "闲聊";
                    if (item.status === "on_the_way") stLabel = `在途(剩${item.remainingMinutes || 15}分)`;
                    else if (item.status === "arrived") stLabel = "已到达";
                    else if (item.status === "pending") stLabel = "待答应";
                    return `${idx + 1}. 「${item.name}」(${item.msgCount}条消息, 状态:${stLabel}, 时间:${timeStr})`;
                }).join("\n");
                showChatToast(`📋 已存快照列表:\n${summary}\n\n💡 输入 /load [名称] 读档，或直接输入 /load 读最新快照`);
            }
            return true;
        }

        if (/^\/(?:删除快照|del-snap|清除快照)(?:\s+.*)?$/i.test(trimmed)) {
            const snapName = trimmed.replace(/^\/(?:删除快照|del-snap|清除快照)\s*/i, "").trim();
            const indexKey = `chat_test_snapshots_index_${session.id}`;
            if (!snapName || snapName === "all" || snapName === "全部") {
                // 清空全部
                let list: { name: string }[] = [];
                try {
                    const rawIdx = localStorage.getItem(indexKey);
                    if (rawIdx) list = JSON.parse(rawIdx);
                } catch {}
                for (const item of list) {
                    localStorage.removeItem(`chat_test_snapshot_${session.id}_${item.name}`);
                }
                localStorage.removeItem(indexKey);
                showChatToast("🗑️ 已清空该会话的全部测试快照");
                return true;
            }
            const snapKey = `chat_test_snapshot_${session.id}_${snapName}`;
            localStorage.removeItem(snapKey);
            let list: { name: string }[] = [];
            try {
                const rawIdx = localStorage.getItem(indexKey);
                if (rawIdx) list = JSON.parse(rawIdx);
            } catch {}
            list = list.filter(item => item.name !== snapName);
            localStorage.setItem(indexKey, JSON.stringify(list));
            showChatToast(`🗑️ 已删除快照「${snapName}」`);
            return true;
        }

        if (trimmed === "/导出快照" || trimmed === "/export-chat" || trimmed === "/导出单聊") {
            const currentMsgs = loadChatMessages(session.id);
            const exportPayload = {
                format: "ai-phone-chat-snapshot",
                version: 1,
                exportedAt: new Date().toISOString(),
                session: { id: session.id, name: character?.name || "单聊" },
                invite: activeOfflineInviteRef.current,
                messages: currentMsgs,
            };
            const jsonStr = JSON.stringify(exportPayload, null, 2);
            const blob = new Blob([jsonStr], { type: "application/json" });
            const filename = `${character?.name || "单聊"}_测试快照_${Date.now()}.json`;
            void downloadFile(blob, filename);
            showChatToast(`📤 单聊测试快照已导出！(${filename})`);
            return true;
        }

        if (trimmed === "/导入快照" || trimmed === "/import-chat" || trimmed === "/导入单聊") {
            const fileInput = document.createElement("input");
            fileInput.type = "file";
            fileInput.accept = ".json";
            fileInput.style.display = "none";
            document.body.appendChild(fileInput);
            fileInput.onchange = (e) => {
                const file = (e.target as HTMLInputElement).files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (event) => {
                    try {
                        const content = event.target?.result as string;
                        const data = JSON.parse(content);
                        let msgs: ChatMessage[] = [];
                        let inv: OfflineInviteData | null = null;
                        if (Array.isArray(data)) {
                            msgs = data;
                        } else if (Array.isArray(data.messages)) {
                            msgs = data.messages;
                            inv = data.invite || null;
                        }
                        if (msgs.length > 0) {
                            replaceChatSessionMessages(session.id, msgs);
                            // 如果快照带了邀约状态直接恢复，没带则从消息自动水合
                            const finalInvite = inv || restoreOfflineInviteFromMessages(msgs, null);
                            updateActiveOfflineInvite(finalInvite);
                            if (finalInvite?.status !== "on_the_way") {
                                setIsOfflineInviteMinimized(false);
                            }
                            syncMessagesFromStorage();
                            showChatToast(`📥 单聊测试快照导入成功！已恢复 ${msgs.length} 条消息与现场`);
                        } else {
                            showChatToast("导入文件中未包含有效聊天消息");
                        }
                    } catch {
                        showChatToast("解析导入快照文件失败");
                    } finally {
                        fileInput.remove();
                    }
                };
                reader.readAsText(file);
            };
            fileInput.click();
            return true;
        }

        // Cancel any pending follow-up for this session
        cancelFollowUp(session.id);

        // If quoting a message, send as quote type
        const isQuoting = !!quotingMessage;
        const quoteData = quotingMessage ? {
            quoteMessageId: quotingMessage.id,
            quotePreview: quotingMessage.content.slice(0, 50),
            quoteRole: quotingMessage.role,
        } : undefined;
        setQuotingMessage(null);

        const commitSendText = (currentText: string) => {
            // 掷骰子：整条消息就是骰子图标时，发骰子气泡（内容仅图标），
            // 点数由系统旁白公布——避免结果挂在 user 消息上被角色模仿格式
            const diceOnly = !isQuoting && isDiceOnlyMessage(currentText);
            const diceFace = diceOnly ? rollChatDiceFace() : 0;

            const newMsg = pushChatMessage({
                sessionId: session.id,
                role: "user",
                content: currentText,
                mediaType: diceOnly ? "dice" : isQuoting ? "quote" : undefined,
                mediaData: diceOnly ? { diceFace } : isQuoting ? quoteData : undefined,
            });

            setMessages(prev => [...prev, newMsg]);
            if (diceOnly) {
                const diceAside = pushChatMessage({
                    sessionId: session.id,
                    role: "system",
                    content: formatChatDiceResultMessage(diceFace),
                });
                setMessages(prev => [...prev, diceAside]);
            }
            setPendingGenerate(true);
            // 按回复键发送：消息落库后立即触发模型回复（无论插件是否异步改写，
            // 都在消息真正写入后触发，避免回复基于旧上下文）
            if (options?.autoReply) void triggerAIResponse();
        };

        // 聊天插件织入点 user.beforeSend：无插件时走原同步路径，
        // 有插件时输入框先清空，改写/取消在异步续体里完成
        if (getChatPluginHookBus().hasHandlers("user.beforeSend")) {
            void runChatPluginTransform("user.beforeSend", {
                text: trimmed,
                sessionId: session.id,
                isGroup: !!session.isGroup,
                cancelled: false,
            }).then(payload => {
                if (payload.cancelled) return;
                const finalText = typeof payload.text === "string" ? payload.text.trim() : trimmed;
                if (finalText) commitSendText(finalText);
            });
        } else {
            commitSendText(trimmed);
        }
        return true;
    };

    // 线下 XML 构造与提示词查看器共用 lib/offline-prompt-builder（社区 #108），
    // 保证「预览 = 真实发出的提示词」；此处仅包一层稳定引用。
    // 自定义状态栏：custom 生效时新消息盖戳，折叠区改走用户渲染代码；旧消息按原生渲染
    const statusRegionCfg = getStatusRegionConfig(session.id);
    const customStatusActive = isCustomStatusRegionActive(statusRegionCfg);

    const formatOfflineTurnXml = useCallback((turn: ChatOfflineTurn): string => formatOfflineTurnXmlShared(turn), []);

    const buildOfflinePromptHistory = (turns: ChatOfflineTurn[], pendingUserContent: string): ChatMessage[] =>
        buildOfflinePromptHistoryShared(session, turns, pendingUserContent);
    const getOfflineCopyText = (turn: ChatOfflineTurn, role: OfflineActionTarget["role"]): string => {
        if (role === "user") return turn.userContent;
        return formatOfflineTurnXml(turn);
    };

    const getOfflineDisplayText = useCallback((turn: ChatOfflineTurn) => {
        const rawSource = formatOfflineTurnXml(turn);
        const rawDisplay = renderDisplayText(rawSource, 2, true);
        const parsed = rawDisplay !== rawSource
            ? parseOfflineResponse(rawDisplay, turn.summaryTag || "summary")
            : null;
        const hasParsedDisplay = Boolean(parsed?.content.trim() || parsed?.summary.trim());
        return {
            userContent: renderDisplayText(turn.userContent, 1, true),
            assistantContent: hasParsedDisplay
                ? (parsed!.content.trim() || renderDisplayText(turn.assistantContent, 2, true))
                : renderDisplayText(turn.assistantContent, 2, true),
            summary: hasParsedDisplay
                ? (parsed!.summary.trim() || renderDisplayText(turn.summary, 2, true))
                : renderDisplayText(turn.summary, 2, true),
        };
    }, [formatOfflineTurnXml, renderDisplayText]);

    const visibleOfflineTurns = useMemo(() => {
        return offlineTurns.slice(-offlineVisibleCount);
    }, [offlineTurns, offlineVisibleCount]);

    const hasMoreOfflineTurns = visibleOfflineTurns.length < offlineTurns.length;

    const offlineDisplayByTurnId = useMemo(() => {
        const map = new Map<string, ReturnType<typeof getOfflineDisplayText>>();
        for (const turn of visibleOfflineTurns) {
            map.set(turn.id, getOfflineDisplayText(turn));
        }
        return map;
    }, [getOfflineDisplayText, visibleOfflineTurns]);

    const loadMoreOfflineTurns = useCallback(() => {
        if (!hasMoreOfflineTurns) return;
        const el = scrollRef.current;
        if (el) {
            offlineLoadMoreRestoreRef.current = {
                scrollHeight: el.scrollHeight,
                scrollTop: el.scrollTop,
            };
        }
        setOfflineVisibleCount(count => Math.min(count + OFFLINE_LOAD_MORE_COUNT, offlineTurns.length));
    }, [hasMoreOfflineTurns, offlineTurns.length]);

    useLayoutEffect(() => {
        const restore = offlineLoadMoreRestoreRef.current;
        const el = scrollRef.current;
        if (!restore || !el) return;
        el.scrollTop = restore.scrollTop + (el.scrollHeight - restore.scrollHeight);
        offlineLoadMoreRestoreRef.current = null;
    }, [visibleOfflineTurns.length]);

    const handleOfflinePointerDown = (e: React.PointerEvent, target: OfflineActionTarget) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        e.preventDefault();
        const anchor = { x: e.clientX, y: e.clientY };
        startPosRef.current = anchor;
        longPressTriggeredRef.current = false;
        if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = setTimeout(() => {
            longPressTriggeredRef.current = true;
            openOfflineContextMenu(target, anchor);
            longPressTimerRef.current = null;
        }, 500);
    };

    const handleOfflineEditStart = (turn: ChatOfflineTurn, role: OfflineActionTarget["role"]) => {
        setActiveOfflineTarget(null);
        setEditingOfflineTarget({ turnId: turn.id, role });
        setEditingOfflineContent(role === "user" ? turn.userContent : formatOfflineTurnXml(turn));
    };

    const doToggleOfflineMode = (isFromConfirmedInviteExit: boolean = false) => {
        cancelFollowUp(session.id);
        setShowPlusMenu(false);
        setShowEmojiPanel(false);
        setShowStickerPanel(false);
        setRichModal(null);
        setQuotingMessage(null);
        setActiveOfflineTarget(null);
        setOfflineTurns(loadChatOfflineTurns(session.id));
        setOfflineVisibleCount(OFFLINE_INITIAL_LOAD);
        setOfflineMode(prev => {
            const next = !prev;
            kvSet(CHAT_OFFLINE_MODE_PREFIX + session.id, next ? "1" : "0");
            if (prev && !next) {
                // 华敏锐指出的体验细节：从线下切回线上时重置初始滚动标记，确保定位至最新对话
                needsInitialScrollRef.current = true;
                // 只有当明确是由角色邀约赴约结束（用户在确认弹窗点击确认）时，才触发角色主动发信（报平安/余韵）
                // 用户平时的手动线下切换绝对不触发！
                if (isFromConfirmedInviteExit && session.enableOfflineInvite && !session.isGroup) {
                    window.setTimeout(() => {
                        void runManagedGeneration({
                            history: loadChatMessages(session.id),
                            returnedFromOffline: true,
                        });
                    }, 600);
                }
            }
            return next;
        });
    };

    const toggleOfflineMode = () => {
        if (!offlineMode && isGenerating) {
            showChatToast("请先等待对方回复");
            return;
        }
        if (offlineMode && isOfflineGenerating) {
            showChatToast("线下回复生成中");
            return;
        }
        // 如果当前在线下模式，且当前会话属于“角色主动发起见面的线下赴约”：弹出确认弹窗
        if (offlineMode && kvGet(OFFLINE_INVITE_ACTIVE_SESSION_PREFIX + session.id) === "1") {
            setShowConfirmExitOfflineInvite(true);
            return;
        }
        doToggleOfflineMode(false);
    };

    const handleAcceptOfflineInvite = () => {
        if (!activeOfflineInvite) return;
        if (remindExpandTimerRef.current) {
            clearTimeout(remindExpandTimerRef.current);
            remindExpandTimerRef.current = null;
        }
        // 如果是角色来见用户，且当前还在待答应（pending）阶段：答应后开启“在途赶来”阶段
        if (activeOfflineInvite.direction === "he_comes" && activeOfflineInvite.status === "pending") {
            const duration = activeOfflineInvite.durationMinutes || 15;
            const inTransitInvite: OfflineInviteData = {
                ...activeOfflineInvite,
                status: "on_the_way",
                startTime: Date.now(),
                durationMinutes: duration,
            };
            updateActiveOfflineInvite(inTransitInvite);
            setIsOfflineInviteMinimized(true);
            showChatToast(`${character?.name || "对方"}已动身，预计 ${duration} 分钟后到达`);

            // 华提出的黄金体验节点②【同意动身】：系统居中小灰字留下同意与动身记录（因果链）
            const charName = character?.name || "对方";
            const rawPlace = activeOfflineInvite.place?.trim();
            const placeStr = rawPlace ? (rawPlace === "你身边" ? "你身边" : `「${rawPlace}」`) : "约定地点";
            const sysAcceptMsg = pushChatMessage({
                sessionId: session.id,
                role: "system",
                content: `你已同意赴约，${charName} 正在动身赶往${placeStr}`,
                mediaType: "offline_invite_system_notice",
                mediaData: { offlineInvite: inTransitInvite },
            });
            setMessages(prev => [...prev, sysAcceptMsg]);

            // 华的细腻考量：如果用户是“稍后处理后自助点击答应”（即聊天框里最后一条并不是刚刚发出的动身提醒），
            // 角色绝不能闷声就出发！系统自动在聊天窗口发一条动身消息，模拟打字 1 秒延迟！
            const lastMsg = messages[messages.length - 1];
            const wasJustReminded = Boolean(
                lastRemindBatchIdRef.current && lastMsg?.responseBatchId === lastRemindBatchIdRef.current
            );
            if (!wasJustReminded) {
                // 华的黄金要求：使用 AI 在该情境下动态生成的动身回复（例如答应一起去拼豆店），绝不生硬套用机械模板！
                const transitChat = sanitizeTransitMessage(
                    activeOfflineInvite.onTheWayMessage,
                    activeOfflineInvite.direction,
                    activeOfflineInvite.place
                );
                // 模拟角色打字 1 秒后发出
                window.setTimeout(() => {
                    const newMsg = pushChatMessage({
                        sessionId: session.id,
                        role: "assistant",
                        content: transitChat,
                    });
                    setMessages(prev => [...prev, newMsg]);
                }, 1000);
            }
            return;
        }

        // 若已到达（arrived）或角色在途用户提前去见，或用户主动去赴约（i_go）：进入线下模式
        const isHeComes = activeOfflineInvite.direction === "he_comes";
        const place = activeOfflineInvite.place || "约定地点";
        const initiativePrompt = isHeComes
            ? `【线下相遇开场·你奔赴来见用户】：是你主动动身来到用户所在的地方（奔赴地点：${place}）。此时你刚刚抵达并在现场见到了走出来的用户。这是你们在线下碰面的第一刻，请以你的角色人设输出你见到用户时的第一句话与动作描写（注意是你奔赴来见对方，例如在车旁或路灯下看见对方迎上前去、递上热饮、上下打量对方温和打招呼等）。绝对严禁写成用户跑来你的地盘找你！`
            : `【线下相遇开场·用户前来赴约找你】：你在约定的地点（奔赴地点：${place}）等候，用户此时如约赶到了现场。这是你们在线下见面的第一刻，请以你的角色人设输出你迎接用户时的第一句话与动作描写（例如在座位上看到对方走来起身招手、招呼对方坐下等）。`;

        if (!isHeComes && activeOfflineInvite.status === "pending") {
            const charName = character?.name || "对方";
            const placeStr = activeOfflineInvite.place ? `「${activeOfflineInvite.place}」` : "约定地点";
            const sysAcceptMsg = pushChatMessage({
                sessionId: session.id,
                role: "system",
                content: `你已同意赴约，请前往${placeStr}与 ${charName} 碰面`,
                mediaType: "offline_invite_system_notice",
                mediaData: { offlineInvite: activeOfflineInvite },
            });
            setMessages(prev => [...prev, sysAcceptMsg]);
        }

        // 标记本次线下是由角色自主邀约赴约开启的
        kvSet(OFFLINE_INVITE_ACTIVE_SESSION_PREFIX + session.id, "1");
        updateActiveOfflineInvite(null);
        setIsOfflineInviteMinimized(false);
        kvRemove(PENDING_OFFLINE_INVITE_DECLINE_PREFIX + session.id);
        showChatToast("正在奔赴线下...");
        doToggleOfflineMode(false);

        // 角色在线下主动说出第一句话（开场白）
        window.setTimeout(() => {
            void handleOfflineSend("", { isInitiative: true, initiativePrompt });
        }, 600);
    };

    const handleDeclineOfflineInvite = () => {
        if (!activeOfflineInvite) return;
        if (remindExpandTimerRef.current) {
            clearTimeout(remindExpandTimerRef.current);
            remindExpandTimerRef.current = null;
        }
        // 华提出的黄金体验节点⑤【婉拒交代】：留下拒绝记录，为角色后续的心理安抚做出完美因果交代
        const charName = character?.name || "对方";
        const sysDeclineMsg = pushChatMessage({
            sessionId: session.id,
            role: "system",
            content: `你婉拒了 ${charName} 的线下赴约提议`,
            mediaType: "offline_invite_system_notice",
        });
        setMessages(prev => [...prev, sysDeclineMsg]);

        updateActiveOfflineInvite(null);
        setIsOfflineInviteMinimized(false);
        kvSet(PENDING_OFFLINE_INVITE_DECLINE_PREFIX + session.id, "1");
        showChatToast("已拒绝线下见面");
        if (session.enableOfflineInvite && !session.isGroup) {
            void runManagedGeneration({
                history: loadChatMessages(session.id),
                offlineInviteDeclined: true,
            });
        }
    };

    const handleEarlyArriveOfflineInvite = () => {
        if (!activeOfflineInvite) return;
        const remainingMins = getRemainingMinutes(activeOfflineInvite.startTime, activeOfflineInvite.durationMinutes || 15);
        const arriveBatchId = `offline_early_arrive_${Date.now()}`;
        const arrivedInvite: OfflineInviteData = {
            ...activeOfflineInvite,
            status: "arrived",
            isEarlyArrived: true,
            frozenRemainingMinutes: remainingMins,
            relatedBatchIds: Array.from(new Set([...(activeOfflineInvite.relatedBatchIds || []), arriveBatchId])),
        };
        updateActiveOfflineInvite(arrivedInvite);
        setIsOfflineInviteMinimized(false);

        // 华提出的黄金体验节点③【行程到达】：提前到达时，在聊天流中留下提前到达事实系统记录
        const charName = character?.name || "对方";
        const isOriginByYourSide = activeOfflineInvite.initialPlace === "你身边" || (!activeOfflineInvite.initialPlace && activeOfflineInvite.place === "你身边");
        const rawPlace = activeOfflineInvite.place?.trim();
        const placeStr = isOriginByYourSide ? "你身边" : (rawPlace ? (rawPlace === "你身边" ? "你身边" : `「${rawPlace}」`) : "约定地点");
        const sysArriveMsg = pushChatMessage({
            sessionId: session.id,
            role: "system",
            content: activeOfflineInvite.direction === "he_comes"
                ? `${charName} 已提前到达${placeStr}`
                : `${charName} 已在${placeStr}就位等候`,
            mediaType: "offline_invite_system_notice",
            mediaData: { offlineInvite: arrivedInvite },
        });
        setMessages(prev => [...prev, sysArriveMsg]);

        // 华提出的黄金细节：隔 1 秒钟模拟角色打字时间发出到达微信消息！
        const arrivalChatText = getArrivalChatMessage(activeOfflineInvite);
        window.setTimeout(() => {
            const newMsg = pushChatMessage({
                sessionId: session.id,
                role: "assistant",
                content: arrivalChatText,
                responseBatchId: arriveBatchId,
                mediaType: "offline_invite_arrive_notice",
            });
            setMessages(prev => [...prev, newMsg]);
        }, 1000);
    };

    const handleMinimizeOfflineInvite = () => {
        setIsOfflineInviteMinimized(true);
    };

    const handleExpandOfflineInvite = () => {
        if (remindExpandTimerRef.current) {
            clearTimeout(remindExpandTimerRef.current);
            remindExpandTimerRef.current = null;
        }
        setIsOfflineInviteMinimized(false);
    };

    const toggleTheaterMode = () => {
        setShowPlusMenu(false);
        setShowEmojiPanel(false);
        setShowStickerPanel(false);
        setTheaterMode(prev => {
            const next = !prev;
            if (next) kvSet(CHAT_THEATER_MODE_PREFIX + session.id, "1");
            else kvRemove(CHAT_THEATER_MODE_PREFIX + session.id);
            return next;
        });
    };

    const closeTheaterMode = () => {
        kvRemove(CHAT_THEATER_MODE_PREFIX + session.id);
        setTheaterMode(false);
    };

    const handleOfflineSend = (inputText: string, options?: { isInitiative?: boolean; initiativePrompt?: string }): boolean => {
        if (isOfflineGenerating) {
            showChatToast("线下回复生成中");
            return false;
        }
        const isInitiative = options?.isInitiative === true;
        const currentText = inputText.trim();
        if (!currentText && !(session.isGroup && session.isSpectator) && !isInitiative) return false;

        cancelFollowUp(session.id);
        setShowPlusMenu(false);
        setShowEmojiPanel(false);
        setShowStickerPanel(false);
        setRichModal(null);
        setPendingOfflineUserText(currentText);
        offlineGenerationInputRef.current = currentText;
        setIsOfflineGenerating(true);
        offlineStreamAccumRef.current = "";
        setOfflineStreamPreview(null);
        const offlineRun = createOfflineGenerationRun(session.id);
        const offlineRunId = offlineRun.runId;
        const isCurrentOfflineRun = () => isOfflineGenerationRunActive(session.id, offlineRunId);

        void (async () => {
            try {
                const history = buildOfflinePromptHistory(offlineTurns, currentText);
                const onOfflineDelta = (delta: string) => {
                    if (!isCurrentOfflineRun()) return;
                    offlineStreamAccumRef.current += delta;
                    // 线下预览解析合并到 rAF 下一帧：每帧最多一次全文解析+setState
                    if (offlineStreamFrameRef.current) return;
                    offlineStreamFrameRef.current = window.requestAnimationFrame(() => {
                        offlineStreamFrameRef.current = 0;
                        if (!isCurrentOfflineRun()) return;
                        // 与引擎顺序一致：先按预设 strip_texts 清洗原文，再解析（避免剔除文本影响 XML 结构时预览与最终结果不一致）
                        const previewRaw = stripLiteralTexts(offlineStreamAccumRef.current, streamPreviewTagConfig.stripTexts);
                        const parsed = parseOfflineResponse(previewRaw, streamPreviewTagConfig.summaryTag);
                        // 流式碎片阶段 XML 标签可能未闭合：content 提取不到时，剥掉开标签残片直接显示原文；
                        // 思维链/自定义摘要标签按当前预设整块隐藏，避免生成过程中闪现（与引擎最终清洗同源）
                        const previewContent = (parsed.content
                            ? stripXmlTagBlocks(parsed.content, [streamPreviewTagConfig.summaryTag, ...streamPreviewTagConfig.offlineThinking])
                            : stripXmlTagBlocks(previewRaw, [streamPreviewTagConfig.summaryTag, ...streamPreviewTagConfig.offlineThinking])
                                .replace(/<\/?(?:content|summary|thinking|thought|think)>/gi, "")
                                .replace(/<[^>]+>/g, "")
                        ).trim();
                        setOfflineStreamPreview({ content: previewContent, summary: parsed.summary });
                    });
                };
                const result = session.isGroup
                    ? await generateGroupOfflineChatCompletion(session, history, { signal: offlineRun.controller.signal, onStreamDelta: onOfflineDelta })
                    : await generateOfflineChatCompletion(session, history, {
                        signal: offlineRun.controller.signal,
                        onStreamDelta: onOfflineDelta,
                        offlineInitiativePrompt: options?.initiativePrompt,
                    });
                if (!isCurrentOfflineRun()) return;
                const assistantContent = result.content.trim() || result.rawText.trim();
                if (!assistantContent) throw new Error("AI 没有返回线下正文");
                if (!result.summary.trim()) showChatToast(`未提取到 <${result.summaryTag}> 摘要`);
                const saved = appendChatOfflineTurn({
                    sessionId: session.id,
                    userContent: currentText,
                    assistantContent,
                    summary: result.summary.trim(),
                    summaryTag: result.summaryTag,
                    rawText: result.rawText,
                    reasoningText: result.reasoning,
                    thinkingText: result.thinking,
                    thinkingTag: result.thinkingTag,
                });
                setOfflineTurns(prev => [...prev, saved]);
            } catch (error: any) {
                if (!isCurrentOfflineRun() || isAbortLikeError(error)) return;
                offlineTextInputRef.current?.setText(currentText);
                showChatToast(`线下生成失败: ${error?.message || String(error)}`, 3000);
            } finally {
                if (!finishOfflineGenerationRun(session.id, offlineRunId)) return;
                setPendingOfflineUserText("");
                offlineGenerationInputRef.current = "";
                setIsOfflineGenerating(false);
                offlineStreamAccumRef.current = "";
                setOfflineStreamPreview(null);
            }
        })();
        return true;
    };

    const handleOfflineEditSave = () => {
        if (!editingOfflineTarget) return;
        const content = editingOfflineContent.trim();
        const turn = offlineTurns.find(item => item.id === editingOfflineTarget.turnId);
        if (!turn) {
            setEditingOfflineTarget(null);
            setEditingOfflineContent("");
            return;
        }
        if (!content) {
            showChatToast("编辑内容不能为空");
            return;
        }

        if (editingOfflineTarget.role === "user") {
            const nextContent = applyEditTextRegex(content, 1, true);
            const updated = updateChatOfflineTurn(session.id, turn.id, { userContent: nextContent });
            if (updated) setOfflineTurns(prev => prev.map(item => item.id === updated.id ? updated : item));
            setEditingOfflineTarget(null);
            setEditingOfflineContent("");
            return;
        }

        const nextContent = applyEditTextRegex(content, 2, true);
        const parsed = parseOfflineResponse(nextContent, turn.summaryTag || "summary");
        const assistantContent = parsed.content.trim() || parsed.rawText.trim();
        if (!assistantContent) {
            showChatToast("没有解析到线下正文");
            return;
        }
        if (!parsed.summary.trim()) showChatToast(`未提取到 <${parsed.summaryTag}> 摘要`);
        // 思维链：parseOfflineResponse 已回归官方两参数（不再提取 thinking）。
        // 若该条原本带标签思维链（预设开启线下标签解析），按原标签从编辑后的正文重新提取，否则保持无。
        const editedThinking = turn.thinkingText !== undefined
            ? (extractThinkingTag(nextContent, turn.thinkingTag) || undefined)
            : undefined;
        const updated = updateChatOfflineTurn(session.id, turn.id, {
            assistantContent,
            summary: parsed.summary.trim(),
            summaryTag: parsed.summaryTag,
            rawText: parsed.rawText,
            thinkingText: editedThinking,
            thinkingTag: editedThinking !== undefined ? turn.thinkingTag : undefined,
        });
        if (updated) setOfflineTurns(prev => prev.map(item => item.id === updated.id ? updated : item));
        setEditingOfflineTarget(null);
        setEditingOfflineContent("");
    };

    const handleOfflineDeleteTurn = (turnId: string) => {
        setOfflineTurns(deleteChatOfflineTurn(session.id, turnId));
        setActiveOfflineTarget(null);
    };

    const handleOfflineDeleteTurnsFrom = (turnId: string) => {
        setOfflineTurns(deleteChatOfflineTurnsFrom(session.id, turnId));
        setActiveOfflineTarget(null);
    };

    const handleOfflineRetryFrom = async (turnId: string) => {
        if (isOfflineGenerating) {
            showChatToast("线下回复生成中");
            return;
        }
        const idx = offlineTurns.findIndex(turn => turn.id === turnId);
        if (idx < 0) return;
        const targetTurn = offlineTurns[idx];
        const baseTurns = offlineTurns.slice(0, idx);
        const retryInput = targetTurn.userContent.trim();
        if (!retryInput) {
            showChatToast("这一轮没有可重试的用户输入");
            return;
        }

        cancelFollowUp(session.id);
        setActiveOfflineTarget(null);
        setShowPlusMenu(false);
        setShowEmojiPanel(false);
        setShowStickerPanel(false);
        setRichModal(null);
        saveChatOfflineTurns(session.id, baseTurns);
        setOfflineTurns(baseTurns);
        setPendingOfflineUserText(retryInput);
        offlineGenerationInputRef.current = retryInput;
        setIsOfflineGenerating(true);
        offlineStreamAccumRef.current = "";
        setOfflineStreamPreview(null);
        const offlineRun = createOfflineGenerationRun(session.id);
        const offlineRunId = offlineRun.runId;
        const isCurrentOfflineRun = () => isOfflineGenerationRunActive(session.id, offlineRunId);

        try {
            const history = buildOfflinePromptHistory(baseTurns, retryInput);
            const onOfflineDelta = (delta: string) => {
                if (!isCurrentOfflineRun()) return;
                offlineStreamAccumRef.current += delta;
                // 线下预览解析合并到 rAF 下一帧：每帧最多一次全文解析+setState（与首次发送路径对齐）
                if (offlineStreamFrameRef.current) return;
                offlineStreamFrameRef.current = window.requestAnimationFrame(() => {
                    offlineStreamFrameRef.current = 0;
                    if (!isCurrentOfflineRun()) return;
                    // 与引擎顺序一致：先按预设 strip_texts 清洗原文，再解析（避免剔除文本影响 XML 结构时预览与最终结果不一致）
                    const previewRaw = stripLiteralTexts(offlineStreamAccumRef.current, streamPreviewTagConfig.stripTexts);
                    const parsed = parseOfflineResponse(previewRaw, streamPreviewTagConfig.summaryTag);
                    // 流式碎片阶段 XML 标签可能未闭合：content 提取不到时，剥掉开标签残片直接显示原文；
                    // 思维链/自定义摘要标签按当前预设整块隐藏，避免生成过程中闪现（与引擎最终清洗同源）
                    const previewContent = (parsed.content
                        ? stripXmlTagBlocks(parsed.content, [streamPreviewTagConfig.summaryTag, ...streamPreviewTagConfig.offlineThinking])
                        : stripXmlTagBlocks(previewRaw, [streamPreviewTagConfig.summaryTag, ...streamPreviewTagConfig.offlineThinking])
                            .replace(/<\/?(?:content|summary|thinking|thought|think)>/gi, "")
                            .replace(/<[^>]+>/g, "")
                    ).trim();
                    setOfflineStreamPreview({ content: previewContent, summary: parsed.summary });
                });
            };
            const result = session.isGroup
                ? await generateGroupOfflineChatCompletion(session, history, { signal: offlineRun.controller.signal, onStreamDelta: onOfflineDelta })
                : await generateOfflineChatCompletion(session, history, { signal: offlineRun.controller.signal, onStreamDelta: onOfflineDelta });
            if (!isCurrentOfflineRun()) return;
            const assistantContent = result.content.trim() || result.rawText.trim();
            if (!assistantContent) throw new Error("AI 没有返回线下正文");
            if (!result.summary.trim()) showChatToast(`未提取到 <${result.summaryTag}> 摘要`);
            const saved = appendChatOfflineTurn({
                sessionId: session.id,
                userContent: retryInput,
                assistantContent,
                summary: result.summary.trim(),
                summaryTag: result.summaryTag,
                rawText: result.rawText,
                reasoningText: result.reasoning,
                thinkingText: result.thinking,
                thinkingTag: result.thinkingTag,
            });
            setOfflineTurns([...baseTurns, saved]);
        } catch (error: any) {
            if (!isCurrentOfflineRun() || isAbortLikeError(error)) return;
            offlineTextInputRef.current?.setText(retryInput);
            showChatToast(`线下重试失败: ${error?.message || String(error)}`, 3000);
        } finally {
            if (!finishOfflineGenerationRun(session.id, offlineRunId)) return;
            setPendingOfflineUserText("");
            offlineGenerationInputRef.current = "";
            setIsOfflineGenerating(false);
            offlineStreamAccumRef.current = "";
            setOfflineStreamPreview(null);
        }
    };

    const handleRetry = async (msgId: string) => {
        const msgIndex = messages.findIndex(m => m.id === msgId);
        if (msgIndex === -1 || messages[msgIndex].role !== "assistant") return;

        const targetRetryMsg = messages[msgIndex];
        const contextMessages = messages.slice(0, msgIndex);
        const truncatedMessages = messages.slice(msgIndex);

        const currentInvite = activeOfflineInviteRef.current;
        const rootId = currentInvite?.initialBatchId || currentInvite?.sourceBatchId;
        const truncatesInitialRoot = Boolean(
            currentInvite &&
            currentInvite.sourceBatchId !== "mock_offline_invite" &&
            rootId &&
            truncatedMessages.some(m => m.responseBatchId === rootId) &&
            // 华提出的核心保护：只有当剩余的上下文里彻底没有任何赴约根基（提议或同意记录）时，才算真正截断了根！
            !contextMessages.some(m =>
                (rootId && (m.responseBatchId === rootId || m.id === rootId)) ||
                m.mediaData?.offlineInvite ||
                (m.role === "system" && m.content && (
                    m.content.includes("你已同意赴约") ||
                    m.content.includes("线下赴约提议") ||
                    m.content.includes("正在动身赶往") ||
                    m.content.includes("前往")
                ))
            )
        );

        // 🌸 华专属打造的黄金体验分流：若当前正处于线下赴约中（用户暂时切回线上），弹窗提供双选项选择回溯方式！
        const isMeetingActive = !session.isGroup && kvGet(OFFLINE_INVITE_ACTIVE_SESSION_PREFIX + session.id) === "1";
        if (isMeetingActive) {
            setActiveMessageId(null);
            setOfflineRetryConfirm({
                msgId,
                targetMsg: targetRetryMsg,
                msgIndex,
                truncatedMessages,
                truncatesInitialRoot,
                contextMessages,
            });
            return;
        }

        const executeRetry = async () => {
            // Delete this message and everything after it
            deleteChatMessagesFrom(msgId);
            setMessages(prev => prev.slice(0, msgIndex));
            setActiveMessageId(null);

            // Cancel any pending follow-up for this session
            cancelFollowUp(session.id);

            // 华提出的“皮之不存，毛将焉附”与“重试智能保全”原则：
            if (currentInvite && currentInvite.sourceBatchId !== "mock_offline_invite") {
                if (truncatesInitialRoot) {
                    // 若重试截断了最初发起消息，彻底取消邀约
                    updateActiveOfflineInvite(null);
                    setIsOfflineInviteMinimized(false);
                    if (remindExpandTimerRef.current) {
                        clearTimeout(remindExpandTimerRef.current);
                        remindExpandTimerRef.current = null;
                    }
                } else {
                    // 若重试的是中间节点或普通回复（如中途改地址或在途闲聊时 AI 崩了/OOC），
                    // 绝不能无脑将整个赴约状态一锅端取消！
                    // 基于 contextMessages 智能回滚/保全邀约状态，使大模型重新生成时依然能拿到完整的赴约提示词上下文！
                    const restoredInvite = restoreOfflineInviteFromMessages(contextMessages, currentInvite, targetRetryMsg);
                    if (restoredInvite) {
                        updateActiveOfflineInvite(restoredInvite);
                        // 🌸 华确立的黄金体验法则：重试期间必须保持收起状态，让用户清晰看到“对方正在输入中”！
                        setIsOfflineInviteMinimized(true);
                    }
                }
            }

            await runManagedGeneration({
                history: contextMessages,
                errorPrefix: "重试失败",
                onDecline: triggerReply,
            });

            // 🌸 华确立的“新卡片3秒必弹律”：重试生成完毕后，留足 3 秒供用户读完文本，再平滑自动展开大卡片
            const currentRestored = activeOfflineInviteRef.current;
            const needsModalExpand = Boolean(
                currentRestored && (
                    currentRestored.status === "pending" ||
                    currentRestored.status === "arrived" ||
                    currentRestored.direction === "i_go"
                )
            );
            if (needsModalExpand && !remindExpandTimerRef.current) {
                remindExpandTimerRef.current = setTimeout(() => {
                    setIsOfflineInviteMinimized(false);
                    remindExpandTimerRef.current = null;
                }, 3000);
            }
        };

        // 华敏锐确立的黄金交互三阶分流：
        // 1. 若重试截断了最初发起邀约的根源消息（生命之根）：弹窗预警会彻底取消赴约
        if (truncatesInitialRoot) {
            setActiveMessageId(null);
            setPendingInviteDeleteConfirm({
                title: "重试此条回复？",
                message: "重试将重新生成本条回复，并删除之后的内容（包含本次线下赴约的发起消息），同时取消当前的赴约状态，是否确认重试？",
                confirmLabel: "重试",
                variant: "danger",
                onConfirm: () => void executeRetry(),
            });
            return;
        }

        // 2. 场景 B（时光倒流）：只有当截断的后续内容包含用户发言（role === "user"）或系统变动记录（role === "system"）时，
        // 说明用户是在跨轮次倒退历史（会抹去用户自己后续说的话或同意/改地点记录），才弹窗确认防止误删！
        // 若截断的仅仅是最新一轮 AI 连发的多个气泡（后续无用户发言），即便点击倒数第二条气泡也是纯粹的当场重抽，0 弹窗 0 阻碍！
        const hasSubsequentTurns = truncatedMessages.slice(1).some(m => m.role === "user" || m.role === "system");
        if (currentInvite && hasSubsequentTurns) {
            setActiveMessageId(null);
            setPendingInviteDeleteConfirm({
                title: "回溯并重新生成？",
                message: `重试将删除本条及之后的 ${truncatedMessages.length} 条消息，赴约状态将同步回溯至当时。是否确认重新生成？`,
                confirmLabel: "确认回溯",
                variant: "default",
                onConfirm: () => void executeRetry(),
            });
            return;
        }

        // 3. 场景 A：当场重试最新一轮回复（无后续用户发言），0 弹窗 0 阻碍无缝即点即抽！
        await executeRetry();
    };

    // 🌸 华专属打造的黄金体验：线下赴约进行时回溯重试（回溯至当时的时间线，并直接结束当前的线下赴约）
    const handleExecuteOfflineRetryMode = async () => {
        if (!offlineRetryConfirm) return;
        const { msgId, msgIndex, contextMessages, targetMsg, truncatesInitialRoot } = offlineRetryConfirm;
        setOfflineRetryConfirm(null);

        // Delete this message and everything after it
        deleteChatMessagesFrom(msgId);
        setMessages(prev => prev.slice(0, msgIndex));
        setActiveMessageId(null);
        cancelFollowUp(session.id);

        // 1. 彻底结束线下赴约状态
        kvRemove(OFFLINE_INVITE_ACTIVE_SESSION_PREFIX + session.id);
        if (remindExpandTimerRef.current) {
            clearTimeout(remindExpandTimerRef.current);
            remindExpandTimerRef.current = null;
        }

        // 2. 根据 contextMessages 智能回溯赴约状态至当时那一刻
        if (truncatesInitialRoot) {
            updateActiveOfflineInvite(null);
            setIsOfflineInviteMinimized(false);
        } else {
            const restoredInvite = restoreOfflineInviteFromMessages(contextMessages, null, targetMsg);
            if (restoredInvite) {
                updateActiveOfflineInvite(restoredInvite);
                // 🌸 华确立的黄金体验法则：重试期间必须保持收起状态，让用户清晰看到“对方正在输入中”！
                setIsOfflineInviteMinimized(true);
            } else {
                updateActiveOfflineInvite(null);
                setIsOfflineInviteMinimized(false);
            }
        }

        // 3. 重新生成该消息（绝不携带 returnedFromOffline，杜绝触发从线下回到线上的主动报备发信）
        await runManagedGeneration({
            history: contextMessages,
            errorPrefix: "重试失败",
            onDecline: triggerReply,
        });

        // 🌸 华确立的“新卡片3秒必弹律”：重试生成完毕后，留足 3 秒供用户读完文本，再平滑自动展开大卡片
        const currentRestored = activeOfflineInviteRef.current;
        const needsModalExpand = Boolean(
            currentRestored && (
                currentRestored.status === "pending" ||
                currentRestored.status === "arrived" ||
                currentRestored.direction === "i_go"
            )
        );
        if (needsModalExpand && !remindExpandTimerRef.current) {
            remindExpandTimerRef.current = setTimeout(() => {
                setIsOfflineInviteMinimized(false);
                remindExpandTimerRef.current = null;
            }, 3000);
        }

        showChatToast("已回溯至当时，线下赴约状态已结束");
    };

    const handleRetractMessage = (msgId: string) => {
        retractChatMessage(msgId);
        setMessages(prev => prev.map(m => m.id === msgId ? { ...m, isRetracted: true } : m));
        setActiveMessageId(null);
    };

    const handleEditMessageStart = (msg: ChatMessage) => {
        setEditingResponseBatchId(null);
        setEditingResponseRoundId(null);
        setEditingResponseContent("");
        setEditingMessageId(msg.id);
        // 语音条的文字存在 mediaData.label 里，content 是空的
        setEditingContent(msg.mediaType === "audio" ? (msg.mediaData?.label || msg.content) : msg.content);
        setActiveMessageId(null);
    };

    const handleEditMessageSave = () => {
        if (!editingMessageId || !editingContent.trim()) {
            setEditingMessageId(null);
            setEditingContent("");
            return;
        }

        const originalMessage = messages.find(m => m.id === editingMessageId) || loadChatMessages(session.id).find(m => m.id === editingMessageId);
        const isEditingSystemInstruction = originalMessage ? isSystemInstructionMessage(originalMessage) : false;
        const placement = originalMessage?.role === "user" ? 1 : 2;
        const nextContent = isEditingSystemInstruction
            ? editingContent.trim()
            : applyEditTextRegex(editingContent.trim(), placement, false);
        if (originalMessage?.mediaType === "audio") {
            // 语音条的显示文字和 AI 上下文都读 mediaData.label，改 content 不生效；
            // synthesizedFromText 保留旧值，AI 语音会因文字不一致自动重新合成
            const nextMediaData = { ...originalMessage.mediaData, label: nextContent };
            updateMessageMediaData(editingMessageId, nextMediaData);
            setMessages(prev => prev.map(m => m.id === editingMessageId ? { ...m, mediaData: nextMediaData } : m));
        } else {
            editChatMessage(editingMessageId, nextContent);
            setMessages(prev => prev.map(m => m.id === editingMessageId ? { ...m, content: nextContent } : m));
        }
        setEditingMessageId(null);
        setEditingContent("");
        const ta = document.querySelector<HTMLTextAreaElement>(".chat-input-textarea");
        if (ta) ta.style.height = "auto";
    };

    const normalizeEditedAssistantParts = (
        parts: ReturnType<typeof parseAIResponse>["parts"],
        senderNameOverride?: string,
        options?: { omitHandledFinancialActions?: boolean },
    ) => {
        return parts.flatMap(part => {
            if (part.mediaType === "music") {
                const title = part.mediaData?.musicTitle || part.mediaData?.label || "未知歌曲";
                const artist = part.mediaData?.musicArtist ? `-${part.mediaData.musicArtist}` : "";
                return [{ content: `[音乐:${title}${artist}]` }];
            }
            if (part.mediaType === "voice_call") {
                return [{ content: "[我发起了语音通话]" }];
            }
            if (part.mediaType === "video_call") {
                return [{ content: "[我发起了视频通话]" }];
            }
            if (
                options?.omitHandledFinancialActions &&
                (
                    part.mediaType === "accept_red_packet" ||
                    part.mediaType === "decline_red_packet" ||
                    part.mediaType === "accept_transfer" ||
                    part.mediaType === "decline_transfer" ||
                    part.mediaType === "accept_payment_request" ||
                    part.mediaType === "decline_payment_request"
                )
            ) {
                return [];
            }
            if (part.mediaType === "accept_red_packet") {
                return [{ content: "[领取红包]" }];
            }
            if (part.mediaType === "decline_red_packet") {
                return [{ content: "[拒收红包]" }];
            }
            if (part.mediaType === "accept_transfer") {
                return [{ content: "[领取转账]" }];
            }
            if (part.mediaType === "decline_transfer") {
                return [{ content: "[拒收转账]" }];
            }
            if (part.mediaType === "accept_payment_request") {
                return [{ content: "[接受代付]" }];
            }
            if (part.mediaType === "decline_payment_request") {
                return [{ content: "[拒绝代付]" }];
            }
            if (part.mediaType === "poke") {
                const sender = (part.mediaData?.pokeSender === "我" ? senderNameOverride : part.mediaData?.pokeSender)
                    || senderNameOverride
                    || (character?.name || "对方");
                const target = part.mediaData?.pokeTarget || (userIdentity?.name || "你");
                return [{
                    content: `${sender} 拍了拍 ${target}`,
                    mediaType: "poke" as const,
                    mediaData: { pokeSender: sender, pokeTarget: target },
                }];
            }
            return [part];
        }).filter(part => part.mediaType || part.content.trim());
    };

    const handleEditResponseStart = (msg: ChatMessage) => {
        if (session.isGroup && msg.responseRoundId && msg.editableResponseText) {
            setEditingMessageId(null);
            setEditingContent("");
            setEditingResponseBatchId(null);
            setEditingResponseRoundId(msg.responseRoundId);
            setEditingResponseContent(msg.editableResponseText);
            setActiveMessageId(null);
            return;
        }
        if (!msg.responseBatchId || !msg.rawResponseText) {
            handleEditMessageStart(msg);
            return;
        }
        setEditingMessageId(null);
        setEditingContent("");
        setEditingResponseBatchId(msg.responseBatchId);
        setEditingResponseRoundId(null);
        setEditingResponseContent(msg.rawResponseText);
        setActiveMessageId(null);
    };

    const handleEditResponseSave = () => {
        if (!editingResponseContent.trim()) {
            setEditingResponseBatchId(null);
            setEditingResponseRoundId(null);
            setEditingResponseContent("");
            return;
        }

        const editedResponseContent = applyEditTextRegex(editingResponseContent.trim(), 2, false);

        if (session.isGroup && editingResponseRoundId) {
            const storedMessages = loadChatMessages(session.id);
            const roundMessages = storedMessages.filter(msg => msg.responseRoundId === editingResponseRoundId);
            if (roundMessages.length === 0) {
                showChatToast("没有找到这轮群聊回复");
                setEditingResponseRoundId(null);
                setEditingResponseContent("");
                return;
            }

            const firstRoundIndex = storedMessages.findIndex(msg => msg.id === roundMessages[0].id);
            const stateCutoff = storedMessages[firstRoundIndex];

            const nameToId = new Map<string, string>();
            groupCharacters.forEach((groupCharacter) => {
                nameToId.set(groupCharacter.name, groupCharacter.id);
            });
            if (!hasKnownGroupSenderPrefix(editedResponseContent)) {
                showChatToast("群聊编辑内容需要保留 [角色名]: 前缀");
                return;
            }
            const segments = parseGroupChatResponse(editedResponseContent, nameToId);
            if (segments.length === 0) {
                showChatToast("没有识别到可编辑的群聊成员前缀");
                return;
            }

            const replacementMessages: Array<{
                content: string;
                mediaType?: ChatMessage["mediaType"];
                mediaData?: ChatMessage["mediaData"];
                rawResponseText?: string;
                responseBatchId?: string;
                statusPanel?: string;
                statusRegionMode?: "custom";
                innerMonologue?: string;
                stateValues?: StateValue[];
                freshStateValues?: StateValue[];
                senderCharacterId?: string;
                senderName?: string;
            }> = [];

            const currentStateByCharacter = new Map<string, StateValue[]>();
            const getCurrentStateForCharacter = (characterId: string): StateValue[] => {
                const cached = currentStateByCharacter.get(characterId);
                if (cached) return cached;
                const latest = getLatestCharacterStateValues(characterId, stateCutoff ? { before: stateCutoff } : undefined);
                currentStateByCharacter.set(characterId, latest);
                return latest;
            };
            for (const segment of segments) {
                const responseBatchId = createResponseBatchId();
                const { parts: rawParts, stateValues, freshStateValues, statusPanel, innerMonologue } = parseAIResponse(segment.responseText, getCurrentStateForCharacter(segment.characterId));
                const parts = stripInvalidStickerParts(rawParts, segment.characterId);
                const normalizedParts = normalizeEditedAssistantParts(parts, segment.characterName, {
                    omitHandledFinancialActions: true,
                });
                let attachedState = false;
                for (const part of normalizedParts) {
                    if (!part.content.trim() && !part.mediaType && (!(statusPanel || innerMonologue) || attachedState)) continue;
                    // 面板只挂到能显示它的正常气泡上（拍一拍/通话留痕是系统小字）
                    const attachHere = !attachedState && canCarryFoldedPanel(part);
                    replacementMessages.push({
                        content: part.content,
                        mediaType: part.mediaType,
                        mediaData: part.mediaData,
                        rawResponseText: segment.responseText,
                        responseBatchId,
                        statusPanel: attachHere && statusPanel ? statusPanel : undefined,
                        statusRegionMode: customStatusActive && attachHere && statusPanel ? "custom" as const : undefined,
                        innerMonologue: attachHere && innerMonologue ? innerMonologue : undefined,
                        stateValues: attachHere && stateValues.length > 0 ? stateValues : undefined,
                        freshStateValues: attachHere ? freshStateValues : undefined,
                        senderCharacterId: segment.characterId,
                        senderName: segment.characterName,
                    });
                    if (attachHere) attachedState = true;
                }
                if (!attachedState && (statusPanel || innerMonologue || stateValues.length > 0)) {
                    replacementMessages.push({
                        content: "",
                        rawResponseText: segment.responseText,
                        responseBatchId,
                        statusPanel,
                        statusRegionMode: customStatusActive && statusPanel ? "custom" as const : undefined,
                        innerMonologue,
                        stateValues: stateValues.length > 0 ? stateValues : undefined,
                        freshStateValues,
                        senderCharacterId: segment.characterId,
                        senderName: segment.characterName,
                    });
                    attachedState = true;
                }
                const toolCallContent = extractTextToolDirectiveText(segment.responseText);
                if (toolCallContent) {
                    replacementMessages.push({
                        content: toolCallContent,
                        mediaType: "tool_call",
                        responseBatchId,
                        senderCharacterId: segment.characterId,
                        senderName: segment.characterName,
                    });
                }
                if (stateValues.length > 0) {
                    currentStateByCharacter.set(segment.characterId, stateValues);
                }
            }

            if (replacementMessages.length === 0) {
                showChatToast("编辑后的群聊回复没有可显示内容");
                return;
            }

            replaceGroupResponseRound(
                session.id,
                editingResponseRoundId,
                editedResponseContent,
                replacementMessages,
            );
            syncMessagesFromStorage();
            setEditingResponseBatchId(null);
            setEditingResponseRoundId(null);
            setEditingResponseContent("");
            setActiveMessageId(null);
            return;
        }

        if (!editingResponseBatchId) {
            setEditingResponseBatchId(null);
            setEditingResponseRoundId(null);
            setEditingResponseContent("");
            return;
        }

        const storedMessages = loadChatMessages(session.id);
        const batchMessages = storedMessages.filter(msg => msg.responseBatchId === editingResponseBatchId);
        if (batchMessages.length === 0) {
            showChatToast("没有找到这次回复的原始内容");
            setEditingResponseBatchId(null);
            setEditingResponseRoundId(null);
            setEditingResponseContent("");
            return;
        }

        const firstBatchIndex = storedMessages.findIndex(msg => msg.id === batchMessages[0].id);
        const stateCutoff = storedMessages[firstBatchIndex];
        const previousState = session.isGroup
            ? getLatestStateValues(session.id)
            : getLatestCharacterStateValues(session.contactId, stateCutoff ? { before: stateCutoff } : undefined);

        const { parts: rawParts, stateValues, freshStateValues, statusPanel, innerMonologue } = parseAIResponse(editedResponseContent, previousState);
        const parts = stripInvalidStickerParts(rawParts);
        const normalizedParts = normalizeEditedAssistantParts(parts);
        if (normalizedParts.length === 0 && (statusPanel || innerMonologue)) {
            normalizedParts.push({ content: "" });
        }
        if (normalizedParts.length === 0) {
            showChatToast("编辑后的回复没有可显示内容");
            return;
        }
        // 面板挂到第一条能显示它的消息上（编辑后第一条可能是拍一拍或通话留痕，
        // 那类系统小字不显示面板）；全是系统样式时补空消息驮面板
        let metaPartIndex = normalizedParts.findIndex(canCarryFoldedPanel);
        if (metaPartIndex === -1) {
            if (statusPanel || innerMonologue || stateValues.length > 0) {
                normalizedParts.push({ content: "" });
                metaPartIndex = normalizedParts.length - 1;
            } else {
                metaPartIndex = 0;
            }
        }

        // 编辑只改文字，不改这批消息生成时所处的状态栏模式——沿用原戳，
        // 否则编辑一次就退回原生渲染，而且切回原生后再编辑又会反向串档。
        const originalStatusRegionMode = batchMessages.find(m => m.statusRegionMode === "custom")?.statusRegionMode;

        replaceResponseBatchWithParts(
            session.id,
            editingResponseBatchId,
            editedResponseContent,
            normalizedParts,
            {
                statusPanel,
                statusRegionMode: originalStatusRegionMode,
                innerMonologue,
                stateValues: stateValues.length > 0 ? stateValues : undefined,
                freshStateValues,
                metaPartIndex,
                toolCallContent: extractTextToolDirectiveText(editedResponseContent),
            },
        );
        syncMessagesFromStorage();
        setEditingResponseBatchId(null);
        setEditingResponseRoundId(null);
        setEditingResponseContent("");
        setActiveMessageId(null);
    };

    const handleMessagePointerDown = (e: React.PointerEvent, msgId: string) => {
        if (isMultiSelectMode) return;
        // Prevent right click from triggering the timer, as it has its own context menu handler
        if (e.pointerType === 'mouse' && e.button !== 0) return;

        // Prevent text selection on long press
        e.preventDefault();

        const anchor = { x: e.clientX, y: e.clientY };
        startPosRef.current = anchor;
        longPressTriggeredRef.current = false;

        if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = setTimeout(() => {
            longPressTriggeredRef.current = true;
            openMessageContextMenu(msgId, anchor);
            longPressTimerRef.current = null;
        }, 500); // 500ms long press
    };

    const handleMessagePointerUp = (e: React.PointerEvent) => {
        startPosRef.current = null;
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
        // If a long press just triggered, stop the event from becoming a click
        if (longPressTriggeredRef.current) {
            e.stopPropagation();
            e.preventDefault();
            longPressTriggeredRef.current = false;
        }
    };

    const handleMessagePointerCancel = () => {
        startPosRef.current = null;
        longPressTriggeredRef.current = false;
        if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
        }
    };

    const deleteWeixinCloudBeforeLocal = async (
        targetMessages: ChatMessage[],
        applyLocalDelete: () => void,
        successText?: string,
    ) => {
        if (cloudDeletePending) {
            showChatToast("正在删除云端记录，请稍候");
            return;
        }
        const cloudTargetCount = getWeixinCloudDeleteTargetCount(targetMessages);
        if (cloudTargetCount <= 0) {
            applyLocalDelete();
            if (successText) showChatToast(successText);
            return;
        }

        setCloudDeletePending({ count: cloudTargetCount });
        try {
            const deletedCount = await withTimeout(
                deleteWeixinCloudMessagesFromCloud(targetMessages),
                WEIXIN_CLOUD_DELETE_TIMEOUT_MS,
                "云端删除超时，请检查网络后重试。",
            );
            if (deletedCount < cloudTargetCount) {
                throw new Error("云端记录没有完全删除，请检查同步设置后重试。");
            }
            applyLocalDelete();
            if (successText) showChatToast(successText);
            // 删消息对象只解决"消息目录"这一半：删掉的历史早就烘焙进云端运行包的
            // bakedHistory 里，不重烘焙的话云端助手（微信）照样记得刚删的内容。
            // 事件监听那条重同步是 3 秒防抖，这里显式先跑；成功无感，失败必须报。
            void syncAllWeixinBotRuntimesToCloud()
                .catch(() => {
                    emitWeixinSyncToast("微信运行包同步失败：角色可能还记得刚删的内容，请到「设置 → 微信」手动同步运行包。", { id: "weixin-runtime", duration: 4500 });
                });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            showChatToast(`云端删除失败：${message}`, 3500);
        } finally {
            setCloudDeletePending(null);
        }
    };

    const handleDeleteMessage = (msgId: string) => {
        if (isTransientMessage(msgId)) {
            removeTransientMessage(msgId);
            setActiveMessageId(null);
            return;
        }
        setActiveMessageId(null);
        const targetMsg = loadChatMessages(session.id).find(m => m.id === msgId);
        if (!targetMsg) return;

        const executeDelete = () => {
            void deleteWeixinCloudBeforeLocal([targetMsg], () => {
                deleteChatMessage(msgId);
                syncMessagesFromStorage();
            });
        };

        if (isOfflineInviteRootMessage(targetMsg)) {
            setPendingInviteDeleteConfirm({
                title: "删除邀约消息？",
                message: getInviteDeleteConfirmMessage(targetMsg),
                confirmLabel: "删除",
                variant: "danger",
                onConfirm: () => {
                    // 🌸 华拍板的核心终结规则：用户确认删除邀约关键节点，状态全清空，顶栏没了，彻底结束线下！
                    kvRemove(OFFLINE_INVITE_ACTIVE_SESSION_PREFIX + session.id);
                    updateActiveOfflineInvite(null);
                    setIsOfflineInviteMinimized(false);
                    if (remindExpandTimerRef.current) {
                        clearTimeout(remindExpandTimerRef.current);
                        remindExpandTimerRef.current = null;
                    }
                    executeDelete();
                },
            });
            return;
        }

        // 华提出的防误触保护：线下赴约专属系统记录小灰字（防误碰）
        // 华敏锐确立的体验法则：只要当前处于活跃的线下赴约生命周期中（包含在途赶来与现场碰面），弹出防误碰小框；若赴约已结束回到线上，直接删除无弹窗！
        const isMeetingActive = !session.isGroup && kvGet(OFFLINE_INVITE_ACTIVE_SESSION_PREFIX + session.id) === "1";
        if ((activeOfflineInviteRef.current || isMeetingActive) && isOfflineInviteSystemMessage(targetMsg)) {
            setPendingInviteDeleteConfirm({
                title: "删除系统记录？",
                message: "该记录为本次线下赴约的关键系统提示，删除后将从聊天记录中移除，但不影响当前的赴约状态，是否确认删除？",
                confirmLabel: "删除",
                variant: "default",
                onConfirm: () => {
                    executeDelete();
                },
            });
            return;
        }

        executeDelete();
    };

    const handleDeleteMessagesFrom = (msgId: string) => {
        if (isTransientMessage(msgId)) {
            setTransientMessages(prev => {
                const idx = prev.findIndex(m => m.id === msgId);
                return idx >= 0 ? prev.slice(0, idx) : prev;
            });
            setActiveMessageId(null);
            return;
        }
        setActiveMessageId(null);
        const storedMessages = loadChatMessages(session.id);
        const targetMsg = storedMessages.find(m => m.id === msgId);
        if (!targetMsg) return;
        const targetMessages = storedMessages.filter(m => (
            m.sessionId === session.id && compareChatMessages(m, targetMsg) >= 0
        ));

        const executeDeleteFrom = () => {
            void deleteWeixinCloudBeforeLocal(targetMessages, () => {
                deleteChatMessagesFrom(msgId);
                syncMessagesFromStorage();
            });
        };

        if (targetMessages.some(isOfflineInviteRootMessage)) {
            setPendingInviteDeleteConfirm({
                title: "删除以下消息？",
                message: "删除的内容中包含本次线下赴约的发起或变动消息，删除后将直接清除当前的赴约状态。若只想回退赴约状态，可取消并重试消息。",
                confirmLabel: "删除",
                variant: "danger",
                onConfirm: () => {
                    // 🌸 华拍板的核心终结规则：用户确认删除以下包含邀约节点的内容，状态全清空，顶栏没了，彻底结束线下！
                    kvRemove(OFFLINE_INVITE_ACTIVE_SESSION_PREFIX + session.id);
                    updateActiveOfflineInvite(null);
                    setIsOfflineInviteMinimized(false);
                    if (remindExpandTimerRef.current) {
                        clearTimeout(remindExpandTimerRef.current);
                        remindExpandTimerRef.current = null;
                    }
                    executeDeleteFrom();
                },
            });
            return;
        }

        executeDeleteFrom();
    };

    const renderOfflineContextMenu = (turn: ChatOfflineTurn, role: OfflineActionTarget["role"]) => {
        const menu = (
            <div
                onPointerDown={e => e.stopPropagation()}
                ref={positionFloatingContextMenu}
                style={getContextMenuInitialStyle()}
                className="ctx-menu chat-floating-ctx-menu flex flex-col items-center gap-[6px] py-[4px] px-0"
                data-role={role}
            >
                <div className="flex">
                    <button onClick={() => { copyTextToClipboard(getOfflineCopyText(turn, role)); setActiveOfflineTarget(null); }} className="ctx-menu-btn">复制</button>
                    <button onClick={() => handleOfflineEditStart(turn, role)} className="ctx-menu-btn">编辑</button>
                    <button onClick={() => void handleOfflineRetryFrom(turn.id)} className="ctx-menu-btn ctx-menu-btn-danger">重试以下</button>
                </div>
                <div className="flex">
                    <button onClick={() => handleOfflineDeleteTurn(turn.id)} className="ctx-menu-btn ctx-menu-btn-danger">删除</button>
                    <button onClick={() => handleOfflineDeleteTurnsFrom(turn.id)} className="ctx-menu-btn ctx-menu-btn-danger">删除以下</button>
                </div>
                <div data-menu-triangle className="ctx-menu-triangle absolute -top-[6px] w-0 h-0" />
            </div>
        );
        return wrapperRef.current ? createPortal(menu, wrapperRef.current) : menu;
    };

    const getStoredActionMessageId = (msg: ChatMessage | RenderChatMessage): string => {
        return "displaySourceId" in msg && msg.displaySourceId ? msg.displaySourceId : msg.id;
    };

    /** Reusable context menu for user/assistant bubbles */
    const renderBubbleContextMenu = (m: ChatMessage, options?: { allowMultiSelect?: boolean }) => {
        const storedMessageId = getStoredActionMessageId(m);
        const menu = (
            <div
                onPointerDown={e => e.stopPropagation()}
                ref={positionFloatingContextMenu}
                style={getContextMenuInitialStyle()}
                className="ctx-menu chat-floating-ctx-menu flex flex-col items-center gap-[6px] py-[4px] px-0"
                data-role={m.role}>
                <div className="flex">
                    <button onClick={() => {
                        const text = m.content;
                        const fallbackCopy = () => {
                            const ta = document.createElement("textarea");
                            ta.value = text;
                            ta.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0";
                            document.body.appendChild(ta);
                            ta.focus();
                            ta.select();
                            try { document.execCommand("copy"); } catch {}
                            document.body.removeChild(ta);
                        };
                        if (navigator.clipboard?.writeText) {
                            navigator.clipboard.writeText(text).catch(fallbackCopy);
                        } else {
                            fallbackCopy();
                        }
                        setActiveMessageId(null);
                    }} className="ctx-menu-btn">复制</button>
                    <button onClick={() => (m.role === "assistant" ? handleEditResponseStart(m) : handleEditMessageStart(m))} className="ctx-menu-btn">
                        {m.role === "assistant" && (m.rawResponseText || m.editableResponseText) ? "编辑回复" : "编辑"}
                    </button>
                    {m.mediaType === "audio" && m.mediaData?.label && (
                        <button onClick={() => { setVoiceTextIds(prev => { const next = new Set(prev); if (next.has(m.id)) next.delete(m.id); else next.add(m.id); return next; }); setActiveMessageId(null); }} className="ctx-menu-btn">转文字</button>
                    )}
                    {m.role === "user" && (
                        <button onClick={() => handleRetractMessage(storedMessageId)} className="ctx-menu-btn">撤回消息</button>
                    )}
                    {m.role === "assistant" && (
                        <button onClick={() => handleRetry(storedMessageId)} className="ctx-menu-btn ctx-menu-btn-danger">重试以下</button>
                    )}
                </div>
                <div className="flex">
                    <button onClick={() => { setQuotingMessage(m); setActiveMessageId(null); }} className="ctx-menu-btn">引用</button>
                    {options?.allowMultiSelect !== false && (
                        <button onClick={() => startMultiSelectFromMessage(m)} className="ctx-menu-btn">多选</button>
                    )}
                    <button onClick={() => handleDeleteMessage(storedMessageId)} className="ctx-menu-btn ctx-menu-btn-danger">删除</button>
                    <button onClick={() => handleDeleteMessagesFrom(storedMessageId)} className="ctx-menu-btn ctx-menu-btn-danger">删除以下</button>
                </div>
                {(() => {
                    // 聊天插件注册的消息操作菜单项
                    const pluginActions = getChatPluginRuntime().getMessageActions(m);
                    if (pluginActions.length === 0) return null;
                    return (
                        <div className="flex">
                            {pluginActions.map(action => (
                                <button
                                    key={`${action.pluginId}:${action.id}`}
                                    className="ctx-menu-btn"
                                    onClick={() => {
                                        getChatPluginRuntime().runMessageAction(action, m);
                                        setActiveMessageId(null);
                                    }}
                                >{action.label}</button>
                            ))}
                        </div>
                    );
                })()}
                <div data-menu-triangle className="ctx-menu-triangle absolute -top-[6px] w-0 h-0" />
            </div>
        );
        return wrapperRef.current ? createPortal(menu, wrapperRef.current) : menu;
    };

    const renderDeleteOnlyContextMenu = (onDelete: () => void, onMultiSelect?: () => void) => {
        const menu = (
            <div
                onPointerDown={e => e.stopPropagation()}
                ref={positionFloatingContextMenu}
                style={getContextMenuInitialStyle()}
                className="ctx-menu chat-floating-ctx-menu flex py-[6px] px-0"
            >
                {onMultiSelect && (
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onMultiSelect();
                        }}
                        className="ctx-menu-btn"
                    >多选</button>
                )}
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onDelete();
                        closeContextMenu();
                    }}
                    className="ctx-menu-btn ctx-menu-btn-danger"
                >删除</button>
                <div data-menu-triangle className="ctx-menu-triangle absolute -top-[6px] w-0 h-0" />
            </div>
        );
        return wrapperRef.current ? createPortal(menu, wrapperRef.current) : menu;
    };

    const renderSystemContextMenu = (msg: ChatMessage) => {
        const storedMessageId = getStoredActionMessageId(msg);
        if (isSystemInstructionMessage(msg)) {
            const instructionMenu = (
                <div
                    onPointerDown={e => e.stopPropagation()}
                    ref={positionFloatingContextMenu}
                    style={getContextMenuInitialStyle()}
                    className="ctx-menu chat-floating-ctx-menu flex py-[6px] px-0"
                >
                    <button
                        onClick={() => {
                            copyTextToClipboard(msg.content);
                            closeContextMenu();
                        }}
                        className="ctx-menu-btn"
                    >复制</button>
                    <button
                        onClick={() => {
                            handleEditMessageStart(msg);
                        }}
                        className="ctx-menu-btn"
                    >编辑</button>
                    <button
                        onClick={() => {
                            handleDeleteMessage(storedMessageId);
                            closeContextMenu();
                        }}
                        className="ctx-menu-btn ctx-menu-btn-danger"
                    >删除</button>
                    <div data-menu-triangle className="ctx-menu-triangle absolute -top-[6px] w-0 h-0" />
                </div>
            );
            return wrapperRef.current ? createPortal(instructionMenu, wrapperRef.current) : instructionMenu;
        }

        const menu = (
            <div
                onPointerDown={e => e.stopPropagation()}
                ref={positionFloatingContextMenu}
                style={getContextMenuInitialStyle()}
                className="ctx-menu chat-floating-ctx-menu flex py-[6px] px-0"
            >
                <button
                    onClick={() => {
                        const text = msg.mediaType === "memory_write_request"
                            ? (msg.mediaData?.memoryContent || msg.content)
                            : msg.content;
                        copyTextToClipboard(text);
                        closeContextMenu();
                    }}
                    className="ctx-menu-btn"
                >复制</button>
                {(msg.rawResponseText || msg.responseBatchId || msg.editableResponseText) && (
                    <button
                        onClick={() => {
                            handleEditResponseStart(msg);
                        }}
                        className="ctx-menu-btn"
                    >编辑</button>
                )}
                <button
                    onClick={() => {
                        startMultiSelectFromMessage(msg);
                    }}
                    className="ctx-menu-btn"
                >多选</button>
                <button
                    onClick={() => {
                        handleDeleteMessage(storedMessageId);
                        closeContextMenu();
                    }}
                    className="ctx-menu-btn ctx-menu-btn-danger"
                >删除</button>
                <div data-menu-triangle className="ctx-menu-triangle absolute -top-[6px] w-0 h-0" />
            </div>
        );
        return wrapperRef.current ? createPortal(menu, wrapperRef.current) : menu;
    };

    // ── Voice call message grouping ──────────────────
    // Deduplicate messages (staggered timeouts + concurrent reloads can cause duplicates)
    const dedupedMessages = useMemo(() => {
        const seen = new Set<string>();
        return displayMessages.filter(m => {
            if (isReadingDiscussMessage(m)) return false;
            if (seen.has(m.id)) return false;
            seen.add(m.id);
            return true;
        });
    }, [displayMessages]);

    const projectedMessages = useMemo<RenderChatMessage[]>(() => {
        const batches = new Map<string, ChatMessage[]>();
        for (const msg of dedupedMessages) {
            if (msg.role !== "assistant" || !msg.responseBatchId || !msg.rawResponseText?.trim()) continue;
            const key = `${msg.responseRoundId || ""}\x1f${msg.responseBatchId}\x1f${msg.rawResponseText}`;
            const batch = batches.get(key) || [];
            batch.push(msg);
            batches.set(key, batch);
        }

        const projected: RenderChatMessage[] = [];
        const consumedBatchKeys = new Set<string>();
        for (const msg of dedupedMessages) {
            const batchKey = msg.role === "assistant" && msg.responseBatchId && msg.rawResponseText?.trim()
                ? `${msg.responseRoundId || ""}\x1f${msg.responseBatchId}\x1f${msg.rawResponseText}`
                : "";
            if (!batchKey) {
                projected.push(msg);
                continue;
            }
            if (consumedBatchKeys.has(batchKey)) continue;
            consumedBatchKeys.add(batchKey);

            const batch = batches.get(batchKey) || [msg];
            const raw = batch[0]?.rawResponseText?.trim();
            if (!raw) {
                projected.push(...batch);
                continue;
            }
            const displayRaw = renderDisplayText(raw, 2, false);
            if (displayRaw === raw) {
                projected.push(...batch);
                continue;
            }
            const parsed = parseAIResponse(displayRaw, []);
            const parts = normalizeDisplayParts(parsed.parts);
            // 面板投影到第一条能显示它的消息上（拍一拍/通话留痕是系统小字，没有面板入口）
            const displayMetaIdx = parts.findIndex(canCarryFoldedPanel);
            const storedMeta = batch.find(m => m.statusPanel || m.innerMonologue || m.reasoningText || (m.stateValues && m.stateValues.length > 0));
            let metaProjected = false;
            parts.forEach((part, index) => {
                const base = batch[Math.min(index, batch.length - 1)] || batch[0];
                if (!base) return;
                const sourceId = base.id;
                const id = index < batch.length ? sourceId : `${batch[0].id}__display_${index}`;
                const isMetaSlot = index === displayMetaIdx;
                const statusPanelHere = isMetaSlot ? (parsed.statusPanel || storedMeta?.statusPanel) : undefined;
                // 面板从 storedMeta 挪到了别的槽位，戳要跟着面板走：光靠 ...base 展开会取到
                // 槽位那条消息的戳（多半是空的），投影后状态栏就退回原生渲染了。
                const statusRegionModeHere = isMetaSlot && statusPanelHere
                    ? (storedMeta?.statusRegionMode ?? base.statusRegionMode)
                    : undefined;
                const innerMonologueHere = isMetaSlot ? (parsed.innerMonologue || storedMeta?.innerMonologue) : undefined;
                const reasoningTextHere = isMetaSlot ? storedMeta?.reasoningText : undefined;
                const stateValuesHere = isMetaSlot ? storedMeta?.stateValues : undefined;
                const freshStateValuesHere = isMetaSlot ? storedMeta?.freshStateValues : undefined;
                if (isMetaSlot && (statusPanelHere || innerMonologueHere || reasoningTextHere || (stateValuesHere && stateValuesHere.length > 0))) {
                    metaProjected = true;
                }
                // 语音条的 mediaData 里存着播放必需的状态（synthesizedFromText/voiceDuration），
                // 直接用重解析结果整体替换会把它们丢掉，导致气泡永远判定"待重合成"而点不响。
                // 双方都是语音条时按存储值打底、重解析字段覆盖。
                const mediaData = part.mediaType === "audio" && base.mediaType === "audio" && base.mediaData
                    ? { ...base.mediaData, ...part.mediaData }
                    : part.mediaData;
                projected.push({
                    ...base,
                    id,
                    content: part.content,
                    mediaType: part.mediaType,
                    mediaData,
                    statusPanel: statusPanelHere,
                    statusRegionMode: statusRegionModeHere,
                    innerMonologue: innerMonologueHere,
                    reasoningText: reasoningTextHere,
                    stateValues: stateValuesHere,
                    freshStateValues: freshStateValuesHere,
                    displayProjected: true,
                    displaySourceId: sourceId,
                });
            });
            // 投影后没有任何消息驮面板（比如整段只剩拍一拍/通话留痕）→ 补一条空投影消息
            if (!metaProjected && storedMeta) {
                projected.push({
                    ...storedMeta,
                    id: `${batch[0].id}__display_meta`,
                    content: "",
                    mediaType: undefined,
                    mediaData: undefined,
                    displayProjected: true,
                    displaySourceId: storedMeta.id,
                });
            }
        }
        return projected;
    }, [dedupedMessages, normalizeDisplayParts, renderDisplayText]);

    // Build a map: startMsgId → { startIdx, endIdx, duration }
    // and a set of all message indices that belong to a voice call group
    const voiceCallGroups = useMemo(() => {
        const groups: { startId: string; startIdx: number; endIdx: number; duration: string; callType: "voice" | "video" }[] = [];
        const memberSet = new Set<number>();

        let i = 0;
        while (i < projectedMessages.length) {
            const msg = projectedMessages[i];
            if (uiRole(msg) !== "system") { i++; continue; }
            // Detect call START precisely: "发起了语音通话" / "发起了视频通话"
            const isVoiceStart = msg.content.includes("发起了语音通话");
            const isVideoStart = msg.content.includes("发起了视频通话");
            if (isVoiceStart || isVideoStart) {
                const callType = isVideoStart ? "video" : "voice";
                const kw = isVideoStart ? "视频通话" : "语音通话";
                let endIdx = -1;
                let duration = "";
                for (let j = i + 1; j < projectedMessages.length; j++) {
                    if (uiRole(projectedMessages[j]) !== "system") continue;
                    const c = projectedMessages[j].content;
                    // Another call start → separate call, stop
                    if (c.includes("发起了语音通话") || c.includes("发起了视频通话")) break;
                    // Call end: 挂断/拒绝/取消（兼容"群语音通话"/"群视频通话"）
                    if (c.includes(`挂断了${kw}`) || c.includes(`挂断了群${kw}`) || c.includes(`拒绝了${kw}`) || c.includes(`拒绝了群${kw}`) || c.includes(`取消了${kw}`) || c.includes(`取消了群${kw}`)) {
                        endIdx = j;
                        const match = c.match(/时长\s*(\d+:\d+)/);
                        duration = match ? match[1] : "";
                        break;
                    }
                }
                if (endIdx > i) {
                    groups.push({ startId: msg.id, startIdx: i, endIdx, duration, callType });
                    for (let k = i; k <= endIdx; k++) memberSet.add(k);
                    i = endIdx + 1;
                    continue;
                }
            }
            i++;
        }
        return { groups, memberSet };
    }, [projectedMessages]);

    const getSelectableStoredMessageId = useCallback((msg: RenderChatMessage): string | null => {
        const id = msg.displaySourceId || msg.id;
        if (!id || id.startsWith("vc-") || isTransientMessage(id)) return null;
        return id;
    }, []);

    const visibleSelectableMessageIds = useMemo(() => {
        const ids: string[] = [];
        const seen = new Set<string>();
        projectedMessages.forEach((msg, idx) => {
            if (voiceCallGroups.memberSet.has(idx)) return;
            const storedId = getSelectableStoredMessageId(msg);
            if (!storedId || seen.has(storedId)) return;
            const displayContent = getMessageDisplayContent(msg);
            if (isHiddenChatFlowMessage(msg, displayContent)) return;
            seen.add(storedId);
            ids.push(storedId);
        });
        return ids;
    }, [getMessageDisplayContent, getSelectableStoredMessageId, projectedMessages, voiceCallGroups.memberSet]);

    const multiDeleteTargetIds = useMemo(() => {
        if (selectedMessageIds.size === 0) return [];
        const storedMessages = loadChatMessages(session.id);
        const storedIndexById = new Map(storedMessages.map((msg, index) => [msg.id, index]));
        const targets = new Set<string>();

        selectedMessageIds.forEach(id => {
            if (storedIndexById.has(id)) targets.add(id);
        });

        for (let i = 0; i < visibleSelectableMessageIds.length - 1; i += 1) {
            const leftId = visibleSelectableMessageIds[i];
            const rightId = visibleSelectableMessageIds[i + 1];
            if (!selectedMessageIds.has(leftId) || !selectedMessageIds.has(rightId)) continue;

            const leftIndex = storedIndexById.get(leftId);
            const rightIndex = storedIndexById.get(rightId);
            if (leftIndex === undefined || rightIndex === undefined || rightIndex <= leftIndex) continue;

            for (let storedIndex = leftIndex + 1; storedIndex < rightIndex; storedIndex += 1) {
                targets.add(storedMessages[storedIndex].id);
            }
        }

        return [...targets];
    }, [selectedMessageIds, session.id, visibleSelectableMessageIds]);

    const cancelMultiSelect = useCallback(() => {
        setIsMultiSelectMode(false);
        setSelectedMessageIds(new Set());
        setShowConfirmMultiDelete(false);
    }, []);

    const toggleMultiSelectedMessage = useCallback((messageId: string) => {
        setSelectedMessageIds(prev => {
            const next = new Set(prev);
            if (next.has(messageId)) next.delete(messageId);
            else next.add(messageId);
            return next;
        });
    }, []);

    const startMultiSelectFromMessage = useCallback((msg: RenderChatMessage) => {
        const storedId = getSelectableStoredMessageId(msg);
        if (!storedId) return;
        closeContextMenu();
        setShowEmojiPanel(false);
        setShowStickerPanel(false);
        setShowPlusMenu(false);
        setIsMultiSelectMode(true);
        setSelectedMessageIds(new Set([storedId]));
    }, [getSelectableStoredMessageId]);

    const confirmMultiDelete = useCallback(() => {
        if (multiDeleteTargetIds.length === 0) {
            showChatToast("请选择要删除的消息");
            return;
        }
        setShowConfirmMultiDelete(true);
    }, [multiDeleteTargetIds.length]);

    const handleMultiDeleteConfirmed = () => {
        const targetIds = new Set(multiDeleteTargetIds);
        const targetMessages = loadChatMessages(session.id).filter(msg => targetIds.has(msg.id));
        setShowConfirmMultiDelete(false);
        if (targetMessages.some(isOfflineInviteRootMessage)) {
            kvRemove(OFFLINE_INVITE_ACTIVE_SESSION_PREFIX + session.id);
            updateActiveOfflineInvite(null);
            setIsOfflineInviteMinimized(false);
            if (remindExpandTimerRef.current) {
                clearTimeout(remindExpandTimerRef.current);
                remindExpandTimerRef.current = null;
            }
        }
        void deleteWeixinCloudBeforeLocal(targetMessages, () => {
            const deletedCount = deleteChatMessagesByIds(session.id, multiDeleteTargetIds);
            syncMessagesFromStorage();
            cancelMultiSelect();
            if (deletedCount > 0) showChatToast(`已删除 ${deletedCount} 条历史`);
        });
    };

    /* Settings panel is rendered as an overlay (not early return) to preserve chat scroll position */

    const jumpToStoredMessage = useCallback((messageId: string) => {
        const allMsgs = loadChatMessages(session.id);
        const targetIndex = allMsgs.findIndex(msg => msg.id === messageId);
        if (targetIndex < 0) return;

        let nextCount = Math.min(INITIAL_LOAD, allMsgs.length);
        while (allMsgs.length - nextCount > targetIndex) {
            nextCount = Math.min(allMsgs.length, nextCount + LOAD_MORE_COUNT);
        }
        const computedStartIndex = Math.max(0, allMsgs.length - nextCount);
        const currentFirstVisibleId = visibleMessagesRef.current.find(msg => !isTransientMessage(msg))?.id;
        const currentStartIndex = currentFirstVisibleId
            ? allMsgs.findIndex(msg => msg.id === currentFirstVisibleId)
            : -1;
        const startIndex = currentStartIndex >= 0
            ? Math.min(computedStartIndex, currentStartIndex)
            : computedStartIndex;
        const nextMessages = allMsgs.slice(startIndex);
        const targetMsg = allMsgs[targetIndex];
        const batchKey = targetMsg?.role === "assistant" && targetMsg.responseBatchId && targetMsg.rawResponseText?.trim()
            ? `${targetMsg.responseRoundId || ""}\x1f${targetMsg.responseBatchId}\x1f${targetMsg.rawResponseText}`
            : "";
        const fallbackMessageId = batchKey
            ? nextMessages.find(msg => (
                msg.role === "assistant" &&
                msg.responseBatchId &&
                msg.rawResponseText?.trim() &&
                `${msg.responseRoundId || ""}\x1f${msg.responseBatchId}\x1f${msg.rawResponseText}` === batchKey
            ))?.id
            : undefined;

        stopLoadMoreAnchorTracking();
        loadMoreScrollRestoreRef.current = null;
        loadingMoreRef.current = false;
        initialScrollVersionRef.current += 1;
        needsInitialScrollRef.current = false;
        pendingSearchJumpRef.current = {
            messageId,
            ...(fallbackMessageId && fallbackMessageId !== messageId ? { fallbackMessageId } : {}),
        };

        const nextHasMore = startIndex > 0;
        visibleMessagesRef.current = nextMessages;
        hasMoreRef.current = nextHasMore;
        setHasMore(nextHasMore);
        setMessages(nextMessages);
    }, [session.id, stopLoadMoreAnchorTracking]);

    // Shared handler: reload messages + re-trigger scroll-to-bottom after call ends
    const returnFromCall = (hide: () => void) => {
        hide();
        needsInitialScrollRef.current = true;
        prevMsgCountRef.current = 0;
        syncMessagesFromStorage();
        triggerReply();
    };

    const editingMessage = editingMessageId ? messages.find(m => m.id === editingMessageId) : null;
    const editingSystemInstruction = editingMessage ? isSystemInstructionMessage(editingMessage) : false;

    if (showVoiceCall) {
        if (session.isGroup && groupCharacters.length > 0) {
            return (
                <GroupCallScreen
                    type="voice"
                    session={session}
                    characters={groupCharacters}
                    initiator={callInitiator}
                    initiatorName={callInitiatorName}
                    onEnd={() => returnFromCall(() => setShowVoiceCall(false))}
                />
            );
        }
        if (character) {
            return (
                <VoiceCallScreen
                    session={session}
                    character={character}
                    initiator={callInitiator}
                    onEnd={() => returnFromCall(() => setShowVoiceCall(false))}
                />
            );
        }
    }

    if (showVideoCall) {
        if (session.isGroup && groupCharacters.length > 0) {
            return (
                <GroupCallScreen
                    type="video"
                    session={session}
                    characters={groupCharacters}
                    initiator={callInitiator}
                    initiatorName={callInitiatorName}
                    onEnd={() => returnFromCall(() => setShowVideoCall(false))}
                />
            );
        }
        if (character) {
            return (
                <VideoCallScreen
                    session={session}
                    character={character}
                    initiator={callInitiator}
                    onEnd={() => returnFromCall(() => setShowVideoCall(false))}
                />
            );
        }
    }

    const chatRoomBackgroundStyle = bgImageResolved ? {
        backgroundColor: "#fff",
        backgroundImage: `url(${bgImageResolved})`,
        backgroundPosition: "center",
        backgroundSize: "cover",
        backgroundRepeat: "no-repeat",
    } : undefined;

    return (
        <div ref={wrapperRef} className={`session-${session.id} chat-room-wrapper page-shell inset-0 flex flex-col z-20`} style={chatRoomBackgroundStyle} {...(bgLoading ? { "data-loading": "" } : {})} {...(bgImageResolved ? { "data-has-bg-image": "" } : {})} {...(showSettings ? { "data-settings-open": "" } : {})}>
            {/* Custom CSS Injection for this session — scoped to prevent leaking */}
            {liveCSS && (
                <SessionCustomCSS css={liveCSS} scope={`.session-${session.id}`} />
            )}

            {/* 全屏特效层（表情雨/礼花），不拦截任何触摸操作 */}
            <ChatScreenEffectOverlay active={activeScreenEffect} onDone={() => setActiveScreenEffect(null)} />
            {/* Header */}
            <header className="page-header chat-room-main-pane" data-ui="header">
                <div className="page-header-safe-area" />
                <div className="page-header-content">
                    <button className="page-back-btn" type="button" onClick={onBack} aria-label="返回">
                        <ChevronLeft size={24} strokeWidth={1.5} />
                    </button>
                    <span className="page-title" style={{ position: 'relative' }}>
                        {offlineMode ? "线下 · " : ""}
                        {session.isGroup
                            ? `${session.groupName || "群聊"}(${(session.participantIds?.length || 0) + (session.isSpectator ? 0 : 1)})`
                            : (session.alias || character?.name || `User_${session.contactId.slice(-4)}`)}
                        {(isGenerating || isOfflineGenerating) && (
                            <span className="chat-typing-indicator">
                                {offlineMode ? "线下生成中" : "对方正在输入"}<span className="chat-typing-dots"><i/><i/><i/></span>
                            </span>
                        )}
                    </span>
                    <span className="page-header-right">
                        <button className="page-back-btn" type="button" onClick={() => setShowSettings(true)} aria-label="更多">
                            <MoreHorizontal size={22} strokeWidth={1.5} />
                        </button>
                    </span>
                </div>
            </header>
            <ChatPluginSlot
                name="chat.header"
                slotProps={{ sessionId: session.id, isGroup: !!session.isGroup }}
                className="chat-plugin-header chat-room-main-pane"
            />

            {!offlineMode && (
                activeOfflineInvite && isOfflineInviteMinimized ? (
                    <div className="chat-offline-invite-capsule-wrapper">
                        <OfflineInviteCapsule
                            invite={activeOfflineInvite}
                            character={character}
                            onClick={handleExpandOfflineInvite}
                            onAccept={handleAcceptOfflineInvite}
                        />
                    </div>
                ) : (kvGet(OFFLINE_INVITE_ACTIVE_SESSION_PREFIX + session.id) === "1" ? (
                    <div className="chat-offline-invite-capsule-wrapper">
                        <div
                            onClick={() => doToggleOfflineMode(false)}
                            className="w-fit max-w-[92%] mx-auto px-3.5 py-1.5 rounded-full bg-[var(--c-panel,#ffffff)]/95 backdrop-blur-md border border-[var(--c-panel-border,rgba(0,0,0,0.12))] shadow-md flex items-center gap-2 cursor-pointer select-none hover:scale-[1.02] active:scale-[0.98] transition-all"
                            data-ui="offline-invite-capsule"
                            title="点击返回面对面碰面"
                        >
                            <span className="relative flex h-2 w-2 shrink-0">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--c-primary,#2563eb)] opacity-75" />
                                <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--c-primary,#2563eb)]" />
                            </span>
                            <span className="text-xs font-medium text-[var(--c-text-title,#111827)] truncate">
                                ✨ 与 {character?.name || "对方"} 线下碰面中
                            </span>
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    doToggleOfflineMode(false);
                                }}
                                className="text-[11px] bg-[var(--c-primary,#2563eb)] text-white font-semibold px-2 py-0.5 rounded-full hover:opacity-90 active:scale-95 transition-all shrink-0 cursor-pointer shadow-sm"
                            >
                                回到现场
                            </button>
                        </div>
                    </div>
                ) : null)
            )}

            {/* Message List */}
            <div
                ref={scrollRef}
                className="page-body chat-room-main-pane flex flex-col gap-4 chat-scroll-anchored"
                onScroll={(e) => {
                    if (activeMessageId || activeOfflineTarget) closeContextMenu();
                }}
                onPointerDown={(e) => {
                    if (activeMessageId || activeOfflineTarget) closeContextMenu();
                    if (showEmojiPanel) setShowEmojiPanel(false);
                    if (showStickerPanel) setShowStickerPanel(false);
                    if (showPlusMenu) setShowPlusMenu(false);
                }}
            >
                {offlineMode && (
                    <div className="chat-offline-body">
                        {offlineTurns.length === 0 && !pendingOfflineUserText ? (
                            <div className="chat-offline-empty">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0Z" /><circle cx="12" cy="10" r="3" /></svg>
                                线下模式
                            </div>
                        ) : null}
                        {hasMoreOfflineTurns && (
                            <button
                                type="button"
                                className="chat-sys-msg chat-load-more-button"
                                onClick={loadMoreOfflineTurns}
                            >
                                <span>查看更多线下记录</span>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <polyline points="18 15 12 9 6 15" />
                                </svg>
                            </button>
                        )}
                        {visibleOfflineTurns.map((turn, turnIdx) => {
                            const offlineDisplay = offlineDisplayByTurnId.get(turn.id) ?? getOfflineDisplayText(turn);
                            const assistantHasHtmlPreview = hasOfflineHtmlPreview(offlineDisplay.assistantContent);
                            const prevTime = turnIdx > 0 ? visibleOfflineTurns[turnIdx - 1].createdAt : null;
                            const showTime = !prevTime || shouldShowTimestamp(turn.createdAt, prevTime);
                            return (
                            <Fragment key={turn.id}>
                            {showTime && <div className="chat-offline-time">{formatChatUiTime(turn.createdAt)}</div>}
                            <div className="chat-offline-turn">
                                <div className="chat-offline-entry" data-role="user" style={offlineDisplay.userContent.trim() ? undefined : { display: "none" }}>
                                    {/* 头像占位：默认 display:none（见 chat.css），供自定义 CSS 显示 */}
                                    <div className="chat-offline-avatar" aria-hidden="true">
                                        {userIdentity?.avatarUrl ? <img src={userIdentity.avatarUrl} alt="" /> : <User size={18} color="var(--c-text)" />}
                                    </div>
                                    <div className="chat-offline-label">你</div>
                                    <div
                                        className="chat-offline-text"
                                        onPointerDown={(e) => { e.stopPropagation(); handleOfflinePointerDown(e, { turnId: turn.id, role: "user" }); }}
                                        onPointerUp={(e) => handleMessagePointerUp(e)}
                                        onPointerCancel={handleMessagePointerCancel}
                                        onPointerLeave={handleMessagePointerCancel}
                                        onPointerMove={(e) => {
                                            if (startPosRef.current) {
                                                const dx = Math.abs(e.clientX - startPosRef.current.x);
                                                const dy = Math.abs(e.clientY - startPosRef.current.y);
                                                if (dx > 10 || dy > 10) handleMessagePointerCancel();
                                            }
                                        }}
                                        onContextMenu={(e) => { e.preventDefault(); openOfflineContextMenu({ turnId: turn.id, role: "user" }, { x: e.clientX, y: e.clientY }); }}
                                        {...(activeOfflineTarget?.turnId === turn.id && activeOfflineTarget.role === "user" ? { "data-active": "" } : {})}
                                    >
                                        {activeOfflineTarget?.turnId === turn.id && activeOfflineTarget.role === "user" && renderOfflineContextMenu(turn, "user")}
                                        <BilingualTextBlock
                                            text={offlineDisplay.userContent}
                                            mode="markdown"
                                            defaultExpanded={session.collapseBilingualTranslation !== false ? false : true}
                                        />
                                    </div>
                                </div>
                                <div className="chat-offline-entry" data-role="assistant">
                                    {/* 头像占位：默认 display:none（见 chat.css），供自定义 CSS 显示 */}
                                    <div className="chat-offline-avatar" aria-hidden="true">
                                        {character?.avatar ? <img src={character.avatar} alt="" /> : <ChatFallbackAvatar />}
                                    </div>
                                    <div className="chat-offline-label-row">
                                        <div className="chat-offline-label">{session.isGroup ? (session.groupName || "群聊") : (character?.name || "对方")}</div>
                                        {assistantHasHtmlPreview ? (
                                            <button
                                                type="button"
                                                className="chat-offline-menu-trigger"
                                                aria-label="线下回复操作"
                                                title="线下回复操作"
                                                onPointerDown={(e) => {
                                                    e.stopPropagation();
                                                    handleMessagePointerCancel();
                                                }}
                                                onClick={(e) => {
                                                    e.preventDefault();
                                                    e.stopPropagation();
                                                    const rect = e.currentTarget.getBoundingClientRect();
                                                    openOfflineContextMenu({ turnId: turn.id, role: "assistant" }, {
                                                        x: rect.left + rect.width / 2,
                                                        y: rect.bottom,
                                                    });
                                                }}
                                            >
                                                <MoreHorizontal size={16} strokeWidth={2} />
                                            </button>
                                        ) : null}
                                    </div>
                                    {/* 思维链触发条（线下模式，Claude app 风格）：优先展示预设格式 <thinking> 解析结果，缺省回退模型 API 原生思考 */}
                                    {(turn.thinkingText || turn.reasoningText) && (
                                        <button
                                            type="button"
                                            className="chat-reasoning-trigger"
                                            onClick={(e) => { e.stopPropagation(); setReasoningSheetText(turn.thinkingText || turn.reasoningText || null); }}
                                            aria-label="查看思考过程"
                                        >
                                            <Clock size={13} strokeWidth={1.8} className="chat-reasoning-trigger-icon" />
                                            <span className="chat-reasoning-trigger-text">{reasoningPreviewLine(turn.thinkingText || turn.reasoningText || "")}</span>
                                            <ChevronRight size={14} strokeWidth={1.8} className="chat-reasoning-trigger-icon" />
                                        </button>
                                    )}
                                    <div
                                        className="chat-offline-text"
                                        onPointerDown={(e) => { e.stopPropagation(); handleOfflinePointerDown(e, { turnId: turn.id, role: "assistant" }); }}
                                        onPointerUp={(e) => handleMessagePointerUp(e)}
                                        onPointerCancel={handleMessagePointerCancel}
                                        onPointerLeave={handleMessagePointerCancel}
                                        onPointerMove={(e) => {
                                            if (startPosRef.current) {
                                                const dx = Math.abs(e.clientX - startPosRef.current.x);
                                                const dy = Math.abs(e.clientY - startPosRef.current.y);
                                                if (dx > 10 || dy > 10) handleMessagePointerCancel();
                                            }
                                        }}
                                        onContextMenu={(e) => { e.preventDefault(); openOfflineContextMenu({ turnId: turn.id, role: "assistant" }, { x: e.clientX, y: e.clientY }); }}
                                        {...(activeOfflineTarget?.turnId === turn.id && activeOfflineTarget.role === "assistant" ? { "data-active": "" } : {})}
                                    >
                                        {activeOfflineTarget?.turnId === turn.id && activeOfflineTarget.role === "assistant" && renderOfflineContextMenu(turn, "assistant")}
                                        <OfflineAssistantTextBlock
                                            text={offlineDisplay.assistantContent}
                                            defaultExpanded={session.collapseBilingualTranslation !== false ? false : true}
                                        />
                                    </div>
                                    {turn.summary.trim() && (
                                        <details className="chat-offline-summary-fold">
                                            <summary>摘要（{turn.summaryTag || "summary"}）</summary>
                                            <div className="chat-offline-summary-content">
                                                <BilingualTextBlock
                                                    text={offlineDisplay.summary}
                                                    mode="markdown"
                                                    defaultExpanded={session.collapseBilingualTranslation !== false ? false : true}
                                                />
                                            </div>
                                        </details>
                                    )}
                                </div>
                            </div>
                            </Fragment>
                            );
                        })}
                        {(pendingOfflineUserText || isOfflineGenerating) && (
                            <div className="chat-offline-turn">
                                <div className="chat-offline-entry" data-role="user" style={pendingOfflineUserText ? undefined : { display: "none" }}>
                                    {/* 头像占位：默认 display:none（见 chat.css），供自定义 CSS 显示 */}
                                    <div className="chat-offline-avatar" aria-hidden="true">
                                        {userIdentity?.avatarUrl ? <img src={userIdentity.avatarUrl} alt="" /> : <User size={18} color="var(--c-text)" />}
                                    </div>
                                    <div className="chat-offline-label">你</div>
                                    <div className="chat-offline-text">
                                        <BilingualTextBlock
                                            text={renderDisplayText(pendingOfflineUserText, 1, true)}
                                            mode="markdown"
                                            defaultExpanded={session.collapseBilingualTranslation !== false ? false : true}
                                        />
                                    </div>
                                </div>
                                {offlineStreamPreview?.content ? (
                                    /* 流式预览原地长出：与正式剧情正文同结构（头像/角色名/正文区），
                                       正文用轻量 pre-wrap 渲染（避免每帧 markdown/双语解析），落库时原地换成正式排版 */
                                    <div className="chat-offline-entry" data-role="assistant">
                                        <div className="chat-offline-avatar" aria-hidden="true">
                                            {character?.avatar ? <img src={character.avatar} alt="" /> : <ChatFallbackAvatar />}
                                        </div>
                                        <div className="chat-offline-label-row">
                                            <div className="chat-offline-label">{session.isGroup ? (session.groupName || "群聊") : (character?.name || "对方")}</div>
                                        </div>
                                        <div className="chat-offline-text">
                                            <div className="chat-stream-text whitespace-pre-wrap break-words">{offlineStreamPreview.content}</div>
                                            <span className="chat-stream-cursor" aria-hidden="true" />
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        )}
                    </div>
                )}
                {!offlineMode && hasMore && (
                    <button
                        type="button"
                        className="chat-sys-msg chat-load-more-button"
                        onClick={loadMore}
                    >
                        <span>查看更多消息</span>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="18 15 12 9 6 15" />
                        </svg>
                    </button>
                )}
                {!offlineMode && projectedMessages.map((msg, idx) => {
                    // ── Voice call group: collapsed widget ──
                    const vcGroup = voiceCallGroups.groups.find(g => g.startIdx === idx);
                    if (vcGroup) {
                        const isExpanded = expandedVoiceCallIds.has(vcGroup.startId);
                        const groupMessages = projectedMessages.slice(vcGroup.startIdx, vcGroup.endIdx + 1);
                        const chatCount = groupMessages.filter(m => uiRole(m) !== "system").length;
                        return (
                            <div key={`vc-${vcGroup.startId}`} className="flex flex-col gap-2">
                                <div
                                    onPointerDown={(e) => { e.stopPropagation(); handleMessagePointerDown(e, `vc-${vcGroup.startId}`); }}
                                    onPointerUp={(e) => handleMessagePointerUp(e)}
                                    onPointerCancel={handleMessagePointerCancel}
                                    onPointerLeave={handleMessagePointerCancel}
                                    onPointerMove={(e) => {
                                        if (startPosRef.current) {
                                            const dx = Math.abs(e.clientX - startPosRef.current.x);
                                            const dy = Math.abs(e.clientY - startPosRef.current.y);
                                            if (dx > 10 || dy > 10) handleMessagePointerCancel();
                                        }
                                    }}
                                    onContextMenu={(e) => { e.preventDefault(); openMessageContextMenu(`vc-${vcGroup.startId}`, { x: e.clientX, y: e.clientY }); }}
                                    onClick={() => {
                                        if (activeMessageId === `vc-${vcGroup.startId}`) return;
                                        setExpandedVoiceCallIds(prev => {
                                            const next = new Set(prev);
                                            if (next.has(vcGroup.startId)) next.delete(vcGroup.startId);
                                            else next.add(vcGroup.startId);
                                            return next;
                                        });
                                    }}
                                    className="chat-sys-msg flex items-center justify-center gap-[6px] py-[6px] px-[14px] mx-auto rounded-2xl cursor-pointer relative"
                                    {...(activeMessageId === `vc-${vcGroup.startId}` ? { "data-active": "" } : {})}
                                >
                                    {vcGroup.callType === "video" ? (
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M23 7l-7 5 7 5V7z" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" />
                                        </svg>
                                    ) : (
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z" />
                                        </svg>
                                    )}
                                    <span>{vcGroup.callType === "video" ? "视频通话" : "语音通话"}{vcGroup.duration ? ` ${vcGroup.duration}` : ""}{chatCount > 0 ? ` · ${chatCount}条消息` : ""}</span>
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                                        className="ui-chevron-down-flip" {...(isExpanded ? { "data-open": "" } : {})}>
                                        <polyline points="6 9 12 15 18 9" />
                                    </svg>
                                    {activeMessageId === `vc-${vcGroup.startId}` && renderDeleteOnlyContextMenu(() => {
                                        const groupMsgIds = groupMessages.map(m => m.id);
                                        void deleteWeixinCloudBeforeLocal(groupMessages, () => {
                                            groupMsgIds.forEach(id => deleteChatMessage(id));
                                            setMessages(prev => prev.filter(m => !groupMsgIds.includes(m.id)));
                                        });
                                    })}
                                </div>
                                {isExpanded && (
                                    <div className="chat-vc-group-border">
                                        {groupMessages.map((gMsg) => (
                                            uiRole(gMsg) === "system" ? (
                                                <div key={gMsg.id} className="flex justify-center">
                                                    <div
                                                        onPointerDown={(e) => { e.stopPropagation(); handleMessagePointerDown(e, gMsg.id); }}
                                                        onPointerUp={(e) => handleMessagePointerUp(e)}
                                                        onPointerCancel={handleMessagePointerCancel}
                                                        onPointerLeave={handleMessagePointerCancel}
                                                        onPointerMove={(e) => {
                                                            if (startPosRef.current) {
                                                                const dx = Math.abs(e.clientX - startPosRef.current.x);
                                                                const dy = Math.abs(e.clientY - startPosRef.current.y);
                                                                if (dx > 10 || dy > 10) handleMessagePointerCancel();
                                                            }
                                                        }}
                                                        onContextMenu={(e) => { e.preventDefault(); openMessageContextMenu(gMsg.id, { x: e.clientX, y: e.clientY }); }}
                                                        className="chat-sys-msg relative cursor-pointer"
                                                        {...(activeMessageId === gMsg.id ? { "data-active": "" } : {})}
                                                    >
                                                        {formatSysMsgForUI(gMsg.content, gMsg)}
                                                        {activeMessageId === gMsg.id && renderDeleteOnlyContextMenu(() => handleDeleteMessage(getStoredActionMessageId(gMsg)))}
                                                    </div>
                                                </div>
                                            ) : (
                                                <div key={gMsg.id} className={`flex ${gMsg.role === "user" ? "justify-end" : "justify-start"}`}>
                                                    <div className="flex flex-col min-w-0 max-w-[75%]">
                                                        {session.isGroup && gMsg.role !== "user" && (
                                                            <span className="chat-group-sender-name">{gMsg.senderName || ""}{renderGroupRoleBadge(gMsg.senderCharacterId)}</span>
                                                        )}
                                                        <div
                                                            onPointerDown={(e) => { e.stopPropagation(); handleMessagePointerDown(e, gMsg.id); }}
                                                            onPointerUp={(e) => handleMessagePointerUp(e)}
                                                            onPointerCancel={handleMessagePointerCancel}
                                                            onPointerLeave={handleMessagePointerCancel}
                                                            onPointerMove={(e) => {
                                                                if (startPosRef.current) {
                                                                    const dx = Math.abs(e.clientX - startPosRef.current.x);
                                                                    const dy = Math.abs(e.clientY - startPosRef.current.y);
                                                                    if (dx > 10 || dy > 10) handleMessagePointerCancel();
                                                                }
                                                            }}
                                                            onContextMenu={(e) => { e.preventDefault(); openMessageContextMenu(gMsg.id, { x: e.clientX, y: e.clientY }); }}
                                                            className={`chat-bubble-role-${gMsg.role} py-2 px-3 rounded-md break-words relative cursor-pointer`}
                                                            {...(activeMessageId === gMsg.id ? { "data-active": "" } : {})}
                                                        >
                                                            <BilingualTextBlock
                                                                text={gMsg.displayProjected ? gMsg.content : renderDisplayText(gMsg.content, gMsg.role === "user" ? 1 : 2, false)}
                                                                mode="markdown"
                                                                defaultExpanded={session.collapseBilingualTranslation !== false ? false : true}
                                                            />
                                                            {activeMessageId === gMsg.id && renderBubbleContextMenu(gMsg, { allowMultiSelect: false })}
                                                        </div>
                                                    </div>
                                                </div>
                                            )
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    }

                    // Skip messages that belong to a voice call group (rendered above)
                    if (voiceCallGroups.memberSet.has(idx)) return null;

                    const renderMsg = msg;
                    const isSystemInstruction = isSystemInstructionMessage(renderMsg);
                    const bubbleDisplayContent = getMessageDisplayContent(renderMsg);
                    let prevVisibleMsg: RenderChatMessage | null = null;
                    for (let prevIdx = idx - 1; prevIdx >= 0; prevIdx -= 1) {
                        if (voiceCallGroups.memberSet.has(prevIdx)) continue;
                        const candidate = projectedMessages[prevIdx];
                        const candidateDisplayContent = getMessageDisplayContent(candidate);
                        if (isHiddenChatFlowMessage(candidate, candidateDisplayContent)) continue;
                        prevVisibleMsg = candidate;
                        break;
                    }
                    const showTime = shouldShowTimestamp(msg.createdAt, prevVisibleMsg?.createdAt ?? null);
                    const isConsecutive = prevVisibleMsg && !showTime && uiRole(prevVisibleMsg) === uiRole(msg) && uiRole(msg) !== "system"
                        && (!session.isGroup || prevVisibleMsg.senderCharacterId === msg.senderCharacterId);
                    // Hide bubbles with no visible content (empty text, stripped music tags, etc.)
                    const visibleContent = getChatFlowVisibleContent(renderMsg, bubbleDisplayContent);
                    const isVisualMedia = isChatVisualMedia(renderMsg);
                    const hiddenEmpty = isHiddenChatFlowMessage(renderMsg, bubbleDisplayContent);
                    const hasFoldedPanel = !!(renderMsg.statusPanel || renderMsg.innerMonologue);
                    // 内心卡片只展示本轮实际输出的状态值；旧数据没有 freshStateValues 时回退到合并快照
                    const cardStateValues = msg.freshStateValues ?? msg.stateValues;
                    const isSilentThought = !visibleContent && !renderMsg.mediaType && hasFoldedPanel && msg.role !== "user";
                    const isStandaloneHtmlPreview = !renderMsg.mediaType && isStandaloneHtmlPreviewContent(bubbleDisplayContent);
                    const isMediaBubble = (renderMsg.mediaType && CHAT_MEDIA_BUBBLE_TYPES.has(renderMsg.mediaType)) || isStandaloneHtmlPreview;
                    // Empty bubble: no visible content AND no visual media AND no folded panel.
                    const isEmptyBubble = !isVisualMedia && !visibleContent && uiRole(msg) !== "system" && !hasFoldedPanel;
                    const selectableStoredId = getSelectableStoredMessageId(msg);
                    const isMultiSelectable = isMultiSelectMode && !!selectableStoredId && !hiddenEmpty;
                    const isMultiSelected = !!selectableStoredId && selectedMessageIds.has(selectableStoredId);
                    const multiSelectWrapperProps = isMultiSelectable ? {
                        onClickCapture: (e: React.MouseEvent) => {
                            e.preventDefault();
                            e.stopPropagation();
                            toggleMultiSelectedMessage(selectableStoredId!);
                        },
                        "data-multi-select": "",
                        ...(isMultiSelected ? { "data-selected": "" } : {}),
                    } : {};

                    return (
                        <div key={msg.id} className="flex flex-col gap-4" {...(hiddenEmpty ? { style: { display: "none" } } : {})} {...(isEmptyBubble && renderMsg.reasoningText && !showTime ? { "data-reasoning-only": "" } : {})}>
                            {showTime && (
                                <div className="flex justify-center w-full">
                                    <span className="chat-sys-msg py-[2px] px-2 rounded select-none">
                                        {formatChatUiTime(msg.createdAt)}
                                    </span>
                                </div>
                            )}
                            {/* 思维链触发条（Claude app 风格）：点击打开底部弹窗 */}
                            {renderMsg.reasoningText && msg.role !== "user" && uiRole(msg) !== "system" && (
                                <div className="chat-msg-wrapper" data-role={uiRole(msg)} data-reasoning-row="" style={{ marginBottom: -8 }}>
                                    <div className="w-[40px] shrink-0" />
                                    <button
                                        type="button"
                                        className="chat-reasoning-trigger"
                                        onClick={(e) => { e.stopPropagation(); setReasoningSheetText(renderMsg.reasoningText || null); }}
                                        aria-label="查看思考过程"
                                    >
                                        <Clock size={13} strokeWidth={1.8} className="chat-reasoning-trigger-icon" />
                                        <span className="chat-reasoning-trigger-text">{reasoningPreviewLine(renderMsg.reasoningText)}</span>
                                        <ChevronRight size={14} strokeWidth={1.8} className="chat-reasoning-trigger-icon" />
                                    </button>
                                </div>
                            )}
                            <div
                                id={`message-${msg.id}`}
                                className="chat-msg-wrapper"
                                data-role={uiRole(msg)}
                                {...(isEmptyBubble && renderMsg.reasoningText ? { "data-reasoning-empty": "" } : {})}
                                {...(isConsecutive ? { "data-consecutive": "" } : {})}
                                {...(activeMessageId === msg.id ? { "data-active": "" } : {})}
                                {...(highlightMessageId === msg.id ? { "data-highlight": "" } : {})}
                                {...multiSelectWrapperProps}
                            >
                                {isMultiSelectable && (
                                    <span className="chat-multi-select-check" aria-hidden="true">
                                        {isMultiSelected && <Check size={14} strokeWidth={2.5} />}
                                    </span>
                                )}
                                {uiRole(msg) === "system" ? (
                                    <div
                                        onPointerDown={(e) => { e.stopPropagation(); handleMessagePointerDown(e, msg.id); }}
                                        onPointerUp={(e) => handleMessagePointerUp(e)}
                                        onPointerCancel={handleMessagePointerCancel}
                                        onPointerLeave={handleMessagePointerCancel}
                                        onPointerMove={(e) => {
                                            if (startPosRef.current) {
                                                const dx = Math.abs(e.clientX - startPosRef.current.x);
                                                const dy = Math.abs(e.clientY - startPosRef.current.y);
                                                if (dx > 10 || dy > 10) handleMessagePointerCancel();
                                            }
                                        }}
                                        onContextMenu={(e) => { e.preventDefault(); openMessageContextMenu(msg.id, { x: e.clientX, y: e.clientY }); }}
                                        className={isSystemInstruction
                                            ? "chat-system-instruction-card relative cursor-pointer"
                                            : `chat-sys-msg break-all max-w-[90%] relative cursor-pointer${
                                                // 骰子旁白：等骰子落定再淡入，避免剧透点数
                                                msg.content.startsWith("🎲 掷出了") && Date.now() - new Date(msg.createdAt).getTime() < 6000
                                                    ? " dice-aside-reveal"
                                                    : ""
                                            }`}
                                        {...(activeMessageId === msg.id ? { "data-active": "" } : {})}
                                    >
                                        {isSystemInstruction ? (
                                            <SystemInstructionCard content={msg.content} />
                                        ) : msg.mediaType === "memory_write_request" ? (
                                            <MemoryWriteRequestCard
                                                msg={msg}
                                                onApprove={handleApproveMemoryWrite}
                                                onIgnore={handleIgnoreMemoryWrite}
                                            />
                                        ) : (
                                            <>
                                                {msg.mediaType === "poke"
                                                    ? (() => {
                                                        const sender = msg.mediaData?.pokeSender || (msg.role === "user" ? "你" : (character?.name || "对方"));
                                                        const target = msg.mediaData?.pokeTarget || (msg.role === "user" ? (character?.name || "对方") : "你");
                                                        const displaySender = sender === userIdentity?.name ? "你" : sender;
                                                        const displayTarget = target === userIdentity?.name ? "你" : target;
                                                        return `${displaySender} 拍了拍 ${displayTarget}`;
                                                    })()
                                                    : formatSysMsgForUI(msg.content, msg)}
                                            </>
                                        )}
                                        {activeMessageId === msg.id && renderSystemContextMenu(msg)}
                                    </div>
                                ) : msg.isRetracted ? (
                                    <div
                                        onPointerDown={(e) => { e.stopPropagation(); handleMessagePointerDown(e, msg.id); }}
                                        onPointerUp={(e) => handleMessagePointerUp(e)}
                                        onPointerCancel={handleMessagePointerCancel}
                                        onPointerLeave={handleMessagePointerCancel}
                                        onPointerMove={(e) => {
                                            if (startPosRef.current) {
                                                const dx = Math.abs(e.clientX - startPosRef.current.x);
                                                const dy = Math.abs(e.clientY - startPosRef.current.y);
                                                if (dx > 10 || dy > 10) handleMessagePointerCancel();
                                            }
                                        }}
                                        onContextMenu={(e) => { e.preventDefault(); openMessageContextMenu(msg.id, { x: e.clientX, y: e.clientY }); }}
                                        className="chat-sys-msg mx-auto relative cursor-pointer"
                                        {...(activeMessageId === msg.id ? { "data-active": "" } : {})}
                                    >
                                        {msg.role === "user" ? "你" : (character?.name || "对方")}撤回了一条消息
                                        {activeMessageId === msg.id && renderDeleteOnlyContextMenu(() => handleDeleteMessage(getStoredActionMessageId(msg)), () => startMultiSelectFromMessage(msg))}
                                    </div>
                                ) : (
                                    <>
                                        {msg.role !== "user" && !isEmptyBubble && (
                                            isSilentThought ? (
                                                /* Silent + inner monologue: no avatar, just heart */
                                                <div
                                                    onPointerDown={(e) => { e.stopPropagation(); handleMessagePointerDown(e, msg.id); }}
                                                    onPointerUp={(e) => handleMessagePointerUp(e)}
                                                    onPointerCancel={handleMessagePointerCancel}
                                                    onPointerLeave={handleMessagePointerCancel}
                                                    onPointerMove={(e) => {
                                                        if (startPosRef.current) {
                                                            const dx = Math.abs(e.clientX - startPosRef.current.x);
                                                            const dy = Math.abs(e.clientY - startPosRef.current.y);
                                                            if (dx > 10 || dy > 10) handleMessagePointerCancel();
                                                        }
                                                    }}
                                                    onContextMenu={(e) => { e.preventDefault(); openMessageContextMenu(msg.id, { x: e.clientX, y: e.clientY }); }}
                                                    onClick={(e) => {
                                                        if (activeMessageId === msg.id) return;
                                                        e.stopPropagation();
                                                        setExpandedThinkingId(prev => prev === msg.id ? null : msg.id);
                                                    }}
                                                    className="chat-monologue-heart flex items-center justify-center shrink-0 w-[40px] h-[24px] relative cursor-pointer"
                                                    title={session.isGroup ? `${msg.senderName || "群成员"}的折叠状态` : "查看折叠状态"}
                                                    aria-label={session.isGroup ? `${msg.senderName || "群成员"}的折叠状态` : "查看折叠状态"}
                                                    {...(activeMessageId === msg.id ? { "data-active": "" } : {})}
                                                >
                                                    <span className="chat-monologue-heart ts-18 leading-none inline-block" {...(expandedMonologueId === msg.id ? { "data-active": "" } : {})}><svg viewBox="0 0 16 16" width="18" height="18" style={{display:"block"}}><path d="M8 14s-6-4-6-8c0-2.5 1.5-4 3.5-4 1 0 2 .5 2.5 1.5C8.5 2.5 9.5 2 10.5 2 12.5 2 14 3.5 14 6c0 4-6 8-6 8z" fill="currentColor"/></svg></span>
                                                    {activeMessageId === msg.id && renderDeleteOnlyContextMenu(() => handleDeleteMessage(getStoredActionMessageId(msg)), () => startMultiSelectFromMessage(msg))}
                                                </div>
                                            ) : (
                                                <div className="chat-msg-avatar flex flex-col items-center gap-1 shrink-0">
                                                    {(() => {
                                                        const senderChar = session.isGroup && msg.senderCharacterId
                                                            ? groupCharMap.get(msg.senderCharacterId) || character
                                                            : character;
                                                        return (
                                                            <>
                                                    <div onDoubleClick={() => {
                                                        const targetChar = session.isGroup && msg.senderCharacterId
                                                            ? groupCharMap.get(msg.senderCharacterId) || character
                                                            : character;
                                                        if (targetChar) sendRichMessage("poke", { pokeTarget: targetChar.name });
                                                    }} className="w-[40px] h-[40px] rounded-[20px] bg-[var(--c-input)] overflow-hidden cursor-pointer">
                                                        {senderChar?.avatar ? (
                                                            <img src={senderChar.avatar} className="w-full h-full object-cover" alt="" />
                                                        ) : (
                                                            <ChatFallbackAvatar />
                                                        )}
                                                    </div>
                                                            </>
                                                        );
                                                    })()}
                                                </div>
                                            )
                                        )}
                                        {!isSilentThought && !isEmptyBubble && <div
                                            className={`chat-msg-content-wrap flex flex-col min-w-0 max-w-[70%] ${isStandaloneHtmlPreview ? "chat-msg-content-wrap-html" : ""}`}
                                            {...(isStandaloneHtmlPreview ? { "data-html": "true" } : {})}
                                        >
                                            {session.isGroup && msg.role !== "user" && (
                                                <span className="chat-group-sender-name">{msg.senderName || ""}{renderGroupRoleBadge(msg.senderCharacterId)}</span>
                                            )}
                                            <div
                                            {...(editingMessageId !== msg.id ? {
                                                onPointerDown: (e: React.PointerEvent) => { e.stopPropagation(); handleMessagePointerDown(e, msg.id); },
                                                onPointerUp: (e: React.PointerEvent) => handleMessagePointerUp(e),
                                                onPointerCancel: handleMessagePointerCancel,
                                                onPointerLeave: handleMessagePointerCancel,
                                                onPointerMove: (e: React.PointerEvent) => {
                                                    if (startPosRef.current) {
                                                        const dx = Math.abs(e.clientX - startPosRef.current.x);
                                                        const dy = Math.abs(e.clientY - startPosRef.current.y);
                                                        if (dx > 10 || dy > 10) handleMessagePointerCancel();
                                                    }
                                                },
                                                onContextMenu: (e: React.MouseEvent) => { e.preventDefault(); openMessageContextMenu(msg.id, { x: e.clientX, y: e.clientY }); },
                                            } : {})}
                                            className={`chat-bubble-role-${msg.role} ${isMediaBubble ? "chat-bubble-media" : ""} ${isStandaloneHtmlPreview ? "chat-bubble-html-preview" : ""} ${renderMsg.mediaType === "music_share" ? "chat-bubble-music-share" : ""} ${renderMsg.mediaType === "gift" || renderMsg.mediaType === "image" || isStandaloneHtmlPreview ? "rounded-none" : "rounded-md"} break-words relative cursor-pointer select-none`}
                                            style={isStandaloneHtmlPreview ? STANDALONE_CARD_BUBBLE_STYLE : undefined}
                                            data-ui={msg.role === "user" ? "bubble-user" : "bubble-bot"}
                                            data-msg-id={msg.id}
                                            {...(activeMessageId === msg.id ? { "data-active": "" } : {})}
                                            >
                                            {/* Message Actions Popup */}
                                            {activeMessageId === msg.id && renderBubbleContextMenu(msg)}

                                            <MessageBubble
                                                msg={renderMsg}
                                                displayContent={msg.displayProjected ? undefined : bubbleDisplayContent}
                                                charName={character?.name}
                                                userName={userIdentity?.name || "你"}
                                                groupSize={session.isGroup ? (session.participantIds?.length || 0) + (session.isSpectator ? 0 : 1) : undefined}
                                                onShowDetail={setMediaDetailMsg}
                                                characterId={msg.senderCharacterId || session.contactId}
                                                onUpdate={(updated) => setMessages(prev => prev.map(m => m.id === updated.id ? updated : m))}
                                                onSystemMessage={(text) => {
                                                    const sysMsg = pushChatMessage({
                                                        sessionId: session.id,
                                                        role: "system",
                                                        content: text,
                                                    });
                                                    setMessages(prev => [...prev, sysMsg]);
                                                }}
                                                onMusicPlay={handleMusicCardPlay}
                                                onActionSelect={(text) => chatTextInputRef.current?.appendText(text)}
                                                defaultTranslationExpanded={session.collapseBilingualTranslation !== false ? false : true}
                                            />
                                        </div>
                                        </div>}
                                        {msg.role !== "user" && !isSilentThought && !isEmptyBubble && hasFoldedPanel && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setExpandedThinkingId(prev => prev === msg.id ? null : msg.id); }}
                                                className="chat-monologue-heart bg-none border-none cursor-pointer p-1 ts-14 leading-none self-end shrink-0 -ml-2"
                                                {...(expandedMonologueId === msg.id ? { "data-active": "" } : {})}
                                                title="查看折叠状态"
                                                aria-label="查看折叠状态"
                                            >
                                                <svg viewBox="0 0 16 16" width="14" height="14" style={{display:"block"}}>
                                                    <path d="M8 14s-6-4-6-8c0-2.5 1.5-4 3.5-4 1 0 2 .5 2.5 1.5C8.5 2.5 9.5 2 10.5 2 12.5 2 14 3.5 14 6c0 4-6 8-6 8z" fill="currentColor"/>
                                                </svg>
                                            </button>
                                        )}
                                        {msg.role === "user" && !isEmptyBubble && (
                                            <div className="chat-msg-avatar w-[40px] h-[40px] rounded-[20px] bg-[var(--c-page-body-bg)] shrink-0 flex items-center justify-center overflow-hidden">
                                                {userIdentity?.avatarUrl ? (
                                                    <img src={userIdentity.avatarUrl} alt="Me" className="w-full h-full object-cover rounded-[20px]" />
                                                ) : (
                                                    <User size={20} color="var(--c-text)" />
                                                )}
                                            </div>
                                        )}
                                    </>
                                )}
                            </div>
                            {/* Voice message: text transcription bubble */}
                            {renderMsg.mediaType === "audio" && voiceTextIds.has(msg.id) && renderMsg.mediaData?.label && (
                                <div className={`chat-msg-wrapper`} data-role={uiRole(msg)} style={{ marginTop: -12 }}>
                                    {msg.role !== "user" && <div className="w-[40px] shrink-0" />}
                                    <div className="voice-msg-text-bubble">
                                        <BilingualTextBlock
                                            text={msg.displayProjected ? (renderMsg.mediaData?.label || "") : renderDisplayText(renderMsg.mediaData?.label || "", msg.role === "user" ? 1 : 2, false)}
                                            mode="markdown"
                                            defaultExpanded={session.collapseBilingualTranslation !== false ? false : true}
                                        />
                                    </div>
                                    {msg.role === "user" && <div className="w-[40px] shrink-0" />}
                                </div>
                            )}
                            {/* 状态栏：一律裸渲染，不套便利贴外框（自定义模式下交给用户的渲染代码，
                                否则 [状态栏] 原文直接走 markdown/内联 HTML，让 AI 直出的卡片自己当外框）。
                                状态值跟内心独白走（留在便利贴里）；这轮没有内心独白时便利贴不出现，
                                数值裸放在状态栏上方。 */}
                            {hasFoldedPanel && expandedMonologueId === msg.id
                                && (renderMsg.statusPanel || (!renderMsg.innerMonologue && cardStateValues && cardStateValues.length > 0)) && (
                                <div className="chat-status-bare">
                                    {!renderMsg.innerMonologue && cardStateValues && cardStateValues.length > 0 && (
                                        <StateValuesPanel stateValues={cardStateValues} />
                                    )}
                                    {renderMsg.statusPanel && (
                                        msg.statusRegionMode === "custom" && statusRegionCfg.renderHtml.trim() ? (
                                            <CustomStatusFrame html={statusRegionCfg.renderHtml} raw={renderMsg.statusPanel} />
                                        ) : (
                                            <BilingualTextBlock text={msg.displayProjected ? renderMsg.statusPanel : renderDisplayText(renderMsg.statusPanel, 6, false)} mode="markdown" defaultExpanded={session.collapseBilingualTranslation !== false ? false : true} />
                                        )
                                    )}
                                </div>
                            )}
                            {/* Inner monologue card (sticky note / journal style) */}
                            {hasFoldedPanel && expandedMonologueId === msg.id && renderMsg.innerMonologue && (
                                <div className="chat-thought-card">
                                    {/* Decorative washi tape */}
                                    <div className="chat-thought-tape-left" />
                                    <div className="chat-thought-tape-right" />
                                    {/* Title */}
                                    <div className="chat-thought-title">
                                        💭 内心独白
                                    </div>
                                    {/* State values panel */}
                                    {cardStateValues && cardStateValues.length > 0 && (
                                        <StateValuesPanel stateValues={cardStateValues} />
                                    )}
                                    <div className="chat-thought-body">
                                        <BilingualTextBlock text={msg.displayProjected ? renderMsg.innerMonologue : renderDisplayText(renderMsg.innerMonologue, 6, false)} mode="markdown" defaultExpanded={session.collapseBilingualTranslation !== false ? false : true} />
                                    </div>
                                    {/* Signature */}
                                    <div className="chat-thought-sig">
                                        — {session.isGroup ? (msg.senderName || "群成员") : (character?.name || "TA")}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
                {/* 流式生成预览：生成中实时显示原文增量，结束后由正式消息替换 */}
                {!offlineMode && streamPreview && (
                    <div className="chat-stream-preview" data-ui="stream-preview">
                        {session.isGroup && streamPreview.parts && streamPreview.parts.length > 0 ? (
                            /* 按空行定型：写完的段落立即成为独立气泡（与最终拆条同规则），只有最后一段带光标打字 */
                            streamPreview.parts.map((part, i) => {
                                const senderChar = groupCharMap.get(part.characterId) || character;
                                const isLastPart = i === (streamPreview.parts?.length ?? 0) - 1;
                                return part.texts.map((segText, j) => {
                                    const isTyping = isLastPart && j === part.texts.length - 1;
                                    return (
                                        <div key={`stream-${part.characterId}-${i}-${j}`} className="chat-msg-wrapper" data-role="assistant">
                                            <div className="chat-msg-avatar flex flex-col items-center gap-1 shrink-0">
                                                <div className="w-[40px] h-[40px] rounded-[20px] bg-[var(--c-input)] overflow-hidden">
                                                    {senderChar?.avatar ? <img src={senderChar.avatar} className="w-full h-full object-cover" alt="" /> : <ChatFallbackAvatar />}
                                                </div>
                                            </div>
                                            <div className="chat-msg-content-wrap flex flex-col min-w-0 max-w-[70%]">
                                                <span className="chat-group-sender-name">{part.characterName}</span>
                                                <div className="chat-bubble-role-assistant chat-stream-bubble break-words rounded-md px-3 py-2">
                                                    {/* 流式预览用轻量 pre-wrap 渲染：避免每帧跑 markdown/双语解析导致闪烁卡顿 */}
                                                    <div className="chat-stream-text whitespace-pre-wrap break-words">{segText}</div>
                                                    {isTyping && <span className="chat-stream-cursor" aria-hidden="true" />}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                });
                            })
                        ) : streamPreview.texts && streamPreview.texts.length > 0 ? (
                            streamPreview.texts.map((segText, j) => {
                                const isTyping = j === (streamPreview.texts?.length ?? 0) - 1;
                                return (
                                    <div key={`stream-seg-${j}`} className="chat-msg-wrapper" data-role="assistant">
                                        <div className="chat-msg-avatar flex flex-col items-center gap-1 shrink-0">
                                            <div className="w-[40px] h-[40px] rounded-[20px] bg-[var(--c-input)] overflow-hidden">
                                                {character?.avatar ? <img src={character.avatar} className="w-full h-full object-cover" alt="" /> : <ChatFallbackAvatar />}
                                            </div>
                                        </div>
                                        <div className="chat-msg-content-wrap flex flex-col min-w-0 max-w-[70%]">
                                            <div className="chat-bubble-role-assistant chat-stream-bubble break-words rounded-md px-3 py-2">
                                                {/* 流式预览用轻量 pre-wrap 渲染：避免每帧跑 markdown/双语解析导致闪烁卡顿 */}
                                                <div className="chat-stream-text whitespace-pre-wrap break-words">{segText}</div>
                                                {isTyping && <span className="chat-stream-cursor" aria-hidden="true" />}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        ) : null}
                    </div>
                )}
                {/* Scroll anchor: browser keeps this in view when content above changes height */}
                <div style={{ overflowAnchor: 'auto', height: 1 }} />
            </div>

            {/* Input Bar — absolute at bottom, same layer as header */}
            {isMultiSelectMode && !offlineMode && (
                <div className="chat-multi-select-bar chat-room-main-pane" data-ui="multi-select">
                    <button
                        type="button"
                        className="chat-multi-select-icon-btn"
                        onClick={cancelMultiSelect}
                        aria-label="退出多选"
                        title="退出多选"
                    >
                        <X size={20} strokeWidth={1.8} />
                    </button>
                    <div className="chat-multi-select-summary">
                        <strong>已选 {selectedMessageIds.size} 条</strong>
                        <span>
                            {multiDeleteTargetIds.length > selectedMessageIds.size
                                ? `实际删除 ${multiDeleteTargetIds.length} 条，含隐藏历史`
                                : `实际删除 ${multiDeleteTargetIds.length} 条`}
                        </span>
                    </div>
                    <button
                        type="button"
                        className="chat-multi-select-delete-btn"
                        disabled={selectedMessageIds.size === 0 || multiDeleteTargetIds.length === 0}
                        onClick={confirmMultiDelete}
                    >
                        <Trash2 size={18} strokeWidth={1.8} />
                        删除
                    </button>
                </div>
            )}
            {!isMultiSelectMode && (offlineMode ? (
                <OfflineTextInputBar
                    key={session.id}
                    ref={offlineTextInputRef}
                    isOfflineGenerating={isOfflineGenerating}
                    isSpectator={!!session.isGroup && !!session.isSpectator}
                    showEmojiPanel={showEmojiPanel}
                    enterToSendEnabled={enterToSendEnabled}
                    onToggleOfflineMode={toggleOfflineMode}
                    onCloseEmojiPanel={() => setShowEmojiPanel(false)}
                    onToggleEmojiPanel={() => { setShowEmojiPanel(!showEmojiPanel); setShowStickerPanel(false); setShowPlusMenu(false); }}
                    onSendText={handleOfflineSend}
                    onStopGeneration={clearOfflineGeneration}
                />
            ) : (
            <ChatTextInputBar
                ref={chatTextInputRef}
                characterName={character?.name || "对方"}
                characterId={session.contactId}
                offlineMeetingActive={!session.isGroup && kvGet(OFFLINE_INVITE_ACTIVE_SESSION_PREFIX + session.id) === "1"}
	                stickerCharacterIds={session.isGroup ? session.participantIds : undefined}
	                isGroup={!!session.isGroup}
	                isSpectator={!!session.isGroup && !!session.isSpectator}
	                muteUntilMs={session.isGroup && session.groupMutes?.[GROUP_SELF_KEY] ? new Date(session.groupMutes[GROUP_SELF_KEY]).getTime() : 0}
	                isGenerating={isGenerating}
	                theaterMode={theaterMode}
	                enterToSendEnabled={enterToSendEnabled}
	                quotingMessage={quotingMessage}
                showEmojiPanel={showEmojiPanel}
                showStickerPanel={showStickerPanel}
                showPlusMenu={showPlusMenu}
                customPlusActions={customPlusActions}
                onClearQuote={() => setQuotingMessage(null)}
                onToggleOfflineMode={toggleOfflineMode}
                onClosePanels={() => { setShowEmojiPanel(false); setShowStickerPanel(false); setShowPlusMenu(false); }}
	                onToggleEmojiPanel={() => { setShowEmojiPanel(!showEmojiPanel); setShowStickerPanel(false); setShowPlusMenu(false); }}
	                onToggleStickerPanel={() => { setShowStickerPanel(!showStickerPanel); setShowEmojiPanel(false); setShowPlusMenu(false); }}
	                onTogglePlusMenu={() => { setShowPlusMenu(!showPlusMenu); setShowEmojiPanel(false); setShowStickerPanel(false); }}
	                onToggleTheaterMode={toggleTheaterMode}
	                onCloseTheaterMode={closeTheaterMode}
	                onOpenRichModal={(modal) => { setShowPlusMenu(false); setRichModal(modal); }}
                onOpenCustomPlusAction={handleOpenCustomPlusAction}
                onStartVideoCall={() => { cancelFollowUp(session.id); setShowPlusMenu(false); setCallInitiator("user"); setShowVideoCall(true); }}
                onStartVoiceCall={() => { cancelFollowUp(session.id); setShowPlusMenu(false); setCallInitiator("user"); setShowVoiceCall(true); }}
                onSendText={handleSendText}
                onStopGeneration={clearStuckGeneration}
                onTriggerAIResponse={triggerAIResponse}
                onSendSticker={(name, url) => { setShowStickerPanel(false); sendRichMessage("sticker", { label: name, stickerUrl: url }); }}
            />
            ))}

            {showConfirmMultiDelete && (
                <ConfirmDialog
                    title="删除选中消息？"
                    dialogClassName="[&_p]:whitespace-pre-line"
                    message={(() => {
                        const targetIds = new Set(multiDeleteTargetIds);
                        const storedMessages = loadChatMessages(session.id);
                        const hasInviteRoot = storedMessages.some(m => targetIds.has(m.id) && isOfflineInviteRootMessage(m));
                        const count = multiDeleteTargetIds.length;
                        return hasInviteRoot
                            ? `删除的 ${count} 条消息中包含本次线下赴约的发起或变动消息，删除后将直接清除当前的赴约状态。若只想回退赴约状态，可取消并重试消息。`
                            : (count > selectedMessageIds.size
                                ? `将删除已选消息，并一并删除相邻已选消息之间的隐藏历史。实际删除 ${count} 条，删除后无法恢复。`
                                : `将删除已选的 ${count} 条消息，删除后无法恢复。`);
                    })()}
                    icon={AlertCircle}
                    variant="danger"
                    confirmLabel="删除"
                    cancelLabel="取消"
                    onConfirm={handleMultiDeleteConfirmed}
                    onCancel={() => setShowConfirmMultiDelete(false)}
                />
            )}

            {pendingInviteDeleteConfirm && (
                <div
                    className="modal-overlay"
                    data-ui="modal"
                    onClick={() => setPendingInviteDeleteConfirm(null)}
                >
                    <div
                        className="modal-dialog relative"
                        data-ui="modal-dialog"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="modal-header" data-ui="modal-header">
                            {pendingInviteDeleteConfirm.variant === "danger" && (
                                <div className="ui-icon-circle" data-variant="danger">
                                    <AlertCircle size={20} />
                                </div>
                            )}
                            <h3 className="modal-title">{pendingInviteDeleteConfirm.title}</h3>
                        </div>
                        <div className="modal-body text-center" data-ui="modal-body">
                            <p className="leading-relaxed whitespace-pre-line text-[14px]">
                                {pendingInviteDeleteConfirm.message}
                            </p>
                        </div>
                        <div className="modal-footer" data-ui="modal-footer">
                            <button
                                type="button"
                                className="ui-btn"
                                onClick={() => setPendingInviteDeleteConfirm(null)}
                            >
                                {pendingInviteDeleteConfirm.cancelLabel || "取消"}
                            </button>
                            <button
                                type="button"
                                className={`ui-btn ${pendingInviteDeleteConfirm.variant === "danger" ? "ui-btn-danger" : "ui-btn-primary"}`}
                                onClick={() => {
                                    const act = pendingInviteDeleteConfirm.onConfirm;
                                    setPendingInviteDeleteConfirm(null);
                                    act();
                                }}
                            >
                                {pendingInviteDeleteConfirm.confirmLabel || "删除"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {showConfirmExitOfflineInvite && (
                <div
                    className="modal-overlay"
                    data-ui="modal"
                    onClick={() => setShowConfirmExitOfflineInvite(false)}
                >
                    <div
                        className="modal-dialog relative"
                        data-ui="modal-dialog"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            type="button"
                            className="absolute top-3.5 right-3.5 w-7 h-7 rounded-full flex items-center justify-center bg-[var(--c-input,rgba(0,0,0,0.06))] hover:bg-[var(--c-input-border,rgba(0,0,0,0.12))] text-[var(--c-icon,#9ca3af)] hover:text-[var(--c-text-title,#111827)] transition-all cursor-pointer active:scale-90 shadow-xs"
                            onClick={() => setShowConfirmExitOfflineInvite(false)}
                            title="继续留在现场"
                            aria-label="继续留在现场"
                        >
                            <X size={16} />
                        </button>
                        <div className="modal-header" data-ui="modal-header">
                            <h3 className="modal-title">结束线下赴约？</h3>
                        </div>
                        <div className="modal-body text-center" data-ui="modal-body">
                            <p className="leading-relaxed">你可以选择暂时切回线上查阅消息，也可以正式结束本次线下赴约回到线上。</p>
                        </div>
                        <div className="modal-footer" data-ui="modal-footer">
                            <button
                                type="button"
                                className="ui-btn"
                                onClick={() => {
                                    setShowConfirmExitOfflineInvite(false);
                                    // 华提出的“暂时离开”：返回线上，不清除邀约，不发结束系统消息，不触发角色主动发信
                                    doToggleOfflineMode(false);
                                }}
                            >
                                暂时离开
                            </button>
                            <button
                                type="button"
                                className="ui-btn ui-btn-primary"
                                onClick={() => {
                                    setShowConfirmExitOfflineInvite(false);
                                    kvRemove(OFFLINE_INVITE_ACTIVE_SESSION_PREFIX + session.id);
                                    updateActiveOfflineInvite(null);
                                    // 华提出的黄金体验节点④【结束闭环】：结束线下赴约回到线上时，在聊天流中留下结束闭环系统记录
                                    const sysEndMsg = pushChatMessage({
                                        sessionId: session.id,
                                        role: "system",
                                        content: "本次线下赴约已结束，双方已返回线上",
                                        mediaType: "offline_invite_system_notice",
                                    });
                                    setMessages(prev => [...prev, sysEndMsg]);
                                    doToggleOfflineMode(true);
                                }}
                            >
                                结束赴约
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {offlineRetryConfirm && (
                <div
                    className="modal-overlay"
                    data-ui="modal"
                    onClick={() => setOfflineRetryConfirm(null)}
                >
                    <div
                        className="modal-dialog relative !max-w-[340px] !w-[90%]"
                        data-ui="modal-dialog"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="modal-header" data-ui="modal-header">
                            <div className="ui-icon-circle" data-variant="danger">
                                <AlertCircle size={20} />
                            </div>
                            <h3 className="modal-title">线下赴约回溯确认</h3>
                        </div>

                        <div className="modal-body text-center" data-ui="modal-body">
                            <p className="leading-relaxed text-[13.5px] text-[var(--c-text,#4b5563)]">
                                检测到您与角色当前正在线下赴约中。重试该消息将会回溯至当时的时间线，并直接结束当前的线下赴约。是否确认重试？
                            </p>
                        </div>

                        {/* 华专属审美：左右结构，左取消，右回溯并结束线下（单行舒展不折行，高度平齐对称） */}
                        <div className="modal-footer !flex-row !gap-2.5 !w-full" data-ui="modal-footer">
                            <button
                                type="button"
                                className="ui-btn !flex-1 whitespace-nowrap cursor-pointer select-none text-[13px]"
                                onClick={() => setOfflineRetryConfirm(null)}
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                className="ui-btn ui-btn-danger !flex-1 whitespace-nowrap cursor-pointer select-none text-[12.5px] !px-2"
                                onClick={() => void handleExecuteOfflineRetryMode()}
                            >
                                回溯并结束线下
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Settings Panel — portaled outside session-scoped CSS, preserves chat room mount */}
            {showSettings && wrapperRef.current?.parentElement && createPortal(
                <div className="chat-settings-layer absolute inset-0 z-50">
                    <ChatSettingsPanel
                        session={session}
                        onClose={() => {
                            setShowSettings(false);
                            // Reload messages in case history was cleared
                            syncMessagesFromStorage();
                        }}
                        onJumpToMessage={(messageId) => {
                            setShowSettings(false);
                            jumpToStoredMessage(messageId);
                        }}
                        onHistoryCleared={() => {
                            updateActiveOfflineInvite(null);
                            setIsOfflineInviteMinimized(false);
                            if (remindExpandTimerRef.current) {
                                clearTimeout(remindExpandTimerRef.current);
                                remindExpandTimerRef.current = null;
                            }
                            kvRemove(OFFLINE_INVITE_ACTIVE_SESSION_PREFIX + session.id);
                            kvRemove(PENDING_OFFLINE_INVITE_DECLINE_PREFIX + session.id);
                            syncMessagesFromStorage();
                            showChatToast("已清空聊天记录与赴约状态");
                        }}
                        onToolHistoryCleared={syncMessagesFromStorage}
                        offlineHistoryBusy={isOfflineGenerating}
                        onOfflineHistoryCleared={() => {
                            setOfflineTurns([]);
                            setOfflineVisibleCount(OFFLINE_INITIAL_LOAD);
                            setPendingOfflineUserText("");
                            offlineGenerationInputRef.current = "";
                            setActiveOfflineTarget(null);
                            setContextMenuAnchor(null);
                            setEditingOfflineTarget(null);
                            setEditingOfflineContent("");
                            showChatToast("已清空线下聊天记录");
                        }}
                        onDeleteFriend={() => onBack()}
                        onSessionDeleted={() => {
                            setShowSettings(false);
                            (onDeleted ?? onBack)();
                        }}
                    />
                </div>,
                wrapperRef.current.parentElement
            )}

            {activeCustomChatPlus && activeCustomChatPlus.presentation === "none" && (
                <div className="chat-custom-app-headless" aria-hidden="true">
                    <CustomAppRunner
                        app={activeCustomChatPlus.app}
                        launchContext={activeCustomChatPlus.launchContext}
                        embedded
                        onClose={() => setActiveCustomChatPlus(null)}
                        onNotice={showChatToast}
                    />
                </div>
            )}

            {activeCustomChatPlus && activeCustomChatPlus.presentation !== "none" && (
                <div
                    className={`chat-custom-app-layer is-${activeCustomChatPlus.presentation}`}
                    role="presentation"
                    onClick={() => setActiveCustomChatPlus(null)}
                >
                    <div
                        className="chat-custom-app-shell"
                        role="dialog"
                        aria-modal="true"
                        aria-label={activeCustomChatPlus.action.label}
                        style={{
                            "--chat-custom-app-panel-height": normalizeCustomPanelHeight(activeCustomChatPlus.action.panelHeight) ?? undefined,
                        } as React.CSSProperties}
                        onClick={event => event.stopPropagation()}
                    >
                        <div className="chat-custom-app-head">
                            <div className="chat-custom-app-title">
                                <span className="chat-custom-app-icon" aria-hidden="true">
                                    {activeCustomChatPlus.app.iconDataUrl ? <img src={activeCustomChatPlus.app.iconDataUrl} alt="" /> : <Blocks size={18} />}
                                </span>
                                <span>{activeCustomChatPlus.action.label}</span>
                            </div>
                            <button
                                type="button"
                                className="chat-custom-app-close"
                                onClick={() => setActiveCustomChatPlus(null)}
                                aria-label="关闭"
                            >
                                <X size={18} strokeWidth={2} />
                            </button>
                        </div>
                        <div className="chat-custom-app-body">
                            <CustomAppForegroundBoundary
                                key={activeCustomChatPlus.app.id}
                                appName={activeCustomChatPlus.app.name}
                                appId={activeCustomChatPlus.app.id}
                                appVersion={activeCustomChatPlus.app.version}
                                manifestId={activeCustomChatPlus.app.manifest?.id}
                                closeLabel="返回聊天"
                                onClose={() => setActiveCustomChatPlus(null)}
                            >
                                <CustomAppRunner
                                    app={activeCustomChatPlus.app}
                                    launchContext={activeCustomChatPlus.launchContext}
                                    embedded
                                    onClose={() => setActiveCustomChatPlus(null)}
                                    onNotice={showChatToast}
                                />
                            </CustomAppForegroundBoundary>
                        </div>
                    </div>
                </div>
            )}

            {/* Rich Media Input Modals */}
            {richModal === "voice_msg" && (
                <VoiceRecordModal
                    characterId={session.contactId}
                    onSend={(text, audioDataUrl) => {
                        setRichModal(null);
                        sendRichMessage("audio", { label: text }, "", audioDataUrl);
                    }}
                    onClose={() => setRichModal(null)}
                />
            )}
            {richModal === "text_photo" && (
                <TextPhotoModal
                    onSend={(text) => { setRichModal(null); sendRichMessage("image", { label: text }); }}
                    onClose={() => setRichModal(null)}
                />
            )}
            {richModal === "photo" && (
                <PhotoInputModal
                    onSend={(desc, imageDataUrl) => { setRichModal(null); sendRichMessage("image", { label: desc }, "", imageDataUrl); }}
                    onClose={() => setRichModal(null)}
                />
            )}
            {richModal === "gift" && (
                <GiftPickerModal
                    gifts={availableShoppingGifts}
                    isGroup={session.isGroup}
                    recipients={groupCharacters}
                    onSend={(gift, recipient) => {
                        const sent = sendShoppingGiftMessage(gift, recipient);
                        if (sent) setRichModal(null);
                    }}
                    onClose={() => setRichModal(null)}
                />
            )}
            {richModal === "red_packet" && (
                <RedPacketModal
                    mode="red_packet"
                    isGroup={session.isGroup}
                    onSend={(amount, label, count) => {
                        const sent = sendRichMessage("red_packet", { amount, label, status: "pending", count: count || 1 });
                        if (sent) setRichModal(null);
                    }}
                    onClose={() => setRichModal(null)}
                />
            )}
            {richModal === "transfer_target" && session.isGroup && (
                <TransferTargetModal
                    participants={groupCharacters}
                    onSelect={(char) => {
                        setTransferTarget(char);
                        setRichModal("transfer");
                    }}
                    onClose={() => setRichModal(null)}
                />
            )}
            {richModal === "transfer" && (
                <RedPacketModal
                    mode="transfer"
                    onSend={(amount, label) => {
                        if (session.isGroup && transferTarget) {
                            const sent = sendRichMessage("transfer", {
                                amount, label, status: "pending",
                                senderName: userIdentity?.name || "你",
                                recipientId: transferTarget.id,
                                recipientName: transferTarget.name,
                            });
                            if (sent) {
                                setRichModal(null);
                                setTransferTarget(null);
                            }
                        } else {
                            const sent = sendRichMessage("transfer", { amount, label, status: "pending" });
                            if (sent) setRichModal(null);
                        }
                    }}
                    onClose={() => { setRichModal(null); setTransferTarget(null); }}
                />
            )}
            {richModal === "location" && (
                <LocationInputModal
                    onSend={(loc) => { setRichModal(null); sendRichMessage("location", { label: loc }); }}
                    onClose={() => setRichModal(null)}
                />
            )}
            {richModal === "system_instruction" && (
                <SystemInstructionModal
                    onSend={(text) => {
                        const sent = sendSystemInstruction(text);
                        if (sent) setRichModal(null);
                    }}
                    onClose={() => setRichModal(null)}
                />
            )}

            {/* 思维链底部弹窗（Claude app 风格） */}
            {reasoningSheetText !== null && (
                <div
                    className="modal-overlay modal-overlay-bottom"
                    data-ui="modal"
                    role="dialog"
                    aria-modal="true"
                    aria-label="思考过程"
                    onClick={() => setReasoningSheetText(null)}
                >
                    <div className="modal-sheet chat-reasoning-sheet" onClick={(e) => e.stopPropagation()}>
                        <div className="chat-reasoning-sheet-handle" />
                        <div className="chat-reasoning-sheet-header">
                            <button
                                type="button"
                                className="chat-reasoning-sheet-close"
                                onClick={handleTranslateReasoning}
                                aria-label={reasoningTranslation ? "隐藏译文" : "翻译思考过程"}
                                title={reasoningTranslation ? "隐藏译文" : "翻译思考过程"}
                            >
                                {reasoningTranslating
                                    ? <Loader2 size={18} strokeWidth={2} className="animate-spin" />
                                    : <Languages size={18} strokeWidth={2} {...(reasoningTranslation ? { color: "var(--c-icon-active)" } : {})} />}
                            </button>
                            <span className="chat-reasoning-sheet-title">思考过程</span>
                            <button
                                type="button"
                                className="chat-reasoning-sheet-close"
                                onClick={() => setReasoningSheetText(null)}
                                aria-label="关闭"
                            >
                                <X size={18} strokeWidth={2} />
                            </button>
                        </div>
                        <div className="chat-reasoning-sheet-body">
                            {reasoningTranslateError && (
                                <div className="chat-reasoning-translate-error">{reasoningTranslateError}</div>
                            )}
                            {reasoningTranslation && (
                                <div className="chat-reasoning-view-switch">
                                    {([["zh", "中文"], ["orig", "原文"], ["both", "对照"]] as const).map(([mode, text]) => (
                                        <button
                                            key={mode}
                                            type="button"
                                            className="chat-reasoning-view-btn"
                                            {...(reasoningViewMode === mode ? { "data-active": "" } : {})}
                                            onClick={() => setReasoningViewMode(mode)}
                                        >{text}</button>
                                    ))}
                                </div>
                            )}
                            {reasoningTranslation && reasoningViewMode !== "orig" && (
                                <div className={reasoningViewMode === "both" ? "chat-reasoning-translation" : undefined}>
                                    <BilingualTextBlock text={reasoningTranslation} mode="markdown" defaultExpanded />
                                </div>
                            )}
                            {(reasoningViewMode !== "zh" || !reasoningTranslation) && (
                                <BilingualTextBlock text={reasoningSheetText} mode="markdown" defaultExpanded />
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Red Packet / Transfer Detail Modal */}
            {mediaDetailMsg && (
                <MediaDetailModal
                    msg={mediaDetailMsg}
                    userName={userIdentity?.name || "你"}
                    groupSize={session.isGroup ? (session.participantIds?.length || 0) + (session.isSpectator ? 0 : 1) : undefined}
                    onAccept={(updatedMsg, sysText, actionType) => {
                        const walletUpdatedMsg = updatedMsg.role === "assistant"
                            ? creditIncomingMoneyMessage(updatedMsg, actionType)
                            : updatedMsg;
                        setMessages(prev => prev.map(m => m.id === walletUpdatedMsg.id ? walletUpdatedMsg : m));
                        setMediaDetailMsg(null);
                        const claimerN = userIdentity?.name || "你";
                        const ownerN = walletUpdatedMsg.senderName || (walletUpdatedMsg.role === "assistant" ? (character?.name || "对方") : claimerN);
                        const sysMsg = pushChatMessage({
                            sessionId: session.id, role: "user", content: sysText,
                            mediaType: actionType as ChatMessage["mediaType"],
                            ...(session.isGroup ? { mediaData: { claimer: claimerN, owner: ownerN }, senderName: claimerN } : {}),
                        });
                        setMessages(prev => [...prev, sysMsg]);
                    }}
                    onClose={() => setMediaDetailMsg(null)}
                />
            )}

            {editingOfflineTarget && (
                <div className="chat-html-overlay" onClick={() => { setEditingOfflineTarget(null); setEditingOfflineContent(""); }}>
                    <div
                        className="g-card w-[min(84vw,420px)] max-h-[78vh] p-4 flex flex-col gap-3"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex flex-col gap-1">
                                <span className="menu-label">
                                    {editingOfflineTarget.role === "user" ? "编辑线下输入" : "编辑线下回复"}
                                </span>
                                <span className="menu-desc !mt-0">
                                    {editingOfflineTarget.role === "user"
                                        ? "保存后会更新这一轮线下历史"
                                        : "保存后会重新解析 content 和摘要，并更新短期记忆事件流"}
                                </span>
                            </div>
                            <button
                                onClick={() => { setEditingOfflineTarget(null); setEditingOfflineContent(""); }}
                                className="ui-bare-btn text-[var(--c-icon)] ts-18 leading-none"
                                type="button"
                            >✕</button>
                        </div>
                        <textarea
                            autoFocus
                            value={editingOfflineContent}
                            onChange={(e) => setEditingOfflineContent(e.target.value)}
                            className="w-full min-h-[220px] max-h-[52vh] resize-none rounded-2xl border border-[var(--c-border)] bg-[var(--c-input)] px-4 py-3 ts-14 text-[var(--c-text)] outline-none"
                        />
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => { setEditingOfflineTarget(null); setEditingOfflineContent(""); }}
                                className="ui-btn ui-btn-outline"
                                type="button"
                            >取消</button>
                            <button
                                onClick={handleOfflineEditSave}
                                disabled={!editingOfflineContent.trim()}
                                className="ui-btn ui-btn-primary"
                                type="button"
                            >保存</button>
                        </div>
                    </div>
                </div>
            )}

            {editingMessageId && (
                <div className="chat-html-overlay" onClick={() => { setEditingMessageId(null); setEditingContent(""); }}>
                    <div
                        className="g-card w-[min(84vw,420px)] max-h-[78vh] p-4 flex flex-col gap-3"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex flex-col gap-1">
                                <span className="menu-label">{editingSystemInstruction ? "编辑系统指令" : "编辑消息"}</span>
                                <span className="menu-desc !mt-0">{editingSystemInstruction ? "保存后会按当前位置更新后续上下文" : "保存后会同步更新聊天记录和后续上下文"}</span>
                            </div>
                            <button
                                onClick={() => { setEditingMessageId(null); setEditingContent(""); }}
                                className="ui-bare-btn text-[var(--c-icon)] ts-18 leading-none"
                                type="button"
                            >✕</button>
                        </div>
                        <textarea
                            autoFocus
                            value={editingContent}
                            onChange={(e) => setEditingContent(e.target.value)}
                            className="w-full min-h-[180px] max-h-[52vh] resize-none rounded-2xl border border-[var(--c-border)] bg-[var(--c-input)] px-4 py-3 ts-14 text-[var(--c-text)] outline-none"
                        />
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => { setEditingMessageId(null); setEditingContent(""); }}
                                className="ui-btn ui-btn-outline"
                                type="button"
                            >取消</button>
                            <button
                                onClick={handleEditMessageSave}
                                disabled={!editingContent.trim()}
                                className="ui-btn ui-btn-primary"
                                type="button"
                            >保存</button>
                        </div>
                    </div>
                </div>
            )}

            {(editingResponseBatchId || editingResponseRoundId) && (
                <div className="chat-html-overlay" onClick={() => { setEditingResponseBatchId(null); setEditingResponseRoundId(null); setEditingResponseContent(""); }}>
                    <div
                        className="g-card w-[min(84vw,420px)] max-h-[78vh] p-4 flex flex-col gap-3"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex flex-col gap-1">
                                <span className="menu-label">编辑本次回复</span>
                                <span className="menu-desc !mt-0">保存后会按新的编辑文本重新拆分这次 AI 回复</span>
                            </div>
                            <button
                                onClick={() => { setEditingResponseBatchId(null); setEditingResponseRoundId(null); setEditingResponseContent(""); }}
                                className="ui-bare-btn text-[var(--c-icon)] ts-18 leading-none"
                                type="button"
                            >✕</button>
                        </div>
                        <textarea
                            autoFocus
                            value={editingResponseContent}
                            onChange={(e) => setEditingResponseContent(e.target.value)}
                            className="w-full min-h-[220px] max-h-[52vh] resize-none rounded-2xl border border-[var(--c-border)] bg-[var(--c-input)] px-4 py-3 ts-14 text-[var(--c-text)] outline-none"
                        />
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => { setEditingResponseBatchId(null); setEditingResponseRoundId(null); setEditingResponseContent(""); }}
                                className="ui-btn ui-btn-outline"
                                type="button"
                            >取消</button>
                            <button
                                onClick={handleEditResponseSave}
                                disabled={!editingResponseContent.trim()}
                                className="ui-btn ui-btn-primary"
                                type="button"
                            >保存</button>
                        </div>
                    </div>
                </div>
            )}

            {cloudDeletePending && (
                <div className="modal-overlay" data-ui="modal" role="alertdialog" aria-modal="true" aria-label="正在删除云端记录">
                    <div className="modal-dialog" data-ui="modal-dialog" onClick={(e) => e.stopPropagation()}>
                        <Loader2 size={30} className="animate-spin text-[var(--c-accent)]" />
                        <div className="flex flex-col items-center gap-2 text-center">
                            <h3 className="modal-title">正在删除云端记录</h3>
                            <p className="menu-desc !mt-0">
                                正在删除 {cloudDeletePending.count} 条微信云端记录，请不要关闭页面。
                            </p>
                            <p className="menu-desc !mt-0">
                                超过 {Math.round(WEIXIN_CLOUD_DELETE_TIMEOUT_MS / 1000)} 秒未完成会自动判定失败。
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {imageGenerationFailure && (
                <GeneratedImageErrorDialog
                    message={imageGenerationFailure}
                    onClose={() => setImageGenerationFailure(null)}
                />
            )}

            {activeOfflineInvite && !isOfflineInviteMinimized && !offlineMode && (
                <OfflineInviteModal
                    invite={activeOfflineInvite}
                    character={character}
                    onAccept={handleAcceptOfflineInvite}
                    onDecline={handleDeclineOfflineInvite}
                    onMinimize={handleMinimizeOfflineInvite}
                    onEarlyArrive={handleEarlyArriveOfflineInvite}
                />
            )}

            {/* Chat toast notification (overlay, does not affect layout) */}
            {chatToast && (
                <div className="chat-toast-overlay">
                    <div className="wp-toast chat-toast-floating">
                        {chatToast === "加载音乐中..." ? (
                            <span className="ui-loading-toast-content">
                                <span className="ui-loading-spinner" />
                                <span>{chatToast}</span>
                            </span>
                        ) : chatToast}
                    </div>
                </div>
            )}

        </div >
    );
}
