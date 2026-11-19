"use client";

// 聊天提示音：新消息 / 发送消息 / 来电 / 致电 / 挂断。
// 配置优先级：私聊角色专属（单独会话 sounds，在私聊聊天信息里设置）
// ＞ 全局聊天信息（ChatAppSettings.globalChatSounds）。
// 音频来源支持用户自定义上传文件（IndexedDB 资产）、音频 URL，
// 以及内置的 Web Audio API 原生纯净合成音效（开箱即自带悦耳音效，无需下载外部 MP3）。

import { useEffect, useRef } from "react";
import {
    CHAT_MESSAGE_PUSHED_EVENT,
    findChatSessionById,
    getActiveChatSessionId,
    resolveChatSoundConfig,
    type ChatMessage,
    type ChatSession,
    type ChatSoundKind,
} from "./chat-storage";
import { getChatAudioFromIndexedDB } from "./chat-asset-storage";

/** 提示音解析用的会话上下文（支持传入 ChatSession 或局部对象） */
type SessionLike = Partial<ChatSession> | null | undefined;

// ── Web Audio 原生音效合成引擎（开箱即自带，零延迟、零体积、纯净治愈） ──
let audioCtx: AudioContext | null = null;
function getAudioContext(): AudioContext | null {
    if (typeof window === "undefined") return null;
    try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return null;
        if (!audioCtx) audioCtx = new AudioCtx();
        if (audioCtx.state === "suspended") {
            audioCtx.resume().catch(() => {});
        }
        return audioCtx;
    } catch {
        return null;
    }
}

/** 内置原生发送音效：清脆灵动的短促轻弹声 (sendMessage) */
export function playDefaultSendMessageSound(): void {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = "sine";
        // 频率从 450Hz 快速微跃到 750Hz
        osc.frequency.setValueAtTime(450, now);
        osc.frequency.exponentialRampToValueAtTime(750, now + 0.05);

        // 音量包络
        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(now);
        osc.stop(now + 0.07);
    } catch {
        // 静默
    }
}

