#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";

const DEFAULT_OPEN_BASE_URL = "https://open.feishu.cn";
const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_DELAY_MS = 400;
const DEFAULT_RETRY_ATTEMPTS = 4;
const DEFAULT_RETRY_DELAY_MS = 800;
const MAX_BATCH_SIZE = 200;
const ATTACHMENT_FIELD_TYPE = 17;
const USER_FIELD_TYPE = 11;
const GROUP_FIELD_TYPE = 23;
const URL_FIELD_TYPE = 15;
const LOCATION_FIELD_TYPE = 22;
const DATE_FIELD_TYPE = 5;
const CHECKBOX_FIELD_TYPE = 7;
const MULTI_SELECT_FIELD_TYPE = 4;
const SINGLE_SELECT_FIELD_TYPE = 3;
const TEXT_FIELD_TYPE = 1;
const NUMBER_FIELD_TYPE = 2;
const PHONE_FIELD_TYPE = 13;
const CHECKPOINT_ROOT = path.join(process.cwd(), ".runtime", "feishu-migration");
const CHECKPOINT_VERSION = 1;

const DIRECT_COPY_FIELD_TYPES = new Set([
  TEXT_FIELD_TYPE,
  NUMBER_FIELD_TYPE,
  SINGLE_SELECT_FIELD_TYPE,
  MULTI_SELECT_FIELD_TYPE,
  DATE_FIELD_TYPE,
  CHECKBOX_FIELD_TYPE,
  PHONE_FIELD_TYPE,
  URL_FIELD_TYPE,
  ATTACHMENT_FIELD_TYPE,
  USER_FIELD_TYPE,
  LOCATION_FIELD_TYPE,
  GROUP_FIELD_TYPE,
]);

const NON_COPY_FIELD_TYPES = new Set([18, 20, 21, 1001, 1002, 1003, 1004, 1005]);
const RETRYABLE_FEISHU_CODES = new Set([1254002, 1254290, 1254291, 1254607, 1255001, 1255002, 1255040]);
const RETRYABLE_HTTP_STATUSES = new Set([408, 409, 425, 429, 500, 502, 503, 504]);
const XHS_URL_PATTERN =
  /((?:https?:\/\/)?(?:www\.)?(?:xiaohongshu\.com|xhslink\.com)\/[^\s<>"'`]+)/gi;
const TRAILING_URL_PUNCTUATION_PATTERN = /[。。，,！!？?；;：:）)\]】》>」』"'`]+$/u;
const LEADING_URL_PUNCTUATION_PATTERN = /^[（(\[【《<「『"'`]+/u;
const MIME_EXTENSION_MAP = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
  ["image/bmp", "bmp"],
  ["image/svg+xml", "svg"],
  ["application/pdf", "pdf"],
  ["text/plain", "txt"],
  ["application/zip", "zip"],
  ["video/mp4", "mp4"],
]);

const HELP_TEXT = `
Feishu Bitable migration script

默认是 dry-run，只做校验和统计，不会写目标表。

用法:
  npm run feishu:migrate
  npm run feishu:migrate -- --table=collect
  npm run feishu:migrate:execute
  npm run feishu:migrate:execute -- --table=rewrite --limit=20

可选参数:
  --execute            真正写入目标表
  --dry-run            仅校验，不写入（默认）
  --table=all|collect|rewrite
  --limit=<number>     仅迁移前 N 条源记录，便于试跑
  --batch-size=<n>     单批写入条数，默认 50
  --allow-skip-fields  允许跳过源表中存在值、但无法映射到目标表的字段
  --help               显示帮助

建议流程:
  1. 先跑 npm run feishu:migrate
  2. 确认输出没有字段缺失 / 类型不一致 / 去重异常
  3. 再跑 npm run feishu:migrate:execute
`;

function parseArgs(argv) {
  const options = {
    mode: "dry-run",
    table: "all",
    limit: 0,
    batchSize: readPositiveIntEnv("FEISHU_MIGRATION_BATCH_SIZE", DEFAULT_BATCH_SIZE),
    allowSkipFields: false,
    help: false,
  };

  for (const rawArg of argv) {
    const arg = String(rawArg || "").trim();
    if (!arg) continue;

    if (arg === "--execute") {
      options.mode = "execute";
      continue;
    }

    if (arg === "--dry-run") {
      options.mode = "dry-run";
      continue;
    }

    if (arg === "--allow-skip-fields") {
      options.allowSkipFields = true;
      continue;
    }

    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg.startsWith("--table=")) {
      options.table = arg.slice("--table=".length).trim() || "all";
      continue;
    }

    if (arg.startsWith("--limit=")) {
      options.limit = toPositiveInt(arg.slice("--limit=".length), 0);
      continue;
    }

    if (arg.startsWith("--batch-size=")) {
      options.batchSize = toPositiveInt(arg.slice("--batch-size=".length), options.batchSize);
      continue;
    }

    throw new Error(`未知参数: ${arg}`);
  }

  if (!["all", "collect", "rewrite"].includes(options.table)) {
    throw new Error(`--table 仅支持 all / collect / rewrite，收到: ${options.table}`);
  }

  options.batchSize = Math.min(Math.max(options.batchSize, 1), MAX_BATCH_SIZE);
  return options;
}

function readEnv(name, fallback = "") {
  const value = process.env[name];
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function readPositiveIntEnv(name, fallback) {
  return toPositiveInt(readEnv(name), fallback);
}

function toPositiveInt(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.trunc(parsed);
}

function parseJsonEnv(name) {
  const raw = readEnv(name);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("必须是 JSON 对象");
    }

    return Object.fromEntries(
      Object.entries(parsed)
        .map(([key, value]) => [String(key).trim(), String(value ?? "").trim()])
        .filter(([key, value]) => key && value)
    );
  } catch (error) {
    throw new Error(`${name} 不是合法的 JSON 对象: ${getErrorMessage(error)}`);
  }
}

