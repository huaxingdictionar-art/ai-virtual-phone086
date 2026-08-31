"use client";

import type { CSSProperties } from "react";
import type { AvatarCrop } from "@/lib/character-types";
import { DEFAULT_AVATAR_CROP, normalizeAvatarCrop } from "@/lib/character-storage";
import { ChatFallbackAvatar } from "./chat-fallback-avatar";

type CharacterAvatarProps = {
    avatar?: string | null;
    avatarCrop?: AvatarCrop;
    alt?: string;
    className?: string;
    imageClassName?: string;
    imageStyle?: CSSProperties;
    containerStyle?: CSSProperties;
    ariaHidden?: boolean;
};

/** 统一按角色保存的归一化取景参数显示头像，不生成裁剪副本。 */
export function CharacterAvatar({
    avatar,
    avatarCrop,
    alt = "",
    className = "",
    imageClassName = "",
    imageStyle,
    containerStyle,
    ariaHidden,
}: CharacterAvatarProps) {
    const crop = normalizeAvatarCrop(avatarCrop) || DEFAULT_AVATAR_CROP;

    return (
        <span className={`block overflow-hidden ${className}`.trim()} style={containerStyle} aria-hidden={ariaHidden}>
            {avatar ? (
                <img
                    src={avatar}
                    alt={alt}
                    draggable={false}
                    className={`block h-full w-full select-none object-cover ${imageClassName}`.trim()}
                    style={{
                        ...imageStyle,
                        objectPosition: `${crop.x * 100}% ${crop.y * 100}%`,
                        transform: `scale(${crop.scale})`,
                        transformOrigin: "center center",
                    }}
                />
            ) : (
                <ChatFallbackAvatar alt={alt} className={imageClassName} />
            )}
        </span>
    );
}
