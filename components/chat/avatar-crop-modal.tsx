"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

const VIEW_SIZE = 260; // 预览区边长（px）
const OUT_SIZE = 400;  // 输出头像边长（px）

function clamp(v: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, v));
}

/**
 * 方形取景框裁剪面板：默认取图片中央，取景框可拖动位置、拖右下角调整大小。
 * 确认后按取景框内容裁成正方形并缩放到 400px 输出。
 */
export function AvatarCropModal({
    image,
    onCancel,
    onConfirm,
}: {
    image: string;
    onCancel: () => void;
    onConfirm: (dataUrl: string) => void;
}) {
    const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
    const [rect, setRect] = useState<{ x: number; y: number; size: number } | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        const img = new Image();
        img.onload = () => {
            const w = img.naturalWidth;
            const h = img.naturalHeight;
            setNatural({ w, h });
            const size = Math.round(Math.min(w, h) * 0.85);
            setRect({
                x: Math.round((w - size) / 2),
                y: Math.round((h - size) / 2),
                size,
            });
        };
        img.src = image;
    }, [image]);

    if (!natural || !rect) {
        return (
            <div className="modal-overlay">
                <div className="modal-dialog">
                    <span className="modal-header-title">调整聊天头像</span>
                    <div className="flex justify-center py-8">
                        <Loader2 size={24} className="animate-spin text-[var(--c-accent)]" />
                    </div>
                </div>
            </div>
        );
    }

    const scale = Math.min(VIEW_SIZE / natural.w, VIEW_SIZE / natural.h);
    const displayW = natural.w * scale;
    const displayH = natural.h * scale;
    const offsetX = (VIEW_SIZE - displayW) / 2;
    const offsetY = (VIEW_SIZE - displayH) / 2;
    const maxSize = Math.min(natural.w, natural.h);

    const startDrag = (e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const startClientX = e.clientX;
        const startClientY = e.clientY;
        const startRect = { ...rect };
        const onMove = (ev: PointerEvent) => {
            const dx = (ev.clientX - startClientX) / scale;
            const dy = (ev.clientY - startClientY) / scale;
            setRect({
                x: Math.round(clamp(startRect.x + dx, 0, natural.w - startRect.size)),
                y: Math.round(clamp(startRect.y + dy, 0, natural.h - startRect.size)),
                size: startRect.size,
            });
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    const startResize = (e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const startClientX = e.clientX;
        const startClientY = e.clientY;
        const startRect = { ...rect };
        const onMove = (ev: PointerEvent) => {
            const delta = Math.max((ev.clientX - startClientX) / scale, (ev.clientY - startClientY) / scale);
            const size = Math.round(clamp(startRect.size + delta, Math.round(maxSize * 0.25), maxSize));
            setRect({
                x: Math.round(clamp(startRect.x, 0, natural.w - size)),
                y: Math.round(clamp(startRect.y, 0, natural.h - size)),
                size,
            });
        };
        const onUp = () => {
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
        };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
    };

    const confirm = async () => {
        if (busy || !rect) return;
        setBusy(true);
        try {
            const img = new Image();
            img.src = image;
            await img.decode();
            const canvas = document.createElement("canvas");
            canvas.width = OUT_SIZE;
            canvas.height = OUT_SIZE;
            const ctx = canvas.getContext("2d");
            if (!ctx) { setBusy(false); return; }
            ctx.drawImage(img, rect.x, rect.y, rect.size, rect.size, 0, 0, OUT_SIZE, OUT_SIZE);
            let dataUrl = canvas.toDataURL("image/png");
            // 超大图转 JPEG（白底）控制体积
            if (dataUrl.length > 400_000) {
                const jpg = document.createElement("canvas");
                jpg.width = OUT_SIZE;
                jpg.height = OUT_SIZE;
                const jctx = jpg.getContext("2d");
                if (jctx) {
                    jctx.fillStyle = "#ffffff";
                    jctx.fillRect(0, 0, OUT_SIZE, OUT_SIZE);
                    jctx.drawImage(canvas, 0, 0);
                    dataUrl = jpg.toDataURL("image/jpeg", 0.9);
                }
            }
            onConfirm(dataUrl);
        } catch {
            setBusy(false);
            alert("图片处理失败，请重试");
        }
    };

    return (
        <div className="modal-overlay" onClick={onCancel}>
            <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
                <span className="modal-header-title">调整聊天头像</span>
                <div className="ts-12 text-[var(--c-icon)] text-center mt-1">
                    拖动取景框选位置，拖右下角调整大小
                </div>
                <div className="relative mx-auto mt-3" style={{ width: VIEW_SIZE, height: VIEW_SIZE }}>
                    <img
                        src={image}
                        alt=""
                        draggable={false}
                        className="absolute max-w-none select-none"
                        style={{ left: offsetX, top: offsetY, width: displayW, height: displayH }}
                    />
                    <div
                        className="absolute cursor-move"
                        style={{
                            left: offsetX + rect.x * scale,
                            top: offsetY + rect.y * scale,
                            width: rect.size * scale,
                            height: rect.size * scale,
                            boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
                            border: "2px solid #fff",
                            touchAction: "none",
                        }}
                        onPointerDown={startDrag}
                    >
                        <div
                            className="absolute -right-[7px] -bottom-[7px] w-[14px] h-[14px] cursor-nwse-resize rounded-sm"
                            style={{ background: "#fff", border: "2px solid #555" }}
                            onPointerDown={startResize}
                        />
                    </div>
                </div>
                <div className="flex gap-2 mt-4">
                    <button className="ui-btn ui-btn-outline flex-1" onClick={onCancel} disabled={busy} type="button">取消</button>
                    <button className="ui-btn ui-btn-primary flex-1" onClick={confirm} disabled={busy} type="button">{busy ? "处理中…" : "使用"}</button>
                </div>
            </div>
        </div>
    );
}
