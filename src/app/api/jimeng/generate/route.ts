import { NextRequest, NextResponse } from "next/server";
import { runtimeConfig } from "@/lib/runtimeConfig";

const JIMENG_BASE_URL = runtimeConfig.jimeng.apiBaseUrl;
const JIMENG_SESSION_ID = runtimeConfig.jimeng.sessionId;
const JIMENG_MODEL = runtimeConfig.jimeng.model;
const JIMENG_REQUEST_TIMEOUT_MS = runtimeConfig.jimeng.requestTimeoutMs;

type JimengResponsePayload = {
  data?: Array<{
    url?: string;
    b64_json?: string;
  }>;
  error?: {
    message?: string;
  };
  message?: string;
  raw?: string;
} | null;

function resolveImageUrl(req: NextRequest, value: string): string {
  if (!value) return "";
  if (/^https?:\/\//i.test(value) || /^data:/i.test(value)) {
    return value;
  }
  return new URL(value, req.nextUrl.origin).toString();
}

function resolveJimengErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) {
    return "图片生成失败";
  }

  if (error.name === "AbortError") {
    return "即梦生成超过90秒，请稍后手动重试";
  }

  const cause = error.cause;
  const code =
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    typeof cause.code === "string"
      ? cause.code
      : undefined;

  if (code === "ECONNREFUSED") {
    return `即梦服务未启动或无法连接：${JIMENG_BASE_URL}`;
  }

  if (error.message === "fetch failed") {
    return `即梦服务请求失败：${JIMENG_BASE_URL}`;
  }

  return error.message;
}

async function parseJimengResponse(resp: Response): Promise<JimengResponsePayload> {
  const contentType = resp.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return (await resp.json()) as JimengResponsePayload;
  }

  const text = await resp.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function extractJimengImageUrl(data: JimengResponsePayload): string | null {
  return data?.data?.[0]?.url || data?.data?.[0]?.b64_json || null;
}

async function requestJimengImage(endpoint: string, body: Record<string, unknown>) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), JIMENG_REQUEST_TIMEOUT_MS);

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${JIMENG_SESSION_ID}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await parseJimengResponse(resp);

    if (!resp.ok) {
      throw new Error(
        `即梦API错误: ${
          data?.error?.message ||
          data?.message ||
          data?.raw ||
          JSON.stringify(data)
        }`
      );
    }

    const imageUrl = extractJimengImageUrl(data);
    if (!imageUrl) {
      throw new Error("即梦API未返回图片URL");
    }

    return imageUrl;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function POST(req: NextRequest) {
  try {
    const {
      prompt,
      ratio = "3:4",
      resolution = "2k",
      templateSrc = "",
      referenceImageSrc = "",
    } = await req.json();

    if (!prompt) {
      return NextResponse.json({ error: "缺少prompt参数" }, { status: 400 });
    }

    const compositionSource = referenceImageSrc || templateSrc;
    const compositionUrl = resolveImageUrl(req, compositionSource);
    const endpoint = compositionUrl
      ? `${JIMENG_BASE_URL}/v1/images/compositions`
      : `${JIMENG_BASE_URL}/v1/images/generations`;
    const body = compositionUrl
      ? {
          model: JIMENG_MODEL,
          prompt,
          ratio,
          resolution,
          sample_strength: 0.35,
          images: [compositionUrl],
        }
      : {
          model: JIMENG_MODEL,
          prompt,
          ratio,
          resolution,
        };
    const imageUrl = await requestJimengImage(endpoint, body);

    return NextResponse.json({ imageUrl });
  } catch (e: unknown) {
    console.error("Jimeng generate error:", e);
    return NextResponse.json(
      { error: resolveJimengErrorMessage(e) },
      { status: 500 }
    );
  }
}
