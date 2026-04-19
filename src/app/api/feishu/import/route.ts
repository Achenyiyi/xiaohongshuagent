import { NextRequest, NextResponse } from "next/server";
import {
  createCollectRecords,
  getCollectRecords,
  getTableFields,
  TABLE_ID,
  uploadAttachmentToBitable,
} from "@/lib/feishu";
import {
  getImageRequestHeaders,
  guessImageExtension,
  normalizeImageUrl,
} from "@/lib/image";
import {
  dedupeTags,
  extractTagsFromText,
  formatTagsForStorage,
  pickDetailImageUrl,
  sanitizeTitle,
  stripTagsFromText,
  toNumber,
} from "@/lib/xhs";
import { buildOpenableNoteLink, extractNoteIdFromLink } from "@/lib/xhsLink";
import { extractCoverTextFromImageUrl, sanitizeExtractedImageText } from "@/lib/coverText";
import { setIfFieldExists, setIfFieldHasValue } from "@/lib/collectTableFields";
import { runtimeConfig } from "@/lib/runtimeConfig";
import type { XHSNote } from "@/types";
import { getCachedNoteDetail, setCachedNoteDetail } from "@/lib/xhsCache";

const FIELD_TYPE_TEXT = 1;
const FIELD_TYPE_DATETIME = 5;
const FIELD_TYPE_URL = 15;
const FIELD_TYPE_ATTACHMENT = 17;
const XHS_API_BASE = runtimeConfig.xhs.apiBaseUrl;
const XHS_API_KEY = runtimeConfig.xhs.apiKey;
const XHS_REQUEST_TIMEOUT_MS = runtimeConfig.xhs.requestTimeoutMs;
const XHS_RETRY_ATTEMPTS = runtimeConfig.xhs.retryAttempts;
const XHS_RETRY_BASE_DELAY_MS = runtimeConfig.xhs.retryBaseDelayMs;
const NOTE_DETAIL_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
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

function toString(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.link === "string") return record.link;
    if (typeof record.url === "string") return record.url;
    if (typeof record.text === "string") return record.text;
  }
  return "";
}

function normalizeNoteLink(link: string, fallbackNoteId?: string): string {
  return buildOpenableNoteLink(link, fallbackNoteId);
}

function getNoteUniqueKey(note: Pick<XHSNote, "id" | "noteLink">): string {
  const noteId = (note.id || extractNoteIdFromLink(note.noteLink || "")).trim().toLowerCase();
  if (noteId) return `note:${noteId}`;

  const normalizedLink = normalizeNoteLink(note.noteLink || "");
  return normalizedLink ? `link:${normalizedLink}` : "";
}

