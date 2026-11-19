"use client";

import { loadCharacters } from "./character-storage";
import { hydrateKvDb, kvGet, kvSet, registerKvMigration } from "./kv-db";
import {
  createOrGetStorySession,
  hydrateStoryStorage,
  loadStoryMessages,
  loadStorySessions,
  loadStorySessionsForOwner,
  replaceStoryMessages,
  saveStoryLaunchTarget,
  updateStorySession,
  type StoryMessage,
  type StorySession,
} from "./story-storage";

const STORY_OPENING_SETS_KEY = "ai_phone_story_opening_sets_v1";
export const STORY_OPENING_SETS_EVENT = "story-opening-sets-updated";
registerKvMigration(STORY_OPENING_SETS_KEY);

export type StoryOpeningFormat = "text" | "markdown" | "html";

export type StoryOpeningItem = {
  id: string;
  name: string;
  content: string;
  format: StoryOpeningFormat;
  sourceIndex?: number;
  createdAt: string;
  updatedAt: string;
};

export type StoryOpeningSet = {
  id: string;
  appId: string;
  characterId: string;
  name: string;
  introductionHtml?: string;
  openings: StoryOpeningItem[];
  activeOpeningId?: string;
  createdAt: string;
  updatedAt: string;
};

export type StoryOpeningArchiveSummary = {
  openingId: string;
  sessionId: string;
  messageCount: number;
  branchName: string;
  promoted: boolean;
  updatedAt: string;
};

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function cleanText(value: unknown, maxLength: number): string {
  return String(value ?? "").replace(/\u0000/g, "").trim().slice(0, maxLength);
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeFormat(value: unknown): StoryOpeningFormat {
  return value === "html" || value === "markdown" ? value : "text";
}

function normalizeOpening(raw: unknown, index: number, existing?: StoryOpeningItem): StoryOpeningItem | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const content = cleanText(record.content ?? record.text ?? record.message, 500_000);
  if (!content) return null;
  const now = nowIso();
  return {
    id: cleanText(record.id, 120) || existing?.id || `opening_${index + 1}_${Math.random().toString(36).slice(2, 7)}`,
    name: cleanText(record.name ?? record.title, 120) || existing?.name || `开场 ${index + 1}`,
    content,
    format: normalizeFormat(record.format ?? existing?.format),
    sourceIndex: Number.isFinite(Number(record.sourceIndex)) ? Number(record.sourceIndex) : existing?.sourceIndex ?? index,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
}

function sanitizeSet(raw: unknown): StoryOpeningSet | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const id = cleanText(record.id, 160);
  const appId = cleanText(record.appId, 160);
  const characterId = cleanText(record.characterId, 160);
  if (!id || !appId || !characterId || !Array.isArray(record.openings)) return null;
  const openings = record.openings
    .map((opening, index) => normalizeOpening(opening, index))
    .filter((opening): opening is StoryOpeningItem => opening !== null);
  if (!openings.length) return null;
  const now = nowIso();
  const activeOpeningId = cleanText(record.activeOpeningId, 120);
  return {
    id,
    appId,
    characterId,
    name: cleanText(record.name, 120) || "剧情开场",
    introductionHtml: cleanText(record.introductionHtml, 500_000) || undefined,
    openings,
    activeOpeningId: openings.some(item => item.id === activeOpeningId) ? activeOpeningId : undefined,
    createdAt: cleanText(record.createdAt, 80) || now,
    updatedAt: cleanText(record.updatedAt, 80) || now,
  };
}

function readAllSets(): StoryOpeningSet[] {
  try {
    const parsed = JSON.parse(kvGet(STORY_OPENING_SETS_KEY) || "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(sanitizeSet).filter((item): item is StoryOpeningSet => item !== null);
  } catch {
    return [];
  }
}

function saveAllSets(items: StoryOpeningSet[]): void {
  kvSet(STORY_OPENING_SETS_KEY, JSON.stringify(items));
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(STORY_OPENING_SETS_EVENT));
  }
}

