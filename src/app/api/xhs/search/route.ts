import { NextRequest, NextResponse } from "next/server";
import type { SearchFilters, XHSNote } from "@/types";
import {
  buildSearchNoteLink,
  dedupeTags,
  extractTagsFromText,
  pickDetailImageUrl,
  pickSearchImageUrl,
  sanitizeTitle,
  stripTagsFromText,
  toNumber,
} from "@/lib/xhs";
import {
  buildOpenableNoteLink,
  extractNoteIdFromLink,
  extractXhsLinksFromText,
  isXhsShortLink,
} from "@/lib/xhsLink";
import {
  getCachedNoteDetail,
  getCachedSearchResponse,
  setCachedNoteDetail,
  setCachedSearchResponse,
} from "@/lib/xhsCache";
import { runtimeConfig } from "@/lib/runtimeConfig";

const XHS_API_BASE = runtimeConfig.xhs.apiBaseUrl;
const XHS_API_KEY = runtimeConfig.xhs.apiKey;
const SEARCH_ERROR_DOC_SOURCE = "小红书搜索笔记(App)(v58)";
const SHORT_LINK_RESOLVE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};
const XHS_REQUEST_TIMEOUT_MS = runtimeConfig.xhs.requestTimeoutMs;
const XHS_RETRY_ATTEMPTS = runtimeConfig.xhs.retryAttempts;
const XHS_RETRY_BASE_DELAY_MS = runtimeConfig.xhs.retryBaseDelayMs;
const SEARCH_RESPONSE_CACHE_TTL_MS = 5 * 60 * 1000;
const NOTE_DETAIL_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const XHS_LINK_DETAIL_CONCURRENCY = 3;
const ESTIMATED_SEARCH_PAGE_SIZE = 20;
const SEARCH_PAGE_BUFFER = 4;
const SEARCH_PAGE_LIMIT = 20;
const MAX_CONSECUTIVE_FILTER_MISS_PAGES = 3;
const RETRYABLE_XHS_CODES = new Set([-1, 1003, 5000, 5003]);
const RETRYABLE_ERROR_KEYWORDS = [
  "fetch failed",
  "timeout",
  "timed out",
  "econnreset",
  "econnrefused",
  "socket hang up",
  "network connection failed",
  "网络连接失败",
] as const;

const SEARCH_ERROR_MESSAGES: Record<number, string> = {
  [-1]: "failed",
  400: "参数错误",
  1001: "账户余额不足",
  1002: "邮箱/手机号或密码错误",
  1003: "请求频率超过上限",
  1004: "邮箱或手机号已注册",
  1005: "无效的 API Key",
  1006: "用户不存在",
  1007: "登录凭证无效",
  1008: "缺少 API Key",
  1009: "手机或邮箱已存在",
  1010: "需要管理员授权",
  1011: "原密码错误",
  1012: "新密码不能与原密码相同",
  1013: "手机号和 uid 不能都为空",
  1014: "请填写验证码",
  1015: "验证码错误或已过期",
  1016: "登录失败次数过多，请输入验证码",
  1017: "请填写手机号",
  1018: "请填写邮箱",
  1019: "接口不存在，请检查",
  5000: "服务暂时不可用，请稍后重试",
  5003: "网络连接失败，请稍后重试",
  6001: "修改密码失败，请稍后重试",
};

type SearchErrorMeta = {
  code: number;
  channel: "app";
  channelLabel: string;
  docMessage: string;
  providerMessage: string;
  docSource: string;
  note?: string;
};

type SearchApiRaw = {
  code?: unknown;
  msg?: unknown;
  message?: unknown;
  data?: Record<string, unknown> | null;
};

type NoteDetailApiRaw = {
  code?: unknown;
  msg?: unknown;
  message?: unknown;
  data?: {
    note_card?: Record<string, unknown>;
  } | null;
};

function toStringValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function getSearchErrorDocMessage(code: number) {
  return SEARCH_ERROR_MESSAGES[code] || "接口文档未定义该错误码";
}

function buildSearchErrorMeta(raw: SearchApiRaw | null | undefined, note?: string): SearchErrorMeta {
  const code = toNumber(raw?.code, -1);

  return {
    code,
    channel: "app",
    channelLabel: "App 搜索",
    docMessage: getSearchErrorDocMessage(code),
    providerMessage: toStringValue(raw?.msg || raw?.message).trim(),
    docSource: SEARCH_ERROR_DOC_SOURCE,
    note,
  };
}

