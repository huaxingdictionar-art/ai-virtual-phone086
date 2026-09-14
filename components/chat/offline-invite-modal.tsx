"use client";

import React, { useState, useEffect } from "react";
import type { Character } from "@/lib/character-types";
import { User, MapPin, Sparkles, Navigation, Clock, Undo2 } from "lucide-react";

export type OfflineInviteData = {
    direction: "he_comes" | "i_go";
    place?: string;
    reason?: string;
    onTheWayMessage?: string;
    transitCardMessage?: string;
    arrivedMessage?: string;
    arrivalCardMessage?: string;
    status: "pending" | "on_the_way" | "arrived";
    isEarlyArrived?: boolean;
    /** 提前到达时冻结的剩余分钟数（用于回溯时精准无损断点续存，绝不被磨蹭时间蚕食） */
    frozenRemainingMinutes?: number;
    startTime?: number;
    durationMinutes?: number;
    sourceBatchId?: string;
    /** 初次发起邀约时的地点（如“你身边”；若最初是身边，即使中途改了坐标，到达时标题依然保持“已到达你身边”的情感浪漫） */
    initialPlace?: string;
    /** 卡片情绪视觉主题：default（经典蓝白）| alert（心跳白红·危机/吃醋）| forced（强行动身·暂以白红渲染，未来黑红） */
    theme?: "default" | "alert" | "forced";
    /** 初次发起邀约的批次ID（全场唯一生命之根，永不覆盖） */
    initialBatchId?: string;
    /** 该赴约生命周期中涉及的所有批次ID（包含发起、改地点、在途、到达等） */
    relatedBatchIds?: string[];
};

export function getRemainingMinutes(startTime?: number, durationMinutes: number = 15): number {
    if (!startTime) return 0;
    const elapsedMs = Date.now() - startTime;
    const remainingMs = durationMinutes * 60 * 1000 - elapsedMs;
    return Math.max(0, Math.ceil(remainingMs / 60000));
}

function formatReason(text?: string): string {
    if (!text) return "";
    const trimmed = text.trim();
    if (!trimmed) return "";
    if (/[。！？…~!?”’]$/.test(trimmed)) return trimmed;
    return trimmed + "。";
}

function getModalDescription(invite: OfflineInviteData): string {
    if (invite.status === "arrived") {
        // 到达状态：优先展示角色以第一人称现场亲口所说的私房心语/叮嘱，绝无生硬第三人称旁白
        if (invite.arrivalCardMessage?.trim()) {
            return `“${formatReason(invite.arrivalCardMessage)}”`;
        }
        if (invite.arrivedMessage?.trim()) {
            return `“${formatReason(invite.arrivedMessage)}”`;
        }
        return invite.direction === "he_comes"
            ? "对方已到达约定地点，正在等待与你碰面。"
            : "对方正在约定的地方等候你的到来。";
    }
    if (invite.status === "on_the_way") {
        // 在途状态：优先展示角色以第一人称表达的在途私房心语（5段格式专属），绝不与微信发信重复
        if (invite.transitCardMessage?.trim() && invite.transitCardMessage.trim() !== invite.onTheWayMessage?.trim()) {
            return `“${formatReason(invite.transitCardMessage)}”`;
        }
        if (invite.transitCardMessage?.trim()) {
            return `“${formatReason(invite.transitCardMessage)}”`;
        }
        // 若缺少独立在途心语，退回展示提议初衷，避免与微信聊天框里刚刚发出的动身报备逐字重复
        if (invite.reason?.trim() && invite.reason.trim() !== invite.onTheWayMessage?.trim()) {
            return `“${formatReason(invite.reason)}”`;
        }
        return invite.direction === "he_comes"
            ? "对方正在赶来的路上，请稍作等候。"
            : "对方正在约定的地方等候你的到来。";
    }
    if (invite.reason?.trim()) {
        return `“${formatReason(invite.reason)}”`;
    }
    return invite.direction === "he_comes"
        ? "对方想要来见你，正在等待你的回应。"
        : "对方正在约定的地方等候你的到来。";
}

