"use client";

import { useState, useEffect, useRef, useContext, type ChangeEvent } from "react";
import {
    Plus,
    Play,
    Square,
    Volume2,
    Trash2,
    FileEdit,
    Upload,
    Link as LinkIcon,
    Check,
    ChevronDown,
    ChevronUp,
    PhoneCall,
    MessageSquare,
    Bell,
    Send,
    PhoneIncoming,
    PhoneOutgoing,
    PhoneOff,
    CheckCircle2,
} from "lucide-react";
import { SettingsContext } from "../phone-settings-app";
import type { SoundProfileConfig, SoundAudioItem, SoundChannelConfig } from "@/lib/settings-types";
import {
    loadSoundProfiles,
    saveSoundProfiles,
    createDefaultSoundProfile,
    loadBindingConfig,
    saveBindingConfig,
} from "@/lib/settings-storage";
import {
    playDefaultSendMessageSound,
    playDefaultNewMessageSound,
} from "@/lib/chat-sound";
import {
    saveChatAudioToIndexedDB,
    getChatAudioFromIndexedDB,
} from "@/lib/chat-asset-storage";
import { Toggle, Input } from "@/components/ui/form";
import { ConfirmDialog } from "@/components/ui/modal";
import { BINDING_ACCENTS } from "@/lib/ui-accent-colors";

type SoundKind = "newMessage" | "sendMessage" | "incomingCall" | "outgoingCall" | "hangup";

type ChannelMeta = {
    kind: SoundKind;
    title: string;
    description: string;
    icon: typeof Bell;
    isCall?: boolean;
};

const CHANNELS: ChannelMeta[] = [
    {
        kind: "newMessage",
        title: "新消息提示音",
        description: "对方发来消息时播放的声音",
        icon: Bell,
    },
    {
        kind: "sendMessage",
        title: "发送消息提示音",
        description: "自己发出消息时播放的声音",
        icon: Send,
    },
    {
        kind: "incomingCall",
        title: "来电铃声",
        description: "角色向你发起语音或视频通话时的振铃声",
        icon: PhoneIncoming,
        isCall: true,
    },
    {
        kind: "outgoingCall",
        title: "致电等待音",
        description: "你呼叫角色等待接听时的回铃音",
        icon: PhoneOutgoing,
        isCall: true,
    },
    {
        kind: "hangup",
        title: "挂断音",
        description: "通话结束时播放的提示音",
        icon: PhoneOff,
        isCall: true,
    },
];