function buildSearchErrorMessage(meta: SearchErrorMeta) {
  const parts = [
    `${meta.channelLabel}失败`,
    `错误码 ${meta.code}`,
    `文档说明：${meta.docMessage}`,
  ];

  if (meta.providerMessage && meta.providerMessage !== meta.docMessage) {
    parts.push(`接口原始消息：${meta.providerMessage}`);
  }

  if (meta.note) {
    parts.push(meta.note);
  }

  return parts.join("；");
}

function errorResponse(meta: SearchErrorMeta) {
  return NextResponse.json(
    {
      error: buildSearchErrorMessage(meta),
      errorMeta: meta,
    },
    { status: 400 }
  );
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "未知错误";
}

function buildRetryDelay(attempt: number) {
  return XHS_RETRY_BASE_DELAY_MS * attempt + Math.floor(Math.random() * 250);
}

function isRetryableTransportError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();
  return RETRYABLE_ERROR_KEYWORDS.some((keyword) => message.includes(keyword));
}

function isRetryableXhsCode(code: number) {
  return RETRYABLE_XHS_CODES.has(code);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = XHS_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`请求超时（${timeoutMs}ms）`);
    }

    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<Array<PromiseSettledResult<R>>> {
  if (items.length === 0) return [];

  const settledResults = new Array<PromiseSettledResult<R>>(items.length);
  let nextIndex = 0;

  async function runWorker() {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) return;

      try {
        const value = await worker(items[currentIndex], currentIndex);
        settledResults[currentIndex] = { status: "fulfilled", value };
      } catch (reason) {
        settledResults[currentIndex] = { status: "rejected", reason };
      }
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  return settledResults;
}

function extractTags(note: Record<string, unknown>) {
  const title = sanitizeTitle(String(note.title || ""));
  const desc = String(note.desc || "");
  const sources = [
    title,
    desc,
    String((note.tag_info as Record<string, unknown> | undefined)?.title || ""),
  ];

  return dedupeTags(extractTagsFromText(sources.filter(Boolean).join(" ")));
}

function extractAppNotes(items: Record<string, unknown>[]): XHSNote[] {
  return items
    .map((item: Record<string, unknown>): XHSNote | null => {
      const note = (item.note || item) as Record<string, unknown>;

      if (note.type && note.type !== "normal") return null;

      const imagesList = Array.isArray(note.images_list)
        ? (note.images_list as Array<Record<string, unknown>>)
        : [];
      const imageList = imagesList.map(pickSearchImageUrl).filter(Boolean);
      const cover = imageList[0] || "";
      const id = String(note.note_id || note.id || "");
      const title = sanitizeTitle(String(note.title || ""));
      const rawDesc = String(note.desc || "");
      const tags = extractTags(note);

      if (!id || !cover) return null;

      return {
        id,
        title,
        desc: stripTagsFromText(rawDesc),
        cover,
        imageList,
        likedCount: toNumber(note.liked_count),
        collectedCount: toNumber(note.collected_count),
        commentCount: toNumber(note.comments_count),
        shareCount: toNumber(note.shared_count, toNumber(note.share_count)),
        publishTime: note.timestamp
          ? new Date(Number(note.timestamp) * 1000).toISOString()
          : "",
        tags,
        author: ((note.user as Record<string, unknown>)?.nickname as string) || "",
        noteLink: buildSearchNoteLink(id, String(note.xsec_token || "")),
      };
    })
    .filter((note): note is XHSNote => Boolean(note));
}

function applyMetricFilters(
  notes: XHSNote[],
  seenIds: Set<string>,
  filters: SearchFilters | undefined
) {
  const minLike = filters?.minLike ?? undefined;
  const minComment = filters?.minComment ?? undefined;
  const minShare = filters?.minShare ?? undefined;
  const minCollect = filters?.minCollect ?? undefined;

  return notes.filter((note) => {
    if (seenIds.has(note.id)) return false;
    if (minLike !== undefined && note.likedCount < minLike) return false;
    if (minComment !== undefined && note.commentCount < minComment) return false;
    if (minShare !== undefined && note.shareCount < minShare) return false;
    if (minCollect !== undefined && note.collectedCount < minCollect) return false;
    seenIds.add(note.id);
    return true;
  });
}

