"use client";

// 独家特调 · 对局画面：角色封面打底 + 三段蒙版，AI 正文无气泡全宽、
// 玩家右侧气泡、小票全宽卡；全程无任何标签徽章，保沉浸。
// 装饰材料的 CSS 以 <style> 注入本画面容器（认 .mix-* 官方语义类）。

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, CornerDownRight, RotateCcw, Send, Undo2 } from "lucide-react";
import { continueMix, generateMixReply, rerollMixReply, undoMixLastRound } from "@/lib/mixology/engine";
import { getMixMaterial, getMixSession } from "@/lib/mixology/storage";
import type { MixSession, MixTurn } from "@/lib/mixology/types";
import { MixProseView } from "./prose-view";
import { MixTicketFrame } from "./ticket-frame";

type GameProps = {
    sessionId: string;
    onBack: () => void;
    onToast: (message: string) => void;
};

function AssistantTurn({ turn, ticketHtml }: { turn: MixTurn; ticketHtml?: string }) {
    return (
        <>
            {turn.text ? <MixProseView text={turn.text} /> : null}
            {ticketHtml && turn.ticketRaw ? (
                <div className="mix-ticket-wrap">
                    <MixTicketFrame html={ticketHtml} raw={turn.ticketRaw} />
                </div>
            ) : null}
        </>
    );
}

export function MixologyGame({ sessionId, onBack, onToast }: GameProps) {
    const [session, setSession] = useState<MixSession | null>(() => getMixSession(sessionId));
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const abortRef = useRef<AbortController | null>(null);

    // 封面 / 小票渲染代码 / 装饰 CSS：按方案槽位从酒柜现取
    const assets = useMemo(() => {
        if (!session) return { cover: "", ticketHtml: undefined as string | undefined, garnishCss: "" };
        const slots = session.recipe.slots;
        const character = slots.character ? getMixMaterial(slots.character) : null;
        const ticket = slots.ticket ? getMixMaterial(slots.ticket) : null;
        const garnish = slots.garnish ? getMixMaterial(slots.garnish) : null;
        return {
            cover: character?.cover ?? "",
            ticketHtml: ticket?.kind === "ticket" ? ticket.renderHtml : undefined,
            garnishCss: garnish?.kind === "garnish" ? garnish.css : "",
        };
    }, [session]);

    useEffect(() => {
        const el = scrollRef.current;
        if (el) el.scrollTop = el.scrollHeight;
    }, [session?.turns.length, busy]);

    useEffect(() => () => abortRef.current?.abort(), []);

    if (!session) {
        return (
            <div className="mix-game">
                <div className="mix-game-header">
                    <button type="button" className="mix-icon-btn" onClick={onBack} aria-label="返回"><ChevronLeft size={20} /></button>
                    <div className="mix-game-title">对局不存在</div>
                    <span style={{ width: 32 }} />
                </div>
            </div>
        );
    }

    const run = async (action: (signal: AbortSignal) => Promise<unknown>) => {
        if (busy) return;
        const controller = new AbortController();
        abortRef.current = controller;
        setBusy(true);
        try {
            await action(controller.signal);
            setSession(getMixSession(sessionId));
        } catch (error) {
            setSession(getMixSession(sessionId));
            const message = error instanceof Error ? error.message : "生成失败，请重试。";
            if (!controller.signal.aborted) onToast(message);
        } finally {
            setBusy(false);
        }
    };

    const handleSend = () => {
        const text = input.trim();
        if (!text) return;
        setInput("");
        void run((signal) => generateMixReply(sessionId, text, signal));
    };

    const lastTurn = session.turns[session.turns.length - 1];
    const canReroll = !busy && lastTurn?.role === "assistant" && session.turns.length > 1;
    const canUndo = !busy && session.turns.some((t) => t.role === "user");

    return (
        <div className="mix-game">
            {assets.garnishCss ? <style>{assets.garnishCss}</style> : null}
            <div className="mix-game-bg" style={assets.cover ? { backgroundImage: `url(${assets.cover})` } : undefined} />
            <div className="mix-game-header">
                <button type="button" className="mix-icon-btn" onClick={onBack} aria-label="返回"><ChevronLeft size={20} /></button>
                <div className="mix-game-title">{session.charName}</div>
                <button
                    type="button"
                    className="mix-icon-btn"
                    onClick={() => {
                        try {
                            undoMixLastRound(sessionId);
                            setSession(getMixSession(sessionId));
                        } catch (error) {
                            onToast(error instanceof Error ? error.message : "撤回失败");
                        }
                    }}
                    disabled={!canUndo}
                    aria-label="撤回上一轮"
                >
                    <Undo2 size={17} />
                </button>
            </div>
            <div className="mix-game-scroll" ref={scrollRef}>
                {session.turns.map((turn) =>
                    turn.role === "user" ? (
                        <div className="mix-user-turn" key={turn.id}>
                            <div className="mix-user-bubble">{turn.text}</div>
                        </div>
                    ) : (
                        <AssistantTurn turn={turn} ticketHtml={assets.ticketHtml} key={turn.id} />
                    ),
                )}
                {busy ? (
                    <div className="mix-game-thinking" aria-label="生成中">
                        <span /><span /><span />
                    </div>
                ) : null}
            </div>
            <div className="mix-game-inputbar">
                <button
                    type="button"
                    className="mix-icon-btn"
                    onClick={() => void run((signal) => rerollMixReply(sessionId, signal))}
                    disabled={!canReroll}
                    aria-label="重说"
                    title="重说"
                >
                    <RotateCcw size={18} />
                </button>
                <button
                    type="button"
                    className="mix-icon-btn"
                    onClick={() => void run((signal) => continueMix(sessionId, signal))}
                    disabled={busy}
                    aria-label="继续"
                    title="继续"
                >
                    <CornerDownRight size={18} />
                </button>
                <textarea
                    className="mix-game-input"
                    rows={1}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            handleSend();
                        }
                    }}
                    placeholder={busy ? "调制中…" : "说点什么…"}
                    disabled={busy}
                />
                <button type="button" className="mix-send-btn" onClick={handleSend} disabled={busy || !input.trim()} aria-label="发送">
                    <Send size={16} />
                </button>
            </div>
        </div>
    );
}
