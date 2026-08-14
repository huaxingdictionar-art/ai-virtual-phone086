import type { Character } from "./character-types";
import { kvGet, kvSet, registerKvMigration } from "./kv-db";

const STORAGE_KEY = "ai_phone_character_versions_v1";
const MAX_VERSIONS_PER_CHARACTER = 30;
registerKvMigration(STORAGE_KEY);

export type CharacterVersionSource = "manual" | "mascot" | "restore";

export type CharacterVersion = {
  id: string;
  characterId: string;
  version: number;
  label: string;
  createdAt: string;
  source: CharacterVersionSource;
  data: Character;
};

type CharacterVersionState = {
  currentVersion: number;
  versions: CharacterVersion[];
};

type CharacterVersionStore = Record<string, CharacterVersionState>;

function cloneCharacter(character: Character): Character {
  return JSON.parse(JSON.stringify(character)) as Character;
}

function loadStore(): CharacterVersionStore {
  if (typeof window === "undefined") return {};
  try {
    const parsed = JSON.parse(kvGet(STORAGE_KEY) || "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as CharacterVersionStore
      : {};
  } catch {
    return {};
  }
}

function saveStore(store: CharacterVersionStore): void {
  if (typeof window === "undefined") return;
  kvSet(STORAGE_KEY, JSON.stringify(store));
}

function normalizeState(state?: CharacterVersionState): CharacterVersionState {
  return {
    currentVersion: Math.max(1, Number(state?.currentVersion) || 1),
    versions: Array.isArray(state?.versions) ? state!.versions : [],
  };
}

export function getCharacterCurrentVersion(characterId: string): number {
  return normalizeState(loadStore()[characterId]).currentVersion;
}

export function loadCharacterVersions(characterId: string): CharacterVersion[] {
  return [...normalizeState(loadStore()[characterId]).versions]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/**
 * 保存修改前的完整角色卡，并把当前生效版本推进一版。
 * 返回值是修改完成后应显示的当前版本号。
 */
export function backupCharacterVersion(
  character: Character,
  source: CharacterVersionSource,
  label?: string,
): number {
  const store = loadStore();
  const state = normalizeState(store[character.id]);
  const snapshotVersion = state.currentVersion;
  const snapshot: CharacterVersion = {
    id: `charver_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    characterId: character.id,
    version: snapshotVersion,
    label: label?.trim() || (source === "mascot" ? "小卷修改前自动备份" : source === "restore" ? "恢复版本前自动备份" : `v${snapshotVersion}.0 修改前备份`),
    createdAt: new Date().toISOString(),
    source,
    data: cloneCharacter(character),
  };

  state.currentVersion = snapshotVersion + 1;
  state.versions = [...state.versions, snapshot]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-MAX_VERSIONS_PER_CHARACTER);
  store[character.id] = state;
  saveStore(store);
  return state.currentVersion;
}

export function renameCharacterVersion(characterId: string, versionId: string, label: string): void {
  const store = loadStore();
  const state = normalizeState(store[characterId]);
  const target = state.versions.find(version => version.id === versionId);
  if (!target) return;
  target.label = label.trim() || `v${target.version}.0`;
  store[characterId] = state;
  saveStore(store);
}

export function deleteCharacterVersion(characterId: string, versionId: string): void {
  const store = loadStore();
  const state = normalizeState(store[characterId]);
  state.versions = state.versions.filter(version => version.id !== versionId);
  store[characterId] = state;
  saveStore(store);
}

export function clearCharacterVersions(characterId: string): void {
  const store = loadStore();
  if (!(characterId in store)) return;
  delete store[characterId];
  saveStore(store);
}
