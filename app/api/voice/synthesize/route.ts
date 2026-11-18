import { NextRequest, NextResponse } from "next/server";
import { proxyFetch } from "@/lib/proxy-fetch";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_TEXT_LENGTH = 20_000;

function clean(value: unknown, limit: number): string {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

async function upstreamError(response: Response): Promise<NextResponse> {
  const raw = (await response.text().catch(() => "")).slice(0, 800);
  let message = raw;
  try {
    const payload = JSON.parse(raw) as Record<string, unknown>;
    const detail = payload.detail;
    message = typeof payload.message === "string"
      ? payload.message
      : typeof detail === "string"
        ? detail
        : detail && typeof detail === "object" && typeof (detail as Record<string, unknown>).message === "string"
          ? String((detail as Record<string, unknown>).message)
          : raw;
  } catch { /* 上游也可能返回纯文本 */ }
  return NextResponse.json({ error: "voice_synthesis_failed", message: message || `HTTP ${response.status}` }, { status: response.status });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({})) as Record<string, unknown>;
  const provider = clean(body.provider, 40);
  const apiKey = clean(body.apiKey, 500);
  const text = clean(body.text, MAX_TEXT_LENGTH);
  const voiceId = clean(body.voiceId, 300);
  const model = clean(body.model, 120);

  if (!apiKey || !text) {
    const message = !apiKey ? "API Key 未配置" : "语音文本为空";
    return NextResponse.json({ error: "missing_voice_parameters", message }, { status: 400 });
  }

  try {
    let response: Response;
    if (provider === "FishAudio" || provider === "Fish Audio") {
      const payload: Record<string, unknown> = {
        text,
        format: "mp3",
        mp3_bitrate: 128,
        normalize: true,
        latency: "normal",
      };
      if (voiceId) {
        payload.reference_id = voiceId;
      }
      response = await proxyFetch("https://api.fish.audio/v1/tts", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          model: model || "s2.1-pro-free",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120_000),
      });
    } else if (provider === "ElevenLabs") {
      if (!voiceId) {
        return NextResponse.json({ error: "missing_voice_parameters", message: "ElevenLabs Voice ID 未配置" }, { status: 400 });
      }
      const speed = typeof body.speechSpeed === "number" && Number.isFinite(body.speechSpeed)
        ? Math.min(1.2, Math.max(0.7, body.speechSpeed))
        : 1;
      response = await proxyFetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
        method: "POST",
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: model || "eleven_multilingual_v2", voice_settings: { speed } }),
        signal: AbortSignal.timeout(120_000),
      });
    } else {
      return NextResponse.json({ error: "unsupported_voice_provider", message: "不支持的语音服务商" }, { status: 400 });
    }

    if (!response.ok) return upstreamError(response);
    const audio = await response.arrayBuffer();
    return new NextResponse(audio, {
      status: 200,
      headers: {
        "Content-Type": response.headers.get("content-type") || "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")
      ? "语音合成请求超时，请稍后重试。"
      : error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: "voice_synthesis_failed", message }, { status: 502 });
  }
}