async function requestAppSearch(body: Record<string, unknown>) {
  const cacheKey = JSON.stringify(body);
  const cached = getCachedSearchResponse<SearchApiRaw>(cacheKey);
  if (cached) return cached;

  let lastError: unknown;

  for (let attempt = 1; attempt <= XHS_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const resp = await fetchWithTimeout(`${XHS_API_BASE}/xhs/search_note_app`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": XHS_API_KEY,
        },
        body: JSON.stringify(body),
      });
      const raw = (await resp.json()) as SearchApiRaw;
      const code = toNumber(raw.code, -1);

      if (!resp.ok) {
        const message = toStringValue(raw.msg || raw.message) || `HTTP ${resp.status}`;
        if (attempt < XHS_RETRY_ATTEMPTS && (resp.status >= 500 || resp.status === 429)) {
          console.warn(`XHS 搜索请求失败，准备第 ${attempt + 1} 次重试：${message}`);
          await sleep(buildRetryDelay(attempt));
          continue;
        }

        throw new Error(message);
      }

      if (code === 0) {
        setCachedSearchResponse(cacheKey, raw, SEARCH_RESPONSE_CACHE_TTL_MS);
        return raw;
      }

      if (attempt < XHS_RETRY_ATTEMPTS && isRetryableXhsCode(code)) {
        console.warn(
          `XHS 搜索返回可重试错误码 ${code}，准备第 ${attempt + 1} 次重试：${toStringValue(raw.msg || raw.message)}`
        );
        await sleep(buildRetryDelay(attempt));
        continue;
      }

      return raw;
    } catch (error) {
      lastError = error;

      if (attempt >= XHS_RETRY_ATTEMPTS || !isRetryableTransportError(error)) {
        throw error;
      }

      console.warn(
        `XHS 搜索网络异常，准备第 ${attempt + 1} 次重试：${getErrorMessage(error)}`
      );
      await sleep(buildRetryDelay(attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error("XHS 搜索失败");
}

async function resolveShortLink(link: string) {
  try {
    const manualResp = await fetchWithTimeout(
      link,
      {
      method: "GET",
      redirect: "manual",
      headers: SHORT_LINK_RESOLVE_HEADERS,
      cache: "no-store",
      },
      8_000
    );

    const location = manualResp.headers.get("location");
    if (location) {
      return new URL(location, link).toString();
    }
  } catch {
    // ignore and fall back to followed response below
  }

  const resp = await fetchWithTimeout(
    link,
    {
      method: "GET",
      redirect: "follow",
      headers: SHORT_LINK_RESOLVE_HEADERS,
      cache: "no-store",
    },
    12_000
  );

  return resp.url || link;
}

async function resolveSearchLink(link: string) {
  const extractedLink = extractXhsLinksFromText(link)[0] || link.trim();
  if (!extractedLink) {
    return {
      requestedLink: "",
      resolvedLink: "",
      noteId: "",
    };
  }

  let resolvedLink = buildOpenableNoteLink(extractedLink);
  let noteId = extractNoteIdFromLink(resolvedLink);

  if (!noteId && isXhsShortLink(resolvedLink)) {
    const redirectedLink = await resolveShortLink(resolvedLink);
    resolvedLink = buildOpenableNoteLink(redirectedLink);
    noteId = extractNoteIdFromLink(resolvedLink);
  }

  return {
    requestedLink: extractedLink,
    resolvedLink: buildOpenableNoteLink(resolvedLink, noteId),
    noteId,
  };
}

function extractDetailTags(noteCard: Record<string, unknown>) {
  const tagList = Array.isArray(noteCard.tag_list)
    ? (noteCard.tag_list as Array<Record<string, unknown>>)
    : [];

  const tags = dedupeTags(tagList.map((tag) => toStringValue(tag.name)));
  if (tags.length > 0) return tags;

  return extractTagsFromText(`${toStringValue(noteCard.title)} ${toStringValue(noteCard.desc)}`);
}

function toIsoString(timestamp: unknown): string {
  const numericValue = toNumber(timestamp, NaN);
  if (!Number.isFinite(numericValue) || numericValue <= 0) return "";

  const milliseconds = numericValue < 1_000_000_000_000 ? numericValue * 1000 : numericValue;
  return new Date(milliseconds).toISOString();
}

async function fetchNoteDetail(noteId: string): Promise<Record<string, unknown>> {
  const cached = getCachedNoteDetail(noteId);
  if (cached) return cached;

  let lastError: unknown;

  for (let attempt = 1; attempt <= XHS_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const resp = await fetchWithTimeout(`${XHS_API_BASE}/xhs/note_detail4`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": XHS_API_KEY,
        },
        body: JSON.stringify({ note_id: noteId }),
      });
      const raw = (await resp.json()) as NoteDetailApiRaw;
      const code = toNumber(raw.code, -1);
      const noteCard = raw.data?.note_card;
      const message = toStringValue(raw.msg || raw.message).trim() || `获取笔记详情失败：${noteId}`;

      if (resp.ok && code === 0 && noteCard) {
        setCachedNoteDetail(noteId, noteCard, NOTE_DETAIL_CACHE_TTL_MS);
        return noteCard;
      }

      if (
        attempt < XHS_RETRY_ATTEMPTS &&
        ((resp.status >= 500 || resp.status === 429) || isRetryableXhsCode(code))
      ) {
        console.warn(`XHS 笔记详情请求失败，准备第 ${attempt + 1} 次重试：${message}`);
        await sleep(buildRetryDelay(attempt));
        continue;
      }

      throw new Error(message);
    } catch (error) {
      lastError = error;

      if (attempt >= XHS_RETRY_ATTEMPTS || !isRetryableTransportError(error)) {
        throw error;
      }

      console.warn(
        `XHS 笔记详情网络异常，准备第 ${attempt + 1} 次重试：${getErrorMessage(error)}`
      );
      await sleep(buildRetryDelay(attempt));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`获取笔记详情失败：${noteId}`);
}

