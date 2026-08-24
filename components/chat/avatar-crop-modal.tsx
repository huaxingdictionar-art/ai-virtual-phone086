"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

const VIEW_SIZE = 260;
const OUT_SIZE = 400;

function clamp(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, value));
}

/** 方形聊天头像裁剪器：拖动取景框选位置，拖右下角调整大小。 */
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
            const size = Math.round(Math.min(w, h) * 0.85);
            setNatural({ w, h });
            setRect({ x: Math.round((w - size) / 2), y: Math.round((h - size) / 2), size });
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

    const startDrag = (event: React.PointerEvent) => {
        event.preventDefault();
        event.stopPropagation();
        const startX = event.clientX;
        const startY = event.clientY;
        const startRect = { ...rect };
        const onMove = (next: PointerEvent) => {
            const dx = (next.clientX - startX) / scale;
            const dy = (next.clientY - startY) / scale;
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

    const startResize = (event: React.PointerEvent) => {
        event.preventDefault();
        event.stopPropagation();
        const startX = event.clientX;
        const startY = event.clientY;
        const startRect = { ...rect };
        const onMove = (next: PointerEvent) => {
            const delta = Math.max((next.clientX - startX) / scale, (next.clientY - startY) / scale);
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
        if (busy) return;
        setBusy(true);
        try {
            const img = new Image();
            img.src = image;
            await img.decode();
            const canvas = document.createElement("canvas");
            canvas.width = OUT_SIZE;
            canvas.height = OUT_SIZE;
            const context = canvas.getContext("2d");
            if (!context) throw new Error("canvas unavailable");
            context.drawImage(img, rect.x, rect.y, rect.size, rect.size, 0, 0, OUT_SIZE, OUT_SIZE);
            let dataUrl = canvas.toDataURL("image/png");
            if (dataUrl.length > 400_000) {
                const jpg = document.createElement("canvas");
                jpg.width = OUT_SIZE;
                jpg.height = OUT_SIZE;
                const jpgContext = jpg.getContext("2d");
                if (jpgContext) {
                    jpgContext.fillStyle = "#ffffff";
                    jpgContext.fillRect(0, 0, OUT_SIZE, OUT_SIZE);
                    jpgContext.drawImage(canvas, 0, 0);
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
            <div className="modal-dialog" onClick={(event) => event.stopPropagation()}>
                <span className="modal-header-title">调整聊天头像</span>
                <div className="ts-12 text-[var(--c-icon)] text-center mt-1">拖动取景框选位置，拖右下角调整大小</div>
                <div className="relative mx-auto mt-3 overflow-hidden bg-black/10" style={{ width: VIEW_SIZE, height: VIEW_SIZE }}>
                    <img
                        src={image}
                        alt=""
                        draggable={false}
                        className="absolute max-w-none select-none"
                        style={{ left: offsetX, top: offsetY, width: displayW, height: displayH }}
                    />
                    <div className="absolute inset-0 bg-black/45 pointer-events-none" />
                    <div
                        className="absolute border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.2)] cursor-move touch-none"
                        style={{ left: offsetX + rect.x * scale, top: offsetY + rect.y * scale, width: rect.size * scale, height: rect.size * scale }}
                        onPointerDown={startDrag}
                    >
                        <span
                            className="absolute -bottom-2 -right-2 h-5 w-5 rounded-full border-2 border-white bg-[var(--c-accent)] cursor-nwse-resize touch-none"
                            onPointerDown={startResize}
                        />
                    </div>
                </div>
                <div className="modal-actions mt-4">
                    <button type="button" className="ui-btn" onClick={onCancel} disabled={busy}>取消</button>
                    <button type="button" className="ui-btn ui-btn-primary" onClick={confirm} disabled={busy}>
                        {busy ? <Loader2 size={16} className="animate-spin" /> : "使用此头像"}
                    </button>
                </div>
            </div>
        </div>
    );
}
