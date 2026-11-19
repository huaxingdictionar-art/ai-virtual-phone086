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
    loadSoundLibrary,
    saveSoundLibrary,
    DEFAULT_BUILTIN_AUDIOS,
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

type SlotMeta = {
    kind: SoundKind;
    title: string;
    description: string;
    icon: typeof Bell;
    isCall?: boolean;
    defaultBuiltinId: string;
};

const MESSAGE_SLOTS: SlotMeta[] = [
    {
        kind: "newMessage",
        title: "新消息提示音",
        description: "收到对方消息时播放的声音",
        icon: Bell,
        defaultBuiltinId: "builtin_new_msg",
    },
    {
        kind: "sendMessage",
        title: "发送消息提示音",
        description: "自己发出消息时播放的声音",
        icon: Send,
        defaultBuiltinId: "builtin_send_msg",
    },
];

const CALL_SLOTS: SlotMeta[] = [
    {
        kind: "incomingCall",
        title: "来电铃声",
        description: "对方发起语音或视频通话时的振铃声",
        icon: PhoneIncoming,
        isCall: true,
        defaultBuiltinId: "builtin_incoming_call",
    },
    {
        kind: "outgoingCall",
        title: "致电等待音",
        description: "呼叫对方等待接通时的回铃音",
        icon: PhoneOutgoing,
        isCall: true,
        defaultBuiltinId: "builtin_outgoing_call",
    },
    {
        kind: "hangup",
        title: "挂断音",
        description: "通话结束时播放的提示音",
        icon: PhoneOff,
        isCall: true,
        defaultBuiltinId: "builtin_hangup",
    },
];