function buildNoteFromDetail(noteCard: Record<string, unknown>, originalLink: string): XHSNote {
  const interactInfo =
    (noteCard.interact_info as Record<string, unknown> | undefined) || {};
  const imageList = Array.isArray(noteCard.image_list)
    ? (noteCard.image_list as Array<Record<string, unknown>>)
        .map(pickDetailImageUrl)
        .filter(Boolean)
    : [];
  const id = toStringValue(noteCard.note_id);

  return {
    id,
    title: sanitizeTitle(toStringValue(noteCard.title)),
    desc: stripTagsFromText(toStringValue(noteCard.desc)),
    cover: imageList[0] || "",
    imageList,
    likedCount: toNumber(interactInfo.liked_count),
    collectedCount: toNumber(interactInfo.collected_count),
    commentCount: toNumber(interactInfo.comment_count),
    shareCount: toNumber(interactInfo.share_count),
    publishTime: toIsoString(noteCard.time),
    tags: extractDetailTags(noteCard),
    author: toStringValue((noteCard.user as Record<string, unknown> | undefined)?.nick_name),
    noteLink: buildOpenableNoteLink(originalLink, id),
    coverText: "",
  };
}

async function searchByLinks(noteLinks: string[]) {
  const cleanedLinks = noteLinks.flatMap((item) => {
    const extractedLinks = extractXhsLinksFromText(item);
    if (extractedLinks.length > 0) return extractedLinks;

    const trimmed = item.trim();
    return trimmed ? [trimmed] : [];
  });

  const uniqueLinks = Array.from(
    new Map(
      cleanedLinks.map((link) => [buildOpenableNoteLink(link).toLowerCase(), link])
    ).values()
  );

  if (uniqueLinks.length === 0) {
    return NextResponse.json({ error: "请至少输入 1 个有效笔记链接" }, { status: 400 });
  }

  const warnings: string[] = [];
  const notes: XHSNote[] = [];
  const seenNoteIds = new Set<string>();

  const detailResults = await mapWithConcurrency(
    uniqueLinks,
    XHS_LINK_DETAIL_CONCURRENCY,
    async (link) => {
      const { noteId, resolvedLink, requestedLink } = await resolveSearchLink(link);
      if (!noteId) {
        throw new Error(`链接无法识别笔记ID：${requestedLink || link}`);
      }

      const noteCard = await fetchNoteDetail(noteId);
      return {
        noteId,
        note: buildNoteFromDetail(noteCard, resolvedLink || requestedLink || link),
      };
    }
  );

  detailResults.forEach((item, index) => {
    if (item.status === "fulfilled") {
      if (seenNoteIds.has(item.value.noteId)) return;
      seenNoteIds.add(item.value.noteId);
      notes.push(item.value.note);
      return;
    }

    warnings.push(`第 ${index + 1} 条链接获取失败：${item.reason instanceof Error ? item.reason.message : "未知错误"}`);
  });

  if (notes.length === 0) {
    return NextResponse.json(
      {
        error: warnings[0] || "未能获取任何笔记详情",
      },
      { status: 400 }
    );
  }

  return NextResponse.json({
    notes,
    total: notes.length,
    requestedCount: uniqueLinks.length,
    searchId: null,
    source: "links",
    warning: warnings.length > 0 ? warnings.join("；") : undefined,
  });
}

