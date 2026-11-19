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
    "{User} 拍了拍 {Char}",
    "{User} 戳了戳 {Char} 的脸颊",
    "{User} 拍了拍 {Char} 的小脑袋",
];

export const DEFAULT_CHAR_POKES: string[] = [
    "{Char} 拍了拍 {User}",
    "{Char} 戳了戳 {User} 的脑袋瓜问人呢",
    "{Char} 拍了拍 {User} 并递过来一杯温水",
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

/** 替换文案模板中的占位符，并规范化人称代词为双方真实大名 */
export function resolvePokeTemplate(template: string, userName?: string, charName?: string): string {
    const u = userName?.trim() || "用户";
    const c = charName?.trim() || "对方";
    if (!template) return `${u} 拍了拍 ${c}`;

    let res = template.replace(/\{user\}/gi, u).replace(/\{char\}/gi, c);

    // 智能代词规整：严禁出现你/我/他等代词，全面推行真实大名
    // 1. 处理句首代词：如 "你 拍了拍..."、"我 拍了拍..."
    res = res.replace(/^(?:你|我)\s*(拍了拍|戳了戳|揉了揉|捏了捏|敲了敲|抱了抱|扯了扯|弹了弹)/, `${u} $1`);
    // 2. 处理句中代词：如 "拍了拍 你"、"拍了拍 我"
    res = res.replace(/(拍了拍|戳了戳|揉了揉|捏了捏|敲了敲|抱了抱|扯了扯|弹了弹)\s*(?:你|我)(?=[^\w]|$)/g, `$1 ${u}`);
    // 3. 处理指代角色的代词：如 "拍了拍 他"、"拍了拍 她"
    res = res.replace(/(拍了拍|戳了戳|揉了揉|捏了捏|敲了敲|抱了抱|扯了扯|弹了弹)\s*(?:他|她)(?=[^\w]|$)/g, `$1 ${c}`);
    // 4. 处理 "拍了拍自己"：如 "华 拍了拍自己" -> "华 拍了拍 华"
    res = res.replace(/(拍了拍|戳了戳|揉了揉|捏了捏|敲了敲|抱了抱)\s*自己/g, `$1 ${u}`);

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