// 纯净 Web Audio 合成器（为系统内置通话声音提供即时悦耳试听）
function playBuiltinSynthesis(kind: SoundKind | string) {
    if (typeof window === "undefined") return;
    try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (!AudioCtx) return;
        const ctx = new AudioCtx();
        const now = ctx.currentTime;

        if (kind === "sendMessage" || kind === "builtin_send_msg" || kind === "builtin:pop") {
            playDefaultSendMessageSound();
            return;
        }

        if (kind === "newMessage" || kind === "builtin_new_msg" || kind === "builtin:chime") {
            playDefaultNewMessageSound();
            return;
        }

        if (kind === "incomingCall" || kind === "builtin_incoming_call" || kind === "builtin:ring") {
            // 经典柔和双音铃声 (A5 880Hz + C#6 1108Hz)
            const osc1 = ctx.createOscillator();
            const osc2 = ctx.createOscillator();
            const gain = ctx.createGain();
            osc1.type = "sine";
            osc2.type = "sine";
            osc1.frequency.setValueAtTime(880, now);
            osc2.frequency.setValueAtTime(1108, now);
            gain.gain.setValueAtTime(0.12, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
            osc1.connect(gain);
            osc2.connect(gain);
            gain.connect(ctx.destination);
            osc1.start(now);
            osc2.start(now);
            osc1.stop(now + 0.35);
            osc2.stop(now + 0.35);
            return;
        }

        if (kind === "outgoingCall" || kind === "builtin_outgoing_call" || kind === "builtin:dial") {
            // 呼叫等待回铃 (440Hz + 480Hz)
            const osc1 = ctx.createOscillator();
            const osc2 = ctx.createOscillator();
            const gain = ctx.createGain();
            osc1.type = "sine";
            osc2.type = "sine";
            osc1.frequency.setValueAtTime(440, now);
            osc2.frequency.setValueAtTime(480, now);
            gain.gain.setValueAtTime(0.1, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
            osc1.connect(gain);
            osc2.connect(gain);
            gain.connect(ctx.destination);
            osc1.start(now);
            osc2.start(now);
            osc1.stop(now + 0.3);
            osc2.stop(now + 0.3);
            return;
        }

        if (kind === "hangup" || kind === "builtin_hangup" || kind === "builtin:busy") {
            // 挂断忙音短蜂鸣 (480Hz + 620Hz)
            const osc1 = ctx.createOscillator();
            const osc2 = ctx.createOscillator();
            const gain = ctx.createGain();
            osc1.type = "triangle";
            osc2.type = "triangle";
            osc1.frequency.setValueAtTime(480, now);
            osc2.frequency.setValueAtTime(620, now);
            gain.gain.setValueAtTime(0.09, now);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
            osc1.connect(gain);
            osc2.connect(gain);
            gain.connect(ctx.destination);
            osc1.start(now);
            osc2.start(now);
            osc1.stop(now + 0.22);
            osc2.stop(now + 0.22);
            return;
        }

        playDefaultNewMessageSound();
    } catch {
        // 静默兜底
    }
}

export function SoundSettings() {
    const { setSubpageTitle } = useContext(SettingsContext);

    // 方案列表与当前选中的方案
    const [profiles, setProfiles] = useState<SoundProfileConfig[]>([]);
    const [activeProfileId, setActiveProfileId] = useState<string>("");
    const [globalBoundProfileId, setGlobalBoundProfileId] = useState<string>("");

    // 全局音效素材库（华强调的音效池子）
    const [soundLibrary, setSoundLibrary] = useState<SoundAudioItem[]>([]);

    // 正在试听的音频 ID
    const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);

    // 弹窗状态：网络链接
    const [isUrlModalOpen, setIsUrlModalOpen] = useState(false);
    const [urlName, setUrlName] = useState("");
    const [urlValue, setUrlValue] = useState("");

    // 弹窗状态：重命名音频
    const [isRenameAudioModalOpen, setIsRenameAudioModalOpen] = useState(false);
    const [renamingAudio, setRenamingAudio] = useState<SoundAudioItem | null>(null);
    const [renamingAudioName, setRenamingAudioName] = useState("");

    // 弹窗状态：删除音频
    const [deletingAudio, setDeletingAudio] = useState<SoundAudioItem | null>(null);

    // 弹窗状态：方案管理
    const [isRenameProfileModalOpen, setIsRenameProfileModalOpen] = useState(false);
    const [renamingProfileName, setRenamingProfileName] = useState("");
    const [deletingProfileId, setDeletingProfileId] = useState<string | null>(null);

    // 文件上传 ref
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    // 播放器实例
    const activeAudioRef = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
        setSubpageTitle("音效设置");

        // 加载方案
        const loadedProfiles = loadSoundProfiles();
        setProfiles(loadedProfiles);
        if (loadedProfiles.length > 0) {
            setActiveProfileId(loadedProfiles[0].id);
        }

        // 加载绑定
        const bindingCfg = loadBindingConfig();
        const globalId = bindingCfg.globalDefaults.soundProfileId || loadedProfiles[0]?.id || "";
        setGlobalBoundProfileId(globalId);

        // 加载全局素材库
        const library = loadSoundLibrary();
        setSoundLibrary(library);
    }, [setSubpageTitle]);

    const activeProfile = profiles.find(p => p.id === activeProfileId) || profiles[0];

    const stopAudio = () => {
        if (activeAudioRef.current) {
            activeAudioRef.current.pause();
            activeAudioRef.current = null;
        }
        setPlayingAudioId(null);
    };

    // 试听某一个音频
    const playAudioItem = async (item: SoundAudioItem, fallbackKind?: SoundKind) => {
        if (playingAudioId === item.id) {
            stopAudio();
            return;
        }
        stopAudio();
        setPlayingAudioId(item.id);

        if (item.sourceType === "builtin") {
            playBuiltinSynthesis(item.id || fallbackKind || "newMessage");
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

    // 更新当前方案
    const updateProfile = (updater: (prev: SoundProfileConfig) => SoundProfileConfig) => {
        if (!activeProfile) return;
        const nextProfile = updater(activeProfile);
        nextProfile.updatedAt = Date.now();
        const nextList = profiles.map(p => (p.id === nextProfile.id ? nextProfile : p));
        setProfiles(nextList);
        saveSoundProfiles(nextList);
    };

    // 上方槽位选择下拉（从素材库连线）
    const handleSelectSlotAudio = (kind: SoundKind, audioId: string) => {
        const audio = soundLibrary.find(a => a.id === audioId);
        updateProfile(prev => {
            const currentChannel = prev[kind] || { enabled: true, audios: [] };
            const nextAudios = audio
                ? [audio, ...(currentChannel.audios || []).filter(a => a.id !== audio.id)]
                : currentChannel.audios || [];
            return {
                ...prev,
                [kind]: {
                    ...currentChannel,
                    activeAudioId: audioId,
                    audios: nextAudios,
                },
            };
        });
    };

    // 新建方案
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

    // 删除方案
    const handleDeleteProfile = (id: string) => {
        if (profiles.length <= 1) return;
        const nextList = profiles.filter(p => p.id !== id);
        setProfiles(nextList);
        saveSoundProfiles(nextList);
        if (activeProfileId === id) {
            setActiveProfileId(nextList[0].id);
        }
        setDeletingProfileId(null);
    };

    // 设为全手机全局默认音效
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

    // 上传本地音频到素材库
    const triggerUpload = () => {
        if (fileInputRef.current) {
            fileInputRef.current.value = "";
            fileInputRef.current.click();
        }
    };

    const handleFileSelected = async (e: ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const assetId = await saveChatAudioToIndexedDB(file);
            const fileName = file.name.replace(/\.[^/.]+$/, "") || "自定义音频";

            // 小于等于 300KB 的小型提示音同时内嵌 DataURL，双重保险：即使仅备份设置，音频也永不丢失
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

            const nextLibrary = [...soundLibrary, newAudio];
            setSoundLibrary(nextLibrary);
            saveSoundLibrary(nextLibrary);
        } catch {
            // 静默
        }
    };

    // 添加网络音频链接到素材库
    const handleAddUrlAudio = () => {
        if (!urlValue.trim()) return;

        const newAudio: SoundAudioItem = {
            id: `audio_url_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            name: urlName.trim() || "网络音频",
            sourceType: "url",
            value: urlValue.trim(),
        };

        const nextLibrary = [...soundLibrary, newAudio];
        setSoundLibrary(nextLibrary);
        saveSoundLibrary(nextLibrary);

        setIsUrlModalOpen(false);
        setUrlName("");
        setUrlValue("");
    };

    // 重命名素材库中的音频
    const handleSaveAudioRename = () => {
        if (!renamingAudio || !renamingAudioName.trim()) return;
        const newName = renamingAudioName.trim();
        const nextLibrary = soundLibrary.map(item =>
            item.id === renamingAudio.id ? { ...item, name: newName } : item
        );
        setSoundLibrary(nextLibrary);
        saveSoundLibrary(nextLibrary);

        // 同步更新所有方案中的显示
        const nextProfiles = profiles.map(p => {
            const updated = { ...p };
            for (const key of ["newMessage", "sendMessage", "incomingCall", "outgoingCall", "hangup"] as const) {
                const ch = updated[key];
                if (ch?.audios) {
                    updated[key] = {
                        ...ch,
                        audios: ch.audios.map(a => (a.id === renamingAudio.id ? { ...a, name: newName } : a)),
                    };
                }
            }
            return updated;
        });
        setProfiles(nextProfiles);
        saveSoundProfiles(nextProfiles);

        setIsRenameAudioModalOpen(false);
        setRenamingAudio(null);
    };

    // 删除素材库中的音频
    const handleConfirmDeleteAudio = () => {
        if (!deletingAudio || deletingAudio.sourceType === "builtin") return;
        const targetId = deletingAudio.id;
        const nextLibrary = soundLibrary.filter(item => item.id !== targetId);
        setSoundLibrary(nextLibrary);
        saveSoundLibrary(nextLibrary);

        // 如果当前方案有槽位选中了被删除的音频，自动回退到默认内置音频
        const fallbackIdMap: Record<SoundKind, string> = {
            newMessage: "builtin_new_msg",
            sendMessage: "builtin_send_msg",
            incomingCall: "builtin_incoming_call",
            outgoingCall: "builtin_outgoing_call",
            hangup: "builtin_hangup",
        };

        const nextProfiles = profiles.map(p => {
            const updated = { ...p };
            for (const key of ["newMessage", "sendMessage", "incomingCall", "outgoingCall", "hangup"] as const) {
                const ch = updated[key];
                if (ch) {
                    const isUsingDeleted = ch.activeAudioId === targetId;
                    updated[key] = {
                        ...ch,
                        activeAudioId: isUsingDeleted ? fallbackIdMap[key] : ch.activeAudioId,
                        audios: (ch.audios || []).filter(a => a.id !== targetId),
                    };
                }
            }
            return updated;
        });
        setProfiles(nextProfiles);
        saveSoundProfiles(nextProfiles);

        if (playingAudioId === targetId) {
            stopAudio();
        }
        setDeletingAudio(null);
    };

    if (!activeProfile) return null;

    const isGlobalDefault = globalBoundProfileId === activeProfile.id;

    // 辅助渲染上方各个槽位的试听小按钮
    const renderSlotPlayButton = (slot: SlotMeta) => {
        const channel: SoundChannelConfig | undefined = activeProfile[slot.kind];
        const selectedId = channel?.activeAudioId || slot.defaultBuiltinId;
        const selectedAudio = soundLibrary.find(a => a.id === selectedId) || DEFAULT_BUILTIN_AUDIOS.find(a => a.id === slot.defaultBuiltinId);
        const isPlaying = selectedAudio ? playingAudioId === selectedAudio.id : false;

        return (
            <button
                type="button"
                onClick={() => {
                    if (selectedAudio) {
                        playAudioItem(selectedAudio, slot.kind);
                    }
                }}
                className={`h-9 px-3 rounded-xl border border-[var(--c-border-light)] text-[12px] font-medium flex items-center gap-1.5 shrink-0 transition-all ${
                    isPlaying
                        ? "bg-red-50 text-red-600 border-red-200"
                        : "bg-[var(--c-card-bg)] text-[var(--c-text-title)] hover:bg-[var(--c-sub-bg)] active:scale-95"
                }`}
                title="试听当前选中的声音"
            >
                {isPlaying ? (
                    <>
                        <Square size={13} className="text-red-500 fill-red-500" />
                        <span>停止</span>
                    </>
                ) : (
                    <>
                        <Play size={13} className="text-emerald-600 fill-emerald-600" />
                        <span>试听</span>
                    </>
                )}
            </button>
        );
    };

    return (
        <div className="flex flex-col gap-4 pb-12 px-1 text-[var(--c-text-title)]">
            <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={handleFileSelected}
            />

            {/* 顶栏：方案选择与管理卡片 */}
            <div className="g-card p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                    <span className="text-[13px] font-medium text-[var(--c-text-title)]">当前方案</span>
                    <button
                        type="button"
                        onClick={handleCreateProfile}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black text-white text-[12px] font-medium shadow-xs hover:bg-gray-800 active:scale-95 transition-all"
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
                            setRenamingProfileName(activeProfile.name);
                            setIsRenameProfileModalOpen(true);
                        }}
                        className="ui-btn ui-btn-outline p-2 text-[var(--c-text-sub)]"
                        title="重命名方案"
                    >
                        <FileEdit size={16} />
                    </button>

                    {profiles.length > 1 && (
                        <button
                            type="button"
                            onClick={() => setDeletingProfileId(activeProfile.id)}
                            className="ui-btn ui-btn-soft-danger p-2"
                            title="删除方案"
                        >
                            <Trash2 size={16} />
                        </button>
                    )}
                </div>

                <div className="flex items-center justify-between pt-2 border-t border-[var(--c-border-light)]/60 text-[12px]">
                    <div className="flex items-center gap-1.5">
                        {isGlobalDefault ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600 font-medium">
                                <CheckCircle2 size={14} /> 已设为全手机全局默认音效
                            </span>
                        ) : (
                            <span className="text-[var(--c-text-sub)]">未设为全局默认（可在绑定中心为角色单独绑定）</span>
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

            {/* 💬 消息音效卡片（连线区域：无黑框嵌套） */}
            <div className="g-card overflow-hidden">
                <div className="p-4 flex items-center justify-between border-b border-[var(--c-border-light)]/60 bg-[var(--c-sub-bg)]/40">
                    <div className="flex items-center gap-3">
                        <span
                            className="w-8 h-8 rounded-full flex items-center justify-center text-white shadow-xs"
                            style={{ backgroundColor: BINDING_ACCENTS.preset }}
                        >
                            <MessageSquare size={16} />
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

                {activeProfile.messageSoundsEnabled && (
                    <div className="p-4 flex flex-col gap-4">
                        {/* 新消息提示音槽位 */}
                        <div className="flex flex-col gap-1.5">
                            <div className="flex items-center justify-between">
                                <span className="text-[13px] font-medium text-[var(--c-text-title)] flex items-center gap-1.5">
                                    <Bell size={15} className="text-[var(--c-text-sub)]" /> 新消息提示音
                                </span>
                                <span className="text-[11px] text-[var(--c-text-sub)]">对方发来消息时播放</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <select
                                    value={activeProfile.newMessage?.activeAudioId || "builtin_new_msg"}
                                    onChange={e => handleSelectSlotAudio("newMessage", e.target.value)}
                                    className="ui-select flex-1 text-[13px]"
                                >
                                    {soundLibrary.map(audio => (
                                        <option key={audio.id} value={audio.id}>
                                            {audio.name} {audio.sourceType === "builtin" ? " (内置)" : ""}
                                        </option>
                                    ))}
                                </select>
                                {renderSlotPlayButton(MESSAGE_SLOTS[0])}
                            </div>
                            <div className="flex items-center justify-between pt-1 text-[12px] text-[var(--c-text-sub)]">
                                <span>防连续轰炸（10秒内多条消息仅响一次）</span>
                                <Toggle
                                    checked={activeProfile.newMessage?.notifyOncePerBurst !== false}
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

                        <div className="h-[1px] bg-[var(--c-border-light)]/60" />

                        {/* 发送消息提示音槽位 */}
                        <div className="flex flex-col gap-1.5">
                            <div className="flex items-center justify-between">
                                <span className="text-[13px] font-medium text-[var(--c-text-title)] flex items-center gap-1.5">
                                    <Send size={15} className="text-[var(--c-text-sub)]" /> 发送消息提示音
                                </span>
                                <span className="text-[11px] text-[var(--c-text-sub)]">自己发出消息时播放</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <select
                                    value={activeProfile.sendMessage?.activeAudioId || "builtin_send_msg"}
                                    onChange={e => handleSelectSlotAudio("sendMessage", e.target.value)}
                                    className="ui-select flex-1 text-[13px]"
                                >
                                    {soundLibrary.map(audio => (
                                        <option key={audio.id} value={audio.id}>
                                            {audio.name} {audio.sourceType === "builtin" ? " (内置)" : ""}
                                        </option>
                                    ))}
                                </select>
                                {renderSlotPlayButton(MESSAGE_SLOTS[1])}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* 📞 通话音效卡片（连线区域：无黑框嵌套） */}
            <div className="g-card overflow-hidden">
                <div className="p-4 flex items-center justify-between border-b border-[var(--c-border-light)]/60 bg-[var(--c-sub-bg)]/40">
                    <div className="flex items-center gap-3">
                        <span
                            className="w-8 h-8 rounded-full flex items-center justify-center text-white shadow-xs"
                            style={{ backgroundColor: "#8b5cf6" }}
                        >
                            <PhoneCall size={16} />
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

                {activeProfile.callSoundsEnabled && (
                    <div className="p-4 flex flex-col gap-4">
                        {CALL_SLOTS.map((slot, index) => {
                            const Icon = slot.icon;
                            const slotVal = activeProfile[slot.kind]?.activeAudioId || slot.defaultBuiltinId;

                            return (
                                <div key={slot.kind} className="flex flex-col gap-1.5">
                                    {index > 0 && <div className="h-[1px] bg-[var(--c-border-light)]/60 mb-2.5" />}
                                    <div className="flex items-center justify-between">
                                        <span className="text-[13px] font-medium text-[var(--c-text-title)] flex items-center gap-1.5">
                                            <Icon size={15} className="text-[var(--c-text-sub)]" /> {slot.title}
                                        </span>
                                        <span className="text-[11px] text-[var(--c-text-sub)]">{slot.description}</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <select
                                            value={slotVal}
                                            onChange={e => handleSelectSlotAudio(slot.kind, e.target.value)}
                                            className="ui-select flex-1 text-[13px]"
                                        >
                                            {soundLibrary.map(audio => (
                                                <option key={audio.id} value={audio.id}>
                                                    {audio.name} {audio.sourceType === "builtin" ? " (内置)" : ""}
                                                </option>
                                            ))}
                                        </select>
                                        {renderSlotPlayButton(slot)}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* 🎵 音效素材库（华强调的核心音频池） */}
            <div className="g-card overflow-hidden">
                <div className="p-4 flex items-center justify-between border-b border-[var(--c-border-light)]/60 bg-[var(--c-sub-bg)]/40">
                    <div className="flex items-center gap-2.5">
                        <span
                            className="w-8 h-8 rounded-full flex items-center justify-center text-white shadow-xs"
                            style={{ backgroundColor: "#0284c7" }}
                        >
                            <Volume2 size={16} />
                        </span>
                        <div>
                            <div className="text-[14px] font-semibold text-[var(--c-text-title)]">音效素材库</div>
                            <div className="text-[11px] text-[var(--c-text-sub)]">
                                共 {soundLibrary.length} 个可用音频 · 供上方槽位直接选用
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={triggerUpload}
                            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-full bg-black text-white text-[12px] font-medium shadow-xs hover:bg-gray-800 active:scale-95 transition-all"
                        >
                            <Upload size={13} /> 上传音频
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setUrlName("");
                                setUrlValue("");
                                setIsUrlModalOpen(true);
                            }}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full border border-[var(--c-border-light)] bg-[var(--c-card-bg)] text-[12px] font-medium text-[var(--c-text-title)] hover:bg-[var(--c-sub-bg)] active:scale-95 transition-all"
                            title="添加网络音频链接"
                        >
                            <LinkIcon size={13} /> 链接
                        </button>
                    </div>
                </div>

                {/* 音频列表：清爽通透单层行排列 */}
                <div className="p-2 flex flex-col divide-y divide-[var(--c-border-light)]/40">
                    {soundLibrary.map(audio => {
                        const isPlaying = playingAudioId === audio.id;
                        const isBuiltin = audio.sourceType === "builtin";

                        return (
                            <div
                                key={audio.id}
                                className="flex items-center justify-between py-2.5 px-3 rounded-xl hover:bg-[var(--c-sub-bg)]/60 transition-colors"
                            >
                                <div className="flex items-center gap-3 min-w-0 pr-2">
                                    <button
                                        type="button"
                                        onClick={() => playAudioItem(audio)}
                                        className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all ${
                                            isPlaying
                                                ? "bg-red-500 text-white shadow-xs"
                                                : "bg-emerald-50 text-emerald-600 hover:bg-emerald-100"
                                        }`}
                                        title={isPlaying ? "停止播放" : "播放试听"}
                                    >
                                        {isPlaying ? (
                                            <Square size={13} className="fill-white" />
                                        ) : (
                                            <Play size={14} className="fill-emerald-600 ml-0.5" />
                                        )}
                                    </button>

                                    <div className="flex flex-col min-w-0">
                                        <span className="text-[13px] font-medium text-[var(--c-text-title)] truncate">
                                            {audio.name}
                                        </span>
                                        <div className="flex items-center gap-1.5 text-[11px] text-[var(--c-text-sub)]">
                                            {isBuiltin ? (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--c-input)] text-[var(--c-text-sub)]">
                                                    系统内置
                                                </span>
                                            ) : audio.sourceType === "url" ? (
                                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">
                                                    网络链接
                                                </span>
                                            ) : (
                                                <>
                                                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-600">
                                                        本地上传
                                                    </span>
                                                    {audio.dataUrl && (
                                                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-50 text-purple-600">
                                                            含离线备份
                                                        </span>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex items-center gap-1 shrink-0">
                                    {!isBuiltin ? (
                                        <>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setRenamingAudio(audio);
                                                    setRenamingAudioName(audio.name);
                                                    setIsRenameAudioModalOpen(true);
                                                }}
                                                className="p-1.5 rounded-lg text-[var(--c-text-sub)] hover:text-[var(--c-text-title)] hover:bg-[var(--c-card-bg)]"
                                                title="重命名音频"
                                            >
                                                <FileEdit size={15} />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setDeletingAudio(audio)}
                                                className="p-1.5 rounded-lg text-red-500 hover:bg-red-50"
                                                title="删除音频"
                                            >
                                                <Trash2 size={15} />
                                            </button>
                                        </>
                                    ) : (
                                        <span className="text-[11px] text-[var(--c-text-sub)]/70 px-2">系统保护</span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* 弹窗：重命名方案 */}
            {isRenameProfileModalOpen && (
                <div className="modal-overlay" data-ui="modal" onClick={() => setIsRenameProfileModalOpen(false)}>
                    <div
                        className="modal-dialog max-w-[340px]"
                        role="dialog"
                        aria-modal="true"
                        onClick={e => e.stopPropagation()}
                    >
                        <span className="modal-header-title">重命名音效方案</span>
                        <div className="modal-body">
                            <Input
                                value={renamingProfileName}
                                onChange={e => setRenamingProfileName(e.target.value)}
                                placeholder="输入方案名称"
                                autoFocus
                            />
                        </div>
                        <div className="modal-actions">
                            <button
                                type="button"
                                className="ui-btn ui-btn-outline"
                                onClick={() => setIsRenameProfileModalOpen(false)}
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                className="ui-btn ui-btn-primary"
                                onClick={() => {
                                    if (renamingProfileName.trim()) {
                                        updateProfile(prev => ({ ...prev, name: renamingProfileName.trim() }));
                                    }
                                    setIsRenameProfileModalOpen(false);
                                }}
                            >
                                保存
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 弹窗：重命名音频素材 */}
            {isRenameAudioModalOpen && (
                <div className="modal-overlay" data-ui="modal" onClick={() => setIsRenameAudioModalOpen(false)}>
                    <div
                        className="modal-dialog max-w-[340px]"
                        role="dialog"
                        aria-modal="true"
                        onClick={e => e.stopPropagation()}
                    >
                        <span className="modal-header-title">重命名音频素材</span>
                        <div className="modal-body">
                            <Input
                                value={renamingAudioName}
                                onChange={e => setRenamingAudioName(e.target.value)}
                                placeholder="输入音频名称"
                                autoFocus
                            />
                        </div>
                        <div className="modal-actions">
                            <button
                                type="button"
                                className="ui-btn ui-btn-outline"
                                onClick={() => setIsRenameAudioModalOpen(false)}
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                className="ui-btn ui-btn-primary"
                                onClick={handleSaveAudioRename}
                            >
                                保存
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 弹窗：添加网络音频链接 */}
            {isUrlModalOpen && (
                <div className="modal-overlay" data-ui="modal" onClick={() => setIsUrlModalOpen(false)}>
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
                                    value={urlName}
                                    onChange={e => setUrlName(e.target.value)}
                                    placeholder="如：清脆水晶声"
                                    autoFocus
                                />
                            </div>
                            <div>
                                <label className="text-[12px] text-[var(--c-text-sub)] mb-1 block">音频 URL</label>
                                <Input
                                    value={urlValue}
                                    onChange={e => setUrlValue(e.target.value)}
                                    placeholder="https://.../sound.mp3"
                                />
                            </div>
                        </div>
                        <div className="modal-actions">
                            <button
                                type="button"
                                className="ui-btn ui-btn-outline"
                                onClick={() => setIsUrlModalOpen(false)}
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                className="ui-btn ui-btn-primary"
                                disabled={!urlValue.trim()}
                                onClick={handleAddUrlAudio}
                            >
                                添加到素材库
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 确认删除音频对话框 */}
            {deletingAudio && (
                <ConfirmDialog
                    title="删除音频素材"
                    message={`确定要从素材库中删除「${deletingAudio.name}」吗？若当前方案正使用该音频，将自动回退到系统内置默认音效。`}
                    onConfirm={handleConfirmDeleteAudio}
                    onCancel={() => setDeletingAudio(null)}
                />
            )}

            {/* 确认删除方案对话框 */}
            {deletingProfileId && (
                <ConfirmDialog
                    title="删除音效方案"
                    message="确定要删除该音效方案吗？删除后绑定该方案的角色将自动回退到全局默认方案。"
                    onConfirm={() => handleDeleteProfile(deletingProfileId)}
                    onCancel={() => setDeletingProfileId(null)}
                />
            )}
        </div>
    );
}