export function SoundSettings() {
    const { setSubpageTitle } = useContext(SettingsContext);

    const [profiles, setProfiles] = useState<SoundProfileConfig[]>([]);
    const [activeProfileId, setActiveProfileId] = useState<string>("");
    const [globalBoundProfileId, setGlobalBoundProfileId] = useState<string>("");
    const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);

    // 折叠展开状态（每个小类的音频库列表抽屉）
    const [expandedChannels, setExpandedChannels] = useState<Record<string, boolean>>({
        newMessage: false,
        sendMessage: false,
    });

    // 弹窗状态
    const [urlModalTarget, setUrlModalTarget] = useState<SoundKind | null>(null);
    const [urlInputName, setUrlInputName] = useState("");
    const [urlInputValue, setUrlInputValue] = useState("");
    const [isRenameModalOpen, setIsRenameModalOpen] = useState(false);
    const [renameInput, setRenameInput] = useState("");
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

    // 文件上传 ref
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const uploadingTargetRef = useRef<SoundKind | null>(null);

    // 播放器实例
    const activeAudioRef = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
        setSubpageTitle("音效设置");
        const loaded = loadSoundProfiles();
        setProfiles(loaded);
        if (loaded.length > 0) {
            setActiveProfileId(loaded[0].id);
        }

        const bindingCfg = loadBindingConfig();
        const globalId = bindingCfg.globalDefaults.soundProfileId || loaded[0]?.id || "";
        setGlobalBoundProfileId(globalId);
    }, [setSubpageTitle]);

    const activeProfile = profiles.find(p => p.id === activeProfileId) || profiles[0];

    const stopAudio = () => {
        if (activeAudioRef.current) {
            activeAudioRef.current.pause();
            activeAudioRef.current = null;
        }
        setPlayingAudioId(null);
    };

    const playAudioItem = async (channelKind: SoundKind, item: SoundAudioItem) => {
        if (playingAudioId === item.id) {
            stopAudio();
            return;
        }
        stopAudio();
        setPlayingAudioId(item.id);

        if (item.sourceType === "builtin") {
            if (channelKind === "sendMessage") {
                playDefaultSendMessageSound();
            } else if (channelKind === "newMessage") {
                playDefaultNewMessageSound();
            } else {
                playDefaultNewMessageSound();
            }
            setTimeout(() => {
                setPlayingAudioId(prev => (prev === item.id ? null : prev));
            }, 600);
            return;
        }

        let playUrl = item.dataUrl || item.value;
        if (!item.dataUrl && item.sourceType === "file") {
            const dataUrl = await getChatAudioFromIndexedDB(item.value);
            if (!dataUrl) {
                setPlayingAudioId(null);
                return;
            }
            playUrl = dataUrl;
        }

        try {
            const audio = new Audio(playUrl);
            activeAudioRef.current = audio;
            audio.onended = () => {
                setPlayingAudioId(prev => (prev === item.id ? null : prev));
                activeAudioRef.current = null;
            };
            audio.onerror = () => {
                setPlayingAudioId(null);
                activeAudioRef.current = null;
            };
            await audio.play();
        } catch {
            setPlayingAudioId(null);
        }
    };

    const updateProfile = (updater: (prev: SoundProfileConfig) => SoundProfileConfig) => {
        if (!activeProfile) return;
        const nextProfile = updater(activeProfile);
        nextProfile.updatedAt = Date.now();
        const nextList = profiles.map(p => (p.id === nextProfile.id ? nextProfile : p));
        setProfiles(nextList);
        saveSoundProfiles(nextList);
    };

    const handleCreateProfile = () => {
        const base = createDefaultSoundProfile();
        const newId = `sound_profile_${Date.now()}`;
        const newProfile: SoundProfileConfig = {
            ...base,
            id: newId,
            name: `自定义音效方案 ${profiles.length + 1}`,
            description: "用户专属配置的音效方案",
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        const nextList = [...profiles, newProfile];
        setProfiles(nextList);
        saveSoundProfiles(nextList);
        setActiveProfileId(newId);
    };

    const handleDeleteProfile = (id: string) => {
        if (profiles.length <= 1) return;
        const nextList = profiles.filter(p => p.id !== id);
        setProfiles(nextList);
        saveSoundProfiles(nextList);
        if (activeProfileId === id) {
            setActiveProfileId(nextList[0].id);
        }
        setConfirmDeleteId(null);
    };

    const handleSetAsGlobalDefault = () => {
        if (!activeProfile) return;
        const bindingCfg = loadBindingConfig();
        const nextCfg = {
            ...bindingCfg,
            globalDefaults: {
                ...bindingCfg.globalDefaults,
                soundProfileId: activeProfile.id,
            },
        };
        saveBindingConfig(nextCfg);
        setGlobalBoundProfileId(activeProfile.id);
    };

    const triggerUpload = (kind: SoundKind) => {
        uploadingTargetRef.current = kind;
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
            fileInputRef.current.click();
        }
    };

    const handleFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        const kind = uploadingTargetRef.current;
        if (!file || !kind || !activeProfile) return;

        try {
            const assetId = await saveChatAudioToIndexedDB(file);
            const fileName = file.name.replace(/\.[^/.]+$/, "") || "自定义音频";

            // 小于 300KB 的小型提示音同时内嵌 DataURL，双重保险：即使仅备份设置，音频也永不丢失
            let inlineDataUrl: string | undefined;
            if (file.size <= 300 * 1024) {
                inlineDataUrl = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(String(reader.result || ""));
                    reader.onerror = () => reject(reader.error);
                    reader.readAsDataURL(file);
                }).catch(() => undefined);
            }

            const newAudio: SoundAudioItem = {
                id: `audio_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                name: fileName,
                sourceType: "file",
                value: assetId,
                dataUrl: inlineDataUrl,
            };

            updateProfile(prev => {
                const channel = prev[kind] || { enabled: true, audios: [] };
                return {
                    ...prev,
                    [kind]: {
                        ...channel,
                        activeAudioId: newAudio.id,
                        audios: [...(channel.audios || []), newAudio],
                    },
                };
            });
            // 展开该分类以便查看
            setExpandedChannels(prev => ({ ...prev, [kind]: true }));
        } catch {
            // 静默失败
        }
    };

    const handleAddUrlAudio = () => {
        const kind = urlModalTarget;
        if (!kind || !urlInputValue.trim() || !activeProfile) return;

        const newAudio: SoundAudioItem = {
            id: `audio_url_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: urlInputName.trim() || "网络音频",
            sourceType: "url",
            value: urlInputValue.trim(),
        };

        updateProfile(prev => {
            const channel = prev[kind] || { enabled: true, audios: [] };
            return {
                ...prev,
                [kind]: {
                    ...channel,
                    activeAudioId: newAudio.id,
                    audios: [...(channel.audios || []), newAudio],
                },
            };
        });

        setUrlModalTarget(null);
        setUrlInputName("");
        setUrlInputValue("");
        setExpandedChannels(prev => ({ ...prev, [kind]: true }));
    };

    const handleSelectAudio = (kind: SoundKind, audioId: string) => {
        updateProfile(prev => {
            const channel = prev[kind] || { enabled: true, audios: [] };
            return {
                ...prev,
                [kind]: {
                    ...channel,
                    activeAudioId: audioId,
                },
            };
        });
    };

    const handleDeleteAudio = (kind: SoundKind, audioId: string) => {
        updateProfile(prev => {
            const channel = prev[kind] || { enabled: true, audios: [] };
            const nextAudios = (channel.audios || []).filter(a => a.id !== audioId);
            const nextActiveId = channel.activeAudioId === audioId
                ? (nextAudios[0]?.id || "")
                : channel.activeAudioId;
            return {
                ...prev,
                [kind]: {
                    ...channel,
                    activeAudioId: nextActiveId,
                    audios: nextAudios,
                },
            };
        });
    };

    const messageChannels = CHANNELS.filter(c => !c.isCall);
    const callChannels = CHANNELS.filter(c => c.isCall);

    if (!activeProfile) return null;

    const isGlobalDefault = globalBoundProfileId === activeProfile.id;

    return (
        <div className="flex flex-col gap-5 pb-8">
            <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={handleFileSelected}
            />

            {/* 顶栏：方案选择与管理 */}
            <div className="g-card p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                    <span className="text-[13px] font-medium text-[var(--c-text-title)]">当前方案</span>
                    <button
                        type="button"
                        onClick={handleCreateProfile}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black text-white text-[12px] font-medium shadow-sm hover:bg-gray-800 active:scale-95 transition-all"
                    >
                        <Plus size={14} /> 新建方案
                    </button>
                </div>

                <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                        <select
                            value={activeProfileId}
                            onChange={e => {
                                stopAudio();
                                setActiveProfileId(e.target.value);
                            }}
                            className="ui-select w-full pr-8 text-[13px]"
                        >
                            {profiles.map(p => (
                                <option key={p.id} value={p.id}>
                                    {p.name} {p.id === globalBoundProfileId ? "（全局默认）" : ""}
                                </option>
                            ))}
                        </select>
                    </div>

                    <button
                        type="button"
                        onClick={() => {
                            setRenameInput(activeProfile.name);
                            setIsRenameModalOpen(true);
                        }}
                        className="ui-btn ui-btn-outline p-2 text-[var(--c-text-sub)]"
                        title="重命名方案"
                    >
                        <FileEdit size={16} />
                    </button>

                    {profiles.length > 1 && (
                        <button
                            type="button"
                            onClick={() => setConfirmDeleteId(activeProfile.id)}
                            className="ui-btn ui-btn-soft-danger p-2"
                            title="删除方案"
                        >
                            <Trash2 size={16} />
                        </button>
                    )}
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-[var(--c-border-light)] text-[12px]">
                    <div className="flex items-center gap-1.5 text-[var(--c-text-sub)]">
                        {isGlobalDefault ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                                <CheckCircle2 size={14} /> 已设为全手机全局默认音效
                            </span>
                        ) : (
                            <span>未作为全局默认（可在绑定中心独立为角色绑定）</span>
                        )}
                    </div>
                    {!isGlobalDefault && (
                        <button
                            type="button"
                            onClick={handleSetAsGlobalDefault}
                            className="text-[12px] text-blue-600 hover:underline font-medium"
                        >
                            设为全局默认
                        </button>
                    )}
                </div>
            </div>

            {/* 💬 消息音效分组 */}
            <div className="flex flex-col gap-2.5">
                <div className="g-card overflow-hidden">
                    {/* 分组总标题 + 胶囊 Toggle 开关 */}
                    <div className="p-4 flex items-center justify-between border-b border-[var(--c-border-light)] bg-[var(--c-sub-bg)]">
                        <div className="flex items-center gap-2.5">
                            <span
                                className="w-8 h-8 rounded-full flex items-center justify-center text-white"
                                style={{ backgroundColor: BINDING_ACCENTS.preset }}
                            >
                                <MessageSquare size={17} />
                            </span>
                            <div>
                                <div className="text-[14px] font-semibold text-[var(--c-text-title)]">消息音效</div>
                                <div className="text-[11px] text-[var(--c-text-sub)]">
                                    {activeProfile.messageSoundsEnabled ? "已开启消息提示声" : "已静音（不播放任何消息声音）"}
                                </div>
                            </div>
                        </div>
                        <Toggle
                            checked={activeProfile.messageSoundsEnabled}
                            onChange={checked => {
                                updateProfile(prev => ({ ...prev, messageSoundsEnabled: checked }));
                            }}
                        />
                    </div>

                    {/* 开启后平滑展开子选项 */}
                    {activeProfile.messageSoundsEnabled && (
                        <div className="p-4 flex flex-col gap-4">
                            {messageChannels.map(channel => renderChannelCard(channel))}
                        </div>
                    )}
                </div>
            </div>

            {/* 📞 电话音效分组 */}
            <div className="flex flex-col gap-2.5">
                <div className="g-card overflow-hidden">
                    {/* 分组总标题 + 胶囊 Toggle 开关 */}
                    <div className="p-4 flex items-center justify-between border-b border-[var(--c-border-light)] bg-[var(--c-sub-bg)]">
                        <div className="flex items-center gap-2.5">
                            <span
                                className="w-8 h-8 rounded-full flex items-center justify-center text-white"
                                style={{ backgroundColor: "#8b5cf6" }}
                            >
                                <PhoneCall size={17} />
                            </span>
                            <div>
                                <div className="text-[14px] font-semibold text-[var(--c-text-title)]">通话音效</div>
                                <div className="text-[11px] text-[var(--c-text-sub)]">
                                    {activeProfile.callSoundsEnabled ? "已开启来电与通话铃声" : "已静音（通话不响铃）"}
                                </div>
                            </div>
                        </div>
                        <Toggle
                            checked={activeProfile.callSoundsEnabled}
                            onChange={checked => {
                                updateProfile(prev => ({ ...prev, callSoundsEnabled: checked }));
                            }}
                        />
                    </div>

                    {/* 开启后平滑展开子选项 */}
                    {activeProfile.callSoundsEnabled && (
                        <div className="p-4 flex flex-col gap-4">
                            {callChannels.map(channel => renderChannelCard(channel))}
                        </div>
                    )}
                </div>
            </div>

            {/* 弹窗：重命名方案 */}
            {isRenameModalOpen && (
                <div className="modal-overlay" data-ui="modal" onClick={() => setIsRenameModalOpen(false)}>
                    <div
                        className="modal-dialog max-w-[340px]"
                        role="dialog"
                        aria-modal="true"
                        onClick={e => e.stopPropagation()}
                    >
                        <span className="modal-header-title">重命名音效方案</span>
                        <div className="modal-body">
                            <Input
                                value={renameInput}
                                onChange={e => setRenameInput(e.target.value)}
                                placeholder="输入方案名称"
                                autoFocus
                            />
                        </div>
                        <div className="modal-actions">
                            <button
                                type="button"
                                className="ui-btn ui-btn-outline"
                                onClick={() => setIsRenameModalOpen(false)}
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                className="ui-btn ui-btn-primary"
                                onClick={() => {
                                    if (renameInput.trim()) {
                                        updateProfile(prev => ({ ...prev, name: renameInput.trim() }));
                                    }
                                    setIsRenameModalOpen(false);
                                }}
                            >
                                保存
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 弹窗：添加网络音频链接 */}
            {urlModalTarget && (
                <div className="modal-overlay" data-ui="modal" onClick={() => setUrlModalTarget(null)}>
                    <div
                        className="modal-dialog max-w-[360px]"
                        role="dialog"
                        aria-modal="true"
                        onClick={e => e.stopPropagation()}
                    >
                        <span className="modal-header-title">添加网络音频</span>
                        <div className="modal-body flex flex-col gap-3">
                            <div>
                                <label className="text-[12px] text-[var(--c-text-sub)] mb-1 block">音频名称</label>
                                <Input
                                    value={urlInputName}
                                    onChange={e => setUrlInputName(e.target.value)}
                                    placeholder="如：清脆水晶声"
                                />
                            </div>
                            <div>
                                <label className="text-[12px] text-[var(--c-text-sub)] mb-1 block">音频 URL</label>
                                <Input
                                    value={urlInputValue}
                                    onChange={e => setUrlInputValue(e.target.value)}
                                    placeholder="https://.../sound.mp3"
                                />
                            </div>
                        </div>
                        <div className="modal-actions">
                            <button
                                type="button"
                                className="ui-btn ui-btn-outline"
                                onClick={() => setUrlModalTarget(null)}
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                className="ui-btn ui-btn-primary"
                                disabled={!urlInputValue.trim()}
                                onClick={handleAddUrlAudio}
                            >
                                添加并使用
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 确认删除对话框 */}
            {confirmDeleteId && (
                <ConfirmDialog
                    title="删除音效方案"
                    message="确定要删除该音效方案吗？删除后绑定该方案的角色将自动回退到全局默认方案。"
                    onConfirm={() => handleDeleteProfile(confirmDeleteId)}
                    onCancel={() => setConfirmDeleteId(null)}
                />
            )}
        </div>
    );

    function renderChannelCard(meta: ChannelMeta) {
        const channel: SoundChannelConfig = activeProfile[meta.kind] || {
            enabled: true,
            audios: [],
        };
        const audios = channel.audios || [];
        const activeAudio = audios.find(a => a.id === channel.activeAudioId) || audios[0];
        const isExpanded = Boolean(expandedChannels[meta.kind]);
        const Icon = meta.icon;

        return (
            <div
                key={meta.kind}
                className="rounded-2xl border border-[var(--c-border-light)] bg-[var(--c-card-bg)] p-3.5 flex flex-col gap-3 transition-all"
            >
                {/* 顶部标题行 + 子开关 */}
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2.5">
                        <span className="w-7 h-7 rounded-lg bg-[var(--c-sub-bg)] flex items-center justify-center text-[var(--c-text-title)]">
                            <Icon size={16} strokeWidth={1.8} />
                        </span>
                        <div>
                            <div className="text-[13px] font-medium text-[var(--c-text-title)]">{meta.title}</div>
                            <div className="text-[11px] text-[var(--c-text-sub)]">{meta.description}</div>
                        </div>
                    </div>
                    <Toggle
                        checked={channel.enabled !== false}
                        onChange={checked => {
                            updateProfile(prev => ({
                                ...prev,
                                [meta.kind]: {
                                    ...channel,
                                    enabled: checked,
                                },
                            }));
                        }}
                    />
                </div>

                {/* 当前使用的音频小胶囊 + 试听按钮 + 展开按钮 */}
                {channel.enabled !== false && (
                    <div className="flex flex-col gap-2.5 pt-1">
                        <div className="flex items-center justify-between p-2 rounded-xl bg-[var(--c-sub-bg)] border border-[var(--c-border-light)]">
                            <div className="flex items-center gap-2 min-w-0 pr-2">
                                <span className="text-[11px] text-[var(--c-text-sub)] shrink-0">当前使用:</span>
                                <span className="text-[12px] font-medium text-[var(--c-text-title)] truncate">
                                    {activeAudio ? activeAudio.name : "未选择音频"}
                                </span>
                            </div>

                            <div className="flex items-center gap-1.5 shrink-0">
                                {activeAudio && (
                                    <button
                                        type="button"
                                        onClick={() => playAudioItem(meta.kind, activeAudio)}
                                        className="h-7 px-2.5 rounded-lg bg-[var(--c-card-bg)] hover:bg-[var(--c-input)] text-[12px] font-medium text-[var(--c-text-title)] border border-[var(--c-border-light)] flex items-center gap-1 active:scale-95 transition-all"
                                    >
                                        {playingAudioId === activeAudio.id ? (
                                            <>
                                                <Square size={12} className="text-red-500 fill-red-500" />
                                                <span>停止</span>
                                            </>
                                        ) : (
                                            <>
                                                <Play size={12} className="text-emerald-600 fill-emerald-600" />
                                                <span>试听</span>
                                            </>
                                        )}
                                    </button>
                                )}

                                <button
                                    type="button"
                                    onClick={() => {
                                        setExpandedChannels(prev => ({
                                            ...prev,
                                            [meta.kind]: !prev[meta.kind],
                                        }));
                                    }}
                                    className="h-7 px-2 rounded-lg bg-[var(--c-card-bg)] hover:bg-[var(--c-input)] text-[12px] text-[var(--c-text-sub)] border border-[var(--c-border-light)] flex items-center gap-1"
                                    title="查看/管理音频库"
                                >
                                    <span>音频库 ({audios.length})</span>
                                    {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                </button>
                            </div>
                        </div>

                        {/* 展开的音频库列表抽屉 */}
                        {isExpanded && (
                            <div className="rounded-xl border border-[var(--c-border-light)] p-2.5 flex flex-col gap-2 bg-[var(--c-sub-bg)]">
                                <div className="text-[11px] font-medium text-[var(--c-text-sub)] px-1">
                                    可选音频列表（点击可切换当前使用的音频）：
                                </div>

                                <div className="flex flex-col gap-1.5 max-h-[180px] overflow-y-auto">
                                    {audios.map(audio => {
                                        const isSelected = activeAudio?.id === audio.id;
                                        const isPlaying = playingAudioId === audio.id;

                                        return (
                                            <div
                                                key={audio.id}
                                                className={`p-2 rounded-lg flex items-center justify-between text-[12px] transition-all ${
                                                    isSelected
                                                        ? "bg-[var(--c-card-bg)] border border-emerald-500/40 shadow-xs"
                                                        : "bg-[var(--c-card-bg)]/60 border border-[var(--c-border-light)] hover:bg-[var(--c-card-bg)]"
                                                }`}
                                            >
                                                <button
                                                    type="button"
                                                    onClick={() => handleSelectAudio(meta.kind, audio.id)}
                                                    className="flex items-center gap-2 flex-1 min-w-0 text-left"
                                                >
                                                    <span
                                                        className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center shrink-0 ${
                                                            isSelected
                                                                ? "border-emerald-600 bg-emerald-600 text-white"
                                                                : "border-[var(--c-text-sub)]"
                                                        }`}
                                                    >
                                                        {isSelected && <Check size={10} strokeWidth={3} />}
                                                    </span>
                                                    <span className="truncate font-medium text-[var(--c-text-title)]">
                                                        {audio.name}
                                                    </span>
                                                    {audio.sourceType === "builtin" && (
                                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--c-input)] text-[var(--c-text-sub)] shrink-0">
                                                            系统内置
                                                        </span>
                                                    )}
                                                </button>

                                                <div className="flex items-center gap-1 shrink-0 ml-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => playAudioItem(meta.kind, audio)}
                                                        className="p-1 rounded-md hover:bg-[var(--c-input)] text-[var(--c-text-sub)]"
                                                        title="试听此音频"
                                                    >
                                                        {isPlaying ? (
                                                            <Square size={13} className="text-red-500 fill-red-500" />
                                                        ) : (
                                                            <Play size={13} className="text-emerald-600 fill-emerald-600" />
                                                        )}
                                                    </button>

                                                    {audio.sourceType !== "builtin" && (
                                                        <button
                                                            type="button"
                                                            onClick={() => handleDeleteAudio(meta.kind, audio.id)}
                                                            className="p-1 rounded-md hover:bg-red-500/10 text-red-500"
                                                            title="删除音频"
                                                        >
                                                            <Trash2 size={13} />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* 底部操作栏：上传音频 / 添加网络链接 */}
                                <div className="flex items-center gap-2 pt-1 border-t border-[var(--c-border-light)]">
                                    <button
                                        type="button"
                                        onClick={() => triggerUpload(meta.kind)}
                                        className="flex-1 py-1.5 rounded-lg border border-dashed border-[var(--c-border-light)] hover:border-emerald-500 bg-[var(--c-card-bg)] text-[11px] font-medium text-[var(--c-text-title)] flex items-center justify-center gap-1 active:scale-95 transition-all"
                                    >
                                        <Upload size={13} /> 上传本地音频
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setUrlModalTarget(meta.kind);
                                            setUrlInputName("");
                                            setUrlInputValue("");
                                        }}
                                        className="flex-1 py-1.5 rounded-lg border border-dashed border-[var(--c-border-light)] hover:border-blue-500 bg-[var(--c-card-bg)] text-[11px] font-medium text-[var(--c-text-title)] flex items-center justify-center gap-1 active:scale-95 transition-all"
                                    >
                                        <LinkIcon size={13} /> 添加网络链接
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* 特殊控制项：新消息特有的免打扰与防轰炸 */}
                        {meta.kind === "newMessage" && (
                            <div className="flex flex-col gap-2 pt-1 border-t border-[var(--c-border-light)]">
                                <div className="flex items-center justify-between text-[12px]">
                                    <span className="text-[var(--c-text-sub)]">打开当前聊天时免打扰</span>
                                    <Toggle
                                        checked={channel.muteActiveChat === true}
                                        onChange={checked => {
                                            updateProfile(prev => ({
                                                ...prev,
                                                newMessage: {
                                                    ...prev.newMessage,
                                                    muteActiveChat: checked,
                                                },
                                            }));
                                        }}
                                    />
                                </div>
                                <div className="flex items-center justify-between text-[12px]">
                                    <span className="text-[var(--c-text-sub)]">防连续轰炸（10秒内多条消息仅响一次）</span>
                                    <Toggle
                                        checked={channel.notifyOncePerBurst !== false}
                                        onChange={checked => {
                                            updateProfile(prev => ({
                                                ...prev,
                                                newMessage: {
                                                    ...prev.newMessage,
                                                    notifyOncePerBurst: checked,
                                                },
                                            }));
                                        }}
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    }
}
