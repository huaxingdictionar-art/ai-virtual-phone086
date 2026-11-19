"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Filter,
  Download,
  Upload,
  Image as ImageIcon,
  MessageCircle,
  Search,
  Trash2,
  Users,
  X,
  Play,
  Pause,
  Volume2,
} from "lucide-react";

import { ChatPageHeader } from "@/components/chat/chat-page-header";
import {
  deleteFavoriteItems,
  FAVORITES_UPDATED_EVENT,
  listFavoriteItems,
  putFavoriteItem,
  type FavoriteEntry,
  type FavoriteItem,
} from "@/lib/favorites-storage";
import { getChatImageFromIndexedDB } from "@/lib/chat-asset-storage";
import { isMediaStoreRef, loadMediaObjectUrl } from "@/lib/media-cache-storage";
import { downloadFile } from "@/lib/download-utils";

type FavoritesTab = "chat" | "story" | "recent";

type EntitySummary = {
  key: string;
  id: string;
  type: FavoriteItem["entityType"];
  name: string;
  participantNames: string[];
  count: number;
  latestAt: string;
};

function formatDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getItemDisplayTags(item: FavoriteItem): string[] {
  return item.tags.map(tag => {
    if (tag === "聊天") {
      return item.entityType === "group" ? "群聊" : "私聊";
    }
    return tag;
  });
}

function itemHasTag(item: FavoriteItem, tag: string): boolean {
  if (item.tags.includes(tag)) return true;
  if (tag === "群聊" && (item.tags.includes("聊天") && item.entityType === "group")) return true;
  if (tag === "私聊" && (item.tags.includes("聊天") && item.entityType !== "group")) return true;
  return false;
}

function matchesText(item: FavoriteItem, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    item.entityName,
    item.containerName,
    item.title,
    item.preview,
    item.participantNames.join(" "),
    getItemDisplayTags(item).join(" "),
    item.tags.join(" "),
    item.entries.map(entry => `${entry.senderName} ${entry.content} ${entry.imageDescription || ""}`).join(" "),
  ].join(" ").toLowerCase().includes(needle);
}

function categoryMatches(item: FavoriteItem, tab: FavoritesTab): boolean {
  if (tab === "recent") return true;
  return item.category === tab;
}

function FavoriteImage({ entry }: { entry: FavoriteEntry }) {
  const src = useFavoriteMediaUrl(entry.mediaUrl);

  if (!src) {
    return entry.imageDescription ? <p className="favorites-image-description">{entry.imageDescription}</p> : null;
  }
  return <img className="favorites-entry-image" src={src} alt={entry.imageDescription || "收藏图片"} />;
}

