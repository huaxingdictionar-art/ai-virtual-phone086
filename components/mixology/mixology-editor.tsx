"use client";

// 独家特调 · 材料编辑器：八类材料的自建/编辑表单（底部弹层里渲染）。
// Phase ③ 先给够用的表单闭环，创作工坊阶段再上专业编辑体验。

import { useRef, useState, type ReactNode } from "react";
import { FileText, Play, Plus, Trash2 } from "lucide-react";
import type {
    MixCharacterCard,
    MixMaterial,
    MixMaterialKind,
    MixTextMaterial,
} from "@/lib/mixology/types";
import { createMixId, MIX_KIND_LABELS } from "@/lib/mixology/types";
import { MixPreviewSheet, MixStructureSheet, type MixPreviewTarget } from "./mixology-preview";

const OPENING_SEPARATOR = "\n---\n";

/** 每类材料点进来先说清楚：这是干什么的、写完落在提示词哪一段 */
const KIND_GUIDE: Record<MixMaterialKind, { what: string; where: string }> = {
    character: {
        what: "一个可以被扮演的人：他是谁、身处什么世界、开局时和你什么关系。",
        where: "拆进提示词的「角色资料」「世界与剧情」「示例对话」三段。",
    },
    base: {
        what: "扮演的总规矩：怎么入戏、能不能替玩家说话、允不允许出现冲突和负面情绪。管的是「态度」，不管文笔。",
        where: "落在提示词最前面的「扮演总纲」。",
    },
    flavor: {
        what: "只管怎么写字：句子长短、叙述视角、爱写动作还是爱写心理。不要在这里写角色设定。",
        where: "落在提示词的「文风」。",
    },
    glass: {
        what: "每轮回复长什么样：分几段、对白用什么符号包、心声怎么标。管的是「形状」，不管内容。",
        where: "落在提示词的「输出格式」。",
    },
    strength: {
        what: "调酒里的苦精按「滴」算，几滴就能把整杯的性格拧过来——这一味也一样。它排在所有对话之后，是模型动笔前看到的最后一句话，专治「说过又忘」。正因为位置太好，更要克制：挑一两条最要紧的，写长了反而稀释。",
        where: "放在对话历史之后、本轮生成之前，标题是「最高优先级要求」，八味里只有它享受这个位置。",
    },
    ticket: {
        what: "每轮结束时角色额外「递」给你的一张数据卡片——好感度、当前心情、身上带了什么，都行。你定它报什么，也定它长什么样。",
        where: "契约落在提示词的「小票」；渲染代码不进提示词，只在界面里画卡片。",
    },
    garnish: {
        what: "对局画面的皮肤：正文颜色、对白字体、气泡样式，用 CSS 写。",
        where: "完全不进提示词，只改界面呈现，写多长都不占上下文。",
    },
    encore: {
        what: "随卡附赠的互动小玩意儿——一段可点击的 HTML，比如角色的手账、日程表、关系图。",
        where: "完全不进提示词，在沙盒里单独运行。",
    },
};

/** 文本类材料（基底/风味/杯型/苦精）的字段名与示例 */
const TEXT_FIELD_COPY: Record<"base" | "flavor" | "glass" | "strength", { label: string; placeholder: string }> = {
    base: {
        label: "扮演总纲",
        placeholder: "例：\n你将完全成为{{char}}，以第一视角活在故事里。\n- 绝不跳出角色，绝不以 AI 自称。\n- 绝不代替{{user}}说话或做决定。\n- 允许出现冲突、拒绝与负面情绪，贴合人设比讨好{{user}}更重要。",
    },
    flavor: {
        label: "文风描述",
        placeholder: "例：\n克制的短句，多写动作、气味和环境细节，少写心理解说。\n对话之间留白，不把话说满。",
    },
    glass: {
        label: "输出格式",
        placeholder: "例：\n第三人称叙述，每轮 2~4 个自然段，段落之间空一行。\n- 说出口的话用「」包裹。\n- 没说出口的念头用 * * 包裹。\n- 在留有余韵处收笔，给{{user}}接话的空间。",
    },
    strength: {
        label: "最后叮嘱",
        placeholder: "一两句就够，例：\n始终保持{{char}}的克制感，不要替{{user}}总结感受。",
    },
};

