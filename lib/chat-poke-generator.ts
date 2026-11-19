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
    userName: string = "你",
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
    const uName = userName?.trim() || "你";

    const systemPrompt = [
        "你是一位懂角色扮演与细腻网络社交氛围的文案大师。",
        `请结合角色「${charName}」的人设特征与TA同用户「${uName}」的互动关系，为手机聊天软件的「拍一拍（双击头像动作）」功能生成互动文案。`,
        "",
        `【角色设定】\n${character.persona?.trim() || "（暂无具体设定）"}`,
        ...(character.personality?.trim() ? ["", `【性格特征】\n${character.personality.trim()}`] : []),
        "",
        "【至关重要的核心规则】：",
        "1. 拍一拍是手机聊天软件内的线上虚拟屏幕互动（类似微信双击头像震动提醒/戳一戳），绝非现实生活中的线下肉体接触！",
        "2. 哪怕双方身处异地、相隔千里也能在手机上拍。文案要符合线上打趣、撒娇、傲娇、提醒、隔空戳戳的氛围，千万不要写成线下直接动手动脚（严禁描写掀衣服、摸身体等真实肢体接触）！",
        "3. 文案中必须使用占位符：{user} 代表用户，{char} 代表角色。",
        `4. 严格只生成两组文案，每组最多正好 ${MAX_POKE_ITEMS_COUNT} 条（短小精悍，每句一般在 12~24 字以内）。`,
        "- userPokes：用户拍角色（{user} 拍了拍 {char} 的... / {user} 戳了戳 {char} 的...）",
        "- charPokes：角色拍用户（{char} 拍了拍 {user} 的... / {char} 戳了戳 {user} 的...）",
        "",
        "【输出格式】：",
        "请务必只输出合法合规的纯 JSON 格式（不要包含任何 markdown 代码块外部的闲聊）：",
        "{",
        '  "userPokes": [',
        `    "{user} 戳了戳 {char} 紧绷的下颚线",`,
        `    "{user} 拍了拍 {char} 设防森严的对话框",`,
        `    "{user} 敲了敲 {char} 的小脑瓜问在不在",`,
        `    "{user} 拍了拍 {char} 并发送了一记清脆的脑瓜崩",`,
        `    "{user} 扯了扯 {char} 的衣角试图引起注意"`,
        "  ],",
        '  "charPokes": [',
        `    "{char} 拍了拍 {user} 的脑袋瓜问人呢",`,
        `    "{char} 戳了戳 {user} 的屏幕催你快回消息",`,
        `    "{char} 弹了弹 {user} 的额头并递过来一杯温水",`,
        `    "{char} 敲了敲 {user} 悄悄发呆的小脑瓜",`,
        `    "{char} 拍了拍 {user} 并叹了口气说笨蛋"`,
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
        const userPokes = Array.isArray(parsed.userPokes)
            ? parsed.userPokes.filter((s: unknown) => typeof s === "string" && s.trim().length > 0).slice(0, MAX_POKE_ITEMS_COUNT)
            : [];
        const charPokes = Array.isArray(parsed.charPokes)
            ? parsed.charPokes.filter((s: unknown) => typeof s === "string" && s.trim().length > 0).slice(0, MAX_POKE_ITEMS_COUNT)
            : [];

        if (userPokes.length === 0 && charPokes.length === 0) {
            throw new Error("解析出的文案列表为空，请重试。");
        }

        return {
            userPokes: userPokes.length > 0 ? userPokes : ["{user} 拍了拍 {char}"],
            charPokes: charPokes.length > 0 ? charPokes : ["{char} 拍了拍 {user}"],
        };
    } catch (parseErr) {
        console.warn("[generateAllPokesViaLLM] JSON parse failed:", cleaned, parseErr);
        throw new Error("大模型返回格式解析失败，请点击重新生成一次。");
    }
}
