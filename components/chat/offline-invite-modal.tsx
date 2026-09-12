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
                <div className="relative mt-2">
                    <div className="w-16 h-16 rounded-full overflow-hidden border-2 border-[var(--c-primary,#2563eb)]/30 shadow-md flex items-center justify-center bg-[var(--c-input,#f3f4f6)]">
                        {character?.avatar ? (
                            <img src={character.avatar} alt={charName} className="w-full h-full object-cover" />
                        ) : (
                            <User size={30} className="text-[var(--c-text,#9ca3af)]" />
                        )}
                    </div>
                    <div className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-[var(--c-primary,#2563eb)] text-white flex items-center justify-center shadow">
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
                    <div className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-[var(--c-primary,#2563eb)]/10 text-[var(--c-primary,#2563eb)]">
                        <Sparkles size={11} />
                        <span>
                            {isOnTheWay
                                ? "在途赶来中"
                                : isArrived
                                ? (invite.isEarlyArrived ? "已提前到达" : "已经到达")
                                : isHeComes
                                ? "奔赴提议"
                                : "线下邀约"}
                        </span>
                    </div>
                    <h3 className="text-[16px] font-bold text-[var(--c-text-title,#111827)] mt-1">
                        {isOnTheWay
                            ? `${charName} 正在赶来的路上`
                            : isArrived
                            ? `${charName} ${invite.isEarlyArrived ? "已提前到达" : "已到达"}${invite.place ? (invite.place === "你身边" ? "「你身边」" : `「${invite.place}」`) : ""}`
                            : isHeComes
                            ? `${charName} 提议来找你`
                            : `${charName} 邀请你赴约`}
                    </h3>
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
                        <div className="flex items-center gap-2 text-xs font-semibold text-[var(--c-primary,#2563eb)]">
                            <Clock size={14} className="shrink-0" />
                            <span>预计约 {remainingMins > 0 ? remainingMins : 1} 分钟后到达</span>
                        </div>
                    ) : null}

                    {invite.place && (
                        <div className="text-xs text-[var(--c-text-title,#111827)] font-medium flex items-center gap-1">
                            <MapPin size={12} className="text-[var(--c-primary,#2563eb)] shrink-0" />
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
                                className="flex-1 py-2.5 px-3 rounded-xl bg-[var(--c-primary,#2563eb)] text-white text-xs font-semibold shadow hover:opacity-90 active:scale-95 transition-all cursor-pointer"
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
                                className="flex-1 py-2.5 px-3 rounded-xl bg-[var(--c-primary,#2563eb)] text-white text-xs font-semibold shadow hover:opacity-90 active:scale-95 transition-all cursor-pointer"
                            >
                                已经到了/去见Ta
                            </button>
                        </>
                    ) : (
                        /* isArrived */
                        <button
                            type="button"
                            onClick={onAccept}
                            className="w-full py-2.5 px-4 rounded-xl bg-[var(--c-primary,#2563eb)] text-white text-xs font-semibold shadow hover:opacity-90 active:scale-95 transition-all cursor-pointer"
                        >
                            去见Ta
                        </button>
                    )}
                </div>
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

    return (
        <div
            onClick={onClick}
            className="w-fit max-w-[92%] mx-auto px-3.5 py-1.5 rounded-full bg-[var(--c-panel,#ffffff)]/95 backdrop-blur-md border border-[var(--c-panel-border,rgba(0,0,0,0.12))] shadow-md flex items-center gap-2 cursor-pointer select-none hover:scale-[1.02] active:scale-[0.98] transition-all"
            data-ui="offline-invite-capsule"
            title="点击查看邀约详情"
        >
            <span className="relative flex h-2 w-2 shrink-0">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[var(--c-primary,#2563eb)] opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--c-primary,#2563eb)]" />
            </span>
            <span className="text-xs font-medium text-[var(--c-text-title,#111827)] truncate">
                {isOnTheWay
                    ? `${charName}正在赶来，约剩${remainingMins > 0 ? remainingMins : 1}分钟后到达`
                    : isArrived
                    ? `✨ ${charName} ${invite.isEarlyArrived ? "已提前到达" : "已到达"}${invite.place ? (invite.place === "你身边" ? "「你身边」" : `「${invite.place}」`) : ""}`
                    : isHeComes
                    ? `${charName} 提议来见你（待赴约）`
                    : `${charName} 正在等候你赴约`}
            </span>
            {onAccept && (isArrived || !isHeComes) ? (
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onAccept();
                    }}
                    className="text-[11px] bg-[var(--c-primary,#2563eb)] text-white font-semibold px-2 py-0.5 rounded-full hover:opacity-90 active:scale-95 transition-all shrink-0 cursor-pointer shadow-sm"
                >
                    去见Ta
                </button>
            ) : (
                <span className="text-[10px] text-[var(--c-primary,#2563eb)] font-semibold shrink-0">
                    {isOnTheWay ? "查看" : isArrived ? "去见Ta" : "处理"}
                </span>
            )}
        </div>
    );
}