/** 封面统一压到 900px 内的 JPEG dataURL，避免 kv 被大图撑爆 */
async function readCoverFile(file: File): Promise<string> {
    const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(file);
    });
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("图片解码失败"));
        el.src = dataUrl;
    });
    const max = 900;
    const scale = Math.min(1, max / Math.max(img.width, img.height));
    if (scale >= 1 && dataUrl.length < 400_000) return dataUrl;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
}

type EditorProps = {
    kind: MixMaterialKind;
    initial?: MixMaterial;
    onSave: (material: MixMaterial) => void;
    onCancel: () => void;
};

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
    return (
        <>
            <label className="mix-form-label">
                {label}
                {hint ? <> · <b>{hint}</b></> : null}
            </label>
            {children}
        </>
    );
}

export function MixMaterialEditor({ kind, initial, onSave, onCancel }: EditorProps) {
    const isCharacter = kind === "character";
    const initialCard = isCharacter && initial?.kind === "character" ? (initial as MixCharacterCard) : null;

    const [name, setName] = useState(initial?.name ?? "");
    const [hook, setHook] = useState(initial?.hook ?? "");
    const [cover, setCover] = useState(initial?.cover ?? "");
    // 角色卡专属
    const [baseInfo, setBaseInfo] = useState(initialCard?.baseInfo ?? "");
    const [personality, setPersonality] = useState(initialCard?.personality ?? "");
    const [appearance, setAppearance] = useState(initialCard?.appearance ?? "");
    const [background, setBackground] = useState(initialCard?.background ?? "");
    const [worldview, setWorldview] = useState(initialCard?.worldview ?? "");
    const [cognition, setCognition] = useState(initialCard?.cognition ?? "");
    const [relations, setRelations] = useState(initialCard?.relations ?? "");
    const [plot, setPlot] = useState(initialCard?.plot ?? "");
    const [extra, setExtra] = useState(initialCard?.extra ?? "");
    const [openingsText, setOpeningsText] = useState(initialCard?.openings.join(OPENING_SEPARATOR) ?? "");
    const [authorNote, setAuthorNote] = useState(initialCard?.authorNote ?? "");
    const [examples, setExamples] = useState<{ role: "user" | "char"; text: string }[]>(
        initialCard?.examples ? initialCard.examples.map((e) => ({ ...e })) : [],
    );
    // 文本类 / 小票 / 装饰 / 尾调
    const [content, setContent] = useState(
        initial && "content" in initial ? (initial as MixTextMaterial).content : "",
    );
    const [contract, setContract] = useState(initial?.kind === "ticket" ? initial.contract : "");
    const [renderHtml, setRenderHtml] = useState(initial?.kind === "ticket" ? initial.renderHtml : "");
    const [previewRaw, setPreviewRaw] = useState(initial?.kind === "ticket" ? initial.previewRaw ?? "" : "");
    const [css, setCss] = useState(initial?.kind === "garnish" ? initial.css : "");
    const [html, setHtml] = useState(initial?.kind === "encore" ? initial.html : "");
    const [error, setError] = useState("");
    const [preview, setPreview] = useState<MixPreviewTarget | null>(null);
    const [structureOpen, setStructureOpen] = useState(false);
    const fileRef = useRef<HTMLInputElement | null>(null);

    const handleCoverFile = async (file: File | undefined) => {
        if (!file) return;
        try {
            setCover(await readCoverFile(file));
        } catch {
            setError("封面图读取失败，请换一张试试。");
        }
    };

    const handleSave = () => {
        const trimmedName = name.trim();
        if (!trimmedName) {
            setError("先给这件材料起个名字。");
            return;
        }
        const meta = {
            id: initial?.id ?? createMixId("mixmat"),
            name: trimmedName,
            hook: hook.trim() || undefined,
            author: initial?.author,
            tags: initial?.tags,
            cover: cover || undefined,
            createdAt: initial?.createdAt ?? Date.now(),
            updatedAt: Date.now(),
        };
        if (isCharacter) {
            const openings = openingsText
                .split(/\n\s*---\s*(?:\n|$)/)
                .map((o) => o.trim())
                .filter(Boolean);
            if (!openings.length) {
                setError("至少写一段开场白，开局才有酒可端。");
                return;
            }
            const card: MixCharacterCard = {
                ...meta,
                kind: "character",
                charName: trimmedName,
                baseInfo: baseInfo.trim() || undefined,
                personality: personality.trim() || undefined,
                appearance: appearance.trim() || undefined,
                background: background.trim() || undefined,
                worldview: worldview.trim() || undefined,
                cognition: cognition.trim() || undefined,
                relations: relations.trim() || undefined,
                plot: plot.trim() || undefined,
                extra: extra.trim() || undefined,
                openings,
                examples: examples.filter((e) => e.text.trim()).map((e) => ({ role: e.role, text: e.text.trim() })),
                authorNote: authorNote.trim() || undefined,
            };
            onSave(card);
            return;
        }
        if (kind === "ticket") {
            if (!contract.trim() || !renderHtml.trim()) {
                setError("小票需要同时写「输出契约」和「渲染代码」。");
                return;
            }
            onSave({ ...meta, kind: "ticket", contract: contract.trim(), renderHtml, previewRaw: previewRaw.trim() || undefined });
            return;
        }
        if (kind === "garnish") {
            if (!css.trim()) {
                setError("装饰不能是空的，写点 CSS 吧。");
                return;
            }
            onSave({ ...meta, kind: "garnish", css });
            return;
        }
        if (kind === "encore") {
            if (!html.trim()) {
                setError("尾调不能是空的，写点 HTML 吧。");
                return;
            }
            onSave({ ...meta, kind: "encore", html });
            return;
        }
        if (!content.trim()) {
            setError(`${MIX_KIND_LABELS[kind]}的内容不能为空。`);
            return;
        }
        onSave({ ...meta, kind, content: content.trim() } as MixTextMaterial);
    };

    const guide = KIND_GUIDE[kind];

    return (
        <div>
            <div className="mix-guide">
                <div className="mix-guide-what">{guide.what}</div>
                <div className="mix-guide-where">{guide.where}</div>
                <button type="button" className="mix-guide-link" onClick={() => setStructureOpen(true)}>
                    <FileText size={12} style={{ verticalAlign: "-2px" }} /> 看看完整提示词结构
                </button>
            </div>
            <Field label={isCharacter ? "角色名" : "名称"} hint="必填">
                <input className="mix-input" value={name} onChange={(e) => setName(e.target.value)} placeholder={isCharacter ? "角色叫什么，就是提示词里的 {{char}}" : `给这件${MIX_KIND_LABELS[kind]}起个名，方便自己在吧台认出来`} />
            </Field>
            <Field label="一句话介绍">
                <input className="mix-input" value={hook} onChange={(e) => setHook(e.target.value)} placeholder="一句话说清它的特点，会显示在卡片上" />
            </Field>
            {isCharacter || kind === "encore" ? (
                <Field label="封面图" hint={isCharacter ? "对局背景，强烈建议配" : undefined}>
                    <div className="mix-cover-picker">
                        {cover ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img className="mix-cover-preview" src={cover} alt="封面" />
                        ) : (
                            <div className="mix-cover-preview" />
                        )}
                        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                            <button type="button" className="mix-pill-btn" onClick={() => fileRef.current?.click()}>选择图片</button>
                            {cover ? (
                                <button type="button" className="mix-pill-btn" data-tone="ghost" onClick={() => setCover("")}>移除</button>
                            ) : null}
                        </div>
                        <input
                            ref={fileRef}
                            type="file"
                            accept="image/*"
                            style={{ display: "none" }}
                            onChange={(e) => { void handleCoverFile(e.target.files?.[0]); e.target.value = ""; }}
                        />
                    </div>
                </Field>
            ) : null}
            {isCharacter ? (
                <>
                    <Field label="基础信息"><textarea className="mix-textarea" value={baseInfo} onChange={(e) => setBaseInfo(e.target.value)} placeholder="例：27 岁 / 183cm / 便利店夜班店员" /></Field>
                    <Field label="性格"><textarea className="mix-textarea" value={personality} onChange={(e) => setPersonality(e.target.value)} placeholder="例：嘴上嫌弃手上诚实，怕麻烦但从不真的拒绝人" /></Field>
                    <Field label="外貌"><textarea className="mix-textarea" value={appearance} onChange={(e) => setAppearance(e.target.value)} placeholder="例：高瘦，总把制服外套袖子卷到手肘，左耳有个旧耳洞" /></Field>
                    <Field label="背景"><textarea className="mix-textarea" value={background} onChange={(e) => setBackground(e.target.value)} placeholder="例：三年前从老家搬来，白天在读夜校，夜班是为了付学费" /></Field>
                    <Field label="世界观"><textarea className="mix-textarea" value={worldview} onChange={(e) => setWorldview(e.target.value)} placeholder="故事发生在什么世界。例：普通现代都市，没有超自然设定" /></Field>
                    <Field label="对用户的初始认知"><textarea className="mix-textarea" value={cognition} onChange={(e) => setCognition(e.target.value)} placeholder="开局时角色对你了解到什么程度。例：只知道你是每周来三次的常客，不知道名字" /></Field>
                    <Field label="关系与身份"><textarea className="mix-textarea" value={relations} onChange={(e) => setRelations(e.target.value)} placeholder="玩家可以代入哪些身份、各自什么关系。例：熟客（微妙的默契）/ 新同事（他带你）" /></Field>
                    <Field label="当前剧情"><textarea className="mix-textarea" value={plot} onChange={(e) => setPlot(e.target.value)} placeholder="故事从哪一刻开始。例：雨夜，打烊前十分钟，店里只剩你们两个" /></Field>
                    <Field label="附加设定"><textarea className="mix-textarea" value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="配角、私设名词、地点等。例：店长老周只在白班出现；「三号柜」是他们之间的暗号" /></Field>
                    <Field label="开场白" hint="必填，写多个玩家开局可以挑，用单独一行 --- 分隔">
                        <textarea
                            className="mix-textarea"
                            style={{ minHeight: 130 }}
                            value={openingsText}
                            onChange={(e) => setOpeningsText(e.target.value)}
                            placeholder={"故事的第一幕，由角色说出口。\n\n例：\n【便利店 · 打烊前十分钟】\n他把关东煮的竹签码齐，抬眼看你。「今天也加班到这个点？」\n---\n雨夜，他撑着伞站在店门口，像是等了很久。"}
                        />
                    </Field>
                    <Field label="示例对话" hint="文风锚点，不是已发生的剧情">
                        <div className="mix-example-list">
                            {examples.map((example, i) => (
                                <div className="mix-example-row" key={i}>
                                    <button
                                        type="button"
                                        className="mix-example-role"
                                        data-role={example.role}
                                        onClick={() => setExamples((prev) => prev.map((e, idx) => (
                                            idx === i ? { ...e, role: e.role === "user" ? "char" : "user" } : e
                                        )))}
                                    >
                                        {example.role === "user" ? "玩家" : "角色"}
                                    </button>
                                    <textarea
                                        className="mix-textarea"
                                        style={{ minHeight: 56 }}
                                        value={example.text}
                                        onChange={(e) => setExamples((prev) => prev.map((item, idx) => (
                                            idx === i ? { ...item, text: e.target.value } : item
                                        )))}
                                        placeholder={example.role === "user" ? "玩家会怎么说" : "角色该怎么答"}
                                    />
                                    <button
                                        type="button"
                                        className="mix-icon-btn"
                                        onClick={() => setExamples((prev) => prev.filter((_, idx) => idx !== i))}
                                        aria-label="删除这轮"
                                    >
                                        <Trash2 size={15} />
                                    </button>
                                </div>
                            ))}
                            <button
                                type="button"
                                className="mix-pill-btn"
                                onClick={() => setExamples((prev) => [
                                    ...prev,
                                    { role: prev.length && prev[prev.length - 1].role === "user" ? "char" : "user", text: "" },
                                ])}
                            >
                                <Plus size={13} style={{ verticalAlign: "-2px" }} /> 加一轮
                            </button>
                        </div>
                    </Field>
                    <Field label="作者的话" hint="仅展示，不进提示词">
                        <textarea className="mix-textarea" value={authorNote} onChange={(e) => setAuthorNote(e.target.value)} />
                    </Field>
                </>
            ) : null}
            {kind === "base" || kind === "flavor" || kind === "glass" || kind === "strength" ? (
                <Field label={TEXT_FIELD_COPY[kind].label} hint="必填，可用 {{char}} / {{user}}">
                    <textarea
                        className="mix-textarea"
                        style={{ minHeight: 170 }}
                        value={content}
                        onChange={(e) => setContent(e.target.value)}
                        placeholder={TEXT_FIELD_COPY[kind].placeholder}
                    />
                </Field>
            ) : null}
            {kind === "ticket" ? (
                <>
                    <Field label="输出契约" hint="必填，告诉 AI 每轮报哪些数据、按什么格式报">
                        <textarea
                            className="mix-textarea"
                            style={{ minHeight: 130 }}
                            value={contract}
                            onChange={(e) => setContract(e.target.value)}
                            placeholder={"例：\n每轮结束后报告下面三行，每行一个字段：\n好感度: 0-100 的整数\n心情: 四个字以内\n此刻在想: 一句话"}
                        />
                    </Field>
                    <Field label="渲染代码" hint="必填，HTML+CSS+JS，把上面那段原文画成卡片">
                        <textarea
                            className="mix-textarea"
                            data-code="true"
                            style={{ minHeight: 180 }}
                            value={renderHtml}
                            onChange={(e) => setRenderHtml(e.target.value)}
                            placeholder={"AI 报的原文用 {{RAW}} 直接插入，或在 JS 里读 window.TICKET_RAW。\n\n例：\n<div style=\"padding:12px;border-radius:10px;background:#1c1c26;color:#d9b06a\">\n  <pre>{{RAW}}</pre>\n</div>"}
                        />
                    </Field>
                    <Field label="预览示例数据" hint="随便编一份，用来试渲染效果">
                        <textarea
                            className="mix-textarea"
                            data-code="true"
                            value={previewRaw}
                            onChange={(e) => setPreviewRaw(e.target.value)}
                            placeholder={"照着上面的契约编一份，例：\n好感度: 62\n心情: 嘴硬\n此刻在想: 想留你再坐一会"}
                        />
                    </Field>
                    <button
                        type="button"
                        className="mix-pill-btn"
                        style={{ marginTop: 10 }}
                        onClick={() => setPreview({ kind: "ticket", html: renderHtml, raw: previewRaw })}
                        disabled={!renderHtml.trim()}
                    >
                        <Play size={13} style={{ verticalAlign: "-2px" }} /> 预览小票
                    </button>
                </>
            ) : null}
            {kind === "garnish" ? (
                <>
                    <Field label="界面 CSS" hint="必填，点下面「试穿看看」有完整类名速查">
                        <textarea
                            className="mix-textarea"
                            data-code="true"
                            style={{ minHeight: 190 }}
                            value={css}
                            onChange={(e) => setCss(e.target.value)}
                            placeholder={"例：\n.mix-dialogue { color: #ffd479; font-weight: 600 }\n.mix-thought  { color: #8d7bf5 }\n.mix-scene    { letter-spacing: .5em }"}
                        />
                    </Field>
                    <button
                        type="button"
                        className="mix-pill-btn"
                        style={{ marginTop: 10 }}
                        onClick={() => setPreview({ kind: "garnish", css })}
                        disabled={!css.trim()}
                    >
                        <Play size={13} style={{ verticalAlign: "-2px" }} /> 试穿看看
                    </button>
                </>
            ) : null}
            {kind === "encore" ? (
                <>
                    <Field label="小品 HTML" hint="必填，可带 CSS 和 JS，在沙盒里独立运行">
                        <textarea
                            className="mix-textarea"
                            data-code="true"
                            style={{ minHeight: 190 }}
                            value={html}
                            onChange={(e) => setHtml(e.target.value)}
                            placeholder={"一段能看能点的小东西，例：角色的手账、值班表、关系图。\n\n<div style=\"padding:16px;color:#f2f0f7\">\n  <h3>晏迟的排班表</h3>\n  <p>周二 / 周四 / 周六 · 夜班</p>\n</div>"}
                        />
                    </Field>
                    <button
                        type="button"
                        className="mix-pill-btn"
                        style={{ marginTop: 10 }}
                        onClick={() => setPreview({ kind: "encore", html })}
                        disabled={!html.trim()}
                    >
                        <Play size={13} style={{ verticalAlign: "-2px" }} /> 跑一下
                    </button>
                </>
            ) : null}
            {preview ? <MixPreviewSheet target={preview} onClose={() => setPreview(null)} /> : null}
            {structureOpen ? <MixStructureSheet highlight={kind} onClose={() => setStructureOpen(false)} /> : null}
            {error ? <div style={{ color: "#e2a3a3", fontSize: 12, marginTop: 12 }}>{error}</div> : null}
            <div className="mix-form-footer">
                <button type="button" className="mix-ghost-btn" onClick={onCancel}>取消</button>
                <button type="button" className="mix-brew-btn" onClick={handleSave}>保存入柜</button>
            </div>
        </div>
    );
}