/** 🌸 华特调的灵动三睫毛眼眸图标：神采醒目、线条克制雅致、瞳孔带警觉探查微动 */
function EyelashEyeIcon({ className = "", size = 16.5 }: { className?: string; size?: number }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
        >
            {/* 杏仁眼型轮廓 */}
            <path d="M2 13.5C2 13.5 5.5 7.5 12 7.5C18.5 7.5 22 13.5 22 13.5C22 13.5 18.5 19.5 12 19.5C5.5 19.5 2 13.5 2 13.5Z" />
            {/* 灵动眼球/瞳孔：定睛凝视 ➔ 警觉微探 ➔ 瞬间回锁正中 */}
            <circle cx="12" cy="13.5" r="2.8">
                <animate
                    attributeName="cx"
                    values="12; 12; 10.6; 10.6; 13.4; 13.4; 12; 12"
                    keyTimes="0; 0.45; 0.53; 0.65; 0.73; 0.85; 0.92; 1"
                    dur="4s"
                    repeatCount="indefinite"
                />
            </circle>
            {/* 三根生动翘起的眼睫毛：根部顺应外沿，无丝毫内渗 */}
            <path d="M12 6.6V2.6" />
            <path d="M6.5 8.2L4.2 4.4" />
            <path d="M17.5 8.2L19.8 4.4" />
        </svg>
    );
}

/** 🌸 华特调的灵动三睫毛闭目眼眸图标：微弯闭目、非礼勿视、三根垂睫 */
function ClosedEyelashEyeIcon({ className = "", size = 16.5 }: { className?: string; size?: number }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
        >
            {/* 优雅微弯的闭目眼睑弧线 */}
            <path d="M2 11.5C2 11.5 5.5 16.5 12 16.5C18.5 16.5 22 11.5 22 11.5" />
            {/* 三根生动垂下的眼睫毛 */}
            <path d="M12 16.5V21" />
            <path d="M7 14.8L4.5 18.8" />
            <path d="M17 14.8L19.5 18.8" />
        </svg>
    );
}

/** 🌸 华特调的律动心电波形图标：0.6秒波形起伏爆发 + 0.8秒舒张平静待机（1.4秒黄金心率） */
function HeartbeatWaveIcon({ className = "", size = 16 }: { className?: string; size?: number }) {
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.3"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={className}
            style={{ overflow: "visible" }}
        >
            <g style={{ transformOrigin: "12px 12px" }}>
                {/* 伴随波形爆发的 Lub-Dub 双拍心悸鼓动（前 0.6 秒完成跳动，后 0.8 秒舒张） */}
                <animateTransform
                    attributeName="transform"
                    type="scale"
                    values="1; 1.25; 0.96; 1.16; 1; 1"
                    keyTimes="0; 0.11; 0.18; 0.27; 0.43; 1"
                    dur="1.4s"
                    repeatCount="indefinite"
                />
                {/* 动态波形变轨：前 0.6 秒爆发 QRS 冲顶与抚平，后 0.8 秒保持平稳呼吸基线 */}
                <path d="M2 12H6L7.5 11.5L9 12.5L10.5 12L12 12L13.5 12L15 12L16.5 12L18 12H22">
                    <animate
                        attributeName="d"
                        values="
                            M2 12H6L7.5 11.5L9 12.5L10.5 12L12 12L13.5 12L15 12L16.5 12L18 12H22;
                            M2 12H5L6.8 9.5L8.5 17L11 3.5L13.5 19.5L15.2 8.5L16.5 13.5L18 12H22;
                            M2 12H6L7.5 13L9.5 10L11.5 15.5L13.5 8L15.5 14L17 11.5L18.5 12H22;
                            M2 12H6L8 12L10 11.5L12 12.5L14 11.8L16 12.2L18 12H22;
                            M2 12H6L7.5 11.5L9 12.5L10.5 12L12 12L13.5 12L15 12L16.5 12L18 12H22
                        "
                        keyTimes="0; 0.13; 0.27; 0.43; 1"
                        dur="1.4s"
                        repeatCount="indefinite"
                    />
                </path>
            </g>
        </svg>
    );
}

