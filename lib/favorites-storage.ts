"use client";

import Dexie from "dexie";
import type { ChatMessage, ChatSession } from "./chat-storage";
import { loadCharacters } from "./character-storage";
import type { MomentPost } from "./moments-types";
import { loadUserIdentities, resolveUserIdentity } from "./settings-storage";
import type { StoryGroup, StoryMessage, StorySession } from "./story-storage";

export const FAVORITES_UPDATED_EVENT = "favorites-updated";

export type FavoriteCategory = "chat" | "story";
export type FavoriteKind = "message" | "bundle" | "image" | "moment";
export type FavoriteEntityType = "character" | "group";

export type FavoriteEntry = {
  id: string;
  role: "user" | "assistant" | "system";
  senderName: string;
  content: string;
  createdAt: string;
  mediaType?: string;
  mediaUrl?: string;
  imageDescription?: string;
  mediaData?: Record<string, unknown>;
};

export type FavoriteItem = {
  id: string;
  category: FavoriteCategory;
  kind: FavoriteKind;
  scopeKey: string;
  scopeLabel: string;
  chatAccountId: string | null;
  userIdentityId: string | null;
  entityType: FavoriteEntityType;
  entityId: string;
  entityName: string;
  participantIds: string[];
  participantNames: string[];
  containerId: string;
  containerName: string;
  sourceItemIds: string[];
  sourceCreatedAt: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  preview: string;
  tags: string[];
  storySourceLabel?: string;
  entries: FavoriteEntry[];
};

class FavoritesDatabase extends Dexie {
  items!: Dexie.Table<FavoriteItem, string>;

  constructor() {
    super("AiPhoneFavoritesDB");
    this.version(1).stores({
      items: "id, scopeKey, category, kind, entityId, containerId, sourceCreatedAt, createdAt, *participantIds, *tags",
    });
  }
}