function requireOwnedSet(appId: string, setId: string): StoryOpeningSet {
  const set = readAllSets().find(item => item.id === setId && item.appId === appId);
  if (!set) throw new Error("未找到可管理的剧情开场集合。");
  return set;
}

function archiveForOpening(set: StoryOpeningSet, openingId: string): StorySession | null {
  return loadStorySessions().find(session => (
    session.characterId === set.characterId
    && session.openingSetId === set.id
    && session.openingId === openingId
    && session.openingArchive === true
  )) ?? null;
}

function cloneMessages(messages: StoryMessage[], sessionId: string): StoryMessage[] {
  const stamp = Date.now();
  return messages.map((message, index) => ({
    ...message,
    id: `story_opening_${stamp}_${index}_${Math.random().toString(36).slice(2, 7)}`,
    sessionId,
  }));
}

function openingMessage(opening: StoryOpeningItem, sessionId: string): StoryMessage {
  return {
    id: generateId("story_opening"),
    sessionId,
    role: "assistant",
    rawContent: opening.content,
    createdAt: nowIso(),
  };
}

function updateSessionPreview(session: StorySession, messages: StoryMessage[]): void {
  const last = messages[messages.length - 1];
  updateStorySession(session.id, {
    lastMessageId: last?.id,
    lastMessagePreview: (last?.renderedContent || last?.rawContent || "").replace(/\s+/g, " ").trim().slice(0, 64),
    lastMessageAt: last?.createdAt,
    updatedAt: last?.createdAt || nowIso(),
  });
}

function saveMainAsArchive(set: StoryOpeningSet, main: StorySession, openingId: string): StorySession | null {
  const messages = loadStoryMessages(main.id);
  if (!messages.length) return null;
  let archive = archiveForOpening(set, openingId);
  if (!archive) {
    archive = createOrGetStorySession(set.characterId, {
      ownerType: "single",
      ownerId: set.characterId,
      branchId: `opening_${set.id}_${openingId}`,
      branchName: set.openings.find(item => item.id === openingId)?.name || "开场存档",
      inheritRecentMemory: false,
      independentStory: true,
      baseSession: main,
    });
  }
  archive = updateStorySession(archive.id, {
    openingSetId: set.id,
    openingId,
    openingArchive: true,
    hiddenFromBranchList: archive.hiddenFromBranchList !== false,
    independentStory: true,
  }) || archive;
  const copies = cloneMessages(messages, archive.id);
  replaceStoryMessages(archive.id, copies);
  updateSessionPreview(archive, copies);
  return archive;
}

