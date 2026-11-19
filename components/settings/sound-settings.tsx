"use client";

import { useState, useEffect, useRef, useContext, type ChangeEvent } from "react";
import {
    Plus,
    Play,
    Pause,
    Volume2,
    Trash2,
    FileEdit,
    Upload,
    PhoneCall,
    MessageSquare,
    Bell,
    Send,
    PhoneIncoming,
    PhoneOutgoing,
    PhoneOff,
    Check,
} from "lucide-react";
import { SettingsContext } from "../phone-settings-app";
import type { SoundProfileConfig, SoundAudioItem } from "@/lib/settings-types";
import {
    loadSoundProfiles,
    saveSoundProfiles,
    createDefaultSoundProfile,
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
    icon: typeof Bell;
    defaultBuiltinId: string;
};

const MESSAGE_SLOTS: SlotMeta[] = [
    {
        kind: "newMessage",
        title: "新消息提示音",
        icon: Bell,
        defaultBuiltinId: "builtin_new_msg",
    },
    {
        kind: "sendMessage",
        title: "发消息提示音",
        icon: Send,
        defaultBuiltinId: "builtin_send_msg",
    },
];

const CALL_SLOTS: SlotMeta[] = [
    {
        kind: "incomingCall",
        title: "对方来电音",
        icon: PhoneIncoming,
        defaultBuiltinId: "builtin_incoming_call",
    },
    {
        kind: "outgoingCall",
        title: "我方致电音",
        icon: PhoneOutgoing,
        defaultBuiltinId: "builtin_outgoing_call",
    },
    {
        kind: "hangup",
        title: "挂断音",
        icon: PhoneOff,
        defaultBuiltinId: "builtin_hangup",
    },
];

// Web Audio 合成器（为系统内置声音提供即时真实试听反馈）
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
        // 静默
    }
}