function useFavoriteMediaUrl(rawUrl?: string): string | null {
  const [src, setSrc] = useState<string | null>(() => {
    const raw = rawUrl || "";
    return /^(?:data:|https?:|blob:|\/)/i.test(raw) ? raw : null;
  });

  useEffect(() => {
    const raw = rawUrl || "";
    if (!raw) {
      setSrc(null);
      return;
    }
    if (/^(?:data:|https?:|blob:|\/)/i.test(raw)) {
      setSrc(raw);
      return;
    }
    setSrc(null);
    let cancelled = false;
    let objectUrl: string | null = null;
    const storedMedia = isMediaStoreRef(raw);
    const load = storedMedia ? loadMediaObjectUrl(raw) : getChatImageFromIndexedDB(raw.replace(/^asset:\/\//, ""));
    void load.then(value => {
      if (!value) return;
      if (cancelled) {
        if (storedMedia) URL.revokeObjectURL(value);
        return;
      }
      if (storedMedia) objectUrl = value;
      setSrc(value);
    }).catch(() => { if (!cancelled) setSrc(null); });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [rawUrl]);

  return src;
}

function FavoriteVideo({ entry }: { entry: FavoriteEntry }) {
  const src = useFavoriteMediaUrl(entry.mediaUrl);
  return src ? <video className="favorites-entry-image" controls preload="metadata" src={src} onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} /> : <span>原视频文件已不可用</span>;
}

function FavoriteAudio({ entry }: { entry: FavoriteEntry }) {
  const src = useFavoriteMediaUrl(entry.mediaUrl);
  const label = typeof entry.mediaData?.label === "string" ? entry.mediaData.label.trim() : "";
  const duration = typeof entry.mediaData?.voiceDuration === "number" ? Math.ceil(entry.mediaData.voiceDuration) : null;
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const togglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!audioRef.current || !src) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current.play().then(() => setIsPlaying(true)).catch(() => setIsPlaying(false));
    }
  };

  const transcription = label || (entry.content && !entry.content.startsWith("[语音") ? entry.content : "");

  return (
    <div className="favorites-voice-wrap" onClick={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()}>
      {src && (
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          onEnded={() => setIsPlaying(false)}
          onPause={() => setIsPlaying(false)}
          onError={() => setIsPlaying(false)}
          className="hidden"
        />
      )}
      <button
        type="button"
        onClick={togglePlay}
        disabled={!src}
        className={`favorites-voice-pill ${isPlaying ? "is-playing" : ""}`}
        title={isPlaying ? "停止播放" : "播放语音"}
      >
        <span className="favorites-voice-icon">
          {isPlaying ? <Pause size={12} className="fill-current" /> : <Play size={12} className="fill-current ml-0.5" />}
        </span>
        <span className="favorites-voice-wave">
          <Volume2 size={15} className={isPlaying ? "animate-pulse" : ""} />
        </span>
        <span className="favorites-voice-duration">{duration ? `${duration}"` : "语音"}</span>
      </button>
      {transcription && (
        <div className="favorites-voice-transcription">
          <span className="favorites-voice-transcription-tag">转文字</span>
          <p className="favorites-voice-transcription-text">{transcription}</p>
        </div>
      )}
    </div>
  );
}

type ParsedFavoriteContent = {
  visible: string;
  summary?: string;
  thoughts: string[];
};

function parseFavoriteContent(content: string, isStory = false): ParsedFavoriteContent {
  let text = content || "";
  const thoughts: string[] = [];
  let summary: string | undefined;

  // 1. 提取 <think> / <thinking>
  text = text
    .replace(/<(think|thinking)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_match, _tag: string, body: string) => {
      const thought = body.trim();
      if (thought) thoughts.push(thought);
      return "\n";
    })
    .replace(/<(think|thinking)\b[^>]*>([\s\S]*)$/gi, (_match, _tag: string, body: string) => {
      const thought = body.trim();
      if (thought) thoughts.push(thought);
      return "\n";
    });

  // 2. 提取 <summary> 剧情概要
  text = text
    .replace(/<summary\b[^>]*>([\s\S]*?)<\/summary>/gi, (_match, body: string) => {
      const s = body.trim();
      if (s) summary = s;
      return "\n";
    })
    .replace(/<summary\b[^>]*>([\s\S]*)$/gi, (_match, body: string) => {
      const s = body.trim();
      if (s) summary = s;
      return "\n";
    });

  // 3. 提取 <content> 剧情正文（剥离代码格式标签，还原干净的小说段落）
  const contentMatch = text.match(/<content\b[^>]*>([\s\S]*?)<\/content>/i);
  if (contentMatch) {
    text = contentMatch[1].trim();
  } else {
    // 兼容没有闭合或零散标签的情况
    text = text.replace(/<\/?content\b[^>]*>/gi, "").trim();
  }

  // 4. 全面防御性剔除任何残留的代码/XML格式标签（如残存的 <summary>、<thought>、<context> 等）
  text = text
    .replace(/<\/?(summary|content|think|thinking|narrative|scene|dialogue|system|instruction|user|assistant|context)\b[^>]*>/gi, "")
    .replace(/<[a-zA-Z_][a-zA-Z0-9_-]*(?:\s+[^>]*)?>[\s\S]*?<\/[a-zA-Z_][a-zA-Z0-9_-]*>/g, (block) => {
      return block.replace(/<\/?[a-zA-Z_][a-zA-Z0-9_-]*(?:\s+[^>]*)?>/g, "");
    })
    .replace(/<\/?[a-zA-Z_][a-zA-Z0-9_-]*(?:\s+[^>]*)?>/g, "")
    .trim();

  // 5. 清理残留的多余空行
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  return { visible: text, summary, thoughts };
}

