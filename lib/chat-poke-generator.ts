// lib/chat-poke-generator.ts
// 拍一拍文案 AI 一键全部生成器：单次 LLM 请求同时生成【你拍TA】与【TA拍你】各 5 条精选文案

import { simpleLLMCall } from "./api-helpers";
import { loadApiConfigs, loadBindingConfig, resolveBinding } from "./settings-storage";
import type { Character } from "./character-types";
import { MAX_POKE_ITEMS_COUNT } from "./chat-poke-types";

export interface GeneratedPokesResult {
    userPokes: string[];
    charPokes: string[];
}

/**
 * 根据角色人设与用户名称，单次调用大模型一键生成双方各 5 条拍一拍文案。
 */
export async function generateAllPokesViaLLM(
    character: Character,
    userName?: string,
): Promise<GeneratedPokesResult> {
    const bindings = loadBindingConfig();
    const slot = resolveBinding(bindings, character.id, "chat");
    if (!slot.apiConfigId) {
        throw new Error("尚未绑定聊天 API 配置，请先在模型设置中绑定。");
    }
    const apiConfig = loadApiConfigs().find(c => c.id === slot.apiConfigId);
    if (!apiConfig) {
        throw new Error("绑定的 API 配置不存在，请检查模型设置。");
    }

    const charName = character.name?.trim() || "该角色";
    const uName = userName?.trim() || "用户";

    const systemPrompt = [
        "你是一位懂角色扮演与细腻网络社交氛围的文案大师。",
        `请结合角色「${charName}」的人设特征与TA同用户「${uName}」的互动关系，为手机聊天软件的「拍一拍（双击头像动作）」功能生成互动文案。`,
        "",
        `【角色设定】\n${character.persona?.trim() || "（暂无具体设定）"}`,
        ...(character.personality?.trim() ? ["", `【性格特征】\n${character.personality.trim()}`] : []),
        "",
        "【至关重要的核心铁律】：",
        "1. 严禁出现「你」、「我」、「他」、「她」等第一/第二/第三人称代词！文案中必须直接使用占位符：{User} 代表用户真实大名，{Char} 代表角色真实大名（注意首字母大写）。例如：{User} 拍了拍 {Char} 的小脑瓜，绝不能写成 我拍了拍你 或 你拍了拍我！",
        "2. 拍一拍是手机聊天软件内的线上虚拟屏幕互动（类似微信双击头像震动提醒/戳一戳），绝非现实生活中的线下肉体接触！文案要符合线上打趣、撒娇、傲娇、提醒、隔空戳戳的氛围，严禁写成线下动手动脚（严禁描写掀衣服、抚摸身体等肉体接触）。",
        `3. 严格只生成两组文案，每组最多正好 ${MAX_POKE_ITEMS_COUNT} 条（短小精悍，每句一般在 12~24 字以内）。`,
        "- userPokes：用户拍角色（格式：{User} 动作词 {Char} ...）",
        "- charPokes：角色拍用户（格式：{Char} 动作词 {User} ...）",
        "",
        "【输出格式】：",
        "请务必只输出合法合规的纯 JSON 格式（不要包含任何 markdown 代码块外部的闲聊）：",
        "{",
        '  "userPokes": [',
        `    "{User} 戳了戳 {Char} 紧绷的下颚线",`,
        `    "{User} 拍了拍 {Char} 设防森严的对话框",`,
        `    "{User} 敲了敲 {Char} 的小脑瓜问在不在",`,
        `    "{User} 拍了拍 {Char} 并发送了一记清脆的脑瓜崩",`,
        `    "{User} 扯了扯 {Char} 的衣角试图引起注意"`,
        "  ],",
        '  "charPokes": [',
        `    "{Char} 拍了拍 {User} 的脑袋瓜问人呢",`,
        `    "{Char} 戳了戳 {User} 的屏幕并递过来一杯温水",`,
        `    "{Char} 弹了弹 {User} 的额头叫 {User} 别发呆",`,
        `    "{Char} 敲了敲 {User} 悄悄发呆的小脑袋",`,
        `    "{Char} 拍了拍 {User} 并叹了口气说笨蛋"`,
        "  ]",
        "}",
    ].join("\n");

    const result = await simpleLLMCall(
        apiConfig,
        [
            { role: "system", content: systemPrompt },
            { role: "user", content: `请为「${charName}」和「${uName}」生成双方各 ${MAX_POKE_ITEMS_COUNT} 条拍一拍文案。` },
        ],
        {
            temperature: 0.8,
            max_tokens: 1200,
            label: `Poke-Gen-${charName}`,
        },
    );

    if (result.error || !result.content) {
        throw new Error(result.error || "大模型未返回有效内容，请检查网络或 API 配置。");
    }

    // 提取 JSON
    let cleaned = result.content.trim();
    // 移除 markdown 标记 ```json ... ```
    if (cleaned.startsWith("```")) {
        cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
    }

    try {
        const parsed = JSON.parse(cleaned);
        const sanitizePoke = (raw: string, isUserAction: boolean) => {
            let str = raw.trim();
            // 规整真实名字为首字母大写的占位符
            if (uName && uName !== "用户") str = str.split(uName).join("{User}");
            if (charName && charName !== "该角色" && charName !== "对方") str = str.split(charName).join("{Char}");
            // 规整小写占位符为大写占位符
            str = str.replace(/\{user\}/gi, "{User}").replace(/\{char\}/gi, "{Char}");
            // 消除残余代词
            if (isUserAction) {
                str = str.replace(/^我\s*/, "{User} ");
                str = str.replace(/^你\s*/, "{User} ");
                str = str.replace(/(拍了拍|戳了戳|揉了揉|捏了捏|敲了敲|抱了抱)\s*(?:他|她)/g, "$1 {Char}");
            } else {
                str = str.replace(/^他\s*/, "{Char} ");
                str = str.replace(/^她\s*/, "{Char} ");
                str = str.replace(/(拍了拍|戳了戳|揉了揉|捏了捏|敲了敲|抱了抱)\s*(?:你|我)/g, "$1 {User}");
            }
            // 确保开头有主语
            if (!str.startsWith("{User}") && !str.startsWith("{Char}")) {
                str = isUserAction ? `{User} ${str}` : `{Char} ${str}`;
            }
            return str.replace(/\s{2,}/g, " ").trim();
        };

        const rawUserPokes: string[] = Array.isArray(parsed.userPokes)
            ? parsed.userPokes.filter((s: unknown): s is string => typeof s === "string" && s.trim().length > 0).slice(0, MAX_POKE_ITEMS_COUNT)
            : [];
        const rawCharPokes: string[] = Array.isArray(parsed.charPokes)
            ? parsed.charPokes.filter((s: unknown): s is string => typeof s === "string" && s.trim().length > 0).slice(0, MAX_POKE_ITEMS_COUNT)
            : [];

        const userPokes = rawUserPokes.map((s: string) => sanitizePoke(s, true));
        const charPokes = rawCharPokes.map((s: string) => sanitizePoke(s, false));

        if (userPokes.length === 0 && charPokes.length === 0) {
            throw new Error("解析出的文案列表为空，请重试。");
        }

        return {
            userPokes: userPokes.length > 0 ? userPokes : ["{User} 拍了拍 {Char}"],
            charPokes: charPokes.length > 0 ? charPokes : ["{Char} 拍了拍 {User}"],
        };
    } catch (parseErr) {
        console.warn("[generateAllPokesViaLLM] JSON parse failed:", cleaned, parseErr);
        throw new Error("大模型返回格式解析失败，请点击重新生成一次。");
    }
}