export function SoundSettings() {
    const { setSubpageTitle } = useContext(SettingsContext);

    const [profiles, setProfiles] = useState<SoundProfileConfig[]>([]);
    const [activeProfileId, setActiveProfileId] = useState<string>("");

    // 音效素材库
    const [soundLibrary, setSoundLibrary] = useState<SoundAudioItem[]>([]);

    // 正在试听的音频 ID
    const [playingAudioId, setPlayingAudioId] = useState<string | null>(null);

    // 弹窗状态：重命名音频
    const [isRenameAudioModalOpen, setIsRenameAudioModalOpen] = useState(false);
    const [renamingAudio, setRenamingAudio] = useState<SoundAudioItem | null>(null);
    const [renamingAudioName, setRenamingAudioName] = useState("");

    // 弹窗状态：删除音频
    const [deletingAudio, setDeletingAudio] = useState<SoundAudioItem | null>(null);

    // 弹窗状态：方案管理
    const [isCreateProfileModalOpen, setIsCreateProfileModalOpen] = useState(false);
    const [newProfileName, setNewProfileName] = useState("");
    const [isRenameProfileModalOpen, setIsRenameProfileModalOpen] = useState(false);
    const [renamingProfileName, setRenamingProfileName] = useState("");
    const [deletingProfileId, setDeletingProfileId] = useState<string | null>(null);

    // Toast 提示
    const [toast, setToast] = useState<string | null>(null);
    const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const showToast = (msg: string) => {
        if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
        setToast(msg);
        toastTimerRef.current = setTimeout(() => setToast(null), 2400);
    };

    // 文件上传 ref
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    // 播放器实例
    const activeAudioRef = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
        setSubpageTitle("音效设置");

        const loadedProfiles = loadSoundProfiles();
        setProfiles(loadedProfiles);
        if (loadedProfiles.length > 0) {
            setActiveProfileId(loadedProfiles[0].id);
        }

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

    const updateProfile = (updater: (prev: SoundProfileConfig) => SoundProfileConfig) => {
        if (!activeProfile) return;
        const nextProfile = updater(activeProfile);
        nextProfile.updatedAt = Date.now();
        const nextList = profiles.map(p => (p.id === nextProfile.id ? nextProfile : p));
        setProfiles(nextList);
        saveSoundProfiles(nextList);
    };

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

    const handleOpenCreateProfileModal = () => {
        setNewProfileName(`音效方案 ${profiles.length + 1}`);
        setIsCreateProfileModalOpen(true);
    };

    const handleConfirmCreateProfile = () => {
        const name = newProfileName.trim() || `音效方案 ${profiles.length + 1}`;
        const base = createDefaultSoundProfile();
        const newId = `sound_profile_${Date.now()}`;
        const newProfile: SoundProfileConfig = {
            ...base,
            id: newId,
            name,
            description: "用户专属配置的音效方案",
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        const nextList = [...profiles, newProfile];
        setProfiles(nextList);
        saveSoundProfiles(nextList);
        setActiveProfileId(newId);
        setIsCreateProfileModalOpen(false);
        showToast("✓ 已新建并应用方案");
    };

    const handleDeleteProfile = (id: string) => {
        if (profiles.length <= 1) return;
        const nextList = profiles.filter(p => p.id !== id);
        setProfiles(nextList);
        saveSoundProfiles(nextList);
        if (activeProfileId === id) {
            setActiveProfileId(nextList[0].id);
        }
        setDeletingProfileId(null);
        showToast("✓ 音效方案已删除");
    };

    const handleSaveCurrentProfile = () => {
        if (!activeProfile) return;
        saveSoundProfiles(profiles);
        showToast("✓ 音效方案配置已保存");
    };

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

    const handleSaveAudioRename = () => {
        if (!renamingAudio || !renamingAudioName.trim()) return;
        const newName = renamingAudioName.trim();
        const nextLibrary = soundLibrary.map(item =>
            item.id === renamingAudio.id ? { ...item, name: newName } : item
        );
        setSoundLibrary(nextLibrary);
        saveSoundLibrary(nextLibrary);

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

    const handleConfirmDeleteAudio = () => {
        if (!deletingAudio || deletingAudio.sourceType === "builtin") return;
        const targetId = deletingAudio.id;
        const nextLibrary = soundLibrary.filter(item => item.id !== targetId);
        setSoundLibrary(nextLibrary);
        saveSoundLibrary(nextLibrary);

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

    // 纯粹的极简圆形播放试听按钮（深灰色圆圈双竖线 ⏸，闲置为中性浅灰圆圈小三角 ▶）
    const renderCirclePlayButton = (slot: SlotMeta) => {
        const channel = activeProfile[slot.kind];
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
                className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 transition-all ${
                    isPlaying
                        ? "bg-neutral-800 text-white shadow-xs"
                        : "bg-black/5 hover:bg-black/10 text-neutral-700 active:scale-95"
                }`}
                title={isPlaying ? "停止" : "播放"}
                aria-label={isPlaying ? "停止" : "播放"}
            >
                {isPlaying ? (
                    <Pause size={12} className="fill-white text-white" />
                ) : (
                    <Play size={12} className="fill-neutral-700 text-neutral-700 ml-0.5" />
                )}
            </button>
        );
    };

    return (
        <div className="flex flex-col gap-5 pb-12 px-1 text-[var(--c-text-title)] relative">
            {/* 优雅悬浮 Toast 提示 */}
            {toast && (
                <div className="fixed top-14 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-full bg-black/85 backdrop-blur-md text-white text-[12px] font-medium shadow-lg transition-all flex items-center gap-1.5 pointer-events-none animate-fade-in">
                    <span>{toast}</span>
                </div>
            )}

            <input
                ref={fileInputRef}
                type="file"
                accept="audio/*"
                className="hidden"
                onChange={handleFileSelected}
            />

            {/* 1. 当前方案管理 */}
            <div className="flex flex-col gap-2.5">
                <p className="settings-menu-section-title">PROFILE MANAGEMENT</p>
                <div className="menu-group p-4 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                        <span className="text-[13px] font-medium text-[var(--c-text-title)]">当前方案</span>
                        <button
                            type="button"
                            onClick={handleOpenCreateProfileModal}
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
                                    showToast("已切换音效方案");
                                }}
                                className="ui-select w-full pr-8 text-[13px]"
                            >
                                {profiles.map(p => (
                                    <option key={p.id} value={p.id}>
                                        {p.name}
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

                    <div className="pt-1 flex items-center justify-end border-t border-black/[0.045]">
                        <button
                            type="button"
                            onClick={handleSaveCurrentProfile}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/[0.05] hover:bg-black/[0.08] active:scale-95 text-[12px] font-medium text-[var(--c-text-title)] transition-all"
                        >
                            <Check size={13} /> 保存/更新当前配置
                        </button>
                    </div>
                </div>
            </div>

            {/* 2. 消息音效 */}
            <div className="flex flex-col gap-2.5">
                <p className="settings-menu-section-title">MESSAGE SOUNDS</p>
                <div className="menu-group">
                    <div className="menu-item data-readonly-item">
                        <span
                            className="card-icon"
                            style={{
                                color: BINDING_ACCENTS.preset,
                                backgroundColor: `${BINDING_ACCENTS.preset}18`,
                            }}
                        >
                            <MessageSquare size={20} strokeWidth={1.8} />
                        </span>
                        <div className="menu-label-group">
                            <span className="menu-label">消息音效</span>
                        </div>
                        <span className="menu-right">
                            <Toggle
                                checked={activeProfile.messageSoundsEnabled}
                                onChange={checked => {
                                    updateProfile(prev => ({ ...prev, messageSoundsEnabled: checked }));
                                }}
                            />
                        </span>
                    </div>

                    {activeProfile.messageSoundsEnabled && (
                        <div className="px-4 pb-4 pt-2 flex flex-col gap-3.5 border-t border-black/[0.045]">
                            {/* 新消息提示音 */}
                            <div className="flex flex-col gap-1.5">
                                <span className="text-[12px] font-medium text-[var(--c-text-sub,#64748b)]">
                                    新消息提示音
                                </span>
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
                                    {renderCirclePlayButton(MESSAGE_SLOTS[0])}
                                </div>
                                <div className="flex items-center justify-between pt-1 text-[12px] text-[var(--c-text-sub)]">
                                    <span>防连续轰炸（一轮连续消息仅响一次）</span>
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

                            {/* 极细微线分隔 */}
                            <div className="border-t border-black/[0.045]" />

                            {/* 发消息提示音 */}
                            <div className="flex flex-col gap-1.5">
                                <span className="text-[12px] font-medium text-[var(--c-text-sub,#64748b)]">
                                    发消息提示音
                                </span>
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
                                    {renderCirclePlayButton(MESSAGE_SLOTS[1])}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* 3. 通话音效 */}
            <div className="flex flex-col gap-2.5">
                <p className="settings-menu-section-title">CALL SOUNDS</p>
                <div className="menu-group">
                    <div className="menu-item data-readonly-item">
                        <span
                            className="card-icon"
                            style={{
                                color: "#8b5cf6",
                                backgroundColor: "#8b5cf618",
                            }}
                        >
                            <PhoneCall size={20} strokeWidth={1.8} />
                        </span>
                        <div className="menu-label-group">
                            <span className="menu-label">通话音效</span>
                        </div>
                        <span className="menu-right">
                            <Toggle
                                checked={activeProfile.callSoundsEnabled}
                                onChange={checked => {
                                    updateProfile(prev => ({ ...prev, callSoundsEnabled: checked }));
                                }}
                            />
                        </span>
                    </div>

                    {activeProfile.callSoundsEnabled && (
                        <div className="px-4 pb-4 pt-2 flex flex-col gap-3.5 border-t border-black/[0.045]">
                            {CALL_SLOTS.map((slot, idx) => {
                                const slotVal = activeProfile[slot.kind]?.activeAudioId || slot.defaultBuiltinId;

                                return (
                                    <div key={slot.kind} className="flex flex-col gap-1.5">
                                        {idx > 0 && <div className="border-t border-black/[0.045] mb-2" />}
                                        <span className="text-[12px] font-medium text-[var(--c-text-sub,#64748b)]">
                                            {slot.title}
                                        </span>
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
                                            {renderCirclePlayButton(slot)}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* 4. 音效素材库 */}
            <div className="flex flex-col gap-2.5">
                <p className="settings-menu-section-title">SOUND LIBRARY</p>
                <div className="menu-group p-4 flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                            <span
                                className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                                style={{ color: "#0284c7", backgroundColor: "#0284c718" }}
                            >
                                <Volume2 size={16} strokeWidth={1.8} />
                            </span>
                            <div>
                                <span className="text-[13.5px] font-semibold text-[var(--c-text-title)]">音效素材库</span>
                                <span className="text-[11px] text-[var(--c-text-sub)] ml-1.5">
                                    ({soundLibrary.length})
                                </span>
                            </div>
                        </div>

                        <button
                            type="button"
                            onClick={triggerUpload}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black text-white text-[12px] font-medium shadow-xs hover:bg-gray-800 active:scale-95 transition-all"
                        >
                            <Upload size={13} /> 上传音频
                        </button>
                    </div>

                    <div className="flex flex-col gap-1.5 pt-1">
                        {soundLibrary.map(audio => {
                            const isPlaying = playingAudioId === audio.id;
                            const isBuiltin = audio.sourceType === "builtin";

                            return (
                                <div
                                    key={audio.id}
                                    className="flex items-center justify-between py-2 px-2.5 rounded-xl bg-[var(--c-sub-bg)]/50 hover:bg-[var(--c-sub-bg)] transition-colors"
                                >
                                    <div className="flex items-center gap-2.5 min-w-0 pr-2">
                                        <button
                                            type="button"
                                            onClick={() => playAudioItem(audio)}
                                            className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 transition-all ${
                                                isPlaying
                                                    ? "bg-neutral-800 text-white shadow-xs"
                                                    : "bg-black/5 hover:bg-black/10 text-neutral-700 active:scale-95"
                                            }`}
                                            title={isPlaying ? "停止" : "播放"}
                                        >
                                            {isPlaying ? (
                                                <Pause size={11} className="fill-white text-white" />
                                            ) : (
                                                <Play size={11} className="fill-neutral-700 text-neutral-700 ml-0.5" />
                                            )}
                                        </button>

                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="text-[12.5px] font-medium text-[var(--c-text-title)] truncate">
                                                {audio.name}
                                            </span>
                                            {isBuiltin ? (
                                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-black/5 text-[var(--c-text-sub)] shrink-0">
                                                    内置
                                                </span>
                                            ) : (
                                                <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-600 shrink-0">
                                                    本地
                                                </span>
                                            )}
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
                                                    className="p-1 rounded-md text-[var(--c-text-sub)] hover:text-[var(--c-text-title)]"
                                                    title="重命名音频"
                                                >
                                                    <FileEdit size={14} />
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => setDeletingAudio(audio)}
                                                    className="p-1 rounded-md text-red-500 hover:bg-red-50"
                                                    title="删除音频"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </>
                                        ) : (
                                            <span className="text-[10.5px] text-[var(--c-text-sub)]/60 px-1.5">保护</span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* 弹窗：新建方案 */}
            {isCreateProfileModalOpen && (
                <div className="modal-overlay" data-ui="modal" onClick={() => setIsCreateProfileModalOpen(false)}>
                    <div
                        className="modal-dialog max-w-[340px]"
                        role="dialog"
                        aria-modal="true"
                        onClick={e => e.stopPropagation()}
                    >
                        <span className="modal-header-title">新建音效方案</span>
                        <div className="modal-body flex flex-col gap-2">
                            <span className="text-[12px] text-[var(--c-text-sub)]">为这套音效方案起一个名字：</span>
                            <Input
                                value={newProfileName}
                                onChange={e => setNewProfileName(e.target.value)}
                                placeholder="输入方案名称"
                                autoFocus
                            />
                        </div>
                        <div className="modal-actions">
                            <button
                                type="button"
                                className="ui-btn ui-btn-outline"
                                onClick={() => setIsCreateProfileModalOpen(false)}
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                className="ui-btn ui-btn-primary"
                                onClick={handleConfirmCreateProfile}
                            >
                                确认创建
                            </button>
                        </div>
                    </div>
                </div>
            )}

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
                                        showToast("✓ 方案名称已更新");
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

            {/* 确认删除音频对话框 */}
            {deletingAudio && (
                <ConfirmDialog
                    title="删除音频素材"
                    message={`确定要从素材库中删除「${deletingAudio.name}」吗？若当前方案正使用该音频，将自动回退到默认音效。`}
                    onConfirm={handleConfirmDeleteAudio}
                    onCancel={() => setDeletingAudio(null)}
                />
            )}

            {/* 确认删除方案对话框 */}
            {deletingProfileId && (
                <ConfirmDialog
                    title="删除音效方案"
                    message="确定要删除该音效方案吗？删除后绑定该方案的角色将自动回退到默认方案。"
                    onConfirm={() => handleDeleteProfile(deletingProfileId)}
                    onCancel={() => setDeletingProfileId(null)}
                />
            )}
        </div>
    );
}
