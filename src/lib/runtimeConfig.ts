import "server-only";

function readStringEnv(name: string) {
  return process.env[name]?.trim();
}

function readPositiveIntEnv(name: string, fallback: number) {
  const raw = readStringEnv(name);
  if (!raw) return fallback;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.trunc(parsed);
}

export const runtimeConfig = {
  feishu: {
    appId: readStringEnv("FEISHU_APP_ID") || "",
    appSecret: readStringEnv("FEISHU_APP_SECRET") || "",
    openBaseUrl: readStringEnv("FEISHU_OPEN_BASE_URL") || "https://open.feishu.cn",
    bitableAppToken: readStringEnv("FEISHU_BITABLE_APP_TOKEN") || "",
    bitableTableId: readStringEnv("FEISHU_BITABLE_TABLE_ID") || "",
    rewriteTableId: readStringEnv("FEISHU_REWRITE_TABLE_ID") || "",
  },
  xhs: {
    apiBaseUrl: readStringEnv("XHS_API_BASE_URL") || "https://api.yddm.com",
    apiKey: readStringEnv("XHS_API_KEY") || "",
    requestTimeoutMs: readPositiveIntEnv("XHS_REQUEST_TIMEOUT_MS", 15_000),
    retryAttempts: readPositiveIntEnv("XHS_RETRY_ATTEMPTS", 3),
    retryBaseDelayMs: readPositiveIntEnv("XHS_RETRY_BASE_DELAY_MS", 800),
  },
  dashscope: {
    apiKey: readStringEnv("DASHSCOPE_API_KEY") || "",
    baseUrl:
      readStringEnv("DASHSCOPE_BASE_URL") ||
      "https://dashscope.aliyuncs.com/compatible-mode/v1",
    textModel:
      readStringEnv("DASHSCOPE_TEXT_MODEL") ||
      readStringEnv("DASHSCOPE_MODEL") ||
      "qwen-plus",
    visionModel: readStringEnv("DASHSCOPE_VISION_MODEL") || "qwen-vl-plus",
  },
  jimeng: {
    apiBaseUrl: readStringEnv("JIMENG_API_BASE_URL") || "http://localhost:5100",
    sessionId: readStringEnv("JIMENG_SESSION_ID") || "",
    model: readStringEnv("JIMENG_MODEL") || "jimeng-4.6",
    requestTimeoutMs: readPositiveIntEnv("JIMENG_REQUEST_TIMEOUT_MS", 90_000),
  },
  saveDraft: {
    concurrency: readPositiveIntEnv("SAVE_DRAFT_CONCURRENCY", 3),
    retryAttempts: readPositiveIntEnv("SAVE_DRAFT_RETRY_ATTEMPTS", 4),
    retryBaseDelayMs: readPositiveIntEnv("SAVE_DRAFT_RETRY_BASE_DELAY_MS", 800),
  },
} as const;
