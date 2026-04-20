import { NextRequest, NextResponse } from "next/server";
import {
  createRecordsInTable,
  updateCollectRecords,
  getTableFields,
  addTableField,
  TABLE_ID,
  uploadAttachmentToBitable,
} from "@/lib/feishu";
import type { RewriteResult } from "@/types";
import { buildExtractReplaceInfoPrompt } from "@/lib/prompts";
import {
  guessImageExtension,
  normalizeImageUrl,
} from "@/lib/image";
import { fetchImageResponse } from "@/lib/serverImage";
import { setIfFieldExists, setIfFieldHasValue } from "@/lib/collectTableFields";
import { dedupeTags, formatTagsForStorage, stripTagsFromText } from "@/lib/xhs";
import { sanitizeExtractedImageText } from "@/lib/coverText";
import {
  buildOriginalAndRewrittenBlock,
  injectOriginalAndRewritten,
  replaceOriginalAndRewrittenIfPresent,
} from "@/lib/promptInjection";
import { runtimeConfig } from "@/lib/runtimeConfig";

const DASHSCOPE_API_KEY = runtimeConfig.dashscope.apiKey;
const DASHSCOPE_BASE_URL = runtimeConfig.dashscope.baseUrl;
const DASHSCOPE_TEXT_MODEL = runtimeConfig.dashscope.textModel;
const REWRITE_TABLE_ID = runtimeConfig.feishu.rewriteTableId;
const FIELD_TYPE_TEXT = 1;
const FIELD_TYPE_DATETIME = 5;
const FIELD_TYPE_ATTACHMENT = 17;
const COMBINED_REPLACE_INFO_FIELD_NAME = "二创替换信息";
type PromptMode = "default" | "custom";
const REWRITE_TABLE_FIELDS = [
  { field_name: "二创日期", type: FIELD_TYPE_DATETIME },
  { field_name: "封面", type: FIELD_TYPE_ATTACHMENT },
  { field_name: "封面文案", type: FIELD_TYPE_TEXT },
  { field_name: "标题", type: FIELD_TYPE_TEXT },
  { field_name: "正文", type: FIELD_TYPE_TEXT },
  { field_name: "标签", type: FIELD_TYPE_TEXT },
  { field_name: "二创封面", type: FIELD_TYPE_ATTACHMENT },
  { field_name: "二创封面文案", type: FIELD_TYPE_TEXT },
  { field_name: "二创标题", type: FIELD_TYPE_TEXT },
  { field_name: "二创正文", type: FIELD_TYPE_TEXT },
  { field_name: "二创标签", type: FIELD_TYPE_TEXT },
  { field_name: COMBINED_REPLACE_INFO_FIELD_NAME, type: FIELD_TYPE_TEXT },
  { field_name: "笔记链接", type: FIELD_TYPE_TEXT },
  { field_name: "源记录ID", type: FIELD_TYPE_TEXT },
  { field_name: "点赞数", type: 2 },
  { field_name: "收藏数", type: 2 },
  { field_name: "评论数", type: 2 },
] as const;
const SAVE_DRAFT_CONCURRENCY = runtimeConfig.saveDraft.concurrency;
const SAVE_DRAFT_RETRY_ATTEMPTS = runtimeConfig.saveDraft.retryAttempts;
const SAVE_DRAFT_RETRY_BASE_DELAY_MS = runtimeConfig.saveDraft.retryBaseDelayMs;
const RETRYABLE_ERROR_KEYWORDS = [
  "request trigger frequency limit",
  "fetch failed",
  "timed out",
  "timeout",
  "econnreset",
  "econnrefused",
  "socket hang up",
  "too many requests",
  "rate limit",
] as const;

type ReplaceInfoScope = "title" | "body" | "cover";
type ReplaceInfoByScope = Record<ReplaceInfoScope, string>;
type UploadedAttachment = Awaited<ReturnType<typeof uploadAttachmentToBitable>>;
type CollectRecordUpdate = {
  record_id: string;
  fields: Record<string, unknown>;
};
type PersistedResultItem = {
  result: RewriteResult;
  extractedByScope: ReplaceInfoByScope;
  collectUpdate?: CollectRecordUpdate;
};
type FailedResultItem = {
  resultId: string;
  recordId: string;
  title: string;
  error: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "保存失败";
}