function shouldFetchNoteDetail(note: XHSNote): boolean {
  const title = note.title.trim();
  const desc = note.desc.trim();
  const hasTags = dedupeTags(note.tags || []).length > 0;
  const hasCover = Boolean(note.cover || note.imageList?.[0]);

  return !title || !hasCover || (!desc && !hasTags);
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

function extractTagsFromDetail(noteCard: Record<string, unknown>): string[] {
  const tagList = Array.isArray(noteCard.tag_list)
    ? (noteCard.tag_list as Array<Record<string, unknown>>)
    : [];

  const detailTags = dedupeTags(tagList.map((tag) => toString(tag.name)));
  if (detailTags.length > 0) return detailTags;

  return extractTagsFromText(`${toString(noteCard.title)} ${toString(noteCard.desc)}`);
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

      const raw = (await resp.json()) as {
        code?: unknown;
        msg?: string;
        message?: string;
        data?: { note_card?: Record<string, unknown> } | null;
      };
      const code = toNumber(raw.code, -1);
      const noteCard = raw.data?.note_card;
      const message = raw.msg || raw.message || noteId;

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

      throw new Error(`获取笔记详情失败: ${message}`);
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

  throw lastError instanceof Error ? lastError : new Error(`获取笔记详情失败: ${noteId}`);
}

async function loadExistingNoteKeys() {
  const keys = new Set<string>();
  let pageToken: string | undefined;

  while (true) {
    const response = await getCollectRecords(100, pageToken);

    for (const item of response.items || []) {
      const uniqueKey = getNoteUniqueKey({
        id: extractNoteIdFromLink(toString(item.fields["笔记链接"])),
        noteLink: toString(item.fields["笔记链接"]),
      });

      if (uniqueKey) {
        keys.add(uniqueKey);
      }
    }

    if (!response.has_more || !response.page_token) break;
    pageToken = response.page_token;
  }

  return keys;
}

async function prepareImportNote(note: XHSNote): Promise<XHSNote> {
  if (!shouldFetchNoteDetail(note)) {
    return {
      ...note,
      title: sanitizeTitle(note.title),
      desc: stripTagsFromText(note.desc),
      noteLink: normalizeNoteLink(note.noteLink, note.id),
      tags: dedupeTags(note.tags || []),
    };
  }

  const noteCard = await fetchNoteDetail(note.id);
  const interactInfo =
    (noteCard.interact_info as Record<string, unknown> | undefined) || {};
  const imageList = Array.isArray(noteCard.image_list)
    ? (noteCard.image_list as Array<Record<string, unknown>>)
        .map(pickDetailImageUrl)
        .filter(Boolean)
    : [];
  const detailNoteId = toString(noteCard.note_id) || note.id;
  const mergedTags = dedupeTags([...(note.tags || []), ...extractTagsFromDetail(noteCard)]);

  return {
    ...note,
    id: detailNoteId,
    title: sanitizeTitle(toString(noteCard.title)) || sanitizeTitle(note.title),
    desc: stripTagsFromText(toString(noteCard.desc)),
    cover: imageList[0] || note.cover,
    imageList: imageList.length > 0 ? imageList : note.imageList,
    likedCount: toNumber(interactInfo.liked_count, note.likedCount),
    collectedCount: toNumber(interactInfo.collected_count, note.collectedCount),
    commentCount: toNumber(interactInfo.comment_count, note.commentCount),
    shareCount: toNumber(interactInfo.share_count, note.shareCount),
    publishTime: toIsoString(noteCard.time) || note.publishTime,
    tags: mergedTags,
    author: toString((noteCard.user as Record<string, unknown> | undefined)?.nick_name) || note.author,
    noteLink: normalizeNoteLink(note.noteLink, detailNoteId),
  };
}

function assertFieldType(
  fieldTypeMap: Map<string, number>,
  fieldName: string,
  expectedType: number
) {
  const actualType = fieldTypeMap.get(fieldName);

  if (actualType !== expectedType) {
    throw new Error(
      `飞书字段「${fieldName}」类型错误，当前为 ${actualType ?? "缺失"}，预期为 ${expectedType}`
    );
  }
}

function assertFieldTypeIfPresent(
  fieldTypeMap: Map<string, number>,
  fieldName: string,
  expectedType: number
) {
  if (!fieldTypeMap.has(fieldName)) return;
  assertFieldType(fieldTypeMap, fieldName, expectedType);
}

async function uploadNoteCover(note: XHSNote) {
  const imageUrl = normalizeImageUrl(note.cover);
  const resp = await fetch(imageUrl, {
    headers: getImageRequestHeaders(imageUrl),
    redirect: "follow",
  });

  if (!resp.ok) {
    throw new Error(`下载封面失败: ${note.title || note.id}`);
  }

  const buffer = await resp.arrayBuffer();
  const mimeType = resp.headers.get("content-type") || "image/jpeg";
  const ext = guessImageExtension(mimeType, imageUrl);

  return uploadAttachmentToBitable({
    buffer,
    mimeType,
    fileName: `xhs-${note.id}.${ext}`,
  });
}

export async function POST(req: NextRequest) {
  try {
    const { notes, keyword }: { notes: XHSNote[]; keyword: string } = await req.json();

    if (!notes || notes.length === 0) {
      return NextResponse.json({ error: "没有可导入的笔记" }, { status: 400 });
    }

    const { items: tableFields } = await getTableFields(TABLE_ID);
    const fieldTypeMap = new Map(tableFields.map((field) => [field.field_name, field.type]));

    assertFieldTypeIfPresent(fieldTypeMap, "采集日期", FIELD_TYPE_DATETIME);
    assertFieldTypeIfPresent(fieldTypeMap, "发布时间", FIELD_TYPE_DATETIME);
    assertFieldTypeIfPresent(fieldTypeMap, "笔记链接", FIELD_TYPE_URL);
    assertFieldTypeIfPresent(fieldTypeMap, "封面", FIELD_TYPE_ATTACHMENT);
    assertFieldTypeIfPresent(fieldTypeMap, "封面文案", FIELD_TYPE_TEXT);

    const existingNoteKeys = await loadExistingNoteKeys();
    const pendingKeys = new Set<string>();
    const importCandidates: XHSNote[] = [];
    let skippedCount = 0;

    for (const note of notes) {
      const uniqueKey = getNoteUniqueKey(note);

      if (!uniqueKey) {
        throw new Error(`笔记缺少唯一标识，无法导入: ${note.title || note.id || "未命名笔记"}`);
      }

      if (existingNoteKeys.has(uniqueKey) || pendingKeys.has(uniqueKey)) {
        skippedCount++;
        continue;
      }

      pendingKeys.add(uniqueKey);
      importCandidates.push(note);
    }

    if (importCandidates.length === 0) {
      return NextResponse.json({
        success: true,
        count: 0,
        importedCount: 0,
        skippedCount,
      });
    }

    const preparedNotes: XHSNote[] = [];

    for (const note of importCandidates) {
      preparedNotes.push(await prepareImportNote(note));
    }

    const notesWithCoverText = fieldTypeMap.has("封面文案")
      ? await Promise.all(
          preparedNotes.map(async (note) => {
            if (note.coverText || !note.cover) return note;
            try {
              const coverText = await extractCoverTextFromImageUrl(note.cover);
              return { ...note, coverText };
            } catch (error) {
              console.error(`封面文案提取失败: ${note.id}`, error);
              return note;
            }
          })
        )
      : preparedNotes;

    const collectDate = new Date();
    collectDate.setHours(0, 0, 0, 0);
    const collectTimestamp = collectDate.getTime();
    const attachmentMap = new Map<string, Awaited<ReturnType<typeof uploadNoteCover>>>();

    for (const note of notesWithCoverText) {
      if (!fieldTypeMap.has("封面")) continue;
      if (!note.cover) continue;
      const attachment = await uploadNoteCover(note);
      attachmentMap.set(note.id, attachment);
    }

    const records = notesWithCoverText.map((note) => {
      const fields: Record<string, unknown> = {};
      const normalizedCoverText = sanitizeExtractedImageText(note.coverText || "");
      setIfFieldExists(fields, fieldTypeMap, "采集日期", collectTimestamp);
      setIfFieldHasValue(fields, fieldTypeMap, "搜索关键词", keyword);
      setIfFieldHasValue(fields, fieldTypeMap, "标题", note.title);
      setIfFieldHasValue(fields, fieldTypeMap, "正文", note.desc);
      setIfFieldExists(fields, fieldTypeMap, "点赞数", note.likedCount || 0);
      setIfFieldExists(fields, fieldTypeMap, "收藏数", note.collectedCount || 0);
      setIfFieldExists(fields, fieldTypeMap, "评论数", note.commentCount || 0);
      setIfFieldExists(fields, fieldTypeMap, "转发数", note.shareCount || 0);
      setIfFieldHasValue(fields, fieldTypeMap, "封面文案", normalizedCoverText);
      setIfFieldHasValue(fields, fieldTypeMap, "标签", formatTagsForStorage(note.tags || []));
      setIfFieldExists(fields, fieldTypeMap, "已二创", false);

      if (fieldTypeMap.has("笔记链接") && note.noteLink) {
        fields["笔记链接"] = {
          text: note.noteLink,
          link: note.noteLink,
        };
      }

      if (fieldTypeMap.has("发布时间") && note.publishTime) {
        const publishTimestamp = new Date(note.publishTime).getTime();
        if (Number.isFinite(publishTimestamp)) {
          fields["发布时间"] = publishTimestamp;
        }
      }

      const attachment = attachmentMap.get(note.id);
      if (fieldTypeMap.has("封面") && attachment) {
        fields["封面"] = [attachment];
      }

      return { fields };
    });

    const result = await createCollectRecords(records);

    return NextResponse.json({
      success: true,
      count: result.records?.length || records.length,
      importedCount: result.records?.length || records.length,
      skippedCount,
    });
  } catch (e: unknown) {
    console.error("Feishu import error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "导入失败" },
      { status: 500 }
    );
  }
}