/** 内置原生新消息音效：温暖清雅的双音和弦 "叮-咚" (newMessage) */
export function playDefaultNewMessageSound(): void {
    const ctx = getAudioContext();
    if (!ctx) return;
    try {
        const now = ctx.currentTime;

        // 第一个音 "叮" (880Hz, A5)
        const osc1 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        osc1.type = "sine";
        osc1.frequency.setValueAtTime(880, now);
        gain1.gain.setValueAtTime(0.16, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
        osc1.connect(gain1);
        gain1.connect(ctx.destination);
        osc1.start(now);
        osc1.stop(now + 0.13);

        // 第二个音 "咚" (1175Hz, D6 纯净微挑)
        const osc2 = ctx.createOscillator();
        const gain2 = ctx.createGain();
        osc2.type = "sine";
        osc2.frequency.setValueAtTime(1174.66, now + 0.07);
        gain2.gain.setValueAtTime(0.001, now);
        gain2.gain.setValueAtTime(0.18, now + 0.07);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
        osc2.connect(gain2);
        gain2.connect(ctx.destination);
        osc2.start(now + 0.07);
        osc2.stop(now + 0.25);
    } catch {
        // 静默
    }
}

// ── 音频来源解析 ────────────────────────────────────────────────
// IndexedDB 资产每次读取都要开库，data URL 也可能较大：按资产 id 缓存。

const dataUrlCache = new Map<string, string>();

async function resolveChatSoundSrc(kind: ChatSoundKind, session?: SessionLike): Promise<string | null> {
    const config = resolveChatSoundConfig(kind, session);
    if (!config.value) return null;
    // 兼容历史数据 / 手写配置：直接是 data: 或 http(s) 地址时原样使用
    if (config.value.startsWith("data:") || /^https?:/i.test(config.value)) return config.value;
    const cached = dataUrlCache.get(config.value);
    if (cached) return cached;
    const dataUrl = await getChatAudioFromIndexedDB(config.value);
    if (!dataUrl) return null;
    dataUrlCache.set(config.value, dataUrl);
    return dataUrl;
}

/** 设置页“试听”：优先播放自定义音频，未配置时试听内置默认音效 */
export async function previewChatSound(kind: ChatSoundKind, session?: SessionLike): Promise<void> {
    const src = await resolveChatSoundSrc(kind, session);
    if (src) {
        const audio = new Audio(src);
        audio.play().catch(() => {});
        return;
    }
    // 默认内置试听
    if (kind === "sendMessage") {
        playDefaultSendMessageSound();
    } else if (kind === "newMessage") {
        playDefaultNewMessageSound();
    }
}

/** 播放一次提示音（优先自定义，未配置自定义时使用内置纯净合成音效） */
export async function playChatSoundOnce(kind: ChatSoundKind, session?: SessionLike): Promise<void> {
    const config = resolveChatSoundConfig(kind, session);
    // 只要没有显式设为 false，默认视为开启
    if (config.enabled === false) return;

    const src = await resolveChatSoundSrc(kind, session);
    if (src) {
        const audio = new Audio(src);
        audio.play().catch(() => {});
        return;
    }

    // 无自定义音频时，若为发送或新消息，播放开箱即用的默认音效
    if (kind === "sendMessage") {
        playDefaultSendMessageSound();
    } else if (kind === "newMessage") {
        playDefaultNewMessageSound();
    }
}

// ── 循环铃声（来电等待 / 致电等待）──────────────────────────────
type ActiveSoundLoop = { audio: HTMLAudioElement; token: object };
let activeSoundLoop: ActiveSoundLoop | null = null;
let soundLoopSeq = 0;

function stopActiveSoundLoop(): void {
    if (!activeSoundLoop) return;
    activeSoundLoop.audio.pause();
    activeSoundLoop = null;
}

/** 循环播放某提示音（如铃声），返回停止函数；传会话时优先用该角色专属配置 */
export function startChatSoundLoop(kind: ChatSoundKind, session?: SessionLike): () => void {
    const config = resolveChatSoundConfig(kind, session);
    if (config.enabled === false) return () => {};
    let cancelled = false;
    const token = {};
    const mySeq = ++soundLoopSeq;
    void resolveChatSoundSrc(kind, session).then(src => {
        if (cancelled || !src) return;
        if (mySeq !== soundLoopSeq) return;
        stopActiveSoundLoop();
        const audio = new Audio(src);
        audio.loop = true;
        activeSoundLoop = { audio, token };
        audio.play().catch(() => {});
    });
    return () => {
        cancelled = true;
        if (activeSoundLoop?.token === token) stopActiveSoundLoop();
    };
}

// ── 通话屏声音 Hook（来电铃声 / 致电等待音 / 挂断音）───────────
export function useCallScreenSounds(opts: { initiator: "user" | "character"; callState: string; session?: SessionLike }): void {
    const hangupPlayedRef = useRef(false);
    const realMountRef = useRef(false);
    const sessionRef = useRef(opts.session);
    sessionRef.current = opts.session;

    useEffect(() => {
        if (opts.callState !== "CONNECTING") return;
        return startChatSoundLoop(opts.initiator === "character" ? "incomingCall" : "outgoingCall", sessionRef.current);
    }, [opts.callState, opts.initiator]);

    useEffect(() => {
        if (opts.callState === "ENDED" && !hangupPlayedRef.current) {
            hangupPlayedRef.current = true;
            void playChatSoundOnce("hangup", sessionRef.current);
        }
    }, [opts.callState]);

    useEffect(() => {
        const timer = setTimeout(() => { realMountRef.current = true; }, 300);
        return () => {
            clearTimeout(timer);
            if (realMountRef.current && !hangupPlayedRef.current) {
                hangupPlayedRef.current = true;
                void playChatSoundOnce("hangup", sessionRef.current);
            }
        };
    }, []);
}

// ── 新消息 / 发送消息音效监听 ───────────────────────────────────
const CALL_SYS_MSG_RE = /\[(?:我|.*?):?(?:向.*?)?(?:发起|挂断|拒绝|取消)了(?:群)?(?:语音|视频)通话/;

const SILENT_ASSISTANT_MEDIA_TYPES = new Set([
    "tool_call",
    "tool_result",
    "tool_notice",
    "memory_write_request",
    "voice_call",
    "video_call",
    "system_instruction",
    "group_admin_notice",
]);

const SILENT_ORIGINS = new Set(["reading_discuss", "story_floating_phone"]);

let miniChatSoundSessionId: string | null = null;

export function setMiniChatSoundSessionId(sessionId: string | null): void {
    miniChatSoundSessionId = sessionId;
}

function isSessionBeingWatched(sessionId: string): boolean {
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return false;
    return getActiveChatSessionId() === sessionId || miniChatSoundSessionId === sessionId;
}

// 10秒内连续消息防轰炸
const BURST_NOTIFY_WINDOW_MS = 10_000;
const burstLastSoundAt = new Map<string, number>();

function getBurstKey(msg: ChatMessage): string {
    return msg.senderCharacterId || msg.sessionId;
}

function shouldPlayNewMessageSound(msg: ChatMessage, notifyOnce: boolean): boolean {
    if (SILENT_ASSISTANT_MEDIA_TYPES.has(msg.mediaType || "")) return false;
    if (msg.origin && SILENT_ORIGINS.has(msg.origin)) return false;
    if (CALL_SYS_MSG_RE.test(msg.content)) return false;
    if (!msg.content.trim() && !msg.mediaType) return false;
    // 防轰炸：10秒内只响一次
    if (notifyOnce) {
        const key = getBurstKey(msg);
        const last = burstLastSoundAt.get(key) ?? 0;
        if (Date.now() - last < BURST_NOTIFY_WINDOW_MS) return false;
    }
    return true;
}

function markBurstPlayed(msg: ChatMessage): void {
    burstLastSoundAt.set(getBurstKey(msg), Date.now());
}

/**
 * 安装全局消息提示音监听（新消息音效 + 发送消息音效）。
 * 挂在常驻的壳组件上一次即可，返回卸载函数。
 */
export function installChatSoundListener(): () => void {
    if (typeof window === "undefined") return () => {};

    const onPushed = (e: Event) => {
        const detail = (e as CustomEvent<{ message?: ChatMessage }>).detail;
        const msg = detail?.message;
        if (!msg) return;

        if (msg.role === "user") {
            if (msg.origin && SILENT_ORIGINS.has(msg.origin)) return;
            if (CALL_SYS_MSG_RE.test(msg.content)) return;
            void playChatSoundOnce("sendMessage", findChatSessionById(msg.sessionId));
            return;
        }

        if (msg.role === "assistant") {
            const session = findChatSessionById(msg.sessionId);
            const config = resolveChatSoundConfig("newMessage", session);
            if (config.enabled === false) return;
            // 默认防轰炸开启（notifyOncePerBurst !== false）
            const notifyOnce = config.notifyOncePerBurst !== false;
            if (!shouldPlayNewMessageSound(msg, notifyOnce)) return;
            markBurstPlayed(msg);
            void playChatSoundOnce("newMessage", session);
        }
    };

    window.addEventListener(CHAT_MESSAGE_PUSHED_EVENT, onPushed);
    return () => window.removeEventListener(CHAT_MESSAGE_PUSHED_EVENT, onPushed);
}
