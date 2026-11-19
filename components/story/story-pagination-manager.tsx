"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronDownIcon,
  ArrowDownTrayIcon,
  MagnifyingGlassIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from "@heroicons/react/24/solid";
import { Avatar } from "@/components/ui/primitives";
import type { Character } from "@/lib/character-types";
import type { StoryGroup, StorySession } from "@/lib/story-storage";
import { fileToUserAvatarDataUrl } from "@/lib/user-avatar-image";

export type StoryBranchCreateInput = {
  name: string;
  inheritRecentMemory: boolean;
  independentStory: boolean;
};

type StoryPaginationManagerProps = {
  characters: Character[];
  activeCharacterId: string;
  activeGroupId: string;
  groups: StoryGroup[];
  sessions: StorySession[];
  activeSessionId: string;
  userName: string;
  onCharacterChange: (characterId: string) => void;
  onGroupSelect: (groupId: string) => void;
  onGroupCreate: (characterIds: string[], name: string) => void;
  onGroupRename: (groupId: string, name: string) => void;
  onGroupDelete: (groupId: string) => void;
  onSessionSelect: (sessionId: string) => void;
  onBranchCreate: (input: StoryBranchCreateInput) => void;
  onBranchDelete: (sessionIds: string[]) => void;
  onSessionUpdate: (sessionId: string, updates: Partial<StorySession>) => void;
  onExportSession: (sessionId: string) => void;
  onExportSessions: (sessionIds: string[]) => void;
  onExportAll: () => void;
  onMergeBranches: (sessionIds: string[], deleteSources: boolean) => void;
};

function AvatarCollage({ characters, large = false, customAvatar }: { characters: Character[]; large?: boolean; customAvatar?: string }) {
  if (customAvatar) {
    return <span className={`story-custom-avatar${large ? " is-large" : ""}`}><img src={customAvatar} alt="剧情头像" /></span>;
  }
  const visible = characters.slice(0, 4);
  if (visible.length <= 1) {
    const character = visible[0];
    return <Avatar src={character?.avatar || undefined} name={character?.name || "剧情"} size="lg" />;
  }
  return (
    <div className={`story-group-avatar-grid${large ? " is-large" : ""}`} data-count={Math.min(visible.length, 4)}>
      {visible.map((character) => (
        <span key={character.id}><Avatar src={character.avatar || undefined} name={character.name} size={large ? "lg" : "sm"} /></span>
      ))}
    </div>
  );
}

