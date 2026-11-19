// lib/chat-poke-types.ts
// 拍一拍配置类型定义与辅助工具

export interface ChatPokeConfig {
    /** 是否开启拍一拍（默认开启） */
    enabled?: boolean;
    /** 你拍 TA 的文案池（最多 5 条，支持 {user} / {char} 占位符） */
    userPokes?: string[];
    /** TA 拍你的文案池（最多 5 条，支持 {user} / {char} 占位符） */
    charPokes?: string[];
    /** 是否允许角色在追问或闲聊中主动拍你（默认开启） */
    allowCharActivePoke?: boolean;
    /** 角色拍你时是否允许即兴发挥（默认关闭，使用句子池） */
    allowCharImprovise?: boolean;
}

export const MAX_POKE_ITEMS_COUNT = 5;

export const DEFAULT_USER_POKES: string[] = [
    "{user} 拍了拍 {char}",
    "{user} 戳了戳 {char} 的脸颊",
    "{user} 拍了拍 {char} 的小脑袋",
];

export const DEFAULT_CHAR_POKES: string[] = [
    "{char} 拍了拍 {user}",
    "{char} 戳了戳 {user} 的脑袋瓜问人呢",
    "{char} 拍了拍 {user} 并递过来一杯温水",
];

/** 归一化拍一拍配置，给足默认值且严格截断至最多 5 条 */
export function normalizePokeConfig(config?: ChatPokeConfig | null): Required<ChatPokeConfig> {
    const rawUser = Array.isArray(config?.userPokes) && config!.userPokes.length > 0
        ? config!.userPokes
        : DEFAULT_USER_POKES;
    const rawChar = Array.isArray(config?.charPokes) && config!.charPokes.length > 0
        ? config!.charPokes
        : DEFAULT_CHAR_POKES;

    return {
        enabled: config?.enabled ?? true,
        userPokes: rawUser.slice(0, MAX_POKE_ITEMS_COUNT),
        charPokes: rawChar.slice(0, MAX_POKE_ITEMS_COUNT),
        allowCharActivePoke: config?.allowCharActivePoke ?? true,
        allowCharImprovise: config?.allowCharImprovise ?? false,
    };
}

/** 替换文案模板中的占位符 */
export function resolvePokeTemplate(template: string, userName: string, charName: string): string {
    const u = userName?.trim() || "你";
    const c = charName?.trim() || "对方";
    let res = template.replace(/\{user\}/g, u).replace(/\{char\}/g, c);
    return res.trim();
}

/** 从池子中随机抽一句并解析 */
export function getRandomPokeText(
    pool: string[] | undefined,
    userName: string,
    charName: string,
    fallback: string,
): string {
    const validPool = Array.isArray(pool) && pool.length > 0 ? pool : [fallback];
    const picked = validPool[Math.floor(Math.random() * validPool.length)] || fallback;
    return resolvePokeTemplate(picked, userName, charName);
}