function ensureRequiredEnv(names) {
  const missing = names.filter((name) => !readEnv(name));
  if (missing.length > 0) {
    throw new Error(`缺少环境变量: ${missing.join(", ")}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildRetryDelay(baseDelayMs, attempt) {
  return baseDelayMs * attempt + Math.floor(Math.random() * 250);
}

function shouldRetry(status, code) {
  return RETRYABLE_HTTP_STATUSES.has(status) || RETRYABLE_FEISHU_CODES.has(code);
}

function getErrorMessage(error) {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isRetryableTransportError(error) {
  const message = getErrorMessage(error).toLowerCase();
  return [
    "fetch failed",
    "timeout",
    "timed out",
    "econnreset",
    "econnrefused",
    "socket hang up",
    "network connection failed",
    "aborted",
  ].some((keyword) => message.includes(keyword));
}

function timestampLabel() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function writeJsonAtomic(filePath, data) {
  await ensureDir(path.dirname(filePath));
  const tempPath = `${filePath}.tmp`;
  await fs.writeFile(tempPath, JSON.stringify(data, null, 2), "utf8");
  await fs.rm(filePath, { force: true });
  await fs.rename(tempPath, filePath);
}

async function readJsonFile(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return fallback;
    }

    throw error;
  }
}

function chunkArray(items, size) {
  const result = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

function hasMeaningfulValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some((item) => hasMeaningfulValue(item));
  if (typeof value === "object") return Object.values(value).some((item) => hasMeaningfulValue(item));
  return true;
}

function toText(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  if (Array.isArray(value)) {
    return value.map((item) => toText(item)).join("");
  }

  if (typeof value === "object") {
    if (typeof value.text === "string") return value.text;
    if (typeof value.link === "string") return value.link;
    if (typeof value.url === "string") return value.url;
    if (typeof value.name === "string") return value.name;
  }

  return String(value);
}

function toNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function toBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return null;
}

function ensureProtocol(value) {
  if (/^https?:\/\//i.test(value)) return value;
  if (/^(?:www\.)?(?:xiaohongshu\.com|xhslink\.com)\//i.test(value)) {
    return `https://${value}`;
  }
  return value;
}

function stripOuterPunctuation(value) {
  return value
    .trim()
    .replace(LEADING_URL_PUNCTUATION_PATTERN, "")
    .replace(TRAILING_URL_PUNCTUATION_PATTERN, "");
}

function sanitizeCandidateLink(value) {
  return ensureProtocol(stripOuterPunctuation(value));
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function unwrapRedirectPath(url) {
  const redirectPath = url.searchParams.get("redirectPath");
  return redirectPath ? safeDecodeURIComponent(redirectPath) : "";
}

function toUrl(value) {
  const sanitized = sanitizeCandidateLink(value);
  if (!sanitized) return null;

  try {
    return new URL(sanitized);
  } catch {
    return null;
  }
}

function isXhsShortLink(link) {
  const url = toUrl(link);
  if (!url) return false;
  const hostname = url.hostname.toLowerCase();
  return hostname === "xhslink.com" || hostname.endsWith(".xhslink.com");
}

function isXiaohongshuHost(hostname) {
  return hostname === "xiaohongshu.com" || hostname.endsWith(".xiaohongshu.com");
}

function extractXhsLinksFromText(text) {
  const matches = Array.from(String(text || "").matchAll(XHS_URL_PATTERN), (match) =>
    sanitizeCandidateLink(match[1] || "")
  ).filter(Boolean);

  const seen = new Set();
  const result = [];
  for (const link of matches) {
    const key = link.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(link);
  }
  return result;
}

function pickFirstXhsLink(text) {
  return extractXhsLinksFromText(text)[0] || "";
}

function extractNoteIdFromLink(link) {
  const candidate = pickFirstXhsLink(link) || sanitizeCandidateLink(link);
  if (!candidate) return "";

  const url = toUrl(candidate);
  if (url) {
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts[0] === "explore" && parts[1]) return parts[1];
    if (parts[0] === "discovery" && parts[1] === "item" && parts[2]) return parts[2];

    const redirected = unwrapRedirectPath(url);
    if (redirected) {
      const redirectedNoteId = extractNoteIdFromLink(redirected);
      if (redirectedNoteId) return redirectedNoteId;
    }

    return url.searchParams.get("noteId") || url.searchParams.get("note_id") || "";
  }

  const match =
    candidate.match(/\/explore\/([^/?#]+)/i) ||
    candidate.match(/\/discovery\/item\/([^/?#]+)/i);

  return match?.[1] || "";
}

function normalizeXhsLink(link) {
  const candidate = pickFirstXhsLink(link) || sanitizeCandidateLink(link);
  if (!candidate) return "";

  const url = toUrl(candidate);
  if (!url) return candidate;

  const redirected = unwrapRedirectPath(url);
  if (redirected) return normalizeXhsLink(redirected);

  url.hash = "";
  const hostname = url.hostname.toLowerCase();
  if (isXiaohongshuHost(hostname) || isXhsShortLink(url.toString())) {
    return url.toString();
  }

  const noteId = extractNoteIdFromLink(url.toString());
  return noteId ? `https://www.xiaohongshu.com/explore/${noteId}` : url.toString();
}

function buildDedupeKey(fieldName, value) {
  if (!hasMeaningfulValue(value)) return "";

  const normalizedFieldName = String(fieldName || "").trim();
  if (normalizedFieldName === "笔记链接" || normalizedFieldName.toLowerCase().includes("link")) {
    return normalizeXhsLink(toText(value)).trim().toLowerCase();
  }

  return toText(value).trim().toLowerCase();
}

function sanitizeFileName(fileName, index, mimeType) {
  const safeBase = String(fileName || "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_")
    .trim();

  const ext = MIME_EXTENSION_MAP.get(String(mimeType || "").toLowerCase()) || "";
  let finalName = safeBase || `attachment-${index + 1}`;

  const hasExtension = /\.[A-Za-z0-9]{1,8}$/.test(finalName);
  if (!hasExtension && ext) {
    finalName = `${finalName}.${ext}`;
  }

  return finalName.slice(0, 180);
}

function isCopyableFieldType(type) {
  return DIRECT_COPY_FIELD_TYPES.has(type);
}

function isUnsafeFieldType(type) {
  return NON_COPY_FIELD_TYPES.has(type);
}

function formatFieldType(type) {
  const map = new Map([
    [1, "文本"],
    [2, "数字"],
    [3, "单选"],
    [4, "多选"],
    [5, "日期"],
    [7, "复选框"],
    [11, "人员"],
    [13, "电话"],
    [15, "超链接"],
    [17, "附件"],
    [18, "单向关联"],
    [20, "公式"],
    [21, "双向关联"],
    [22, "地理位置"],
    [23, "群组"],
    [1001, "创建时间"],
    [1002, "更新时间"],
    [1003, "创建人"],
    [1004, "修改人"],
    [1005, "自动编号"],
  ]);

  return map.get(type) || `type=${type}`;
}

class FeishuClient {
  constructor(config) {
    this.name = config.name;
    this.baseUrl = config.baseUrl.replace(/\/+$/, "");
    this.appId = config.appId;
    this.appSecret = config.appSecret;
    this.appToken = config.appToken;
    this.retryAttempts = config.retryAttempts;
    this.retryDelayMs = config.retryDelayMs;
    this.cachedToken = null;
    this.tokenExpireAt = 0;
  }

  invalidateToken() {
    this.cachedToken = null;
    this.tokenExpireAt = 0;
  }

  async getTenantAccessToken(forceRefresh = false) {
    if (!forceRefresh && this.cachedToken && Date.now() < this.tokenExpireAt) {
      return this.cachedToken;
    }

    const response = await fetch(`${this.baseUrl}/open-apis/auth/v3/tenant_access_token/internal`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({
        app_id: this.appId,
        app_secret: this.appSecret,
      }),
    });

    const payload = await response.json();
    if (payload.code !== 0 || !payload.tenant_access_token) {
      throw new Error(`[${this.name}] 获取 tenant_access_token 失败: ${payload.msg || "unknown error"}`);
    }

    this.cachedToken = payload.tenant_access_token;
    this.tokenExpireAt = Date.now() + Math.max((payload.expire || 7200) - 60, 60) * 1000;
    return this.cachedToken;
  }

  async request(method, pathName, options = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query || {})) {
      if (value === undefined || value === null || value === "") continue;
      query.set(key, String(value));
    }

    const normalizedPath = String(pathName || "");
    const urlBase = /^https?:\/\//i.test(normalizedPath)
      ? normalizedPath
      : normalizedPath.startsWith("/open-apis/")
        ? `${this.baseUrl}${normalizedPath}`
        : `${this.baseUrl}/open-apis${normalizedPath}`;
    const url = `${urlBase}${query.toString() ? `${urlBase.includes("?") ? "&" : "?"}${query}` : ""}`;

    for (let attempt = 1; attempt <= this.retryAttempts; attempt += 1) {
      try {
        const token = await this.getTenantAccessToken(attempt > 1 && options.refreshTokenOnRetry);
        const headers = new Headers(options.headers || {});
        headers.set("Authorization", `Bearer ${token}`);

        let body;
        if (options.form) {
          body = options.form;
        } else if (options.body !== undefined) {
          headers.set("Content-Type", "application/json; charset=utf-8");
          body = JSON.stringify(options.body);
        }

        const response = await fetch(url, {
          method,
          headers,
          body,
        });

        if (options.responseType === "arrayBuffer") {
          if (response.status === 401 && attempt < this.retryAttempts) {
            this.invalidateToken();
            await sleep(buildRetryDelay(this.retryDelayMs, attempt));
            continue;
          }

          if (response.ok) {
            return await response.arrayBuffer();
          }

          const text = await response.text();
          const code = 0;
          if (attempt < this.retryAttempts && shouldRetry(response.status, code)) {
            await sleep(buildRetryDelay(this.retryDelayMs, attempt));
            continue;
          }

          throw new Error(`[${this.name}] 下载失败: http=${response.status} ${text}`.trim());
        }

        const text = await response.text();
        let payload = {};
        if (text) {
          try {
            payload = JSON.parse(text);
          } catch {
            if (response.ok) return text;
            throw new Error(`[${this.name}] 接口返回非 JSON: http=${response.status} body=${text.slice(0, 300)}`);
          }
        }

        if (response.status === 401 && attempt < this.retryAttempts) {
          this.invalidateToken();
          await sleep(buildRetryDelay(this.retryDelayMs, attempt));
          continue;
        }

        if (response.ok && payload.code === 0) {
          return payload.data ?? {};
        }

        const code = typeof payload.code === "number" ? payload.code : 0;
        const msg = payload.msg || payload.message || text || "unknown error";
        if (attempt < this.retryAttempts && shouldRetry(response.status, code)) {
          await sleep(buildRetryDelay(this.retryDelayMs, attempt));
          continue;
        }

        throw new Error(
          `[${this.name}] ${method} ${pathName} 失败: http=${response.status} code=${code} msg=${msg}`
        );
      } catch (error) {
        if (attempt < this.retryAttempts && isRetryableTransportError(error)) {
          await sleep(buildRetryDelay(this.retryDelayMs, attempt));
          continue;
        }

        throw error;
      }
    }

    throw new Error(`[${this.name}] ${method} ${pathName} 重试耗尽`);
  }

  async listFields(tableId) {
    const items = [];
    let pageToken = "";

    while (true) {
      const data = await this.request("GET", `/bitable/v1/apps/${this.appToken}/tables/${tableId}/fields`, {
        query: {
          page_size: String(DEFAULT_PAGE_SIZE),
          page_token: pageToken,
        },
      });

      items.push(...(data.items || []));
      if (!data.has_more || !data.page_token) break;
      pageToken = data.page_token;
    }

    return items;
  }

  async listRecords(tableId, options = {}) {
    const items = [];
    let pageToken = "";

    while (true) {
      const data = await this.request("GET", `/bitable/v1/apps/${this.appToken}/tables/${tableId}/records`, {
        query: {
          page_size: String(DEFAULT_PAGE_SIZE),
          page_token: pageToken,
          user_id_type: options.userIdType || "user_id",
        },
      });

      items.push(...(data.items || []));
      if (options.limit > 0 && items.length >= options.limit) {
        return items.slice(0, options.limit);
      }

      if (!data.has_more || !data.page_token) break;
      pageToken = data.page_token;
    }

    return items;
  }

  async batchCreateRecords(tableId, records) {
    return this.request("POST", `/bitable/v1/apps/${this.appToken}/tables/${tableId}/records/batch_create`, {
      query: {
        client_token: randomUUID(),
        ignore_consistency_check: "true",
        user_id_type: "user_id",
      },
      body: { records },
    });
  }

  async downloadAttachment(url) {
    if (!url) throw new Error(`[${this.name}] 缺少附件下载链接`);
    return this.request("GET", url, {
      responseType: "arrayBuffer",
      refreshTokenOnRetry: true,
    });
  }

  async uploadAttachment(params) {
    const form = new FormData();
    const mimeType = params.mimeType || "application/octet-stream";
    const parentType = mimeType.toLowerCase().startsWith("image/") ? "bitable_image" : "bitable_file";

    form.append("file_name", params.fileName);
    form.append("parent_type", parentType);
    form.append("parent_node", this.appToken);
    form.append("extra", JSON.stringify({ drive_route_token: this.appToken }));
    form.append("size", String(params.buffer.byteLength));
    form.append("file", new Blob([params.buffer], { type: mimeType }), params.fileName);

    const data = await this.request("POST", "/drive/v1/medias/upload_all", {
      form,
      refreshTokenOnRetry: true,
    });

    if (!data.file_token) {
      throw new Error(`[${this.name}] 上传附件失败: 未返回 file_token`);
    }

    return data;
  }
}

function buildTableConfigs() {
  ensureRequiredEnv([
    "FEISHU_MIGRATION_SOURCE_APP_ID",
    "FEISHU_MIGRATION_SOURCE_APP_SECRET",
    "FEISHU_MIGRATION_SOURCE_APP_TOKEN",
    "FEISHU_MIGRATION_SOURCE_COLLECT_TABLE_ID",
    "FEISHU_MIGRATION_SOURCE_REWRITE_TABLE_ID",
    "FEISHU_MIGRATION_TARGET_APP_ID",
    "FEISHU_MIGRATION_TARGET_APP_SECRET",
    "FEISHU_MIGRATION_TARGET_APP_TOKEN",
    "FEISHU_MIGRATION_TARGET_COLLECT_TABLE_ID",
    "FEISHU_MIGRATION_TARGET_REWRITE_TABLE_ID",
  ]);

  const retryAttempts = readPositiveIntEnv("FEISHU_MIGRATION_RETRY_ATTEMPTS", DEFAULT_RETRY_ATTEMPTS);
  const retryDelayMs = readPositiveIntEnv("FEISHU_MIGRATION_RETRY_DELAY_MS", DEFAULT_RETRY_DELAY_MS);

  const sourceClient = new FeishuClient({
    name: "source",
    baseUrl: readEnv("FEISHU_MIGRATION_SOURCE_OPEN_BASE_URL", DEFAULT_OPEN_BASE_URL),
    appId: readEnv("FEISHU_MIGRATION_SOURCE_APP_ID"),
    appSecret: readEnv("FEISHU_MIGRATION_SOURCE_APP_SECRET"),
    appToken: readEnv("FEISHU_MIGRATION_SOURCE_APP_TOKEN"),
    retryAttempts,
    retryDelayMs,
  });

  const targetClient = new FeishuClient({
    name: "target",
    baseUrl: readEnv("FEISHU_MIGRATION_TARGET_OPEN_BASE_URL", DEFAULT_OPEN_BASE_URL),
    appId: readEnv("FEISHU_MIGRATION_TARGET_APP_ID"),
    appSecret: readEnv("FEISHU_MIGRATION_TARGET_APP_SECRET"),
    appToken: readEnv("FEISHU_MIGRATION_TARGET_APP_TOKEN"),
    retryAttempts,
    retryDelayMs,
  });

  const collectFieldMap = parseJsonEnv("FEISHU_MIGRATION_COLLECT_FIELD_MAP_JSON");
  const rewriteFieldMap = parseJsonEnv("FEISHU_MIGRATION_REWRITE_FIELD_MAP_JSON");

  const tables = [
    {
      key: "collect",
      label: "爆款库",
      sourceTableId: readEnv("FEISHU_MIGRATION_SOURCE_COLLECT_TABLE_ID"),
      targetTableId: readEnv("FEISHU_MIGRATION_TARGET_COLLECT_TABLE_ID"),
      fieldMap: collectFieldMap,
      dedupeFieldName: readEnv("FEISHU_MIGRATION_COLLECT_DEDUPE_FIELD", "笔记链接"),
      preferredDedupeFields: ["笔记链接", "源记录ID"],
    },
    {
      key: "rewrite",
      label: "二创库",
      sourceTableId: readEnv("FEISHU_MIGRATION_SOURCE_REWRITE_TABLE_ID"),
      targetTableId: readEnv("FEISHU_MIGRATION_TARGET_REWRITE_TABLE_ID"),
      fieldMap: rewriteFieldMap,
      dedupeFieldName: readEnv("FEISHU_MIGRATION_REWRITE_DEDUPE_FIELD", "源记录ID"),
      preferredDedupeFields: ["源记录ID", "笔记链接"],
    },
  ];

  return { sourceClient, targetClient, tables };
}

function buildFieldMaps(fieldList) {
  const byName = new Map();
  for (const field of fieldList) {
    byName.set(field.field_name, field);
  }
  return byName;
}

function chooseDedupeField(tableConfig, sourceFieldsByName, targetFieldsByName) {
  const candidates = [];
  if (tableConfig.dedupeFieldName) candidates.push(tableConfig.dedupeFieldName);
  candidates.push(...tableConfig.preferredDedupeFields);

  for (const sourceFieldName of candidates) {
    const normalizedSourceFieldName = String(sourceFieldName || "").trim();
    if (!normalizedSourceFieldName) continue;

    const targetFieldName = tableConfig.fieldMap[normalizedSourceFieldName] || normalizedSourceFieldName;
    const sourceField = sourceFieldsByName.get(normalizedSourceFieldName);
    const targetField = targetFieldsByName.get(targetFieldName);
    if (!sourceField || !targetField) continue;
    if (!isCopyableFieldType(sourceField.type)) continue;
    if (sourceField.type !== targetField.type) continue;

    return {
      sourceFieldName: normalizedSourceFieldName,
      targetFieldName,
      type: sourceField.type,
    };
  }

  return null;
}

function analyzeDedupeKeys(records, dedupeFieldName) {
  const keyToRecordIds = new Map();
  const blankRecordIds = [];

  for (const record of records) {
    const rawValue = record.fields?.[dedupeFieldName];
    const dedupeKey = buildDedupeKey(dedupeFieldName, rawValue);
    if (!dedupeKey) {
      blankRecordIds.push(record.record_id);
      continue;
    }

    if (!keyToRecordIds.has(dedupeKey)) {
      keyToRecordIds.set(dedupeKey, []);
    }

    keyToRecordIds.get(dedupeKey).push(record.record_id);
  }

  const duplicates = Array.from(keyToRecordIds.entries())
    .filter(([, recordIds]) => recordIds.length > 1)
    .map(([key, recordIds]) => ({ key, recordIds }));

  return {
    blankRecordIds,
    duplicates,
    keySet: new Set(keyToRecordIds.keys()),
  };
}

async function buildTablePlan(tableConfig, sourceClient, targetClient, options) {
  const [sourceFields, targetFields, sourceRecords, targetRecords] = await Promise.all([
    sourceClient.listFields(tableConfig.sourceTableId),
    targetClient.listFields(tableConfig.targetTableId),
    sourceClient.listRecords(tableConfig.sourceTableId, {
      limit: options.limit,
      userIdType: "user_id",
    }),
    targetClient.listRecords(tableConfig.targetTableId, {
      userIdType: "user_id",
    }),
  ]);

  const sourceFieldsByName = buildFieldMaps(sourceFields);
  const targetFieldsByName = buildFieldMaps(targetFields);
  const fieldMappings = [];
  const missingSourceFieldsFromExplicitMap = [];
  const missingTargetFieldsFromExplicitMap = [];
  const unmappedSourceFields = [];
  const incompatibleFields = [];
  const unsupportedFields = [];
  const unsupportedSourceFields = [];
  const duplicateTargetMappings = [];
  const mappedTargetNames = new Set();

  for (const [sourceFieldName, targetFieldName] of Object.entries(tableConfig.fieldMap)) {
    if (!sourceFieldsByName.has(sourceFieldName)) {
      missingSourceFieldsFromExplicitMap.push(sourceFieldName);
    }

    if (!targetFieldsByName.has(targetFieldName)) {
      missingTargetFieldsFromExplicitMap.push(`${sourceFieldName} -> ${targetFieldName}`);
    }
  }

  for (const sourceField of sourceFields) {
    if (isUnsafeFieldType(sourceField.type) || !isCopyableFieldType(sourceField.type)) {
      unsupportedSourceFields.push(sourceField);
      continue;
    }

    const targetFieldName = tableConfig.fieldMap[sourceField.field_name] || sourceField.field_name;
    const targetField = targetFieldsByName.get(targetFieldName);

    if (!targetField) {
      unmappedSourceFields.push(sourceField);
      continue;
    }

    if (!isCopyableFieldType(targetField.type)) {
      unsupportedFields.push({
        fieldName: sourceField.field_name,
        sourceType: sourceField.type,
        targetType: targetField.type,
      });
      continue;
    }

    if (mappedTargetNames.has(targetField.field_name)) {
      duplicateTargetMappings.push(`${sourceField.field_name} -> ${targetField.field_name}`);
      continue;
    }

    if (sourceField.type !== targetField.type) {
      incompatibleFields.push({
        sourceFieldName: sourceField.field_name,
        targetFieldName: targetField.field_name,
        sourceType: sourceField.type,
        targetType: targetField.type,
      });
      continue;
    }

    mappedTargetNames.add(targetField.field_name);
    fieldMappings.push({
      sourceField,
      targetField,
    });
  }

  const usedUnmappedSourceFields = unmappedSourceFields.filter((field) =>
    sourceRecords.some((record) => hasMeaningfulValue(record.fields?.[field.field_name]))
  );
  const usedUnsupportedSourceFields = unsupportedSourceFields.filter((field) =>
    sourceRecords.some((record) => hasMeaningfulValue(record.fields?.[field.field_name]))
  );

  const dedupeField = chooseDedupeField(tableConfig, sourceFieldsByName, targetFieldsByName);
  const sourceDedupe = dedupeField
    ? analyzeDedupeKeys(sourceRecords, dedupeField.sourceFieldName)
    : { blankRecordIds: [], duplicates: [], keySet: new Set() };
  const targetDedupe = dedupeField
    ? analyzeDedupeKeys(targetRecords, dedupeField.targetFieldName)
    : { blankRecordIds: [], duplicates: [], keySet: new Set() };

  return {
    tableConfig,
    sourceFields,
    targetFields,
    sourceRecords,
    targetRecords,
    fieldMappings,
    unmappedSourceFields,
    usedUnmappedSourceFields,
    incompatibleFields,
    unsupportedFields,
    unsupportedSourceFields,
    usedUnsupportedSourceFields,
    duplicateTargetMappings,
    missingSourceFieldsFromExplicitMap,
    missingTargetFieldsFromExplicitMap,
    dedupeField,
    sourceDedupe,
    targetDedupe,
  };
}

function validatePlan(plan, options) {
  const issues = [];
  const isExecute = options.mode === "execute";

  if (plan.missingSourceFieldsFromExplicitMap.length > 0) {
    issues.push(`字段映射配置引用了源表中不存在的字段: ${plan.missingSourceFieldsFromExplicitMap.join(", ")}`);
  }

  if (plan.missingTargetFieldsFromExplicitMap.length > 0) {
    issues.push(`字段映射配置引用了目标表中不存在的字段: ${plan.missingTargetFieldsFromExplicitMap.join(", ")}`);
  }

  if (plan.duplicateTargetMappings.length > 0) {
    issues.push(`多个源字段映射到了同一个目标字段: ${plan.duplicateTargetMappings.join(", ")}`);
  }

  if (plan.incompatibleFields.length > 0) {
    issues.push(
      `字段类型不一致: ${plan.incompatibleFields
        .map(
          (item) =>
            `${item.sourceFieldName}(${formatFieldType(item.sourceType)}) -> ${item.targetFieldName}(${formatFieldType(item.targetType)})`
        )
        .join("; ")}`
    );
  }

  if (plan.usedUnmappedSourceFields.length > 0 && !options.allowSkipFields) {
    issues.push(
      `源表存在有值但未映射到目标表的字段: ${plan.usedUnmappedSourceFields
        .map((field) => `${field.field_name}(${formatFieldType(field.type)})`)
        .join(", ")}`
    );
  }

  if (plan.usedUnsupportedSourceFields.length > 0 && !options.allowSkipFields) {
    issues.push(
      `源表存在有值但当前脚本不支持直接复制的字段: ${plan.usedUnsupportedSourceFields
        .map((field) => `${field.field_name}(${formatFieldType(field.type)})`)
        .join(", ")}`
    );
  }

  if (plan.unsupportedFields.length > 0) {
    issues.push(
      `目标表中存在已命中但不可直接写入的字段: ${plan.unsupportedFields
        .map(
          (item) =>
            `${item.fieldName}(源:${formatFieldType(item.sourceType)} -> 目标:${formatFieldType(item.targetType)})`
        )
        .join(", ")}`
    );
  }

  if (plan.targetRecords.length > 0 && !plan.dedupeField) {
    issues.push("目标表非空，但未找到可用的去重字段，无法安全执行追加迁移");
  }

  if (plan.dedupeField && plan.sourceDedupe.duplicates.length > 0) {
    issues.push(
      `源表去重字段存在重复值: ${plan.sourceDedupe.duplicates
        .slice(0, 10)
        .map((item) => `${item.key} => ${item.recordIds.join("/")}`)
        .join("; ")}`
    );
  }

  if (plan.targetRecords.length > 0 && plan.dedupeField && plan.sourceDedupe.blankRecordIds.length > 0) {
    issues.push(`目标表非空，且源表有 ${plan.sourceDedupe.blankRecordIds.length} 条记录的去重字段为空，无法安全判断是否重复`);
  }

  if (!isExecute) return issues;
  return issues;
}

function formatPlanSummary(plan, options) {
  const lines = [];
  lines.push(`\n[${plan.tableConfig.label}]`);
  lines.push(`- 模式: ${options.mode}`);
  lines.push(`- 源记录数: ${plan.sourceRecords.length}`);
  lines.push(`- 目标现有记录数: ${plan.targetRecords.length}`);
  lines.push(`- 可迁移字段数: ${plan.fieldMappings.length}`);
  lines.push(`- 去重字段: ${plan.dedupeField ? `${plan.dedupeField.sourceFieldName} -> ${plan.dedupeField.targetFieldName}` : "未找到"}`);

  if (plan.unmappedSourceFields.length > 0) {
    lines.push(
      `- 未映射字段: ${plan.unmappedSourceFields
        .map((field) => `${field.field_name}(${formatFieldType(field.type)})`)
        .join(", ")}`
    );
  }

  if (plan.usedUnmappedSourceFields.length > 0) {
    lines.push(
      `- 有值但未映射字段: ${plan.usedUnmappedSourceFields
        .map((field) => `${field.field_name}(${formatFieldType(field.type)})`)
        .join(", ")}`
    );
  }

  if (plan.usedUnsupportedSourceFields.length > 0) {
    lines.push(
      `- 有值但不支持直接复制的字段: ${plan.usedUnsupportedSourceFields
        .map((field) => `${field.field_name}(${formatFieldType(field.type)})`)
        .join(", ")}`
    );
  }

  if (plan.targetDedupe.duplicates.length > 0) {
    lines.push(`- 目标表去重字段存在重复值: ${plan.targetDedupe.duplicates.length} 组`);
  }

  if (plan.sourceDedupe.blankRecordIds.length > 0) {
    lines.push(`- 源表去重字段为空的记录数: ${plan.sourceDedupe.blankRecordIds.length}`);
  }

  return lines.join("\n");
}

function buildCheckpointPath(tableConfig, sourceClient, targetClient) {
  const fileName = `${tableConfig.key}-${sourceClient.appToken}-${tableConfig.sourceTableId}-to-${targetClient.appToken}-${tableConfig.targetTableId}.json`
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .slice(0, 220);

  return path.join(CHECKPOINT_ROOT, "checkpoints", fileName);
}

async function loadCheckpoint(filePath, plan) {
  const fallback = {
    version: CHECKPOINT_VERSION,
    table: {
      key: plan.tableConfig.key,
      label: plan.tableConfig.label,
      sourceTableId: plan.tableConfig.sourceTableId,
      targetTableId: plan.tableConfig.targetTableId,
    },
    createdBySourceRecordId: {},
  };

  return readJsonFile(filePath, fallback);
}

async function transformFieldValue(context, sourceField, targetField, rawValue) {
  if (rawValue === null || rawValue === undefined) {
    return { include: false };
  }

  switch (targetField.type) {
    case TEXT_FIELD_TYPE:
      return { include: true, value: toText(rawValue) };
    case NUMBER_FIELD_TYPE: {
      const numeric = toNumber(rawValue);
      if (numeric === null) {
        throw new Error(`字段 ${sourceField.field_name} 不是合法数字: ${JSON.stringify(rawValue)}`);
      }
      return { include: true, value: numeric };
    }
    case SINGLE_SELECT_FIELD_TYPE: {
      const text = toText(rawValue).trim();
      return text ? { include: true, value: text } : { include: false };
    }
    case MULTI_SELECT_FIELD_TYPE: {
      const values = Array.isArray(rawValue)
        ? rawValue.map((item) => toText(item).trim()).filter(Boolean)
        : [toText(rawValue).trim()].filter(Boolean);
      return values.length > 0 ? { include: true, value: values } : { include: false };
    }
    case DATE_FIELD_TYPE: {
      const numeric = toNumber(rawValue);
      if (numeric !== null && numeric > 0) {
        return {
          include: true,
          value: numeric < 1_000_000_000_000 ? numeric * 1000 : numeric,
        };
      }

      const parsed = Date.parse(toText(rawValue));
      if (Number.isFinite(parsed) && parsed > 0) {
        return { include: true, value: parsed };
      }

      throw new Error(`字段 ${sourceField.field_name} 不是合法日期: ${JSON.stringify(rawValue)}`);
    }
    case CHECKBOX_FIELD_TYPE: {
      const booleanValue = toBoolean(rawValue);
      if (booleanValue !== null) return { include: true, value: booleanValue };
      if (typeof rawValue === "number") return { include: true, value: rawValue !== 0 };
      throw new Error(`字段 ${sourceField.field_name} 不是合法布尔值: ${JSON.stringify(rawValue)}`);
    }
    case PHONE_FIELD_TYPE:
      return { include: true, value: toText(rawValue) };
    case URL_FIELD_TYPE: {
      if (typeof rawValue === "object" && rawValue !== null && !Array.isArray(rawValue)) {
        const link = String(rawValue.link || rawValue.url || rawValue.text || "").trim();
        const text = String(rawValue.text || rawValue.link || rawValue.url || "").trim();
        if (!link && !text) return { include: false };
        return { include: true, value: { text: text || link, link: link || text } };
      }

      const link = toText(rawValue).trim();
      if (!link) return { include: false };
      return { include: true, value: { text: link, link } };
    }
    case USER_FIELD_TYPE: {
      if (!Array.isArray(rawValue)) return { include: false };
      const users = rawValue
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const id = String(item.id || "").trim();
          return id ? { id } : null;
        })
        .filter(Boolean);
      return users.length > 0 ? { include: true, value: users } : { include: false };
    }
    case GROUP_FIELD_TYPE: {
      if (!Array.isArray(rawValue)) return { include: false };
      const groups = rawValue
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const id = String(item.id || "").trim();
          return id ? { id } : null;
        })
        .filter(Boolean);
      return groups.length > 0 ? { include: true, value: groups } : { include: false };
    }
    case LOCATION_FIELD_TYPE: {
      if (typeof rawValue === "string" && rawValue.trim()) {
        return { include: true, value: rawValue.trim() };
      }

      if (rawValue && typeof rawValue === "object") {
        const longitude = rawValue.longitude ?? rawValue.lng ?? rawValue.lon;
        const latitude = rawValue.latitude ?? rawValue.lat;
        if (longitude !== undefined && latitude !== undefined) {
          return { include: true, value: `${longitude},${latitude}` };
        }
      }

      return { include: false };
    }
    case ATTACHMENT_FIELD_TYPE: {
      if (!Array.isArray(rawValue) || rawValue.length === 0) {
        return { include: false };
      }

      const attachments = [];
      for (let index = 0; index < rawValue.length; index += 1) {
        const attachment = rawValue[index];
        if (!attachment || typeof attachment !== "object") continue;

        const downloadUrl = String(attachment.url || attachment.tmp_url || "").trim();
        const mimeType = String(attachment.type || "").trim() || "application/octet-stream";
        const fileName = sanitizeFileName(attachment.name, index, mimeType);

        if (!downloadUrl) {
          throw new Error(`字段 ${sourceField.field_name} 的附件缺少下载地址`);
        }

        const buffer = await context.sourceClient.downloadAttachment(downloadUrl);
        const uploaded = await context.targetClient.uploadAttachment({
          buffer,
          fileName,
          mimeType,
        });

        attachments.push({ file_token: uploaded.file_token });
        context.stats.attachmentCount += 1;
      }

      return attachments.length > 0 ? { include: true, value: attachments } : { include: false };
    }
    default:
      throw new Error(`暂不支持字段类型: ${sourceField.field_name}(${formatFieldType(targetField.type)})`);
  }
}