function FavoriteEntryView({
  entry,
  compact = false,
  isStory = false,
}: {
  entry: FavoriteEntry;
  compact?: boolean;
  isStory?: boolean;
}) {
  const parsed = parseFavoriteContent(entry.content, isStory);
  const mediaType = entry.mediaType === "media_file" ? entry.mediaData?.fileType : entry.mediaType;
  const isUser = entry.role === "user";

  return (
    <div
      className={`favorites-entry ${isStory ? "is-story-entry" : "is-chat-entry"} ${isUser ? "is-user-entry" : "is-peer-entry"}`}
      data-role={entry.role}
    >
      <div className="favorites-entry-meta">
        <div className="favorites-sender-wrap">
          <strong className="favorites-sender-name">{entry.senderName}</strong>
          {isStory ? (
            <span className="favorites-role-badge is-story">剧情</span>
          ) : isUser ? (
            <span className="favorites-role-badge is-user">我</span>
          ) : (
            <span className="favorites-role-badge is-peer">角色</span>
          )}
          {mediaType === "audio" && (
            <span className="favorites-type-badge">语音</span>
          )}
          {mediaType === "image" && (
            <span className="favorites-type-badge">图片</span>
          )}
        </div>
        <div className="favorites-entry-time" title={isStory ? "角色所处的剧情时空时间" : "消息发送时间"}>
          {isStory ? (
            <span className="favorites-story-time">
              <Clock size={10.5} className="shrink-0 opacity-70" />
              <span>剧中 {formatDate(entry.createdAt)}</span>
            </span>
          ) : (
            <span className="favorites-chat-time">
              <Clock size={10.5} className="shrink-0 opacity-60" />
              <span>{formatDate(entry.createdAt)}</span>
            </span>
          )}
        </div>
      </div>

      {parsed.visible && mediaType !== "audio" && (
        <div className={`favorites-content-box ${isStory ? "is-story-box" : "is-chat-bubble"} ${isUser ? "is-user-bubble" : ""}`}>
          <p className={`favorites-entry-text ${compact ? "is-compact" : ""} ${isStory ? "is-story-text" : "is-chat-text"}`}>
            {parsed.visible}
          </p>
        </div>
      )}

      {/* 剧情概要（SUMMARY）精致优雅板块 */}
      {parsed.summary && !compact && (
        <div className="favorites-story-summary">
          <div className="favorites-story-summary-divider">
            <span className="favorites-story-summary-line" />
            <span className="favorites-story-summary-title">SUMMARY · 剧情概要</span>
            <span className="favorites-story-summary-line" />
          </div>
          <p className="favorites-story-summary-text">{parsed.summary}</p>
        </div>
      )}

      {mediaType === "image" && <FavoriteImage entry={entry} />}
      {mediaType === "audio" && <FavoriteAudio entry={entry} />}
      {mediaType === "video" && <FavoriteVideo entry={entry} />}
      {mediaType === "sticker" && (
        <FavoriteImage
          entry={{
            ...entry,
            mediaUrl:
              typeof entry.mediaData?.stickerUrl === "string"
                ? entry.mediaData.stickerUrl
                : entry.mediaUrl,
          }}
        />
      )}

      {parsed.thoughts.length > 0 &&
        (compact ? (
          <div className="favorites-thinking-compact">思考过程已折叠</div>
        ) : (
          <details className="favorites-thinking">
            <summary>
              <span>思考内容</span>
              <ChevronRight size={14} />
            </summary>
            <div>
              {parsed.thoughts.map((thought, index) => (
                <p key={index}>{thought}</p>
              ))}
            </div>
          </details>
        ))}
    </div>
  );
}