function preserveExistingMainAsBranch(main: StorySession, branchName: string): StorySession | null {
  const messages = loadStoryMessages(main.id);
  if (!messages.length) return null;
  const existingBranches = loadStorySessionsForOwner("single", main.characterId);
  const branch = createOrGetStorySession(main.characterId, {
    ownerType: "single",
    ownerId: main.characterId,
    branchId: `preserved_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    branchName,
    branchOrder: Math.max(0, ...existingBranches.map(session => session.branchOrder ?? 0)) + 1,
    inheritRecentMemory: false,
    independentStory: true,
    baseSession: main,
  });
  const copies = cloneMessages(messages, branch.id);
  replaceStoryMessages(branch.id, copies);
  updateSessionPreview(branch, copies);
  return branch;
}

export async function listStoryOpeningSets(appId: string, characterId?: string): Promise<Array<StoryOpeningSet & { archives: StoryOpeningArchiveSummary[] }>> {
  await hydrateKvDb();
  await hydrateStoryStorage();
  return readAllSets()
    .filter(item => item.appId === appId && (!characterId || item.characterId === characterId))
    .map(set => ({
      ...set,
      archives: loadStorySessions()
        .filter(session => session.openingSetId === set.id && session.openingArchive === true)
        .map(session => ({
          openingId: session.openingId || "",
          sessionId: session.id,
          messageCount: loadStoryMessages(session.id).length,
          branchName: session.branchName || "开场存档",
          promoted: session.hiddenFromBranchList !== true,
          updatedAt: session.updatedAt,
        })),
    }));
}

export async function upsertStoryOpeningSet(appId: string, input: Record<string, unknown>): Promise<StoryOpeningSet> {
  await hydrateKvDb();
  const characterId = cleanText(input.characterId, 160);
  if (!loadCharacters().some(character => character.id === characterId)) {
    throw new Error("剧情开场集合需要有效的 characterId。");
  }
  if (!Array.isArray(input.openings)) throw new Error("剧情开场集合至少需要一个 opening。");
  const all = readAllSets();
  const requestedId = cleanText(input.id ?? input.openingSetId, 160);
  const existing = requestedId ? all.find(item => item.id === requestedId && item.appId === appId) : undefined;
  if (requestedId && !existing && all.some(item => item.id === requestedId && item.appId !== appId)) {
    throw new Error("不能修改其他 APP 创建的剧情开场集合。");
  }
  const openings = input.openings
    .slice(0, 100)
    .map((opening, index) => normalizeOpening(opening, index, existing?.openings[index]))
    .filter((opening): opening is StoryOpeningItem => opening !== null);
  if (!openings.length) throw new Error("剧情开场集合没有有效内容。");
  const now = nowIso();
  const requestedActive = cleanText(input.activeOpeningId ?? input.defaultOpeningId, 120);
  const next: StoryOpeningSet = {
    id: existing?.id || requestedId || generateId("opening_set"),
    appId,
    characterId,
    name: cleanText(input.name, 120) || existing?.name || "剧情开场",
    introductionHtml: cleanText(input.introductionHtml, 500_000) || existing?.introductionHtml,
    openings,
    activeOpeningId: openings.some(item => item.id === requestedActive)
      ? requestedActive
      : openings.some(item => item.id === existing?.activeOpeningId)
        ? existing?.activeOpeningId
        : undefined,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  saveAllSets(existing ? all.map(item => item.id === existing.id ? next : item) : [next, ...all]);
  return next;
}

export async function selectStoryOpening(appId: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  await hydrateKvDb();
  await hydrateStoryStorage();
  const set = requireOwnedSet(appId, cleanText(input.id ?? input.openingSetId, 160));
  const openingId = cleanText(input.openingId, 120);
  const opening = set.openings.find(item => item.id === openingId);
  if (!opening) throw new Error("未找到要选择的剧情开场。");
  const main = createOrGetStorySession(set.characterId, { ownerType: "single", ownerId: set.characterId, branchId: "main" });
  const sameOpening = set.activeOpeningId === openingId;
  const reset = input.reset === true;
  if (!sameOpening || reset) {
    const currentMessages = loadStoryMessages(main.id);
    if (!set.activeOpeningId && currentMessages.length && input.discardCurrent !== true) {
      if (input.preserveCurrentAsBranch !== true) {
        throw new Error("当前主线已有剧情。请先确认 preserveCurrentAsBranch 或 discardCurrent。");
      }
      preserveExistingMainAsBranch(main, cleanText(input.previousBranchName, 120) || "原主线存档");
    }
    if (set.activeOpeningId && input.discardCurrent !== true) {
      saveMainAsArchive(set, main, set.activeOpeningId);
    }
    const archive = !reset ? archiveForOpening(set, openingId) : null;
    const targetMessages = archive
      ? cloneMessages(loadStoryMessages(archive.id), main.id)
      : [openingMessage(opening, main.id)];
    replaceStoryMessages(main.id, targetMessages);
    updateSessionPreview(main, targetMessages);
  }
  updateStorySession(main.id, { openingSetId: set.id, openingId, openingArchive: false, hiddenFromBranchList: false });
  const all = readAllSets();
  const next = { ...set, activeOpeningId: openingId, updatedAt: nowIso() };
  saveAllSets(all.map(item => item.id === set.id ? next : item));
  saveStoryLaunchTarget(main);
  return {
    ok: true,
    openingSetId: set.id,
    openingId,
    sessionId: main.id,
    restoredArchive: !reset && Boolean(archiveForOpening(set, openingId)),
  };
}

/** 从某条开场直接创建一条全新的独立剧情，不改动当前主线与开场存档。 */
export async function openIndependentStoryOpening(appId: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  await hydrateKvDb();
  await hydrateStoryStorage();
  const set = requireOwnedSet(appId, cleanText(input.id ?? input.openingSetId, 160));
  const openingId = cleanText(input.openingId, 120);
  const opening = set.openings.find(item => item.id === openingId);
  if (!opening) throw new Error("未找到要进入的剧情开场。");

  const main = createOrGetStorySession(set.characterId, {
    ownerType: "single",
    ownerId: set.characterId,
    branchId: "main",
  });
  const sessions = loadStorySessionsForOwner("single", set.characterId);
  const branchOrder = Math.max(0, ...sessions.map(session => session.branchOrder ?? 0)) + 1;
  const session = createOrGetStorySession(set.characterId, {
    ownerType: "single",
    ownerId: set.characterId,
    branchId: `independent_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    branchName: cleanText(input.branchName, 120) || opening.name,
    branchOrder,
    inheritRecentMemory: false,
    independentStory: true,
    baseSession: main,
  });
  const messages = [openingMessage(opening, session.id)];
  replaceStoryMessages(session.id, messages);
  updateSessionPreview(session, messages);
  const updated = updateStorySession(session.id, {
    openingSetId: set.id,
    openingId,
    openingArchive: false,
    hiddenFromBranchList: false,
    independentStory: true,
    inheritRecentMemory: false,
    inheritRecentMemoryLocked: true,
  }) || session;
  saveStoryLaunchTarget(updated);
  return { ok: true, openingSetId: set.id, openingId, sessionId: updated.id };
}