// 全局单例任务状态管理器：关闭弹窗甚至切换页面，后台任务依然继续，重新打开弹窗依然维持「生成中」
export const POKE_GENERATION_STATE_EVENT = "chat-poke-generation-state-changed";

export interface PokeGenerationStateDetail {
    characterId: string;
    isGenerating: boolean;
    result?: GeneratedPokesResult;
    error?: string;
}

const generatingCharacters = new Set<string>();

export function isCharacterGeneratingPokes(characterId: string): boolean {
    return generatingCharacters.has(characterId);
}

export async function triggerPersistentPokeGeneration(
    character: Character,
    userName?: string,
): Promise<GeneratedPokesResult> {
    const charId = character.id;
    generatingCharacters.add(charId);
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent<PokeGenerationStateDetail>(POKE_GENERATION_STATE_EVENT, {
            detail: { characterId: charId, isGenerating: true },
        }));
    }

    try {
        const result = await generateAllPokesViaLLM(character, userName);
        generatingCharacters.delete(charId);
        if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent<PokeGenerationStateDetail>(POKE_GENERATION_STATE_EVENT, {
                detail: { characterId: charId, isGenerating: false, result },
            }));
        }
        return result;
    } catch (err: unknown) {
        generatingCharacters.delete(charId);
        const errMsg = err instanceof Error ? err.message : "AI 生成失败，请稍后重试";
        if (typeof window !== "undefined") {
            window.dispatchEvent(new CustomEvent<PokeGenerationStateDetail>(POKE_GENERATION_STATE_EVENT, {
                detail: { characterId: charId, isGenerating: false, error: errMsg },
            }));
        }
        throw err;
    }
}