function isRetryableError(error: unknown) {
  const message = getErrorMessage(error).toLowerCase();
  return RETRYABLE_ERROR_KEYWORDS.some((keyword) => message.includes(keyword));
}

async function withRetry<T>(
  task: () => Promise<T>,
  label: string,
  attempts = SAVE_DRAFT_RETRY_ATTEMPTS
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await task();
    } catch (error) {
      lastError = error;
      if (attempt >= attempts || !isRetryableError(error)) {
        throw error;
      }

      const delay =
        SAVE_DRAFT_RETRY_BASE_DELAY_MS * attempt + Math.floor(Math.random() * 250);
      console.warn(`${label} 失败，准备第 ${attempt + 1} 次重试：${getErrorMessage(error)}`);
      await sleep(delay);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${label}失败`);
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

  const workerCount = Math.min(Math.max(concurrency, 1), items.length);
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
  return settledResults;
}

function assertFieldTypeOrThrow(
  fieldTypeMap: Map<string, number>,
  fieldName: string,
  expectedType: number,
  message?: string
) {
  const actualType = fieldTypeMap.get(fieldName);
  if (actualType === expectedType) return;
  throw new Error(
    message ||
      `飞书字段「${fieldName}」类型错误，当前为 ${actualType ?? "缺失"}，预期为 ${expectedType}`
  );
}

function normalizeReplaceInfo(value: string | undefined) {
  return value?.trim() || "";
}

function buildUsedReplaceInfo(result: RewriteResult): ReplaceInfoByScope {
  return {
    title: normalizeReplaceInfo(result.titleReplaceInfo),
    body: normalizeReplaceInfo(result.bodyReplaceInfo),
    cover: normalizeReplaceInfo(result.coverReplaceInfo),
  };
}

function buildCombinedReplaceInfoSnapshot(usedReplaceInfo: ReplaceInfoByScope) {
  const hasAnyValue =
    Boolean(usedReplaceInfo.cover) ||
    Boolean(usedReplaceInfo.title) ||
    Boolean(usedReplaceInfo.body);

  if (!hasAnyValue) return "";

  return [
    "【封面文案】",
    usedReplaceInfo.cover || "暂无",
    "",
    "【标题】",
    usedReplaceInfo.title || "暂无",
    "",
    "【正文】",
    usedReplaceInfo.body || "暂无",
  ].join("\n");
}

function buildScopeOriginalAndRewritten(
  result: RewriteResult,
  scope: ReplaceInfoScope
) {
  if (scope === "title") {
    return {
      original: {
        title: result.originalNote.originalTitle || "",
        body: "",
        coverText: "",
      },
      rewritten: {
        title: result.rewrittenTitle,
        body: "",
        coverText: "",
      },
    };
  }

  if (scope === "cover") {
    return {
      original: {
        title: "",
        body: "",
        coverText: result.originalNote.coverText || "",
      },
      rewritten: {
        title: "",
        body: "",
        coverText: result.rewrittenCoverText,
      },
    };
  }

  return {
    original: {
      title: "",
      body: result.originalNote.originalBody || "",
      coverText: "",
    },
    rewritten: {
      title: "",
      body: result.rewrittenBody,
      coverText: "",
    },
  };
}

function prependScopeInstruction(prompt: string, scope: ReplaceInfoScope) {
  const scopeInstruction =
    scope === "title"
      ? "这次只分析标题中的替换信息，不要分析正文和封面文案。"
      : scope === "body"
        ? "这次只分析正文中的替换信息，不要分析标题和封面文案。"
        : "这次只分析封面文案中的替换信息，不要分析标题和正文。";

  return `${scopeInstruction}\n\n${prompt}`;
}

function normalizePromptMode(value: unknown): PromptMode {
  return value === "custom" ? "custom" : "default";
}

function buildCustomExtractPrompt(
  promptTemplate: string,
  original: { title: string; body: string; coverText: string },
  rewritten: { title: string; body: string; coverText: string },
  promptIncludesOriginalAndRewritten: boolean
) {
  if (promptIncludesOriginalAndRewritten) {
    return replaceOriginalAndRewrittenIfPresent(promptTemplate, original, rewritten);
  }

  const contextBlock = buildOriginalAndRewrittenBlock(original, rewritten);
  const trimmedTemplate = promptTemplate.trim();
  if (!trimmedTemplate) {
    return contextBlock;
  }

  return `${trimmedTemplate}\n\n## 原文与二创内容\n\n${contextBlock}`;
}