export const favoritesDb = new FavoritesDatabase();

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function createId(): string {
  return `favorite_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function unique(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map(value => cleanText(value)).filter(Boolean)));
}

function compactPreview(value: string, limit = 100): string {
  const text = value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

function emitUpdated(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(FAVORITES_UPDATED_EVENT));
}

function resolveScope(userIdentityId?: string | null): {
  scopeKey: string;
  scopeLabel: string;
} {
  const identities = loadUserIdentities();
  const identity = identities.find(item => item.id === userIdentityId);
  const identityLabel = identity?.name || "默认身份";
  return {
    scopeKey: identity ? `identity:${identity.id}` : "global",
    scopeLabel: identityLabel,
  };
}

function normalizeMediaData(value: ChatMessage["mediaData"]): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return undefined;
  return value as unknown as Record<string, unknown>;
}

export async function listFavoriteItems(): Promise<FavoriteItem[]> {
  if (typeof window === "undefined") return [];
  try {
    return await favoritesDb.items.orderBy("createdAt").reverse().toArray();
  } catch (error) {
    console.warn("[FavoritesDB] load failed:", error);
    return [];
  }
}

export async function putFavoriteItem(item: FavoriteItem): Promise<FavoriteItem> {
  await favoritesDb.items.put(item);
  emitUpdated();
  return item;
}

export async function deleteFavoriteItems(ids: string[]): Promise<number> {
  const targets = unique(ids);
  if (!targets.length) return 0;
  await favoritesDb.items.bulkDelete(targets);
  emitUpdated();
  return targets.length;
}

export async function addChatFavorite(input: {
  session: ChatSession;
  messages: ChatMessage[];
}): Promise<FavoriteItem> {
  const { session } = input;
  const characters = loadCharacters();
  const participantIds = session.isGroup
    ? unique(session.participantIds || [])
    : unique([session.contactId]);
  const participantNames = participantIds.map(id => characters.find(character => character.id === id)?.name || id);
  const primaryCharacterId = participantIds[0] || session.contactId;
  const resolvedIdentity = resolveUserIdentity(primaryCharacterId, session.isGroup ? "group_chat" : "chat");
  const userIdentityId = resolvedIdentity?.id || null;
  const scope = resolveScope(userIdentityId);
  const storedMessages = input.messages
    .filter(message => message.sessionId === session.id)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  if (!storedMessages.length) throw new Error("没有可收藏的聊天消息。");

  const characterById = new Map(characters.map(character => [character.id, character]));
  const entries: FavoriteEntry[] = storedMessages.map(message => {
    const senderCharacter = message.senderCharacterId ? characterById.get(message.senderCharacterId) : null;
    const senderName = message.role === "user"
      ? (resolvedIdentity?.name || "我")
      : message.role === "assistant"
        ? (message.senderName || senderCharacter?.name || (!session.isGroup ? participantNames[0] : "群成员") || "角色")
        : "系统";
    return {
      id: message.id,
      role: message.role === "tool" ? "system" : message.role,
      senderName,
      content: message.content,
      createdAt: message.createdAt,
      mediaType: message.mediaType,
      mediaUrl: message.mediaUrl,
      imageDescription: message.mediaType === "image" ? cleanText(message.mediaData?.label) : undefined,
      mediaData: normalizeMediaData(message.mediaData),
    };
  });
  const tags = new Set<string>(["聊天"]);
  for (const message of storedMessages) {
    if (message.mediaType === "audio") tags.add("语音");
    if (message.mediaType === "image" || message.mediaType === "video" || message.mediaType === "media_file") tags.add("图片");
  }
  const entityType: FavoriteEntityType = session.isGroup ? "group" : "character";
  const entityId = session.isGroup ? session.id : session.contactId;
  const entityName = session.isGroup
    ? (session.groupName?.trim() || "未命名群聊")
    : (session.alias?.trim() || participantNames[0] || "未知角色");
  const now = new Date().toISOString();
  const previewSource = entries.find(entry => entry.content.trim())?.content
    || entries.find(entry => entry.imageDescription)?.imageDescription
    || "媒体消息";
  return putFavoriteItem({
    id: createId(),
    category: "chat",
    kind: entries.length > 1 ? "bundle" : storedMessages[0]?.mediaType === "image" ? "image" : "message",
    scopeKey: scope.scopeKey,
    scopeLabel: scope.scopeLabel,
    chatAccountId: null,
    userIdentityId,
    entityType,
    entityId,
    entityName,
    participantIds,
    participantNames,
    containerId: session.id,
    containerName: entityName,
    sourceItemIds: storedMessages.map(message => message.id),
    sourceCreatedAt: storedMessages[0].createdAt,
    createdAt: now,
    updatedAt: now,
    title: entries.length > 1 ? `${entries.length} 条聊天消息` : (tags.has("图片") ? "图片消息" : tags.has("语音") ? "语音消息" : "聊天消息"),
    preview: compactPreview(previewSource || "聊天消息"),
    tags: Array.from(tags),
    entries,
  });
}

function formatStorySourceLabel(session: StorySession): string {
  if (session.independentStory) {
    const fallback = new Date(session.createdAt || session.updatedAt).toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    return `独立剧情 · ${session.title?.trim() || session.branchName?.trim() || fallback}`;
  }
  return (session.branchId || "main") === "main"
    ? "主线"
    : `分线${session.branchName?.trim() ? ` · ${session.branchName.trim()}` : ""}`;
}

export async function addStoryFavorite(input: {
  session: StorySession;
  messages: StoryMessage[];
  group?: StoryGroup | null;
}): Promise<FavoriteItem> {
  const { session } = input;
  const characters = loadCharacters();
  const participantIds = unique(
    input.group?.characterIds
    || session.participantIds
    || [session.characterId],
  );
  const participantNames = participantIds.map(id => characters.find(character => character.id === id)?.name || id);
  const identity = resolveUserIdentity(session.characterId, "story") || resolveUserIdentity(session.characterId) || resolveUserIdentity();
  const scope = resolveScope(identity?.id || null);
  const storedMessages = input.messages
    .filter(message => message.sessionId === session.id)
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  if (!storedMessages.length) throw new Error("没有可收藏的剧情消息。");

  const storySourceLabel = formatStorySourceLabel(session);
  const entityType: FavoriteEntityType = input.group || session.ownerType === "group" ? "group" : "character";
  const entityId = entityType === "group" ? (input.group?.id || session.ownerId || session.id) : session.characterId;
  const entityName = entityType === "group"
    ? (input.group?.name || session.title || "多人剧情组")
    : (characters.find(character => character.id === session.characterId)?.name || "未知角色");
  const entries: FavoriteEntry[] = storedMessages.map(message => ({
    id: message.id,
    role: message.role,
    senderName: message.role === "user"
      ? (identity?.name || "我")
      : message.role === "assistant" ? entityName : "系统",
    content: message.rawContent,
    createdAt: message.createdAt,
  }));
  const now = new Date().toISOString();
  return putFavoriteItem({
    id: createId(),
    category: "story",
    kind: entries.length > 1 ? "bundle" : "message",
    scopeKey: scope.scopeKey,
    scopeLabel: scope.scopeLabel,
    chatAccountId: null,
    userIdentityId: identity?.id || null,
    entityType,
    entityId,
    entityName,
    participantIds,
    participantNames,
    containerId: session.id,
    containerName: session.title?.trim() || session.branchName?.trim() || storySourceLabel,
    sourceItemIds: storedMessages.map(message => message.id),
    sourceCreatedAt: storedMessages[0].createdAt,
    createdAt: now,
    updatedAt: now,
    title: entries.length > 1 ? `${entries.length} 条剧情消息` : "剧情消息",
    preview: compactPreview(entries[0]?.content || "剧情消息"),
    tags: [storySourceLabel],
    storySourceLabel,
    entries,
  });
}

export async function addMomentFavorite(input: {
  post: MomentPost;
  imageOnly?: boolean;
}): Promise<FavoriteItem> {
  const { post } = input;
  const characters = loadCharacters();
  const participantIds = unique([
    ...(post.visibility || []),
    post.authorType === "character" ? post.authorId : null,
  ]);
  const participantNames = participantIds.map(id => characters.find(character => character.id === id)?.name || id);
  const resolvedIdentity = resolveUserIdentity(participantIds[0], "moments");
  const userIdentityId = post.userIdentityId || resolvedIdentity?.id || null;
  const scope = resolveScope(userIdentityId);
  const isGroup = participantIds.length > 1;
  const authorCharacter = post.authorType === "character" ? characters.find(character => character.id === post.authorId) : null;
  const entityId = isGroup ? `moments:${participantIds.slice().sort().join(",")}` : (participantIds[0] || post.authorId || "moments");
  const entityName = isGroup ? "多人动态" : (participantNames[0] || authorCharacter?.name || resolvedIdentity?.name || "动态");
  const imageOnly = input.imageOnly === true;
  const content = imageOnly ? (post.photoDescription || "动态图片") : post.content;
  const now = new Date().toISOString();
  return putFavoriteItem({
    id: createId(),
    category: "chat",
    kind: imageOnly ? "image" : "moment",
    scopeKey: scope.scopeKey,
    scopeLabel: scope.scopeLabel,
    chatAccountId: null,
    userIdentityId,
    entityType: isGroup ? "group" : "character",
    entityId,
    entityName,
    participantIds,
    participantNames,
    containerId: post.id,
    containerName: "朋友圈动态",
    sourceItemIds: [post.id],
    sourceCreatedAt: post.createdAt,
    createdAt: now,
    updatedAt: now,
    title: imageOnly ? "动态图片" : "动态",
    preview: compactPreview(content || "动态"),
    tags: imageOnly ? ["动态", "图片"] : ["动态"],
    entries: [{
      id: post.id,
      role: post.authorType === "user" ? "user" : "assistant",
      senderName: post.authorType === "user" ? (resolvedIdentity?.name || "我") : (authorCharacter?.name || "角色"),
      content,
      createdAt: post.createdAt,
      mediaType: post.photoUrl ? "image" : undefined,
      mediaUrl: post.photoUrl,
      imageDescription: post.photoDescription,
    }],
  });
}