export async function promoteStoryOpeningArchive(appId: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  await hydrateKvDb();
  await hydrateStoryStorage();
  const set = requireOwnedSet(appId, cleanText(input.id ?? input.openingSetId, 160));
  const openingId = cleanText(input.openingId, 120);
  const main = createOrGetStorySession(set.characterId, { ownerType: "single", ownerId: set.characterId, branchId: "main" });
  if (set.activeOpeningId === openingId) saveMainAsArchive(set, main, openingId);
  const archive = archiveForOpening(set, openingId);
  if (!archive) throw new Error("该开场还没有可转换的剧情存档。");
  const sessions = loadStorySessionsForOwner("single", set.characterId);
  const branchOrder = Math.max(0, ...sessions.map(session => session.branchOrder ?? 0)) + 1;
  const openingName = set.openings.find(item => item.id === openingId)?.name || archive.branchName || "剧情分线";
  const promoted = updateStorySession(archive.id, {
    branchName: cleanText(input.branchName, 120) || openingName,
    branchOrder,
    openingArchive: false,
    hiddenFromBranchList: false,
  });
  return { ok: true, session: promoted };
}

export async function deleteStoryOpeningArchive(appId: string, input: Record<string, unknown>): Promise<Record<string, unknown>> {
  await hydrateKvDb();
  await hydrateStoryStorage();
  const set = requireOwnedSet(appId, cleanText(input.id ?? input.openingSetId, 160));
  const openingId = cleanText(input.openingId, 120);
  const archive = archiveForOpening(set, openingId);
  if (!archive) return { ok: true, deleted: false };
  const { deleteStorySessions } = await import("./story-storage");
  deleteStorySessions([archive.id]);
  return { ok: true, deleted: true };
}

