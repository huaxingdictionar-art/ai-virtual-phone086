"use client";

import { useState, useEffect, useRef } from "react";
import { Sparkles, X, Plus, Trash2, Check, AlertCircle, Loader2, Edit3 } from "lucide-react";
import type { Character } from "@/lib/character-types";
import {
    ChatPokeConfig,
    MAX_POKE_ITEMS_COUNT,
    normalizePokeConfig,
    resolvePokeTemplate,
} from "@/lib/chat-poke-types";
import { generateAllPokesViaLLM } from "@/lib/chat-poke-generator";
import { Toggle } from "@/components/ui/form";

interface ChatPokeSettingsDialogProps {
    open: boolean;
    onClose: () => void;
    character: Character;
    userName?: string;
    initialConfig?: ChatPokeConfig;
    onSave: (newConfig: ChatPokeConfig) => void;
    onTriggerPokeOnce?: (pokeText: string) => void;
}

const QUICK_VERBS = ["拍了拍", "戳了戳", "揉了揉", "捏了捏", "敲了敲", "抱了抱"];

export function ChatPokeSettingsDialog({
    open,
    onClose,
    character,
    userName = "你",
    initialConfig,
    onSave,
    onTriggerPokeOnce,
}: ChatPokeSettingsDialogProps) {
    const [config, setConfig] = useState<Required<ChatPokeConfig>>(() => normalizePokeConfig(initialConfig));
    const [activeTab, setActiveTab] = useState<"user" | "char">("user");
    const [userDraft, setUserDraft] = useState("");
    const [charDraft, setCharDraft] = useState("");
    const [isGenerating, setIsGenerating] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    const userInputRef = useRef<HTMLInputElement>(null);
    const charInputRef = useRef<HTMLInputElement>(null);

    // 同步外部配置
    useEffect(() => {
        if (open) {
            setConfig(normalizePokeConfig(initialConfig));
            setErrorMessage(null);
            setSuccessMessage(null);
        }
    }, [open, initialConfig]);

    if (!open) return null;

    const charName = character?.name || "对方";

    // 一键全部生成（双方各 5 条）
    const handleGenerateAll = async () => {
        try {
            setIsGenerating(true);
            setErrorMessage(null);
            setSuccessMessage(null);

            const result = await generateAllPokesViaLLM(character, userName);
            setConfig(prev => ({
                ...prev,
                userPokes: result.userPokes.slice(0, MAX_POKE_ITEMS_COUNT),
                charPokes: result.charPokes.slice(0, MAX_POKE_ITEMS_COUNT),
            }));
            setSuccessMessage("已结合当前人设生成双方各 5 条精选文案！");
            setTimeout(() => setSuccessMessage(null), 3000);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "AI 生成失败，请稍后重试";
            setErrorMessage(msg);
        } finally {
            setIsGenerating(false);
        }
    };

    // 添加「你拍TA」文案
    const handleAddUserPoke = () => {
        const text = userDraft.trim();
        if (!text) return;
        if (config.userPokes.length >= MAX_POKE_ITEMS_COUNT) {
            setErrorMessage(`文案池最多容纳 ${MAX_POKE_ITEMS_COUNT} 条，请先删除不需要的句子`);
            return;
        }
        setConfig(prev => ({
            ...prev,
            userPokes: [...prev.userPokes, text].slice(0, MAX_POKE_ITEMS_COUNT),
        }));
        setUserDraft("");
        setErrorMessage(null);
    };

    // 添加「TA拍你」文案
    const handleAddCharPoke = () => {
        const text = charDraft.trim();
        if (!text) return;
        if (config.charPokes.length >= MAX_POKE_ITEMS_COUNT) {
            setErrorMessage(`文案池最多容纳 ${MAX_POKE_ITEMS_COUNT} 条，请先删除不需要的句子`);
            return;
        }
        setConfig(prev => ({
            ...prev,
            charPokes: [...prev.charPokes, text].slice(0, MAX_POKE_ITEMS_COUNT),
        }));
        setCharDraft("");
        setErrorMessage(null);
    };

    // 删除文案
    const handleDeletePoke = (type: "user" | "char", index: number) => {
        setConfig(prev => {
            if (type === "user") {
                const next = [...prev.userPokes];
                next.splice(index, 1);
                return { ...prev, userPokes: next };
            } else {
                const next = [...prev.charPokes];
                next.splice(index, 1);
                return { ...prev, charPokes: next };
            }
        });
        setErrorMessage(null);
    };

    // 点击某一条文案回填至输入框微调
    const handleSelectDraft = (type: "user" | "char", text: string) => {
        if (type === "user") {
            setUserDraft(text);
            setTimeout(() => userInputRef.current?.focus(), 50);
        } else {
            setCharDraft(text);
            setTimeout(() => charInputRef.current?.focus(), 50);
        }
    };

    // 点击动词药丸快速填入
    const handleQuickVerb = (verb: string) => {
        if (activeTab === "user") {
            setUserDraft(`{user} ${verb} {char} `);
            setTimeout(() => userInputRef.current?.focus(), 50);
        } else {
            setCharDraft(`{char} ${verb} {user} `);
            setTimeout(() => charInputRef.current?.focus(), 50);
        }
    };

    // 保存并关闭
    const handleSave = () => {
        onSave(config);
        onClose();
    };

    // 保存并顺手拍TA一下
    const handleSaveAndPoke = () => {
        onSave(config);
        if (onTriggerPokeOnce) {
            const pool = config.userPokes.length > 0 ? config.userPokes : ["{user} 拍了拍 {char}"];
            const picked = pool[Math.floor(Math.random() * pool.length)];
            const text = resolvePokeTemplate(picked, userName, charName);
            onTriggerPokeOnce(text);
        }
        onClose();
    };

    return (
        <div
            className="fixed inset-0 z-[120] flex items-center justify-center p-3.5 bg-black/50 backdrop-blur-[4px] animate-fade-in select-none"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div
                className="w-full max-w-[390px] max-h-[88vh] flex flex-col rounded-[24px] bg-[var(--c-page-bg,#ffffff)] text-[var(--c-text,#1f2937)] shadow-2xl border border-black/5 dark:border-white/10 overflow-hidden transition-all"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 pt-4 pb-2.5 border-b border-[var(--c-border,#e5e7eb)] shrink-0 bg-[var(--c-page-bg,#ffffff)]">
                    <div>
                        <h3 className="text-[17px] font-bold leading-tight flex items-center gap-1.5">
                            <span>拍一拍设置</span>
                            <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-[var(--c-input,#f2f2f7)] text-[var(--c-sub,#8e8e93)]">
                                双方各限 5 条
                            </span>
                        </h3>
                        <p className="text-[11.5px] text-[var(--c-sub,#8e8e93)] mt-0.5">
                            双击头像触发 · 手机线上虚拟互动，非现实肢体接触
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-8 h-8 rounded-full flex items-center justify-center text-[var(--c-sub,#8e8e93)] hover:bg-[var(--c-input,#f2f2f7)] active:scale-95 transition-all"
                        aria-label="关闭"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Body (可滚动) */}
                <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3.5">
                    {/* 错误与成功提示 */}
                    {errorMessage && (
                        <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/10 text-red-600 dark:text-red-400 text-[12px] leading-tight animate-fade-in">
                            <AlertCircle size={15} className="shrink-0" />
                            <span>{errorMessage}</span>
                        </div>
                    )}
                    {successMessage && (
                        <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[12px] leading-tight animate-fade-in">
                            <Check size={15} className="shrink-0" />
                            <span>{successMessage}</span>
                        </div>
                    )}

                    {/* 主控制面板卡片 */}
                    <div className="p-3 rounded-2xl bg-[var(--c-input,#f6f6f9)] flex items-center justify-between gap-3 border border-black/5 dark:border-white/5">
                        <div>
                            <div className="text-[13.5px] font-semibold">启用拍一拍互动</div>
                            <div className="text-[11px] text-[var(--c-sub,#8e8e93)] mt-0.5">
                                聊天中双击头像随机抽取文案
                            </div>
                        </div>
                        <Toggle
                            checked={config.enabled}
                            onChange={(checked) => setConfig((prev) => ({ ...prev, enabled: checked }))}
                        />
                    </div>

                    {/* AI 一键全部生成按钮（重点打造：单次请求一网打尽） */}
                    <button
                        type="button"
                        onClick={handleGenerateAll}
                        disabled={isGenerating}
                        className="w-full py-2.5 px-3.5 rounded-2xl font-medium text-[13px] flex items-center justify-center gap-2 transition-all active:scale-[0.99] shadow-sm disabled:opacity-60 bg-gradient-to-r from-violet-600 via-indigo-600 to-pink-500 text-white hover:brightness-105"
                    >
                        {isGenerating ? (
                            <>
                                <Loader2 size={16} className="animate-spin" />
                                <span>AI 正在结合人设构思文案…</span>
                            </>
                        ) : (
                            <>
                                <Sparkles size={16} className="animate-pulse" />
                                <span>✨ AI 一键生成全部（双方各 5 条）</span>
                            </>
                        )}
                    </button>

                    {/* Tab 切换 */}
                    <div className="grid grid-cols-2 p-1 rounded-xl bg-[var(--c-input,#f2f2f7)] text-[13px] font-medium text-center">
                        <button
                            type="button"
                            onClick={() => setActiveTab("user")}
                            className={`py-1.5 rounded-lg transition-all ${
                                activeTab === "user"
                                    ? "bg-[var(--c-page-bg,#ffffff)] text-[var(--c-accent,#007aff)] shadow-sm font-semibold"
                                    : "text-[var(--c-sub,#8e8e93)] hover:text-[var(--c-text,#1f2937)]"
                            }`}
                        >
                            你拍 TA ({config.userPokes.length}/5)
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab("char")}
                            className={`py-1.5 rounded-lg transition-all ${
                                activeTab === "char"
                                    ? "bg-[var(--c-page-bg,#ffffff)] text-[var(--c-accent,#007aff)] shadow-sm font-semibold"
                                    : "text-[var(--c-sub,#8e8e93)] hover:text-[var(--c-text,#1f2937)]"
                            }`}
                        >
                            TA 拍你 ({config.charPokes.length}/5)
                        </button>
                    </div>

                    {/* 快捷动词药丸 */}
                    <div className="space-y-1.5">
                        <div className="text-[11px] text-[var(--c-sub,#8e8e93)] flex items-center justify-between">
                            <span>快捷动词（点击填入下方）：</span>
                            <span className="text-[10px] opacity-75">点击列表条目可回填微调</span>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {QUICK_VERBS.map((verb) => (
                                <button
                                    key={verb}
                                    type="button"
                                    onClick={() => handleQuickVerb(verb)}
                                    className="px-2.5 py-1 rounded-full text-[12px] bg-[var(--c-input,#f2f2f7)] text-[var(--c-text,#1f2937)] hover:bg-[var(--c-border,#e5e7eb)] active:scale-95 transition-all border border-black/5 dark:border-white/5"
                                >
                                    {verb}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Tab 1: 你拍 TA */}
                    {activeTab === "user" && (
                        <div className="space-y-2.5">
                            <div className="space-y-1.5">
                                {config.userPokes.length === 0 ? (
                                    <div className="py-6 text-center text-[12px] text-[var(--c-sub,#8e8e93)]">
                                        文案池暂空，点击上方 AI 生成或在下方输入添加
                                    </div>
                                ) : (
                                    config.userPokes.map((item, idx) => (
                                        <div
                                            key={idx}
                                            onClick={() => handleSelectDraft("user", item)}
                                            className="group flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[var(--c-input,#f8f8fa)] text-[12.5px] border border-black/5 dark:border-white/5 hover:border-[var(--c-accent,#007aff)]/40 cursor-pointer transition-all"
                                            title="点击回填至下方输入框微调"
                                        >
                                            <span className="truncate flex-1 select-text">
                                                {resolvePokeTemplate(item, userName, charName)}
                                            </span>
                                            <div className="flex items-center gap-1 shrink-0">
                                                <Edit3 size={13} className="text-[var(--c-sub,#8e8e93)] opacity-0 group-hover:opacity-60 transition-opacity" />
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleDeletePoke("user", idx);
                                                    }}
                                                    className="w-6 h-6 rounded-md flex items-center justify-center text-[var(--c-sub,#8e8e93)] hover:text-red-500 hover:bg-red-500/10 transition-colors"
                                                    aria-label="删除"
                                                >
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>

                            {/* 底部输入框 */}
                            <div className="flex items-center gap-2 pt-1">
                                <input
                                    ref={userInputRef}
                                    type="text"
                                    value={userDraft}
                                    onChange={(e) => setUserDraft(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            e.preventDefault();
                                            handleAddUserPoke();
                                        }
                                    }}
                                    disabled={config.userPokes.length >= MAX_POKE_ITEMS_COUNT}
                                    placeholder={
                                        config.userPokes.length >= MAX_POKE_ITEMS_COUNT
                                            ? "已达 5 条上限"
                                            : "输入拍一拍文案（如：拍了拍对方的软肋）"
                                    }
                                    className="flex-1 px-3 py-2 rounded-xl text-[12.5px] bg-[var(--c-input,#f2f2f7)] border border-transparent focus:border-[var(--c-accent,#007aff)] outline-none disabled:opacity-50 transition-colors"
                                />
                                <button
                                    type="button"
                                    onClick={handleAddUserPoke}
                                    disabled={!userDraft.trim() || config.userPokes.length >= MAX_POKE_ITEMS_COUNT}
                                    className="px-3.5 py-2 rounded-xl text-[12.5px] font-medium bg-[var(--c-accent,#007aff)] text-white disabled:opacity-40 active:scale-95 transition-all shrink-0"
                                >
                                    添加
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Tab 2: TA 拍你 */}
                    {activeTab === "char" && (
                        <div className="space-y-2.5">
                            {/* 角色主动拍我开关 */}
                            <div className="p-2.5 rounded-xl bg-[var(--c-input,#f8f8fa)] flex items-center justify-between border border-black/5 dark:border-white/5">
                                <div>
                                    <div className="text-[12px] font-medium">允许角色主动拍你</div>
                                    <div className="text-[10.5px] text-[var(--c-sub,#8e8e93)]">闲聊或追问中角色线上双击你的头像</div>
                                </div>
                                <Toggle
                                    checked={config.allowCharActivePoke}
                                    onChange={(checked) =>
                                        setConfig((prev) => ({ ...prev, allowCharActivePoke: checked }))
                                    }
                                />
                            </div>

                            <div className="space-y-1.5">
                                {config.charPokes.length === 0 ? (
                                    <div className="py-6 text-center text-[12px] text-[var(--c-sub,#8e8e93)]">
                                        文案池暂空，点击上方 AI 生成或在下方输入添加
                                    </div>
                                ) : (
                                    config.charPokes.map((item, idx) => (
                                        <div
                                            key={idx}
                                            onClick={() => handleSelectDraft("char", item)}
                                            className="group flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-[var(--c-input,#f8f8fa)] text-[12.5px] border border-black/5 dark:border-white/5 hover:border-[var(--c-accent,#007aff)]/40 cursor-pointer transition-all"
                                            title="点击回填至下方输入框微调"
                                        >
                                            <span className="truncate flex-1 select-text">
                                                {resolvePokeTemplate(item, userName, charName)}
                                            </span>
                                            <div className="flex items-center gap-1 shrink-0">
                                                <Edit3 size={13} className="text-[var(--c-sub,#8e8e93)] opacity-0 group-hover:opacity-60 transition-opacity" />
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleDeletePoke("char", idx);
                                                    }}
                                                    className="w-6 h-6 rounded-md flex items-center justify-center text-[var(--c-sub,#8e8e93)] hover:text-red-500 hover:bg-red-500/10 transition-colors"
                                                    aria-label="删除"
                                                >
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>

                            {/* 底部输入框 */}
                            <div className="flex items-center gap-2 pt-1">
                                <input
                                    ref={charInputRef}
                                    type="text"
                                    value={charDraft}
                                    onChange={(e) => setCharDraft(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                            e.preventDefault();
                                            handleAddCharPoke();
                                        }
                                    }}
                                    disabled={config.charPokes.length >= MAX_POKE_ITEMS_COUNT}
                                    placeholder={
                                        config.charPokes.length >= MAX_POKE_ITEMS_COUNT
                                            ? "已达 5 条上限"
                                            : "输入角色拍你的文案…"
                                    }
                                    className="flex-1 px-3 py-2 rounded-xl text-[12.5px] bg-[var(--c-input,#f2f2f7)] border border-transparent focus:border-[var(--c-accent,#007aff)] outline-none disabled:opacity-50 transition-colors"
                                />
                                <button
                                    type="button"
                                    onClick={handleAddCharPoke}
                                    disabled={!charDraft.trim() || config.charPokes.length >= MAX_POKE_ITEMS_COUNT}
                                    className="px-3.5 py-2 rounded-xl text-[12.5px] font-medium bg-[var(--c-accent,#007aff)] text-white disabled:opacity-40 active:scale-95 transition-all shrink-0"
                                >
                                    添加
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer 按钮组 */}
                <div className="px-4 py-3 bg-[var(--c-input,#f9f9fb)] border-t border-[var(--c-border,#e5e7eb)] flex items-center justify-between gap-2 shrink-0">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-3.5 py-2 rounded-xl text-[13px] text-[var(--c-sub,#8e8e93)] hover:bg-black/5 dark:hover:bg-white/5 active:scale-95 transition-all"
                    >
                        取消
                    </button>
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={handleSave}
                            className="px-4 py-2 rounded-xl text-[13px] font-medium bg-[var(--c-input,#e5e7eb)] text-[var(--c-text,#1f2937)] hover:brightness-95 active:scale-95 transition-all"
                        >
                            保存
                        </button>
                        <button
                            type="button"
                            onClick={handleSaveAndPoke}
                            className="px-4 py-2 rounded-xl text-[13px] font-semibold bg-[var(--c-accent,#007aff)] text-white hover:brightness-105 active:scale-95 transition-all shadow-sm"
                        >
                            拍 TA 一下
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