interface OfflineInviteModalProps {
    invite: OfflineInviteData;
    character?: Character | null;
    onAccept: () => void;
    onDecline: () => void;
    onMinimize: () => void;
    onEarlyArrive?: () => void;
}

export function OfflineInviteModal({
    invite,
    character,
    onAccept,
    onDecline,
    onMinimize,
    onEarlyArrive,
}: OfflineInviteModalProps) {
    const isHeComes = invite.direction === "he_comes";
    const charName = character?.name || "对方";

    // 状态机：pending（待答应）| on_the_way（在途中）| arrived（已到达）
    const isPending = invite.status === "pending";
    const isOnTheWay = invite.status === "on_the_way";
    const isArrived = invite.status === "arrived";

    const [remainingMins, setRemainingMins] = useState(() =>
        getRemainingMinutes(invite.startTime, invite.durationMinutes || 15),
    );

    useEffect(() => {
        if (!isOnTheWay) return;
        const update = () => {
            const mins = getRemainingMinutes(invite.startTime, invite.durationMinutes || 15);
            setRemainingMins(mins);
        };
        update();
        const timer = setInterval(update, 10000);
        return () => clearInterval(timer);
    }, [isOnTheWay, invite.startTime, invite.durationMinutes]);

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/45 backdrop-blur-sm animate-in fade-in duration-200"
            data-ui="offline-invite-overlay"
            onClick={onMinimize}
        >
            <div
                className="relative w-full max-w-[310px] rounded-2xl bg-[var(--c-panel,#ffffff)] border border-[var(--c-panel-border,rgba(0,0,0,0.08))] shadow-2xl p-5 flex flex-col items-center gap-4 text-center select-none animate-in zoom-in-95 duration-200"
                data-ui="offline-invite-dialog"
                onClick={(e) => e.stopPropagation()}
            >
                {/* 右上角返回键（弯箭头） */}
                <button
                    type="button"
                    onClick={onMinimize}
                    className="absolute top-3.5 right-3.5 w-8 h-8 rounded-full flex items-center justify-center bg-[var(--c-input,rgba(0,0,0,0.05))] hover:bg-[var(--c-input-border,rgba(0,0,0,0.1))] text-[var(--c-icon,#9ca3af)] hover:text-[var(--c-text-title,#111827)] transition-all cursor-pointer active:scale-90 shadow-sm"
                    aria-label={isOnTheWay ? "收起状态" : "稍后处理"}
                    title={isOnTheWay ? "收起状态" : "稍后处理"}
                >
                    <Undo2 size={17} />
                </button>

                {/* 角色头像与状态光晕徽章 */}
                {(() => {
                    const isAlertTheme = invite.theme === "alert" || invite.theme === "forced";
                    // 🌸 华专属审美升级：采用纯正鲜艳的 Apple Danger 红（#FF3B30），并注入非常柔和浅漫的红光外溢光晕！
                    const badgeBg = isAlertTheme
                        ? "bg-[var(--c-danger,#FF3B30)] shadow-[0_2px_8px_rgba(255,59,48,0.4)]"
                        : "bg-[var(--c-primary,#2563eb)] shadow-[0_2px_8px_rgba(37,99,235,0.35)]";
                    const badgeBorder = isAlertTheme ? "border-[var(--c-danger,#FF3B30)]/30" : "border-[var(--c-primary,#2563eb)]/30";
                    const tagStyle = isAlertTheme
                        ? "bg-[var(--c-danger,#FF3B30)]/10 text-[var(--c-danger,#FF3B30)] border border-[var(--c-danger,#FF3B30)]/20"
                        : "bg-[var(--c-primary,#2563eb)]/10 text-[var(--c-primary,#2563eb)] border border-[var(--c-primary,#2563eb)]/20";
                    const accentText = isAlertTheme ? "text-[var(--c-danger,#FF3B30)]" : "text-[var(--c-primary,#2563eb)]";
                    const primaryBtn = isAlertTheme
                        ? "bg-[var(--c-danger,#FF3B30)] text-white shadow-[0_4px_16px_rgba(255,59,48,0.38),inset_0_1px_1px_rgba(255,255,255,0.2)] hover:opacity-95"
                        : "bg-[var(--c-primary,#2563eb)] text-white shadow-[0_4px_16px_rgba(37,99,235,0.35),inset_0_1px_1px_rgba(255,255,255,0.2)] hover:opacity-95";

                    return (
                        <>
                            <div className="relative mt-2">
                                <div className={`w-16 h-16 rounded-full overflow-hidden border-2 ${badgeBorder} shadow-md flex items-center justify-center bg-[var(--c-input,#f3f4f6)]`}>
                                    {character?.avatar ? (
                                        <img src={character.avatar} alt={charName} className="w-full h-full object-cover" />
                                    ) : (
                                        <User size={30} className="text-[var(--c-text,#9ca3af)]" />
                                    )}
                                </div>
                                <div className={`absolute -bottom-1 -right-1 w-6 h-6 rounded-full ${badgeBg} text-white flex items-center justify-center shadow`}>
                                    {isOnTheWay ? (
                                        <Navigation size={12} className="animate-pulse" />
                                    ) : isArrived ? (
                                        <Sparkles size={12} />
                                    ) : (
                                        <MapPin size={13} />
                                    )}
                                </div>
                            </div>

                            {/* 标题与情境标签 */}
                            <div className="flex flex-col items-center gap-1">
                                <div className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${tagStyle}`}>
                                    {invite.theme === "forced" ? (
                                        <EyelashEyeIcon size={16.5} className="shrink-0" />
                                    ) : isAlertTheme ? (
                                        <HeartbeatWaveIcon size={16} className="shrink-0" />
                                    ) : (
                                        <Sparkles size={11} className="shrink-0" />
                                    )}
                                    <span>
                                        {isOnTheWay
                                            ? (invite.theme === "forced" ? "你已无法阻拦" : "在途赶来中")
                                            : isArrived
                                            ? (invite.theme === "forced" ? "Ta来了……" : (invite.isEarlyArrived ? "已提前到达" : "已经到达"))
                                            : isHeComes
                                            ? (isAlertTheme ? "紧急赶来" : "奔赴提议")
                                            : (isAlertTheme ? "紧急邀约" : "线下邀约")}
                                    </span>
                                </div>
                                {(() => {
                                    const isOriginByYourSide = invite.initialPlace === "你身边" || (!invite.initialPlace && invite.place === "你身边");
                                    const arrivedPlaceText = isOriginByYourSide
                                        ? "你身边"
                                        : (invite.place ? `「${invite.place}」` : "");
                                    return (
                                        <h3 className="text-[16px] font-bold text-[var(--c-text-title,#111827)] mt-1">
                                            {isOnTheWay
                                                ? (invite.theme === "forced" ? `${charName} 正直奔你而来` : `${charName} 正在赶来的路上`)
                                                : isArrived
                                                ? `${charName} ${invite.isEarlyArrived ? "已提前到达" : "已到达"}${arrivedPlaceText}`
                                                : isHeComes
                                                ? (isAlertTheme ? `${charName} 执意来见你` : `${charName} 提议来见你`)
                                                : (isAlertTheme ? `${charName} “邀请你”赴约` : `${charName} 邀请你赴约`)}
                                        </h3>
                                    );
                                })()}
                                <div className="inline-flex items-center justify-center gap-1 text-[11px] text-[var(--c-text,#9ca3af)] mt-0.5">
                                    <span>按右上角</span>
                                    <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-[var(--c-input,rgba(0,0,0,0.06))] text-[var(--c-text,#6b7280)]">
                                        <Undo2 size={9.5} />
                                    </span>
                                    <span>{isOnTheWay ? "可收起状态" : isArrived ? "可收起通知" : "可稍后处理"}</span>
                                </div>
                            </div>

                            {/* 说明卡片与在途倒计时 */}
                            <div className="w-full rounded-xl bg-[var(--c-input,#f3f4f6)]/70 p-3 text-left flex flex-col gap-1.5 border border-[var(--c-input-border,rgba(0,0,0,0.04))]">
                                {isOnTheWay ? (
                                    <div className={`flex items-center gap-2 text-xs font-semibold ${accentText}`}>
                                        <Clock size={14} className="shrink-0" />
                                        <span>预计约 {remainingMins > 0 ? remainingMins : 1} 分钟后到达</span>
                                    </div>
                                ) : null}

                                {invite.place && (
                                    <div className="text-xs text-[var(--c-text-title,#111827)] font-medium flex items-center gap-1">
                                        <MapPin size={12} className={`${accentText} shrink-0`} />
                                        <span>奔赴地点：{invite.place}</span>
                                    </div>
                                )}

                                <div className="text-xs text-[var(--c-text,#4b5563)] leading-relaxed italic line-clamp-3">
                                    {getModalDescription(invite)}
                                </div>
                            </div>

                            {/* 操作按钮组 */}
                            <div className="flex items-center gap-2.5 w-full mt-1">
                                {isPending ? (
                                    <>
                                        <button
                                            type="button"
                                            onClick={onDecline}
                                            className="flex-1 py-2.5 px-3 rounded-xl border border-[var(--c-border,#d1d5db)] text-xs font-medium text-[var(--c-text,#4b5563)] hover:bg-[var(--c-input,#f3f4f6)] active:scale-95 transition-all cursor-pointer"
                                        >
                                            拒绝Ta
                                        </button>
                                        <button
                                            type="button"
                                            onClick={onAccept}
                                            className={`flex-1 py-2.5 px-3 rounded-xl ${primaryBtn} text-xs font-semibold active:scale-95 transition-all cursor-pointer`}
                                        >
                                            {isHeComes ? "答应Ta" : "去见Ta"}
                                        </button>
                                    </>
                                ) : isOnTheWay ? (
                                    <>
                                        <button
                                            type="button"
                                            onClick={onMinimize}
                                            className="flex-1 py-2.5 px-3 rounded-xl border border-[var(--c-border,#d1d5db)] text-xs font-medium text-[var(--c-text,#4b5563)] hover:bg-[var(--c-input,#f3f4f6)] active:scale-95 transition-all cursor-pointer"
                                        >
                                            线上继续聊
                                        </button>
                                        <button
                                            type="button"
                                            onClick={onEarlyArrive || onAccept}
                                            className={`flex-1 py-2.5 px-3 rounded-xl ${primaryBtn} text-xs font-semibold active:scale-95 transition-all cursor-pointer`}
                                        >
                                            已经到了/去见Ta
                                        </button>
                                    </>
                                ) : (
                                    /* isArrived */
                                    <button
                                        type="button"
                                        onClick={onAccept}
                                        className={`w-full py-2.5 px-4 rounded-xl ${primaryBtn} text-xs font-semibold active:scale-95 transition-all cursor-pointer`}
                                    >
                                        去见Ta
                                    </button>
                                )}
                            </div>
                        </>
                    );
                })()}
            </div>
        </div>
    );
}

interface OfflineInviteCapsuleProps {
    invite: OfflineInviteData;
    character?: Character | null;
    onClick: () => void;
    onAccept?: () => void;
}

export function OfflineInviteCapsule({
    invite,
    character,
    onClick,
    onAccept,
}: OfflineInviteCapsuleProps) {
    const isHeComes = invite.direction === "he_comes";
    const charName = character?.name || "对方";
    const isOnTheWay = invite.status === "on_the_way";
    const isArrived = invite.status === "arrived";

    const [remainingMins, setRemainingMins] = useState(() =>
        getRemainingMinutes(invite.startTime, invite.durationMinutes || 15),
    );

    useEffect(() => {
        if (!isOnTheWay) return;
        const update = () => {
            const mins = getRemainingMinutes(invite.startTime, invite.durationMinutes || 15);
            setRemainingMins(mins);
        };
        update();
        const timer = setInterval(update, 10000);
        return () => clearInterval(timer);
    }, [isOnTheWay, invite.startTime, invite.durationMinutes]);

    const isAlertTheme = invite.theme === "alert" || invite.theme === "forced";
    const pingDotBg = isAlertTheme ? "bg-[var(--c-danger,#FF3B30)]" : "bg-[var(--c-primary,#2563eb)]";
    const solidDotBg = isAlertTheme ? "bg-[var(--c-danger,#FF3B30)]" : "bg-[var(--c-primary,#2563eb)]";
    const btnBg = isAlertTheme
        ? "bg-[var(--c-danger,#FF3B30)] shadow-[0_2px_8px_rgba(255,59,48,0.38)] hover:opacity-95"
        : "bg-[var(--c-primary,#2563eb)] shadow-[0_2px_8px_rgba(37,99,235,0.35)] hover:opacity-90";
    const actionText = isAlertTheme ? "text-[var(--c-danger,#FF3B30)]" : "text-[var(--c-primary,#2563eb)]";

    return (
        <div
            onClick={onClick}
            className="w-fit max-w-[92%] mx-auto px-3.5 py-1.5 rounded-full bg-[var(--c-panel,#ffffff)]/95 backdrop-blur-md border border-[var(--c-panel-border,rgba(0,0,0,0.12))] shadow-md flex items-center gap-2 cursor-pointer select-none hover:scale-[1.02] active:scale-[0.98] transition-all"
            data-ui="offline-invite-capsule"
            title="点击查看邀约详情"
        >
            <span className="relative flex h-2 w-2 shrink-0">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${pingDotBg}`} />
                <span className={`relative inline-flex rounded-full h-2 w-2 ${solidDotBg}`} />
            </span>
            <span className="text-xs font-medium text-[var(--c-text-title,#111827)] truncate">
                {isOnTheWay
                    ? `${charName}正在赶来，约剩${remainingMins > 0 ? remainingMins : 1}分钟后到达`
                    : isArrived
                    ? (() => {
                        const isOriginByYourSide = invite.initialPlace === "你身边" || (!invite.initialPlace && invite.place === "你身边");
                        const arrivedPlaceText = isOriginByYourSide
                            ? "你身边"
                            : (invite.place ? (invite.place === "你身边" ? "你身边" : `「${invite.place}」`) : "");
                        const prefix = isAlertTheme ? "" : "✨ ";
                        return `${prefix}${charName} ${invite.isEarlyArrived ? "已提前到达" : "已到达"}${arrivedPlaceText}`;
                    })()
                    : isHeComes
                    ? (isAlertTheme ? `${charName} 执意来见你（待赴约）` : `${charName} 提议来见你（待赴约）`)
                    : (isAlertTheme ? `${charName} 要求你前来赴约` : `${charName} 正在等候你赴约`)}
            </span>
            {onAccept && (isArrived || !isHeComes) ? (
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onAccept();
                    }}
                    className={`text-[11px] text-white font-semibold px-2 py-0.5 rounded-full active:scale-95 transition-all shrink-0 cursor-pointer shadow-sm ${btnBg}`}
                >
                    去见Ta
                </button>
            ) : (
                <span className={`text-[10px] font-semibold shrink-0 ${actionText}`}>
                    {isOnTheWay ? "查看" : isArrived ? "去见Ta" : "处理"}
                </span>
            )}
        </div>
    );
}