async function buildTargetRecord(context, sourceRecord, plan) {
  const fields = {};

  for (const mapping of plan.fieldMappings) {
    const rawValue = sourceRecord.fields?.[mapping.sourceField.field_name];
    const transformed = await transformFieldValue(context, mapping.sourceField, mapping.targetField, rawValue);
    if (!transformed.include) continue;
    fields[mapping.targetField.field_name] = transformed.value;
  }

  return fields;
}

async function executeTableMigration(plan, sourceClient, targetClient, options) {
  const checkpointPath = buildCheckpointPath(plan.tableConfig, sourceClient, targetClient);
  const checkpoint = await loadCheckpoint(checkpointPath, plan);
  const createdBySourceRecordId = checkpoint.createdBySourceRecordId || {};
  const createdSourceRecordIds = new Set(Object.keys(createdBySourceRecordId));
  const existingTargetKeys = new Set(plan.targetDedupe.keySet);
  const batches = [];
  const pendingItems = [];
  const stats = {
    migratedCount: 0,
    skippedByCheckpointCount: 0,
    skippedExistingCount: 0,
    skippedEmptyCount: 0,
    attachmentCount: 0,
  };

  for (const sourceRecord of plan.sourceRecords) {
    if (createdSourceRecordIds.has(sourceRecord.record_id)) {
      stats.skippedByCheckpointCount += 1;
      continue;
    }

    const dedupeKey = plan.dedupeField
      ? buildDedupeKey(plan.dedupeField.sourceFieldName, sourceRecord.fields?.[plan.dedupeField.sourceFieldName])
      : "";

    if (plan.dedupeField && dedupeKey && existingTargetKeys.has(dedupeKey)) {
      stats.skippedExistingCount += 1;
      continue;
    }

    const fields = await buildTargetRecord(
      {
        sourceClient,
        targetClient,
        stats,
      },
      sourceRecord,
      plan
    );

    if (Object.keys(fields).length === 0) {
      stats.skippedEmptyCount += 1;
      continue;
    }

    pendingItems.push({
      sourceRecordId: sourceRecord.record_id,
      dedupeKey,
      record: { fields },
    });
  }

  for (const batch of chunkArray(pendingItems, options.batchSize)) {
    batches.push(batch);
  }

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index];
    if (batch.length === 0) continue;

    const data = await targetClient.batchCreateRecords(
      plan.tableConfig.targetTableId,
      batch.map((item) => item.record)
    );

    const createdRecords = data.records || [];
    if (createdRecords.length !== batch.length) {
      throw new Error(
        `[${plan.tableConfig.label}] 批量写入返回数量异常: 期望 ${batch.length}，实际 ${createdRecords.length}`
      );
    }

    for (let itemIndex = 0; itemIndex < batch.length; itemIndex += 1) {
      const item = batch[itemIndex];
      const createdRecord = createdRecords[itemIndex];
      createdBySourceRecordId[item.sourceRecordId] = {
        targetRecordId: createdRecord.record_id || createdRecord.id || "",
        dedupeKey: item.dedupeKey,
        createdAt: new Date().toISOString(),
      };

      if (item.dedupeKey) {
        existingTargetKeys.add(item.dedupeKey);
      }
    }

    checkpoint.createdBySourceRecordId = createdBySourceRecordId;
    checkpoint.updatedAt = new Date().toISOString();
    await writeJsonAtomic(checkpointPath, checkpoint);

    stats.migratedCount += batch.length;
    console.log(
      `[${plan.tableConfig.label}] 已完成批次 ${index + 1}/${batches.length}，本批 ${batch.length} 条，累计迁移 ${stats.migratedCount} 条`
    );

    if (index < batches.length - 1) {
      await sleep(readPositiveIntEnv("FEISHU_MIGRATION_DELAY_MS", DEFAULT_DELAY_MS));
    }
  }

  return {
    checkpointPath,
    stats,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    console.log(HELP_TEXT.trim());
    return;
  }

  const runStartedAt = new Date().toISOString();
  const runId = timestampLabel();
  await ensureDir(CHECKPOINT_ROOT);

  const { sourceClient, targetClient, tables } = buildTableConfigs();
  const selectedTables = options.table === "all" ? tables : tables.filter((table) => table.key === options.table);
  const report = {
    runId,
    mode: options.mode,
    startedAt: runStartedAt,
    options: {
      table: options.table,
      limit: options.limit,
      batchSize: options.batchSize,
      allowSkipFields: options.allowSkipFields,
    },
    tables: {},
    issues: [],
  };

  for (const tableConfig of selectedTables) {
    const plan = await buildTablePlan(tableConfig, sourceClient, targetClient, options);
    const issues = validatePlan(plan, options);
    console.log(formatPlanSummary(plan, options));

    if (issues.length > 0) {
      console.log("- 风险/阻断项:");
      for (const issue of issues) {
        console.log(`  * ${issue}`);
      }
    }

    report.tables[tableConfig.key] = {
      label: tableConfig.label,
      sourceRecordCount: plan.sourceRecords.length,
      targetRecordCount: plan.targetRecords.length,
      mappedFieldCount: plan.fieldMappings.length,
      unmappedFieldNames: plan.unmappedSourceFields.map((field) => field.field_name),
      usedUnmappedFieldNames: plan.usedUnmappedSourceFields.map((field) => field.field_name),
      usedUnsupportedFieldNames: plan.usedUnsupportedSourceFields.map((field) => field.field_name),
      unsupportedFieldPairs: plan.unsupportedFields,
      dedupeField: plan.dedupeField,
      sourceDuplicateDedupeCount: plan.sourceDedupe.duplicates.length,
      targetDuplicateDedupeCount: plan.targetDedupe.duplicates.length,
      sourceBlankDedupeCount: plan.sourceDedupe.blankRecordIds.length,
      issues,
    };

    report.issues.push(...issues.map((issue) => `[${tableConfig.label}] ${issue}`));

    if (issues.length > 0) {
      continue;
    }

    if (options.mode === "execute") {
      const result = await executeTableMigration(plan, sourceClient, targetClient, options);
      report.tables[tableConfig.key].execution = result;
    }
  }

  report.completedAt = new Date().toISOString();
  const reportPath = path.join(CHECKPOINT_ROOT, `report-${runId}.json`);
  await writeJsonAtomic(reportPath, report);

  console.log(`\n迁移报告已写入: ${reportPath}`);

  if (report.issues.length > 0) {
    throw new Error("存在阻断项，已停止执行。请先根据报告修正后再重试。");
  }

  if (options.mode === "dry-run") {
    console.log("\ndry-run 完成。确认无误后再执行: npm run feishu:migrate:execute");
    return;
  }

  console.log("\n执行完成。建议保留 .runtime/feishu-migration 下的报告与 checkpoint 文件，便于追溯。");
}

main().catch(async (error) => {
  console.error(`\n迁移失败: ${getErrorMessage(error)}`);
  process.exitCode = 1;
});