export async function POST(req: NextRequest) {
  try {
    const {
      keyword,
      filters,
      targetCount,
      noteLinks,
    }: {
      keyword?: string;
      filters?: SearchFilters;
      targetCount?: number;
      noteLinks?: string[];
    } = await req.json();

    if (Array.isArray(noteLinks) && noteLinks.length > 0) {
      return searchByLinks(noteLinks);
    }

    if (!keyword?.trim()) {
      return NextResponse.json({ error: "关键词不能为空" }, { status: 400 });
    }

    const parsedTargetCount = Number(targetCount);
    if (!Number.isFinite(parsedTargetCount) || parsedTargetCount <= 0) {
      return NextResponse.json({ error: "爬取数量必须大于 0" }, { status: 400 });
    }

    const want = Math.min(200, parsedTargetCount);
    const normalizedKeyword = keyword.trim();
    const allNotes: XHSNote[] = [];
    const seenIds = new Set<string>();
    let currentSearchId: string | null = null;
    let currentSessionId: string | null = null;
    let page = 1;
    const maxPages = Math.min(
      SEARCH_PAGE_LIMIT,
      Math.max(3, Math.ceil(want / ESTIMATED_SEARCH_PAGE_SIZE) + SEARCH_PAGE_BUFFER)
    );
    let consecutiveFilterMissPages = 0;
    let warning = "";

    while (allNotes.length < want && page <= maxPages) {
      const body: Record<string, unknown> = {
        keyword: normalizedKeyword,
        page,
        sort: filters?.sort || "general",
        note_type: "",
        note_time: filters?.timeRange || "",
      };

      if (currentSearchId) body.search_id = currentSearchId;
      if (currentSessionId) body.session_id = currentSessionId;

      const raw = await requestAppSearch(body);

      if (toNumber(raw.code, -1) !== 0) {
        const meta = buildSearchErrorMeta(raw);

        if (page === 1) {
          return errorResponse(meta);
        }

        warning = `${buildSearchErrorMessage(meta)}；已返回前 ${allNotes.length} 条结果`;
        break;
      }

      const items: Record<string, unknown>[] = Array.isArray(raw?.data?.items)
        ? (raw.data?.items as Record<string, unknown>[])
        : [];

      if (items.length === 0) break;

      currentSearchId =
        toStringValue(raw?.data?.search_id) ||
        toStringValue(raw?.data?.search_request_id) ||
        currentSearchId;
      currentSessionId = toStringValue(raw?.data?.session_id) || currentSessionId;

      const extracted = extractAppNotes(items);
      const filtered = applyMetricFilters(extracted, seenIds, filters);
      consecutiveFilterMissPages = filtered.length === 0 ? consecutiveFilterMissPages + 1 : 0;
      allNotes.push(...filtered);

      if (consecutiveFilterMissPages >= MAX_CONSECUTIVE_FILTER_MISS_PAGES) {
        warning = `连续 ${MAX_CONSECUTIVE_FILTER_MISS_PAGES} 页未命中筛选条件，已提前停止深翻页以减少接口消耗；当前返回 ${allNotes.length} 条结果`;
        break;
      }

      page += 1;
    }

    if (!warning && allNotes.length < want && page > maxPages) {
      warning = `达到翻页保护上限（${maxPages} 页），为减少三方接口消耗已停止；当前返回 ${allNotes.length} 条结果`;
    }

    const notes = allNotes.slice(0, want);

    return NextResponse.json({
      notes,
      total: notes.length,
      requestedCount: want,
      searchId: currentSearchId,
      source: "app",
      warning: warning || undefined,
    });
  } catch (error: unknown) {
    console.error("XHS search error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "服务器内部错误" },
      { status: 500 }
    );
  }
}