async function extractReplaceInfoForScope(
  result: RewriteResult,
  scope: ReplaceInfoScope,
  customPromptTemplate?: string,
  promptMode: PromptMode = "default",
  promptIncludesOriginalAndRewritten = false
): Promise<string> {
  try {
    const { original, rewritten } = buildScopeOriginalAndRewritten(result, scope);
    let prompt: string;
    if (customPromptTemplate && promptMode === "custom") {
      prompt = buildCustomExtractPrompt(
        customPromptTemplate,
        original,
        rewritten,
        promptIncludesOriginalAndRewritten
      );
    } else if (customPromptTemplate) {
      prompt = injectOriginalAndRewritten(customPromptTemplate, original, rewritten);
    } else {
      prompt = buildExtractReplaceInfoPrompt(original, rewritten);
    }

    const resp = await fetch(`${DASHSCOPE_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DASHSCOPE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DASHSCOPE_TEXT_MODEL,
        messages: [{ role: "user", content: prependScopeInstruction(prompt, scope) }],
        max_tokens: 512,
      }),
    });
    const data = await resp.json();
    return data.choices?.[0]?.message?.content?.trim() || "";
  } catch {
    return "";
  }
}

async function extractReplaceInfoByScope(
  result: RewriteResult,
  customPromptTemplate?: string,
  promptMode: PromptMode = "default",
  promptIncludesOriginalAndRewritten = false
): Promise<ReplaceInfoByScope> {
  const [title, body, cover] = await Promise.all([
    extractReplaceInfoForScope(
      result,
      "title",
      customPromptTemplate,
      promptMode,
      promptIncludesOriginalAndRewritten
    ),
    extractReplaceInfoForScope(
      result,
      "body",
      customPromptTemplate,
      promptMode,
      promptIncludesOriginalAndRewritten
    ),
    extractReplaceInfoForScope(
      result,
      "cover",
      customPromptTemplate,
      promptMode,
      promptIncludesOriginalAndRewritten
    ),
  ]);

  return { title, body, cover };
}

async function ensureTableFields(
  tableId: string,
  fields: ReadonlyArray<{ field_name: string; type: number }>
) {
  const initial = await getTableFields(tableId);
  const existingNames = new Set(initial.items.map((field) => field.field_name));
  let changed = false;

  for (const field of fields) {
    if (!existingNames.has(field.field_name)) {
      await addTableField(tableId, field);
      changed = true;
    }
  }

  if (!changed) return initial.items;
  const refreshed = await getTableFields(tableId);
  return refreshed.items;
}

type ImageUploadPayload = {
  buffer: ArrayBuffer;
  mimeType: string;
  fileName: string;
};

function isDataImageUrl(value: string) {
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(value);
}

function dataImageToUploadPayload(value: string) {
  const match = value.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i);
  if (!match) {
    throw new Error("二创封面图片数据格式错误");
  }

  const mimeType = match[1];
  const buffer = Buffer.from(match[2], "base64");
  const arrayBuffer = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength
  );

  return { buffer: arrayBuffer, mimeType };
}

async function buildImageUploadPayload(
  source: string,
  fileName: string
): Promise<ImageUploadPayload | null> {
  const trimmedSource = source.trim();
  if (!trimmedSource) return null;

  let buffer: ArrayBuffer;
  let mimeType = "image/png";
  let sourceUrl = trimmedSource;

  if (isDataImageUrl(trimmedSource)) {
    const data = dataImageToUploadPayload(trimmedSource);
    buffer = data.buffer;
    mimeType = data.mimeType;
    sourceUrl = "";
  } else {
    sourceUrl = normalizeImageUrl(trimmedSource);
    const resp = await fetchImageResponse(sourceUrl);

    if (!resp.ok) {
      throw new Error(`图片下载失败: ${fileName}`);
    }

    buffer = await resp.arrayBuffer();
    mimeType = resp.headers.get("content-type") || mimeType;
  }

  const ext = guessImageExtension(mimeType, sourceUrl);
  return {
    buffer,
    mimeType,
    fileName: `${fileName}.${ext}`,
  };
}

async function uploadImageAttachment(source: string, fileName: string) {
  const payload = await buildImageUploadPayload(source, fileName);
  if (!payload) return null;
  return uploadAttachmentToBitable(payload);
}

function buildInheritedTags(result: RewriteResult): string[] {
  return dedupeTags(
    result.rewrittenTags.length > 0
      ? result.rewrittenTags
      : (result.originalNote.originalTags || [])
  );
}

async function ensureRewriteTable() {
  if (!REWRITE_TABLE_ID) {
    throw new Error("未配置 FEISHU_REWRITE_TABLE_ID，当前仅支持写入固定二创库。");
  }

  const fields = await ensureTableFields(REWRITE_TABLE_ID, REWRITE_TABLE_FIELDS);
  const fieldTypeMap = new Map(fields.map((field) => [field.field_name, field.type]));

  assertFieldTypeOrThrow(fieldTypeMap, "二创日期", FIELD_TYPE_DATETIME);
  assertFieldTypeOrThrow(
    fieldTypeMap,
    "封面文案",
    FIELD_TYPE_TEXT,
    "二创库字段「封面文案」当前不是文本字段，无法写入文字。请在飞书里把它改成单行文本或多行文本。"
  );
  assertFieldTypeOrThrow(
    fieldTypeMap,
    "二创封面文案",
    FIELD_TYPE_TEXT,
    "二创库字段「二创封面文案」当前不是文本字段，无法写入文字。请在飞书里把它改成单行文本或多行文本。"
  );
  assertFieldTypeOrThrow(fieldTypeMap, "封面", FIELD_TYPE_ATTACHMENT);
  assertFieldTypeOrThrow(fieldTypeMap, "二创封面", FIELD_TYPE_ATTACHMENT);

  return {
    tableId: REWRITE_TABLE_ID,
    tableName: "二创库",
    fields,
  };
}

function buildRewriteTableFields(params: {
  result: RewriteResult;
  rewriteFields: Array<{ field_name: string; type: number }>;
  rewriteTimestamp: number;
  originalCoverAttachment?: Awaited<ReturnType<typeof uploadAttachmentToBitable>>;
  draftCoverAttachment?: Awaited<ReturnType<typeof uploadAttachmentToBitable>>;
}) {
  const { result, rewriteFields, rewriteTimestamp, originalCoverAttachment, draftCoverAttachment } = params;
  const inheritedTags = buildInheritedTags(result);
  const usedReplaceInfo = buildUsedReplaceInfo(result);
  const combinedReplaceInfoSnapshot = buildCombinedReplaceInfoSnapshot(usedReplaceInfo);
  const targetFieldTypeMap = new Map(
    rewriteFields.map((field) => [field.field_name, field.type])
  );
  const fields: Record<string, unknown> = {};
  const normalizedOriginalCoverText = sanitizeExtractedImageText(
    result.originalNote.coverText || ""
  );
  const normalizedRewrittenCoverText = sanitizeExtractedImageText(
    result.rewrittenCoverText || ""
  );

  setIfFieldExists(fields, targetFieldTypeMap, "二创日期", rewriteTimestamp);
  setIfFieldHasValue(fields, targetFieldTypeMap, "标题", result.originalNote.originalTitle);
  setIfFieldHasValue(
    fields,
    targetFieldTypeMap,
    "正文",
    stripTagsFromText(result.originalNote.originalBody || "")
  );
  setIfFieldHasValue(
    fields,
    targetFieldTypeMap,
    "标签",
    formatTagsForStorage(result.originalNote.originalTags || [])
  );
  setIfFieldHasValue(fields, targetFieldTypeMap, "封面文案", normalizedOriginalCoverText);
  setIfFieldHasValue(fields, targetFieldTypeMap, "二创标题", result.rewrittenTitle);
  setIfFieldHasValue(fields, targetFieldTypeMap, "二创正文", result.rewrittenBody);
  setIfFieldHasValue(fields, targetFieldTypeMap, "二创标签", formatTagsForStorage(inheritedTags));
  setIfFieldHasValue(fields, targetFieldTypeMap, "二创封面文案", normalizedRewrittenCoverText);
  setIfFieldHasValue(
    fields,
    targetFieldTypeMap,
    COMBINED_REPLACE_INFO_FIELD_NAME,
    combinedReplaceInfoSnapshot
  );

  if (targetFieldTypeMap.get("笔记链接") === 15 && result.originalNote.noteLink) {
    fields["笔记链接"] = {
      text: result.originalNote.noteLink,
      link: result.originalNote.noteLink,
    };
  } else {
    setIfFieldHasValue(fields, targetFieldTypeMap, "笔记链接", result.originalNote.noteLink);
  }

  setIfFieldHasValue(fields, targetFieldTypeMap, "源记录ID", result.originalNote.recordId);

  if (originalCoverAttachment) {
    fields["封面"] = [originalCoverAttachment];
  }
  if (draftCoverAttachment) {
    fields["二创封面"] = [draftCoverAttachment];
  }

  return fields;
}

function buildCollectUpdateFields(
  result: RewriteResult,
  collectFieldTypeMap: Map<string, number>,
  rewriteTimestamp: number
) {
  const fields: Record<string, unknown> = {};
  const inheritedTags = buildInheritedTags(result);
  const normalizedOriginalCoverText = sanitizeExtractedImageText(
    result.originalNote.coverText || ""
  );
  const normalizedRewrittenCoverText = sanitizeExtractedImageText(
    result.rewrittenCoverText || ""
  );

  setIfFieldExists(fields, collectFieldTypeMap, "二创日期", rewriteTimestamp);
  setIfFieldHasValue(fields, collectFieldTypeMap, "封面文案", normalizedOriginalCoverText);
  setIfFieldHasValue(fields, collectFieldTypeMap, "二创标题", result.rewrittenTitle);
  setIfFieldHasValue(fields, collectFieldTypeMap, "二创正文", result.rewrittenBody);
  setIfFieldHasValue(fields, collectFieldTypeMap, "二创标签", formatTagsForStorage(inheritedTags));
  setIfFieldHasValue(fields, collectFieldTypeMap, "二创封面文案", normalizedRewrittenCoverText);
  setIfFieldExists(fields, collectFieldTypeMap, "已二创", true);

  return fields;
}

export async function POST(req: NextRequest) {
  try {
    const {
      results,
      extractReplacePromptTemplate = "",
      extractReplacePromptMode,
      extractPromptIncludesOriginalAndRewritten = false,
    }: {
      results: RewriteResult[];
      extractReplacePromptTemplate?: string;
      extractReplacePromptMode?: PromptMode;
      extractPromptIncludesOriginalAndRewritten?: boolean;
    } = await req.json();

    if (!results || results.length === 0) {
      return NextResponse.json({ error: "没有可保存的内容" }, { status: 400 });
    }

    const { tableId, tableName, fields: rewriteFields } = await ensureRewriteTable();
    const persistResults = results;
    const rewriteTimestamp = Date.now();
    const collectFields = await getTableFields(TABLE_ID);
    const collectFieldTypeMap = new Map(
      collectFields.items.map((field) => [field.field_name, field.type])
    );
    const promptTemplate = extractReplacePromptTemplate || undefined;
    const promptMode = normalizePromptMode(extractReplacePromptMode);
    const originalCoverAttachmentTasks = new Map<string, Promise<UploadedAttachment | null>>();

    async function getOriginalCoverAttachment(result: RewriteResult) {
      const sourceRecordId = result.originalNote.recordId || result.recordId;
      if (!sourceRecordId || !result.originalNote.cover) return null;

      let task = originalCoverAttachmentTasks.get(sourceRecordId);
      if (!task) {
        task = (async () => {
          try {
            return await withRetry(
              () =>
                uploadImageAttachment(
                  result.originalNote.cover,
                  `original-cover-${sourceRecordId}`
                ),
              `上传原封面 ${sourceRecordId}`
            );
          } catch (error) {
            console.warn(
              `原封面上传失败，已跳过 ${sourceRecordId}: ${getErrorMessage(error)}`
            );
            return null;
          }
        })();
        originalCoverAttachmentTasks.set(sourceRecordId, task);
      }

      return task;
    }

    async function uploadDraftCoverAttachment(result: RewriteResult) {
      if (!result.rewrittenCover) return null;

      return withRetry(async () => {
        const payload = await buildImageUploadPayload(
          result.rewrittenCover,
          `rewrite-cover-${result.id}`
        );
        if (!payload) return null;
        return uploadAttachmentToBitable(payload);
      }, `上传二创封面 ${result.id}`);
    }

    async function persistSingleResult(result: RewriteResult): Promise<PersistedResultItem> {
      const [extractedByScope, originalCoverAttachment, draftCoverAttachment] =
        await Promise.all([
          extractReplaceInfoByScope(
            result,
            promptTemplate,
            promptMode,
            extractPromptIncludesOriginalAndRewritten
          ),
          getOriginalCoverAttachment(result),
          uploadDraftCoverAttachment(result),
        ]);

      const rewriteRecord = {
        fields: buildRewriteTableFields({
          result,
          rewriteFields,
          rewriteTimestamp,
          originalCoverAttachment: originalCoverAttachment || undefined,
          draftCoverAttachment: draftCoverAttachment || undefined,
        }),
      };

      await withRetry(
        () => createRecordsInTable(tableId, [rewriteRecord]),
        `写入二创库 ${result.id}`
      );

      const sourceRecordId = result.originalNote.recordId || result.recordId;
      const collectFields = buildCollectUpdateFields(
        result,
        collectFieldTypeMap,
        rewriteTimestamp
      );

      return {
        result,
        extractedByScope,
        collectUpdate:
          sourceRecordId && Object.keys(collectFields).length > 0
            ? {
                record_id: sourceRecordId,
                fields: collectFields,
              }
            : undefined,
      };
    }

    const settledResults = await mapWithConcurrency(
      persistResults,
      SAVE_DRAFT_CONCURRENCY,
      persistSingleResult
    );
    const persistedItems: PersistedResultItem[] = [];
    const failedResults: FailedResultItem[] = [];

    settledResults.forEach((item, index) => {
      const result = persistResults[index];
      if (item.status === "fulfilled") {
        persistedItems.push(item.value);
        return;
      }

      failedResults.push({
        resultId: result.id,
        recordId: result.recordId,
        title: result.rewrittenTitle || result.originalNote.originalTitle || result.id,
        error: getErrorMessage(item.reason),
      });
    });

    const collectUpdateMap = new Map<string, CollectRecordUpdate>();
    persistedItems.forEach((item) => {
      if (!item.collectUpdate) return;
      collectUpdateMap.set(item.collectUpdate.record_id, item.collectUpdate);
    });

    let collectUpdateWarning = "";
    const collectUpdates = Array.from(collectUpdateMap.values());
    if (collectUpdates.length > 0) {
      try {
        await withRetry(
          () => updateCollectRecords(collectUpdates),
          "同步爆款库二创快照"
        );
      } catch (error) {
        collectUpdateWarning = getErrorMessage(error);
        console.error("Update collect records warning:", error);
      }
    }

    const newlyExtractedByScope = {
      title: persistedItems
        .map((item) => item.extractedByScope.title.trim())
        .filter((item) => item && item !== "暂无"),
      body: persistedItems
        .map((item) => item.extractedByScope.body.trim())
        .filter((item) => item && item !== "暂无"),
      cover: persistedItems
        .map((item) => item.extractedByScope.cover.trim())
        .filter((item) => item && item !== "暂无"),
    };

    return NextResponse.json({
      success: persistedItems.length > 0,
      count: persistResults.length,
      createdCount: persistedItems.length,
      failedCount: failedResults.length,
      persistedResultIds: persistedItems.map((item) => item.result.id),
      failedResults,
      tableId,
      tableName,
      newlyExtractedByScope,
      collectUpdateWarning,
    });
  } catch (e: unknown) {
    console.error("Save draft error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "保存失败" },
      { status: 500 }
    );
  }
}
