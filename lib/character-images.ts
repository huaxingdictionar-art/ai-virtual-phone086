import type { CSSProperties } from "react";
import type { Character, CharacterImageDisplay, CharacterPolaroidSize } from "./character-types";

const POLAROID_RATIOS = [1 / 1, 3 / 4, 4 / 3, 16 / 9, 9 / 16] as const;
const POLAROID_RATIO_CLASSES = [
  "ratio-square",
  "ratio-portrait",
  "ratio-landscape",
  "ratio-16-9",
  "ratio-9-16",
] as const;
const POLAROID_WIDTHS: Record<CharacterPolaroidSize, number> = {
  small: 110,
  medium: 130,
  large: 150,
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function isSafeCharacterImageUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const url = value.trim();
  return Boolean(url) && (
    url.startsWith("data:") ||
    url.startsWith("http://") ||
    url.startsWith("https://")
  );
}

export function normalizeCharacterImageDisplay(value: unknown): CharacterImageDisplay | undefined {
  if (isSafeCharacterImageUrl(value)) {
    return { image: value.trim(), positionX: 50, positionY: 50, scale: 1 };
  }
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<CharacterImageDisplay>;
  if (!isSafeCharacterImageUrl(raw.image)) return undefined;
  const positionX = Number(raw.positionX);
  const positionY = Number(raw.positionY);
  const scale = Number(raw.scale);
  return {
    image: raw.image.trim(),
    positionX: Number.isFinite(positionX) ? clamp(positionX, 0, 100) : 50,
    positionY: Number.isFinite(positionY) ? clamp(positionY, 0, 100) : 50,
    scale: Number.isFinite(scale) ? clamp(scale, 1, 3) : 1,
  };
}

export function getCharacterArchiveCover(character: Character): CharacterImageDisplay | undefined {
  const cover = normalizeCharacterImageDisplay(character.archiveCover ?? character.archivePhoto);
  if (cover) return cover;
  if (!isSafeCharacterImageUrl(character.avatar)) return undefined;
  return { image: character.avatar.trim(), positionX: 50, positionY: 50, scale: 1 };
}

export function getCharacterImageStyle(display?: CharacterImageDisplay): CSSProperties {
  const normalized = normalizeCharacterImageDisplay(display);
  if (!normalized) return {};
  return {
    objectPosition: `${normalized.positionX}% ${normalized.positionY}%`,
    transform: `scale(${normalized.scale})`,
    transformOrigin: `${normalized.positionX}% ${normalized.positionY}%`,
  };
}

export function getPolaroidAspectRatio(style?: number): number {
  const index = Number.isInteger(style) && Number(style) >= 0 && Number(style) <= 4 ? Number(style) : 0;
  return POLAROID_RATIOS[index];
}

export function getPolaroidRatioClass(style?: number): string {
  const index = Number.isInteger(style) && Number(style) >= 0 && Number(style) <= 4 ? Number(style) : 0;
  return POLAROID_RATIO_CLASSES[index];
}

export function getPolaroidWidth(size: CharacterPolaroidSize | undefined, fallback: number): number {
  return size ? POLAROID_WIDTHS[size] : fallback;
}

export function isCharacterPolaroidSize(value: unknown): value is CharacterPolaroidSize {
  return value === "small" || value === "medium" || value === "large";
}