export function FavoritesApp({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<FavoriteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<FavoritesTab>("recent");
  const [query, setQuery] = useState("");
  const [selectedEntity, setSelectedEntity] = useState<EntitySummary | null>(null);
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [filterOpen, setFilterOpen] = useState(false);
  const [detailItem, setDetailItem] = useState<FavoriteItem | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dataOpen, setDataOpen] = useState(false);
  const [transferBusy, setTransferBusy] = useState("");
  const [transferStatus, setTransferStatus] = useState("");
  const importInput = useRef<HTMLInputElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressStarted = useRef(false);

  const refresh = useCallback(async () => {
    setItems(await listFavoriteItems());
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
    window.addEventListener(FAVORITES_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(FAVORITES_UPDATED_EVENT, refresh);
  }, [refresh]);

  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      if (categoryMatches(item, tab)) {
        getItemDisplayTags(item).forEach(tag => set.add(tag));
      }
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [items, tab]);

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (!categoryMatches(item, tab)) return false;
      if (selectedEntity) {
        const matchesEntity = item.entityType === selectedEntity.type && item.entityId === selectedEntity.id;
        const matchesParticipant = item.participantIds.includes(selectedEntity.id);
        if (!matchesEntity && !matchesParticipant) return false;
      }
      if (selectedTags.size > 0 && !Array.from(selectedTags).every(tag => itemHasTag(item, tag))) {
        return false;
      }
      return matchesText(item, query);
    });
  }, [items, query, selectedEntity, selectedTags, tab]);

  const entities = useMemo(() => {
    const map = new Map<string, EntitySummary>();
    for (const item of items) {
      if (!categoryMatches(item, tab)) continue;
      if (selectedTags.size > 0 && !Array.from(selectedTags).every(tag => itemHasTag(item, tag))) continue;
      if (!matchesText(item, query)) continue;
      const key = `${item.entityType}:${item.entityId}`;
      const current = map.get(key);
      if (current) {
        current.count += 1;
        if (item.createdAt > current.latestAt) current.latestAt = item.createdAt;
      } else {
        map.set(key, {
          key,
          id: item.entityId,
          type: item.entityType,
          name: item.entityName,
          participantNames: item.participantNames,
          count: 1,
          latestAt: item.createdAt,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) => b.latestAt.localeCompare(a.latestAt));
  }, [items, query, selectedTags, tab]);

  const toggleTag = (tag: string) => {
    setSelectedTags(previous => {
      const next = new Set(previous);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const enterSelection = (id: string) => {
    setSelectedIds(previous => new Set(previous).add(id));
  };

  const handleCardPointerDown = (event: React.PointerEvent, id: string) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    longPressStarted.current = false;
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      longPressStarted.current = true;
      enterSelection(id);
      longPressTimer.current = null;
    }, 500);
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };

  const handleCardClick = (item: FavoriteItem) => {
    if (longPressStarted.current) {
      longPressStarted.current = false;
      return;
    }
    if (selectedIds.size) {
      setSelectedIds(previous => {
        const next = new Set(previous);
        if (next.has(item.id)) next.delete(item.id);
        else next.add(item.id);
        return next;
      });
      return;
    }
    setDetailItem(item);
  };

  const removeSelected = async () => {
    await deleteFavoriteItems(Array.from(selectedIds));
    setSelectedIds(new Set());
    await refresh();
  };

  const goBack = () => {
    if (selectedIds.size) {
      setSelectedIds(new Set());
      return;
    }
    if (selectedEntity) {
      setSelectedEntity(null);
      setQuery("");
      return;
    }
    onClose();
  };

  const exportFavoritesJson = () => {
    if (items.length === 0) {
      setTransferStatus("当前没有可导出的收藏");
      return;
    }
    const data = JSON.stringify({ version: 1, exportAt: new Date().toISOString(), items }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    void downloadFile(blob, `收藏备份-${Date.now()}.json`);
    setTransferStatus(`成功导出 ${items.length} 条收藏备份`);
  };

  const importFavoritesJson = (file: File) => {
    setTransferBusy("正在导入…");
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(String(reader.result || "")) as { items?: FavoriteItem[] };
        const importedItems = Array.isArray(parsed.items) ? parsed.items : [];
        if (importedItems.length === 0) throw new Error("文件中没有有效的收藏数据");
        for (const it of importedItems) {
          await putFavoriteItem(it);
        }
        await refresh();
        setTransferStatus(`成功导入 ${importedItems.length} 条收藏！`);
      } catch (err) {
        setTransferStatus(err instanceof Error ? err.message : "导入失败：JSON 格式无效");
      } finally {
        setTransferBusy("");
      }
    };
    reader.readAsText(file);
  };

  return (
    <section className="favorites-app">
      <ChatPageHeader
        title={selectedIds.size ? `已选 ${selectedIds.size} 项` : selectedEntity?.name || "收藏"}
        left={<button className="page-header-btn" type="button" onClick={goBack} aria-label="返回"><ChevronLeft size={23} /></button>}
        right={selectedIds.size
          ? <button className="page-header-btn favorites-delete-head" type="button" onClick={() => void removeSelected()} aria-label="删除所选"><Trash2 size={19} /></button>
          : <div className="flex items-center gap-1">
              <button className="page-header-btn" type="button" onClick={() => setDataOpen(true)} aria-label="收藏导入导出"><Download size={19} /></button>
              <button className="page-header-btn" type="button" onClick={() => setFilterOpen(previous => !previous)} aria-label="筛选"><Filter size={19} /></button>
            </div>}
      />

      <input ref={importInput} type="file" accept=".json,application/json" className="hidden" onChange={event => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file) importFavoritesJson(file);
      }} />

      <div className="favorites-toolbar">
        <label className="favorites-search">
          <Search size={16} />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder={selectedEntity ? `搜索${selectedEntity.name}的收藏` : "搜索角色、群组或收藏内容"}
          />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="清空"><X size={14} /></button>}
        </label>
        {selectedTags.size > 0 && (
          <div className="favorites-active-tags">
            {Array.from(selectedTags).map(tag => <button type="button" key={tag} onClick={() => toggleTag(tag)}>{tag}<X size={11} /></button>)}
          </div>
        )}
      </div>

      {filterOpen && (
        <div className="favorites-filter-panel">
          <div><strong>按标签筛选</strong><button type="button" onClick={() => setSelectedTags(new Set())}>清空</button></div>
          <div className="favorites-filter-tags">
            {availableTags.length ? availableTags.map(tag => (
              <button type="button" key={tag} data-active={selectedTags.has(tag) ? "1" : "0"} onClick={() => toggleTag(tag)}>
                {selectedTags.has(tag) && <Check size={12} />}{tag}
              </button>
            )) : <span>还没有可筛选的标签</span>}
          </div>
        </div>
      )}

      <main className="favorites-main">
        {loading ? (
          <div className="favorites-empty">正在读取收藏…</div>
        ) : !selectedEntity ? (
          entities.length ? <div className="favorites-entity-list">
            {entities.map(entity => (
              <button type="button" className="favorites-entity-card" key={entity.key} onClick={() => { setSelectedEntity(entity); setQuery(""); }}>
                <span className="favorites-entity-icon">{entity.type === "group" ? <Users size={20} /> : <Bookmark size={20} />}</span>
                <span className="favorites-entity-copy">
                  <strong>{entity.name}</strong>
                  <small>{entity.type === "group" && entity.participantNames.length ? entity.participantNames.join("、") : `${entity.count} 项收藏`}</small>
                </span>
                <span className="favorites-entity-count">{entity.count}</span>
              </button>
            ))}
          </div> : <div className="favorites-empty"><Bookmark size={34} /><strong>还没有收藏</strong><span>长按聊天或剧情消息即可收藏</span></div>
        ) : filteredItems.length ? (
          <div className="favorites-card-list">
            {filteredItems.map(item => {
              const selected = selectedIds.has(item.id);
              const previewEntries = item.entries.slice(0, item.kind === "bundle" ? 2 : 1);
              return (
                <article
                  key={item.id}
                  className={`favorites-card ${item.category === "story" ? "is-story-card" : "is-chat-card"}`}
                  data-selected={selected ? "1" : "0"}
                  data-category={item.category}
                  onPointerDown={event => handleCardPointerDown(event, item.id)}
                  onPointerUp={cancelLongPress}
                  onPointerCancel={cancelLongPress}
                  onPointerLeave={cancelLongPress}
                  onClick={() => handleCardClick(item)}
                >
                  {selected && <span className="favorites-card-check"><Check size={13} /></span>}
                  <div className="favorites-card-entries">
                    {previewEntries.map(entry => (
                      <FavoriteEntryView
                        key={entry.id}
                        entry={entry}
                        compact
                        isStory={item.category === "story"}
                      />
                    ))}
                  </div>
                  {item.entries.length > previewEntries.length && (
                    <button className="favorites-expand-note" type="button">
                      展开全部 {item.entries.length} 条
                    </button>
                  )}
                  <footer>
                    <div className="favorites-card-footer-tags">
                      {getItemDisplayTags(item).map(tag => (
                        <span key={tag} className={item.category === "story" ? "is-story-tag" : "is-chat-tag"}>
                          {tag}
                        </span>
                      ))}
                    </div>
                    <div className="favorites-card-reality-time" title="现实世界收藏时间">
                      <span>现实</span>
                      <time>{formatDate(item.createdAt || item.sourceCreatedAt)}</time>
                    </div>
                  </footer>
                </article>
              );
            })}
          </div>
        ) : <div className="favorites-empty"><Search size={32} /><strong>没有找到内容</strong><span>可以调整搜索词或标签筛选</span></div>}
      </main>

      <nav className="favorites-tabs" aria-label="收藏分类">
        <button type="button" data-active={tab === "chat" ? "1" : "0"} onClick={() => { setTab("chat"); setSelectedEntity(null); }}><MessageCircle size={18} /><span>聊天室</span></button>
        <button type="button" data-active={tab === "story" ? "1" : "0"} onClick={() => { setTab("story"); setSelectedEntity(null); }}><Bookmark size={18} /><span>剧情</span></button>
        <button type="button" data-active={tab === "recent" ? "1" : "0"} onClick={() => { setTab("recent"); setSelectedEntity(null); }}><ImageIcon size={18} /><span>最近收藏</span></button>
      </nav>

      {dataOpen && (
        <div className="favorites-detail-backdrop" onClick={() => { if (!transferBusy) setDataOpen(false); }}>
          <section className="favorites-detail" role="dialog" aria-modal="true" aria-label="收藏导入导出" onClick={event => event.stopPropagation()}>
            <header><strong>收藏备份与导出</strong><button type="button" disabled={Boolean(transferBusy)} onClick={() => setDataOpen(false)} aria-label="关闭"><X size={19} /></button></header>
            <div className="favorites-detail-body flex flex-col gap-3">
              <p className="menu-desc">支持将你收藏的所有聊天记录、精彩台词、图片与动态无损备份为 JSON 文件，随时导入还原。</p>
              <button type="button" className="ui-btn ui-btn-primary" disabled={Boolean(transferBusy) || loading} onClick={exportFavoritesJson}><Download size={16} />导出全部收藏备份</button>
              <button type="button" className="ui-btn ui-btn-ghost" disabled={Boolean(transferBusy)} onClick={() => importInput.current?.click()}><Upload size={16} />导入收藏文件 (.json)</button>
              {transferStatus && <p className="menu-desc" role="status">{transferStatus}</p>}
            </div>
          </section>
        </div>
      )}

      {detailItem && (
        <div className="favorites-detail-backdrop" onClick={() => setDetailItem(null)}>
          <section
            className={`favorites-detail ${detailItem.category === "story" ? "is-story-detail" : ""}`}
            role="dialog"
            aria-modal="true"
            onClick={event => event.stopPropagation()}
          >
            <header className="favorites-detail-header">
              <span className={`favorites-detail-archive-tag ${detailItem.category === "story" ? "is-story" : "is-chat"}`}>
                {detailItem.category === "story" ? "STORY ARCHIVE" : "CHAT ARCHIVE"}
              </span>
              <span className="favorites-detail-reality-time">
                现实 {formatDate(detailItem.createdAt)}
              </span>
            </header>
            <div className="favorites-detail-body">
              {detailItem.entries.map(entry => (
                <FavoriteEntryView
                  key={entry.id}
                  entry={entry}
                  isStory={detailItem.category === "story"}
                />
              ))}
            </div>
            <footer>
              <div className="favorites-detail-footer-tags">
                {getItemDisplayTags(detailItem).map(tag => (
                  <span key={tag} className={detailItem.category === "story" ? "is-story-tag" : "is-chat-tag"}>
                    {tag}
                  </span>
                ))}
              </div>
              <button type="button" onClick={async () => { await deleteFavoriteItems([detailItem.id]); setDetailItem(null); await refresh(); }}><Trash2 size={15} />删除</button>
            </footer>
          </section>
        </div>
      )}
    </section>
  );
}
