import type { ChatMessage } from "./chat-storage";

// 中文换头像意图正则
const CHINESE_AVATAR_INTENT_PATTERNS = [
    /(?:换|改|设置|设成|设为|用作|当作|作为|换上).{0,8}(?:头像|头图)/i,
    /(?:头像|头图).{0,8}(?:换|改|设置|设成|设为|用这张|用这个|用它)/i,
    /(?:给你|你|把这张|这张|这个|它).{0,10}(?:当|做|换成|设为|用作|作为|换上).{0,6}(?:头像|头图)/i,
    /(?:这张|这个|它).{0,8}(?:适合|很配).{0,6}(?:你).{0,6}(?:头像|头图)/i,
];

// 英文换头像意图正则（支持 avatar, pfp, profile picture 等）
const ENGLISH_AVATAR_INTENT_PATTERNS = [
    /(?:use|set|make|put|change|turn)\s+(?:this|the picture|the photo|it)\s+(?:as|to|into|for)\s+(?:your|ur)?\s*(?:avatar|pfp|profile pic(?:ture)?|profile photo|icon)/i,
    /(?:new|fresh)\s+(?:avatar|pfp|profile pic(?:ture)?|profile photo)\s+(?:for you|for u)?/i,
    /(?:this|it)\s+(?:looks?|would look|fits?|is)\s+(?:great|good|cute|cool|nice|perfect)\s+as\s+(?:your|ur)?\s*(?:avatar|pfp|profile pic(?:ture)?|profile photo|icon)/i,
    /(?:here(?:'s| is)|giving you|sent you)\s+(?:an?|a new|your)?\s*(?:avatar|pfp|profile pic(?:ture)?|profile photo)/i,
    /(?:how about|what about)\s+(?:using\s+)?(?:this|it)\s+as\s+(?:your|ur)?\s*(?:avatar|pfp|profile pic(?:ture)?|profile photo|icon)/i,
];

// 控制标记正则（支持中英文）
export const AVATAR_ACCEPT_RE = /[\[【]\s*(?:接受头像推荐|accept\s+avatar(?:\s+recommendation)?)\s*[\]】]/i;
export const AVATAR_DECLINE_RE = /[\[【]\s*(?:拒绝头像推荐|decline\s+avatar(?:\s+recommendation)?)\s*[\]】]/i;
const AVATAR_DECISION_GLOBAL_RE = /[\[【]\s*(?:接受头像推荐|拒绝头像推荐|accept\s+avatar(?:\s+recommendation)?|decline\s+avatar(?:\s+recommendation)?)\s*[\]】]/gi;

const AVATAR_DECISION_PLACEHOLDER_PREFIX = "\uE10Aai_phone_avatar_decision_";
const AVATAR_DECISION_PLACEHOLDER_SUFFIX = "_\uE10B";
const AVATAR_INTENT_LOOKBACK_MESSAGES = 12;
const AVATAR_INTENT_LOOKBACK_MS = 30 * 60 * 1000;

export function isAvatarChangeIntent(text: string): boolean {
    const trimmed = text.trim();
    if (!trimmed) return false;

    // 排除“我换头像了”是在告知自己的变化，不应误判成要求角色换头像
    const describesOwnAvatarCn = /^(?:我|用户).{0,8}(?:刚|已经|又)?(?:换|改|设置).{0,5}(?:头像|头图)/i.test(trimmed);
    const describesOwnAvatarEn = /^(?:i|i've|i have|just)\s+(?:changed|updated|got)\s+(?:my|the)?\s*(?:avatar|pfp|profile pic)/i.test(trimmed);

    const directsOtherToChangeCn = /(?:给你|帮你|让你|你也|你要不要|你该|你应该|对方|TA|char).{0,10}(?:换|改|设置|用|当).{0,6}(?:头像|头图)/i.test(trimmed)
        || /(?:把这张|这张|这个|它).{0,10}(?:换成|设为|用作|作为|当作).{0,6}(?:头像|头图)/i.test(trimmed);
    const directsOtherToChangeEn = /(?:use|set|make|change).{0,20}(?:your|ur)\s*(?:avatar|pfp|profile pic)/i.test(trimmed);

    if ((describesOwnAvatarCn && !directsOtherToChangeCn) || (describesOwnAvatarEn && !directsOtherToChangeEn)) {
        return false;
    }

    const normalizedNoSpace = trimmed.replace(/\s+/g, "");
    if (CHINESE_AVATAR_INTENT_PATTERNS.some(pattern => pattern.test(normalizedNoSpace))) {
        return true;
    }

    return ENGLISH_AVATAR_INTENT_PATTERNS.some(pattern => pattern.test(trimmed));
}

function isUserImage(message: ChatMessage): boolean {
    return message.role === "user"
        && Boolean(message.mediaUrl)
        && (message.mediaType === "image"
            || (message.mediaType === "media_file" && message.mediaData?.fileType === "image"));
}

function unresolvedImageForCharacter(message: ChatMessage, characterId?: string): boolean {
    if (!isUserImage(message)) return false;
    if (message.mediaData?.avatarRecommendationForCharacterId
        && message.mediaData.avatarRecommendationForCharacterId !== characterId) return false;
    return message.mediaData?.avatarRecommendationStatus !== "accepted"
        && message.mediaData?.avatarRecommendationStatus !== "declined";
}

function isRecentEnough(image: ChatMessage, reference: ChatMessage): boolean {
    const imageTime = Date.parse(image.createdAt);
    const referenceTime = Date.parse(reference.createdAt);
    if (!Number.isFinite(imageTime) || !Number.isFinite(referenceTime)) return true;
    return referenceTime - imageTime <= AVATAR_INTENT_LOOKBACK_MS;
}

/**
 * 识别最近一次用户换头像意图，并配对最近的真实相册图片。
 */
export function findUserAvatarChangeIntent(
    history: ChatMessage[],
    sessionId: string,
    characterId?: string,
): { image: ChatMessage; intentText: string } | null {
    const sessionMessages = history.filter(message => message.sessionId === sessionId);
    if (sessionMessages.length === 0) return null;

    let endExclusive = sessionMessages.length;
    const trailing = sessionMessages[endExclusive - 1];
    if (trailing?.role === "assistant") {
        const trailingBatchId = trailing.responseBatchId;
        const trailingRaw = trailing.rawResponseText;
        while (endExclusive > 0) {
            const message = sessionMessages[endExclusive - 1];
            if (message.role !== "assistant") break;
            if (trailingBatchId && message.responseBatchId && message.responseBatchId !== trailingBatchId) break;
            if (!trailingBatchId && trailingRaw && message.rawResponseText && message.rawResponseText !== trailingRaw) break;
            endExclusive -= 1;
        }
    }

    const currentTurn: ChatMessage[] = [];
    let currentTurnStart = endExclusive;
    for (let index = endExclusive - 1; index >= 0; index -= 1) {
        const message = sessionMessages[index];
        if (message.role === "assistant") break;
        currentTurnStart = index;
        if (message.role === "user") currentTurn.unshift(message);
    }
    if (currentTurn.length === 0) return null;

    const intentText = currentTurn
        .flatMap(message => [message.content, message.mediaData?.label])
        .filter((value): value is string => Boolean(value?.trim()))
        .join("\n");
    if (!isAvatarChangeIntent(intentText)) return null;

    let image = [...currentTurn].reverse().find(message => unresolvedImageForCharacter(message, characterId));
    if (!image) {
        const reference = currentTurn[currentTurn.length - 1];
        const lookbackStart = Math.max(0, currentTurnStart - AVATAR_INTENT_LOOKBACK_MESSAGES);
        for (let index = currentTurnStart - 1; index >= lookbackStart; index -= 1) {
            const candidate = sessionMessages[index];
            if (!unresolvedImageForCharacter(candidate, characterId)) continue;
            if (!isRecentEnough(candidate, reference)) break;
            image = candidate;
            break;
        }
    }
    if (!image) return null;

    return { image, intentText };
}

/** 保护控制标记不受用户正则等逻辑破坏 */
export function applyWithProtectedAvatarDecisionMarkers(
    text: string,
    transform: (protectedText: string) => string,
): string {
    const markers: string[] = [];
    const protectedText = text.replace(AVATAR_DECISION_GLOBAL_RE, marker => {
        const index = markers.push(marker) - 1;
        return `${AVATAR_DECISION_PLACEHOLDER_PREFIX}${index}${AVATAR_DECISION_PLACEHOLDER_SUFFIX}`;
    });
    const transformed = transform(protectedText);
    if (markers.length === 0) return transformed;
    const placeholderRe = new RegExp(`${AVATAR_DECISION_PLACEHOLDER_PREFIX}(\\d+)${AVATAR_DECISION_PLACEHOLDER_SUFFIX}`, "g");
    return transformed.replace(placeholderRe, (_placeholder, rawIndex: string) => markers[Number(rawIndex)] || "");
}

/** 剔除回复中包含的控制标记，保持展示给用户的气泡干净纯粹 */
export function stripAvatarDecisionMarkers(text: string): string {
    return text.replace(AVATAR_DECISION_GLOBAL_RE, "").trim();
}

/** 模型漏写控制标记时，依据中英文自然回复做智能保守推断 */
export function inferAvatarDecisionFromReply(text: string): "accepted" | "declined" | null {
    const raw = text.trim();
    if (!raw) return null;

    // 优先显式标记
    if (AVATAR_DECLINE_RE.test(raw)) return "declined";
    if (AVATAR_ACCEPT_RE.test(raw)) return "accepted";

    const normalized = raw.replace(/\s+/g, "");

    // 中文拒绝兜底
    if (/(?:不想|不愿|不要|不用|别|不换|算了|拒绝|还是算了).{0,10}(?:头像|这张|照片|图片|它)?/.test(normalized)
        || /(?:头像|这张|照片|图片|它).{0,10}(?:不想|不愿|不要|不用|不换|算了|拒绝)/.test(normalized)) {
        return "declined";
    }

    // 英文拒绝兜底
    if (/(?:don't want|do not want|rather not|prefer not|keep my current|won't change|no thanks|not changing)/i.test(raw)) {
        return "declined";
    }

    // 中文接受兜底
    if (/(?:就用|换上|换成|设成|设为|当作头像|用作头像|收下|采用).{0,10}(?:这张|照片|图片|它|头像)?/.test(normalized)
        || /(?:这张|照片|图片|它).{0,12}(?:就用|换上|换成|设成|设为|当头像|收下|采用)/.test(normalized)) {
        return "accepted";
    }

    // 英文接受兜底
    if (/(?:love this|set it as|use this as|changed my avatar|changing my avatar|new pfp|will use this)/i.test(raw)) {
        return "accepted";
    }

    return null;
}
