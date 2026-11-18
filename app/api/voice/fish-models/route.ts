import { NextRequest, NextResponse } from "next/server";
import { proxyFetch } from "@/lib/proxy-fetch";

export const runtime = "nodejs";
export const maxDuration = 30;

type FishModel = {
  _id?: unknown;
  title?: unknown;
  created_at?: unknown;
};

function clean(value: unknown, limit: number): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function upstreamMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== "object") return fallback;
  const record = payload as Record<string, unknown>;
  for (const key of ["message", "detail", "error"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const apiKey = clean(body.apiKey, 500);
  if (!apiKey) {
    return NextResponse.json({ error: "missing_api_key", message: "请先填写 Fish Audio API Key。" }, { status: 400 });
  }

  try {
    const response = await proxyFetch("https://api.fish.audio/model?self=true&page_size=100&page_number=1", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(25_000),
    });
    const payload = await response.json().catch(() => null) as { items?: FishModel[] } | null;
    if (!response.ok) {
      return NextResponse.json({
        error: "fish_models_failed",
        message: upstreamMessage(payload, `Fish Audio 音色同步失败 (${response.status})`),
      }, { status: response.status });
    }

    const voices = (Array.isArray(payload?.items) ? payload.items : []).flatMap((item) => {
      const id = clean(item?._id, 300);
      if (!id) return [];
      const title = clean(item?.title, 200);
      const createdAtText = clean(item?.created_at, 80);
      const createdAt = createdAtText ? Date.parse(createdAtText) : Number.NaN;
      return [{
        id,
        name: title ? `${title} (${id})` : id,
        ...(Number.isFinite(createdAt) ? { createdAt } : {}),
      }];
    });

    return NextResponse.json({ ok: true, voices });
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError"
      ? "Fish Audio 音色同步超时，请稍后重试。"
      : error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "fish_models_failed", message }, { status: 502 });
  }
}