export function StoryPaginationManager(props: StoryPaginationManagerProps) {
  const [catalogOpen, setCatalogOpen] = useState(false);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [branchModalOpen, setBranchModalOpen] = useState(false);
  const [selectedCharacterIds, setSelectedCharacterIds] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const [branchName, setBranchName] = useState("");
  const [inheritRecentMemory, setInheritRecentMemory] = useState(false);
  const [independentStory, setIndependentStory] = useState(false);
  const [batchMenuOpen, setBatchMenuOpen] = useState(false);
  const [batchAction, setBatchAction] = useState<"delete" | "export" | "merge" | null>(null);
  const [batchSelection, setBatchSelection] = useState<string[]>([]);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [branchesExpanded, setBranchesExpanded] = useState(true);
  const [independentExpanded, setIndependentExpanded] = useState(true);
  const [mergeConfirmOpen, setMergeConfirmOpen] = useState(false);
  const [deleteMergedBranches, setDeleteMergedBranches] = useState(false);
  const [tagDraft, setTagDraft] = useState("");
  const storyAvatarInputRef = useRef<HTMLInputElement>(null);

  const activeGroup = props.groups.find((group) => group.id === props.activeGroupId) || null;
  const activeOwnerCharacters = useMemo(() => {
    const ids = activeGroup?.characterIds || [props.activeCharacterId];
    return ids.map((id) => props.characters.find((character) => character.id === id)).filter((item): item is Character => Boolean(item));
  }, [activeGroup, props.activeCharacterId, props.characters]);
  const mainSession = props.sessions.find((session) => (session.branchId || "main") === "main") || props.sessions[0] || null;
  const activeSession = props.sessions.find((session) => session.id === props.activeSessionId) || mainSession;
  const title = activeGroup?.name || activeOwnerCharacters[0]?.name || "剧情";
  const pairText = activeGroup
    ? `${activeOwnerCharacters.map((character) => character.name).join(" × ")} × ${props.userName}`
    : `${activeOwnerCharacters[0]?.name || "char"} × ${props.userName}`;
  const tags = mainSession?.catalogTags || [];
  const catalogQuery = catalogSearch.trim().toLocaleLowerCase();
  const matchesCatalogSearch = (session: StorySession) => {
    const fallback = (session.branchId || "main") === "main" ? "主线剧情" : "分线剧情";
    return !catalogQuery || (session.branchName || session.title || fallback).toLocaleLowerCase().includes(catalogQuery);
  };
  const regularBranches = props.sessions.filter((session) => (session.branchId || "main") !== "main" && !session.independentStory && matchesCatalogSearch(session));
  const independentStories = props.sessions.filter((session) => (session.branchId || "main") !== "main" && session.independentStory && matchesCatalogSearch(session));

  useEffect(() => {
    setBatchSelection((current) => current.filter((id) => props.sessions.some((session) => session.id === id && (
      batchAction === "export"
      || (batchAction === "merge" ? (session.branchId || "main") !== "main" && !session.independentStory : (session.branchId || "main") !== "main")
    ))));
  }, [batchAction, props.sessions]);

  const beginBatchAction = (action: "delete" | "export" | "merge") => {
    setBatchAction(action);
    setBatchSelection([]);
    setBatchMenuOpen(false);
  };

  const finishBatchAction = () => {
    if (!batchAction || !batchSelection.length) return;
    if (batchAction === "delete") {
      if (!window.confirm(`删除选中的 ${batchSelection.length} 条分线？消息也会一并删除。`)) return;
      props.onBranchDelete(batchSelection);
    } else if (batchAction === "export") {
      props.onExportSessions(batchSelection);
    } else {
      setDeleteMergedBranches(false);
      setMergeConfirmOpen(true);
      return;
    }
    setBatchSelection([]);
    setBatchAction(null);
  };

  const confirmMergeBranches = () => {
    props.onMergeBranches(batchSelection, deleteMergedBranches);
    setMergeConfirmOpen(false);
    setBatchSelection([]);
    setBatchAction(null);
  };

  const openGroupModal = () => {
    setSelectedCharacterIds([]);
    setGroupName("");
    setGroupModalOpen(true);
  };

  const createGroup = () => {
    if (selectedCharacterIds.length < 2) return;
    const fallbackName = selectedCharacterIds
      .map((id) => props.characters.find((character) => character.id === id)?.name)
      .filter(Boolean)
      .join("、");
    props.onGroupCreate(selectedCharacterIds, groupName.trim() || fallbackName || "多人剧情");
    setGroupModalOpen(false);
  };

  const createBranch = () => {
    const name = branchName.trim();
    if (!name) return;
    props.onBranchCreate({
      name,
      inheritRecentMemory: independentStory ? false : inheritRecentMemory,
      independentStory,
    });
    setBranchName("");
    setInheritRecentMemory(false);
    setIndependentStory(false);
    setBranchModalOpen(false);
  };

  const addTag = () => {
    const tag = tagDraft.trim();
    if (!tag || !mainSession) return;
    props.onSessionUpdate(mainSession.id, { catalogTags: Array.from(new Set([...tags, tag])) });
    setTagDraft("");
  };

  const changeStoryAvatar = async (file?: File) => {
    if (!file || !mainSession) return;
    try {
      const avatar = await fileToUserAvatarDataUrl(file);
      props.onSessionUpdate(mainSession.id, { storyAvatar: avatar });
    } catch {
      window.alert("剧情头像处理失败，请换一张图片重试");
    }
  };

  const renderDirectoryRow = (session: StorySession, sectionLabel: string, index: number) => {
    const isMain = (session.branchId || "main") === "main";
    const isSelected = batchSelection.includes(session.id);
    const selectable = batchAction === "export" || (!isMain && batchAction !== "merge") || (batchAction === "merge" && !session.independentStory);
    return (
      <div key={session.id} className="story-directory-row" data-batch={batchAction ? "true" : "false"} data-active={session.id === props.activeSessionId ? "true" : undefined}>
        {batchAction ? (
          <label className="story-directory-check">
            <input type="checkbox" disabled={!selectable} checked={selectable && isSelected} onChange={(event) => setBatchSelection((current) => event.target.checked ? [...current, session.id] : current.filter((id) => id !== session.id))} />
          </label>
        ) : null}
        <div className="story-directory-open" role="button" tabIndex={0} onClick={() => { props.onSessionSelect(session.id); setCatalogOpen(false); }} onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") { event.preventDefault(); props.onSessionSelect(session.id); setCatalogOpen(false); }
        }}>
          <span className="story-directory-number">{isMain ? "主线" : `${sectionLabel} ${index + 1}`}</span>
          <span>
            {isMain ? <strong>主线剧情</strong> : (
              <input value={session.branchName || sectionLabel} aria-label={`${sectionLabel}名称`} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} onChange={(event) => props.onSessionUpdate(session.id, { branchName: event.target.value })} />
            )}
            <small>{isMain ? "默认主线 · 不可更名删除" : [
              session.independentStory ? "独立剧情" : "分线剧情",
              session.inheritRecentMemory ? "已继承最近记忆" : "从创建时开始",
              session.mergedIntoMainAt ? "已合并主线" : "",
            ].filter(Boolean).join(" · ")}</small>
            <small className="story-directory-date">最近聊天：{session.lastMessageAt || session.lastMessageId ? new Date(session.lastMessageAt || session.updatedAt).toLocaleString() : "还没有聊天"}</small>
          </span>
        </div>
        <div className="story-directory-actions">
          {!isMain && session.independentStory && !session.includedInMemoryAt ? <button type="button" className="story-branch-memory" onClick={() => {
            if (window.confirm("结束这条独立剧情并把剧情摘要加入角色记忆？")) { const now = new Date().toISOString(); props.onSessionUpdate(session.id, { endedAt: now, includedInMemoryAt: now }); }
          }}>结束并加入记忆</button> : null}
          <button type="button" className="story-branch-export" aria-label={`导出${session.branchName || "剧情"}`} onClick={() => props.onExportSession(session.id)}><ArrowDownTrayIcon width={14} /></button>
        </div>
      </div>
    );
  };

  return (
    <>
      <section className="story-settings-card">
        <div className="story-settings-card-head">
          <div><h2>选择见面对象</h2><p>点击角色后进入该角色上次停留的剧情分页</p></div>
        </div>
        <div className="story-meeting-characters">
          {props.characters.map((character) => (
            <button
              key={character.id}
              type="button"
              data-active={!props.activeGroupId && character.id === props.activeCharacterId ? "true" : undefined}
              onClick={() => props.onCharacterChange(character.id)}
            >
              <Avatar src={character.avatar || undefined} name={character.name} size="lg" />
              <span>{character.name}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="story-settings-card">
        <button type="button" className="story-group-heading" onClick={openGroupModal}>
          <span><strong>选择多人见面对象</strong><small>多选角色，建立独立的多人剧情与分页</small></span>
          <ChevronRightIcon width={17} />
        </button>
        {props.groups.length ? (
          <div className="story-group-list">
            {props.groups.map((group) => {
              const members = group.characterIds
                .map((id) => props.characters.find((character) => character.id === id))
                .filter((item): item is Character => Boolean(item));
              return (
                <div key={group.id} className="story-group-card" data-active={group.id === props.activeGroupId ? "true" : undefined}>
                  <button type="button" className="story-group-select" onClick={() => props.onGroupSelect(group.id)}>
                    <AvatarCollage characters={members} />
                    <span><strong>{group.name}</strong><small>{members.map((item) => item.name).join("、")}</small></span>
                  </button>
                  <div className="story-group-card-actions">
                    <button type="button" onClick={() => {
                      const next = window.prompt("修改多人组名称", group.name)?.trim();
                      if (next) props.onGroupRename(group.id, next);
                    }}>改名</button>
                    <button type="button" aria-label={`删除${group.name}`} onClick={() => {
                      if (window.confirm(`删除“${group.name}”及其全部剧情分页？此操作不可恢复。`)) props.onGroupDelete(group.id);
                    }}><TrashIcon width={13} /></button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </section>

      <section className="story-settings-card story-owner-avatar-card">
        <div className="story-owner-avatar-preview">
          <AvatarCollage characters={activeOwnerCharacters} customAvatar={mainSession?.storyAvatar} />
        </div>
        <button type="button" className="story-owner-avatar-pick" onClick={() => storyAvatarInputRef.current?.click()}>
          <span><strong>为当前{activeGroup ? "多人组" : "角色"}设置单独头像</strong><small>从相册选取，只用于当前剧情对象</small></span>
          <ChevronRightIcon width={17} />
        </button>
        {mainSession?.storyAvatar ? <button type="button" className="story-owner-avatar-reset" onClick={() => props.onSessionUpdate(mainSession.id, { storyAvatar: undefined })}>恢复默认</button> : null}
        <input ref={storyAvatarInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => {
          void changeStoryAvatar(event.target.files?.[0]);
          event.target.value = "";
        }} />
      </section>

      <section className="story-settings-card">
        <div className="story-settings-card-head">
          <div><h2>剧情分页设置</h2><p>主线固定为第一节；分线拥有各自独立的消息进度</p></div>
        </div>
        <div className="story-pagination-summary">
          <button
            type="button"
            data-active={(activeSession?.branchId || "main") === "main" ? "true" : undefined}
            onClick={() => mainSession && props.onSessionSelect(mainSession.id)}
          >
            <span><strong>主线剧情</strong><small>默认 · 不可删除</small></span>
            <ChevronRightIcon width={16} />
          </button>
          <button type="button" onClick={() => setCatalogOpen(true)}>
            <span><strong>分线剧情</strong><small>{Math.max(0, props.sessions.length - 1)} 条分线 · 打开目录管理</small></span>
            <ChevronRightIcon width={16} />
          </button>
        </div>
      </section>

      {catalogOpen ? (
        <div className="story-catalog-overlay">
          <header className="story-settings-header">
            <button type="button" onClick={() => setCatalogOpen(false)} aria-label="返回剧情设置"><ChevronLeftIcon width={19} /></button>
            <strong>剧情目录</strong>
            <button type="button" onClick={() => setCatalogOpen(false)} aria-label="关闭目录"><XMarkIcon width={17} /></button>
          </header>
          <main className="story-catalog-scroll">
            <section className="story-book-hero">
              <div className="story-book-cover"><AvatarCollage characters={activeOwnerCharacters} large customAvatar={mainSession?.storyAvatar} /></div>
              <div className="story-book-meta">
                <h1>{title}</h1>
                <p>共 {props.sessions.length} 节</p>
                <p>{pairText}</p>
                <div className="story-book-tags">
                  {tags.map((tag) => (
                    <button key={tag} type="button" onClick={() => mainSession && props.onSessionUpdate(mainSession.id, { catalogTags: tags.filter((item) => item !== tag) })}>
                      {tag}<XMarkIcon width={10} />
                    </button>
                  ))}
                  <label><input value={tagDraft} maxLength={12} placeholder="添加标签" onChange={(event) => setTagDraft(event.target.value)} onKeyDown={(event) => {
                    if (event.key === "Enter") { event.preventDefault(); addTag(); }
                  }} /><PlusIcon width={12} /></label>
                </div>
              </div>
            </section>

            <section className="story-directory">
              <div className="story-directory-head">
                <h2>目录</h2>
                <div>
                  <button type="button" onClick={props.onExportAll}><ArrowDownTrayIcon width={14} />导出全部</button>
                  <button type="button" onClick={() => setBranchModalOpen(true)}><PlusIcon width={14} />增加分线</button>
                  <button type="button" onClick={() => setBatchMenuOpen((value) => !value)}>批量操作</button>
                </div>
              </div>
              {batchMenuOpen ? (
                <div className="story-directory-batch-picker">
                  <button type="button" onClick={() => beginBatchAction("delete")}><TrashIcon width={14} />批量删除</button>
                  <button type="button" onClick={() => beginBatchAction("export")}><ArrowDownTrayIcon width={14} />批量导出</button>
                  <button type="button" onClick={() => beginBatchAction("merge")}>分线合并</button>
                </div>
              ) : null}
              {batchAction ? (
                <div className="story-directory-batch-bar">
                  <span>{batchAction === "delete" ? "选择要删除的分线" : batchAction === "export" ? "选择要导出的章节" : "选择要合并到主线的分线"}</span>
                  <button type="button" onClick={() => { setBatchAction(null); setBatchSelection([]); }}>取消</button>
                  <button type="button" disabled={!batchSelection.length} onClick={finishBatchAction}>完成（{batchSelection.length}）</button>
                </div>
              ) : null}
              <label className="story-directory-search">
                <MagnifyingGlassIcon width={16} />
                <input value={catalogSearch} onChange={(event) => setCatalogSearch(event.target.value)} placeholder="搜索剧情标题" />
                {catalogSearch ? <button type="button" aria-label="清除搜索" onClick={() => setCatalogSearch("")}><XMarkIcon width={14} /></button> : null}
              </label>
              <div className="story-directory-groups">
                <section className="story-directory-group">
                  <header><strong>主线</strong><span>{mainSession && matchesCatalogSearch(mainSession) ? 1 : 0}</span></header>
                  <div className="story-directory-list">{mainSession && matchesCatalogSearch(mainSession) ? renderDirectoryRow(mainSession, "主线", 0) : null}</div>
                </section>
                <section className="story-directory-group">
                  <button type="button" className="story-directory-group-toggle" aria-expanded={branchesExpanded} onClick={() => setBranchesExpanded((value) => !value)}>
                    {branchesExpanded ? <ChevronDownIcon width={15} /> : <ChevronRightIcon width={15} />}<strong>分线</strong><span>{regularBranches.length}</span>
                  </button>
                  {branchesExpanded ? <div className="story-directory-list">{regularBranches.length ? regularBranches.map((session, index) => renderDirectoryRow(session, "分线", index)) : <p className="story-directory-empty">没有匹配的分线</p>}</div> : null}
                </section>
                <section className="story-directory-group">
                  <button type="button" className="story-directory-group-toggle" aria-expanded={independentExpanded} onClick={() => setIndependentExpanded((value) => !value)}>
                    {independentExpanded ? <ChevronDownIcon width={15} /> : <ChevronRightIcon width={15} />}<strong>独立剧情</strong><span>{independentStories.length}</span>
                  </button>
                  {independentExpanded ? <div className="story-directory-list">{independentStories.length ? independentStories.map((session, index) => renderDirectoryRow(session, "独立剧情", index)) : <p className="story-directory-empty">没有匹配的独立剧情</p>}</div> : null}
                </section>
              </div>
            </section>
          </main>
        </div>
      ) : null}

      {mergeConfirmOpen ? (
        <div className="story-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setMergeConfirmOpen(false); }}>
          <section className="story-dialog" role="dialog" aria-modal="true" aria-label="合并分线到主线">
            <header><strong>合并到主线</strong><button type="button" onClick={() => setMergeConfirmOpen(false)}><XMarkIcon width={16} /></button></header>
            <p className="story-settings-note">将选中的 {batchSelection.length} 条分线按剧情时间统一合并到主线，不会合并到其他分线。</p>
            <label className="story-settings-toggle-row">
              <span><strong>合并后删除原分线</strong><small>确认主线保存成功后再删除；合并失败时会完整保留原分线</small></span>
              <input type="checkbox" checked={deleteMergedBranches} onChange={(event) => setDeleteMergedBranches(event.target.checked)} />
            </label>
            <footer><button type="button" onClick={() => setMergeConfirmOpen(false)}>取消</button><button type="button" className="story-settings-primary" onClick={confirmMergeBranches}>{deleteMergedBranches ? "合并并删除原分线" : "合并到主线"}</button></footer>
          </section>
        </div>
      ) : null}

      {groupModalOpen ? (
        <div className="story-dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setGroupModalOpen(false);
        }}>
          <section className="story-dialog" role="dialog" aria-modal="true" aria-label="选择多人见面对象">
            <header><strong>选择多人见面对象</strong><button type="button" onClick={() => setGroupModalOpen(false)}><XMarkIcon width={16} /></button></header>
            <label className="story-settings-field"><span>多人组名称</span><input value={groupName} onChange={(event) => setGroupName(event.target.value)} placeholder="例如：周末小队" /></label>
            <div className="story-group-picker">
              {props.characters.map((character) => {
                const checked = selectedCharacterIds.includes(character.id);
                return (
                  <label key={character.id} data-selected={checked ? "true" : undefined}>
                    <input type="checkbox" checked={checked} onChange={(event) => setSelectedCharacterIds((current) => event.target.checked ? [...current, character.id] : current.filter((id) => id !== character.id))} />
                    <Avatar src={character.avatar || undefined} name={character.name} size="md" />
                    <span>{character.name}</span>
                  </label>
                );
              })}
            </div>
            <p className="story-settings-note">至少选择两个角色。多人组会保存自己的主线、分线与消息，不会和单人剧情混在一起。</p>
            <footer><button type="button" onClick={() => setGroupModalOpen(false)}>取消</button><button type="button" className="story-settings-primary" disabled={selectedCharacterIds.length < 2} onClick={createGroup}>创建多人组</button></footer>
          </section>
        </div>
      ) : null}

      {branchModalOpen ? (
        <div className="story-dialog-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setBranchModalOpen(false);
        }}>
          <section className="story-dialog" role="dialog" aria-modal="true" aria-label="增加分线">
            <header><strong>增加分线</strong><button type="button" onClick={() => setBranchModalOpen(false)}><XMarkIcon width={16} /></button></header>
            <label className="story-settings-field"><span>分线命名</span><input autoFocus value={branchName} onChange={(event) => setBranchName(event.target.value)} placeholder="例如：雨夜之后" /></label>
            <label className="story-settings-toggle-row">
              <span><strong>接入最近记忆</strong><small>继承创建分线前的短期记忆；选择后不可逆</small></span>
              <input type="checkbox" checked={inheritRecentMemory} disabled={independentStory} onChange={(event) => setInheritRecentMemory(event.target.checked)} />
            </label>
            <label className="story-settings-toggle-row">
              <span><strong>独立剧情</strong><small>默认关闭；开启后不参考角色记忆，结束时可手动加入记忆</small></span>
              <input type="checkbox" checked={independentStory} onChange={(event) => {
                setIndependentStory(event.target.checked);
                if (event.target.checked) setInheritRecentMemory(false);
              }} />
            </label>
            <footer><button type="button" onClick={() => setBranchModalOpen(false)}>取消</button><button type="button" className="story-settings-primary" disabled={!branchName.trim()} onClick={createBranch}>创建分线</button></footer>
          </section>
        </div>
      ) : null}
    </>
  );
}
