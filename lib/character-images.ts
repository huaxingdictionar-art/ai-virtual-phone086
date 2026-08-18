import type { CSSProperties } from "react";
import type {
  Character,
  CharacterImageDisplay,
  CharacterPolaroidSize,
} from "./character-types";

export const CHARACTER_POLAROID_RATIOS = [
  "ratio-square",
  "ratio-portrait",
  "ratio-landscape",
  "ratio-16-9",
  "ratio-9-16",
] as const;

export function isSafeCharacterImageUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const url = value.trim();
  return Boolean(url) && (
    url.startsWith("data:") ||
    url.startsWith("http://") ||
    url.startsWith("https://")
  );
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, numberValue));
}

export function normalizeCharacterImageDisplay(value: unknown): CharacterImageDisplay | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const image = isSafeCharacterImageUrl(raw.image) ? raw.image.trim() : null;
  return {
    image,
    positionX: clampNumber(raw.positionX, 0, 100, 50),
    positionY: clampNumber(raw.positionY, 0, 100, 50),
    scale: clampNumber(raw.scale, 1, 3, 1),
  };
}

export function getCharacterArchiveCover(character: Character): CharacterImageDisplay {
  const display = normalizeCharacterImageDisplay(character.archiveCover);
  return {
    image: display?.image || character.avatar || null,
    positionX: display?.positionX ?? 50,
    positionY: display?.positionY ?? 50,
    scale: display?.scale ?? 1,
  };
}

export function getCharacterImageStyle(display: CharacterImageDisplay): CSSProperties {
  const positionX = clampNumber(display.positionX, 0, 100, 50);
  const positionY = clampNumber(display.positionY, 0, 100, 50);
  const scale = clampNumber(display.scale, 1, 3, 1);
  return {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    objectPosition: `${positionX}% ${positionY}%`,
    transform: `scale(${scale})`,
    transformOrigin: `${positionX}% ${positionY}%`,
  };
}

export function isCharacterPolaroidSize(value: unknown): value is CharacterPolaroidSize {
  return value === "small" || value === "medium" || value === "large";
}

export function getPolaroidWidth(character: Character, legacyWidth: number): number {
  const widths: Record<CharacterPolaroidSize, number> = {
    small: 110,
    medium: 130,
    large: 150,
  };
  return character.polaroidSize ? widths[character.polaroidSize] : legacyWidth;
}

export function getPolaroidRatioClass(styleIndex: number): typeof CHARACTER_POLAROID_RATIOS[number] {
  return CHARACTER_POLAROID_RATIOS[((styleIndex % CHARACTER_POLAROID_RATIOS.length) + CHARACTER_POLAROID_RATIOS.length) % CHARACTER_POLAROID_RATIOS.length];
}

export function getPolaroidAspectRatio(styleIndex: number): string {
  return ["1 / 1", "3 / 4", "4 / 3", "16 / 9", "9 / 16"][((styleIndex % 5) + 5) % 5];
}
