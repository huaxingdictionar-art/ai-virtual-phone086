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
import {
    triggerPersistentPokeGeneration,
    isCharacterGeneratingPokes,
    POKE_GENERATION_STATE_EVENT,
    type PokeGenerationStateDetail,
} from "@/lib/chat-poke-generator";
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
    userName = "用户",
    initialConfig,
    onSave,
}: ChatPokeSettingsDialogProps) {
    const [config, setConfig] = useState<Required<ChatPokeConfig>>(() => normalizePokeConfig(initialConfig));
    const [activeTab, setActiveTab] = useState<"user" | "char">("user");
    const [userDraft, setUserDraft] = useState("");
    const [charDraft, setCharDraft] = useState("");
    const [isGenerating, setIsGenerating] = useState(() => isCharacterGeneratingPokes(character.id));
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    const userInputRef = useRef<HTMLInputElement>(null);
    const charInputRef = useRef<HTMLInputElement>(null);

    // 同步外部配置与持久化生成状态
    useEffect(() => {
        if (open) {
            setConfig(normalizePokeConfig(initialConfig));
            setIsGenerating(isCharacterGeneratingPokes(character.id));
            setErrorMessage(null);
            setSuccessMessage(null);
        }
    }, [open, initialConfig, character.id]);

    // 全局监听持久化生成事件：即使用户在生成中关闭了弹窗，再次打开或者在后台完成时均能秒级同步！
    useEffect(() => {
        const handleStateChange = (e: Event) => {
            const ce = e as CustomEvent<PokeGenerationStateDetail>;
            if (ce.detail?.characterId !== character.id) return;

            setIsGenerating(ce.detail.isGenerating);
            if (!ce.detail.isGenerating && ce.detail.result) {
                setConfig((prev) => ({
                    ...prev,
                    userPokes: ce.detail.result!.userPokes.slice(0, MAX_POKE_ITEMS_COUNT),
                    charPokes: ce.detail.result!.charPokes.slice(0, MAX_POKE_ITEMS_COUNT),
                }));
                setSuccessMessage("文案已生成！双方各已更新 5 条精选文案。");
                setTimeout(() => setSuccessMessage(null), 3000);
            } else if (!ce.detail.isGenerating && ce.detail.error) {
                setErrorMessage(ce.detail.error);
            }
        };

        window.addEventListener(POKE_GENERATION_STATE_EVENT, handleStateChange);
        return () => window.removeEventListener(POKE_GENERATION_STATE_EVENT, handleStateChange);
    }, [character.id]);

    if (!open) return null;

    const charName = character?.name || "对方";

    // 点击左下角【AI 生成十条】：支持后台持久执行与全局状态恢复
    const handleGenerateAll = async () => {
        try {
            setIsGenerating(true);
            setErrorMessage(null);
            setSuccessMessage(null);
            await triggerPersistentPokeGeneration(character, userName);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "AI 生成失败，请稍后重试";
            setErrorMessage(msg);
        }
    };

    // 添加双方大名文案
    const handleAddUserPoke = () => {
        const text = userDraft.trim();
        if (!text) return;
        if (config.userPokes.length >= MAX_POKE_ITEMS_COUNT) {
            setErrorMessage(`文案池最多容纳 ${MAX_POKE_ITEMS_COUNT} 条，请先删除不需要的句子`);
            return;
        }
        setConfig((prev) => ({
            ...prev,
            userPokes: [...prev.userPokes, text].slice(0, MAX_POKE_ITEMS_COUNT),
        }));
        setUserDraft("");
        setErrorMessage(null);
    };

    const handleAddCharPoke = () => {
        const text = charDraft.trim();
        if (!text) return;
        if (config.charPokes.length >= MAX_POKE_ITEMS_COUNT) {
            setErrorMessage(`文案池最多容纳 ${MAX_POKE_ITEMS_COUNT} 条，请先删除不需要的句子`);
            return;
        }
        setConfig((prev) => ({
            ...prev,
            charPokes: [...prev.charPokes, text].slice(0, MAX_POKE_ITEMS_COUNT),
        }));
        setCharDraft("");
        setErrorMessage(null);
    };

    // 删除文案
    const handleDeletePoke = (type: "user" | "char", index: number) => {
        setConfig((prev) => {
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

    // 点击动词药丸快速填入：使用 {user} 和 {char} 占位符
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

    return (
        <div
            className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/50 backdrop-blur-[3px] animate-fade-in select-none"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
        >
            <div
                className="w-full max-w-[360px] max-h-[85vh] flex flex-col rounded-[20px] bg-white dark:bg-[#18181b] text-black dark:text-white shadow-2xl border border-black/15 dark:border-white/15 overflow-hidden transition-all"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header: 利落纯黑标题，拒绝多余唠叨 */}
                <div className="flex items-center justify-between px-4 py-3.5 border-b border-black/10 dark:border-white/10 shrink-0">
                    <h3 className="text-[16px] font-bold tracking-tight text-black dark:text-white">拍一拍设置</h3>
                    <button
                        type="button"
                        onClick={onClose}
                        className="w-7 h-7 rounded-full flex items-center justify-center text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white hover:bg-black/5 dark:hover:bg-white/10 active:scale-95 transition-all"
                        aria-label="关闭"
                    >
                        <X size={16} />
                    </button>
                </div>

                {/* Body (可滚动) */}
                <div className="flex-1 overflow-y-auto px-4 py-3.5 space-y-3">
                    {/* 错误与成功提示 */}
                    {errorMessage && (
                        <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/10 text-red-600 dark:text-red-400 text-[12px] leading-tight animate-fade-in">
                            <AlertCircle size={14} className="shrink-0" />
                            <span>{errorMessage}</span>
                        </div>
                    )}
                    {successMessage && (
                        <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[12px] leading-tight animate-fade-in">
                            <Check size={14} className="shrink-0" />
                            <span>{successMessage}</span>
                        </div>
                    )}

                    {/* Tab 切换：双方真实大名展示，纯正黑白高对比分段选择器 */}
                    <div className="grid grid-cols-2 p-1 rounded-xl bg-black/5 dark:bg-white/10 text-[12.5px] font-medium text-center">
                        <button
                            type="button"
                            onClick={() => setActiveTab("user")}
                            className={`py-1.5 px-1 rounded-lg transition-all truncate ${
                                activeTab === "user"
                                    ? "bg-black text-white dark:bg-white dark:text-black shadow-sm font-semibold"
                                    : "text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white"
                            }`}
                            title={`${userName || "用户"} 拍 ${charName}`}
                        >
                            {userName || "用户"} 拍 {charName} ({config.userPokes.length}/5)
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab("char")}
                            className={`py-1.5 px-1 rounded-lg transition-all truncate ${
                                activeTab === "char"
                                    ? "bg-black text-white dark:bg-white dark:text-black shadow-sm font-semibold"
                                    : "text-black/60 dark:text-white/60 hover:text-black dark:hover:text-white"
                            }`}
                            title={`${charName} 拍 ${userName || "用户"}`}
                        >
                            {charName} 拍 {userName || "用户"} ({config.charPokes.length}/5)
                        </button>
                    </div>

                    {/* 快捷动词药丸：纯黑文字与利落胶囊 */}
                    <div className="space-y-1.5">
                        <div className="text-[11px] font-medium text-black/60 dark:text-white/60">
                            快捷动词（点击填入下方）：
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            {QUICK_VERBS.map((verb) => (
                                <button
                                    key={verb}
                                    type="button"
                                    onClick={() => handleQuickVerb(verb)}
                                    className="px-2.5 py-1 rounded-full text-[12px] font-medium bg-black/5 dark:bg-white/10 text-black dark:text-white hover:bg-black/10 dark:hover:bg-white/15 active:scale-95 transition-all border border-black/10 dark:border-white/10"
                                >
                                    {verb}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Tab 1: 用户拍角色（真实大名） */}
                    {activeTab === "user" && (
                        <div className="space-y-2.5">
                            <div className="space-y-1.5">
                                {config.userPokes.length === 0 ? (
                                    <div className="py-5 text-center text-[12px] text-black/50 dark:text-white/50">
                                        暂无文案，可点击左下角 AI 生成或在下方输入添加
                                    </div>
                                ) : (
                                    config.userPokes.map((item, idx) => (
                                        <div
                                            key={idx}
                                            onClick={() => handleSelectDraft("user", item)}
                                            className="group flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-black/5 dark:bg-white/5 text-[12.5px] font-medium border border-black/8 dark:border-white/10 hover:border-black/30 dark:hover:border-white/30 cursor-pointer transition-all"
                                            title="点击填入下方微调"
                                        >
                                            <span className="truncate flex-1 select-text text-black dark:text-white">
                                                {resolvePokeTemplate(item, userName, charName)}
                                            </span>
                                            <div className="flex items-center gap-1 shrink-0">
                                                <Edit3 size={13} className="text-black/40 dark:text-white/40 opacity-0 group-hover:opacity-70 transition-opacity" />
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleDeletePoke("user", idx);
                                                    }}
                                                    className="w-5 h-5 rounded flex items-center justify-center text-black/40 dark:text-white/40 hover:text-red-600 hover:bg-red-500/10 transition-colors"
                                                    aria-label="删除"
                                                >
                                                    <X size={13} />
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>

                            {/* 底部输入框 */}
                            <div className="flex items-center gap-2 pt-0.5">
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
                                            : `输入文案，如：{user} 拍了拍 {char}…`
                                    }
                                    className="flex-1 px-3 py-1.5 rounded-xl text-[12.5px] bg-black/5 dark:bg-white/10 text-black dark:text-white placeholder:text-black/40 dark:placeholder:text-white/40 border border-black/10 dark:border-white/10 focus:border-black dark:focus:border-white outline-none disabled:opacity-50 transition-colors"
                                />
                                <button
                                    type="button"
                                    onClick={handleAddUserPoke}
                                    disabled={!userDraft.trim() || config.userPokes.length >= MAX_POKE_ITEMS_COUNT}
                                    className="px-3.5 py-1.5 rounded-xl text-[12.5px] font-semibold bg-black text-white dark:bg-white dark:text-black disabled:opacity-30 active:scale-95 transition-all shrink-0"
                                >
                                    添加
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Tab 2: 角色拍用户（真实大名） */}
                    {activeTab === "char" && (
                        <div className="space-y-2.5">
                            {/* 角色主动拍我开关：纯正黑白卡片 + 原生绿色开关 */}
                            <div className="p-2.5 rounded-xl bg-black/5 dark:bg-white/5 flex items-center justify-between border border-black/8 dark:border-white/10">
                                <div>
                                    <div className="text-[12.5px] font-semibold text-black dark:text-white">允许角色主动拍你</div>
                                    <div className="text-[10.5px] text-black/60 dark:text-white/60">闲聊或追问中角色线上双击你头像</div>
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
                                    <div className="py-5 text-center text-[12px] text-black/50 dark:text-white/50">
                                        暂无文案，可点击左下角 AI 生成或在下方输入添加
                                    </div>
                                ) : (
                                    config.charPokes.map((item, idx) => (
                                        <div
                                            key={idx}
                                            onClick={() => handleSelectDraft("char", item)}
                                            className="group flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-black/5 dark:bg-white/5 text-[12.5px] font-medium border border-black/8 dark:border-white/10 hover:border-black/30 dark:hover:border-white/30 cursor-pointer transition-all"
                                            title="点击填入下方微调"
                                        >
                                            <span className="truncate flex-1 select-text text-black dark:text-white">
                                                {resolvePokeTemplate(item, userName, charName)}
                                            </span>
                                            <div className="flex items-center gap-1 shrink-0">
                                                <Edit3 size={13} className="text-black/40 dark:text-white/40 opacity-0 group-hover:opacity-70 transition-opacity" />
                                                <button
                                                    type="button"
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        handleDeletePoke("char", idx);
                                                    }}
                                                    className="w-5 h-5 rounded flex items-center justify-center text-black/40 dark:text-white/40 hover:text-red-600 hover:bg-red-500/10 transition-colors"
                                                    aria-label="删除"
                                                >
                                                    <X size={13} />
                                                </button>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>

                            {/* 底部输入框 */}
                            <div className="flex items-center gap-2 pt-0.5">
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
                                            : `输入文案，如：{char} 戳了戳 {user}…`
                                    }
                                    className="flex-1 px-3 py-1.5 rounded-xl text-[12.5px] bg-black/5 dark:bg-white/10 text-black dark:text-white placeholder:text-black/40 dark:placeholder:text-white/40 border border-black/10 dark:border-white/10 focus:border-black dark:focus:border-white outline-none disabled:opacity-50 transition-colors"
                                />
                                <button
                                    type="button"
                                    onClick={handleAddCharPoke}
                                    disabled={!charDraft.trim() || config.charPokes.length >= MAX_POKE_ITEMS_COUNT}
                                    className="px-3.5 py-1.5 rounded-xl text-[12.5px] font-semibold bg-black text-white dark:bg-white dark:text-black disabled:opacity-30 active:scale-95 transition-all shrink-0"
                                >
                                    添加
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer 按钮组：左下角 AI 生成十条，右下角 取消 与 纯黑保存 */}
                <div className="px-4 py-3 bg-white dark:bg-[#18181b] border-t border-black/10 dark:border-white/10 flex items-center justify-between gap-2 shrink-0">
                    {/* 左下角：AI 生成十条 / 生成中... */}
                    <button
                        type="button"
                        onClick={handleGenerateAll}
                        disabled={isGenerating}
                        className="px-3.5 py-1.5 rounded-xl text-[12px] font-semibold flex items-center gap-1.5 border border-black/80 dark:border-white text-black dark:text-white bg-white dark:bg-black hover:bg-black/5 dark:hover:bg-white/10 active:scale-95 disabled:opacity-60 disabled:cursor-not-allowed transition-all shadow-xs"
                    >
                        {isGenerating ? (
                            <>
                                <Loader2 size={13} className="animate-spin text-black dark:text-white" />
                                <span>生成中…</span>
                            </>
                        ) : (
                            <>
                                <Sparkles size={13} className="text-black dark:text-white" />
                                <span>AI 生成十条</span>
                            </>
                        )}
                    </button>

                    {/* 右下角：取消 与 纯黑保存 */}
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-3.5 py-1.5 rounded-xl text-[13px] font-medium text-black/70 dark:text-white/70 hover:text-black dark:hover:text-white active:scale-95 transition-all"
                        >
                            取消
                        </button>
                        <button
                            type="button"
                            onClick={handleSave}
                            className="px-5 py-1.5 rounded-xl text-[13px] font-bold bg-black text-white dark:bg-white dark:text-black hover:bg-black/90 dark:hover:bg-white/90 active:scale-95 transition-all shadow-sm"
                        >
                            保存
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
