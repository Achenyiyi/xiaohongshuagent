"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles,
  Save,
  Upload,
  Square,
  Play,
  ChevronDown,
  ChevronUp,
  Check,
  Edit3,
  RotateCcw,
  X,
  Plus,
  Trash2,
  BookOpen,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import clsx from "clsx";
import { useAppStore } from "@/store/appStore";
import { composeCoverImage } from "@/lib/coverComposer";
import {
  COVER_TEMPLATE_FAMILIES,
  getNextCoverTemplateVariant,
  isTemplateVariantSource,
  resolveCoverTemplateSelection,
} from "@/lib/coverTemplates";
import {
  parseExtractedReplaceEntries,
  useRewriteSettingsStore,
  type ReplaceEntryDraft,
  type ReplaceLibraryScope,
} from "@/store/rewriteSettingsStore";
import { usePromptsSettingsStore } from "@/store/promptsSettingsStore";
import { dedupeTags, extractTagsFromText, sanitizeTitle } from "@/lib/xhs";
import type { RewriteEditBaseline, RewriteResult } from "@/types";
import Image from "next/image";

type RetryableRewriteField = "coverText" | "title" | "body";

type ExtractedReplaceInfoByScope = Record<ReplaceLibraryScope, string[]>;
type PendingExtractedEntriesByScope = Record<ReplaceLibraryScope, ReplaceEntryDraft[]>;

const RETRY_FIELD_LABELS: Record<RetryableRewriteField, string> = {
  coverText: "二创封面文案",
  title: "二创标题",
  body: "二创正文",
};

const LIBRARY_SCOPES: Array<{ scope: ReplaceLibraryScope; label: string; desc: string }> = [
  { scope: "title", label: "标题词库", desc: "只作用在标题生成" },
  { scope: "body", label: "正文词库", desc: "只作用在正文生成" },
  { scope: "cover", label: "封面文案词库", desc: "只作用在封面文案生成" },
];

const PUBLISH_PERSONA_OPTIONS = ["主播", "HR", "中立", "运营主管"] as const;

async function callRewriteApi(payload: Record<string, unknown> & { signal?: AbortSignal }) {
  const { signal, ...body } = payload;
  const res = await fetch("/api/ai/rewrite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error || "AI处理失败");
  }
  return data as { result?: string };
}

async function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

function hasBlankLineParagraphs(value: string) {
  return /\n\s*\n/.test(value.replace(/\r\n/g, "\n"));
}

function normalizeRewrittenBody(value: string, originalBody = "") {
  const normalized = value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+\n/g, "\n\n")
    .trim();

  if (!normalized) return "";

  if (hasBlankLineParagraphs(originalBody)) {
    return normalized.replace(/\n{3,}/g, "\n\n");
  }

  return normalized.replace(/\n\s*\n+/g, "\n");
}

function normalizeSavedCoverText(value: string | undefined) {
  return (value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function resolveResultCoverTemplateState(
  result: Pick<
    RewriteResult,
    "id" | "coverTemplateFamilyId" | "coverTemplateVariantId" | "coverBaseImage"
  >
) {
  return resolveCoverTemplateSelection({
    familyId: result.coverTemplateFamilyId,
    variantId: result.coverTemplateVariantId,
    baseImage: result.coverBaseImage,
    seed: result.id,
  });
}

async function buildRenderedCoverPayload(args: {
  result: Pick<
    RewriteResult,
    "id" | "coverTemplateFamilyId" | "coverTemplateVariantId" | "coverBaseImage"
  >;
  coverText: string;
  overrides?: Partial<
    Pick<RewriteResult, "coverTemplateFamilyId" | "coverTemplateVariantId" | "coverBaseImage">
  >;
}) {
  const resolvedTemplate = resolveCoverTemplateSelection({
    familyId: args.overrides?.coverTemplateFamilyId ?? args.result.coverTemplateFamilyId,
    variantId: args.overrides?.coverTemplateVariantId ?? args.result.coverTemplateVariantId,
    baseImage: args.overrides?.coverBaseImage ?? args.result.coverBaseImage,
    seed: args.result.id,
  });
  const normalizedText = normalizeSavedCoverText(args.coverText);
  const rewrittenCover = await composeCoverImage({
    text: normalizedText,
    familyId: resolvedTemplate.family.id,
    baseImageSrc: resolvedTemplate.baseImage,
  });

  return {
    coverTemplateFamilyId: resolvedTemplate.family.id,
    coverTemplateVariantId: resolvedTemplate.variant.id,
    coverBaseImage: resolvedTemplate.baseImage,
    rewrittenCover,
  };
}

function buildDisplayTags(result: RewriteResult): string[] {
  return dedupeTags(
    result.rewrittenTags.length > 0
      ? result.rewrittenTags
      : (result.originalNote.originalTags || [])
  );
}

function buildOriginalTags(result: RewriteResult): string[] {
  return dedupeTags(result.originalNote.originalTags || []);
}

function getCurrentIsoTimestamp() {
  return new Date().toISOString();
}

function parseLooseTimestamp(value?: string | null) {
  if (!value) return null;

  const normalized = value.trim().replace(/\//g, "-");
  if (!normalized) return null;

  const withTimeSeparator = normalized.includes("T")
    ? normalized
    : normalized.replace(" ", "T");
  const withSeconds = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(withTimeSeparator)
    ? `${withTimeSeparator}:00`
    : withTimeSeparator;
  const parsed = new Date(withSeconds);

  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatTwoDigits(value: number) {
  return value.toString().padStart(2, "0");
}

function pickMostRecentTimestamp(...values: Array<string | null | undefined>) {
  let latestRaw = "";
  let latestTime = 0;

  values.forEach((value) => {
    const parsed = parseLooseTimestamp(value);
    if (!parsed) return;

    const timestamp = parsed.getTime();
    if (timestamp >= latestTime) {
      latestTime = timestamp;
      latestRaw = value || "";
    }
  });

  return latestRaw;
}

function formatRewriteModifiedTime(value?: string | null) {
  const parsed = parseLooseTimestamp(value);
  if (!parsed) return "";

  const now = new Date();
  const sameYear = now.getFullYear() === parsed.getFullYear();
  const dateLabel = sameYear
    ? `${formatTwoDigits(parsed.getMonth() + 1)}-${formatTwoDigits(parsed.getDate())}`
    : `${parsed.getFullYear()}-${formatTwoDigits(parsed.getMonth() + 1)}-${formatTwoDigits(parsed.getDate())}`;

  return `最近修改 ${dateLabel} ${formatTwoDigits(parsed.getHours())}:${formatTwoDigits(parsed.getMinutes())}`;
}

function parseTagDraft(input: string): string[] {
  const extracted = extractTagsFromText(input);
  if (extracted.length > 0) return extracted;
  return dedupeTags(input.split(/[\s、，,\n]+/));
}

function formatTagDraft(tags: string[]): string {
  return dedupeTags(tags).join("");
}

function buildReplaceEntryKey(entry: { original: string; replacement: string }) {
  return `${entry.original.trim()}→${entry.replacement.trim()}`;
}

function createEmptyPendingExtractedEntries(): PendingExtractedEntriesByScope {
  return {
    title: [],
    body: [],
    cover: [],
  };
}

function collectUniqueExtractedEntries(
  rawList: string[],
  excludedEntries: Array<{ original: string; replacement: string }>
) {
  const existingKeys = new Set(excludedEntries.map(buildReplaceEntryKey));
  const collected: ReplaceEntryDraft[] = [];

  for (const raw of rawList) {
    for (const entry of parseExtractedReplaceEntries(raw)) {
      const key = buildReplaceEntryKey(entry);
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      collected.push(entry);
    }
  }

  return collected;
}

function normalizeExtractedByScope(value: unknown): ExtractedReplaceInfoByScope {
  const fallback: ExtractedReplaceInfoByScope = {
    title: [],
    body: [],
    cover: [],
  };

  if (!value || typeof value !== "object") return fallback;

  const source = value as Partial<Record<ReplaceLibraryScope, unknown>>;
  return {
    title: Array.isArray(source.title)
      ? source.title.filter((item): item is string => typeof item === "string")
      : [],
    body: Array.isArray(source.body)
      ? source.body.filter((item): item is string => typeof item === "string")
      : [],
    cover: Array.isArray(source.cover)
      ? source.cover.filter((item): item is string => typeof item === "string")
      : [],
  };
}

function countPendingExtractedEntries(entriesByScope: PendingExtractedEntriesByScope) {
  return LIBRARY_SCOPES.reduce(
    (sum, item) => sum + entriesByScope[item.scope].length,
    0
  );
}

function buildEntryKeys(entries: Array<{ original: string; replacement: string }>) {
  return new Set(entries.map(buildReplaceEntryKey));
}

function removeScopedEntries(
  current: PendingExtractedEntriesByScope,
  entriesToRemove: PendingExtractedEntriesByScope
): PendingExtractedEntriesByScope {
  const titleKeys = buildEntryKeys(entriesToRemove.title);
  const bodyKeys = buildEntryKeys(entriesToRemove.body);
  const coverKeys = buildEntryKeys(entriesToRemove.cover);

  return {
    title: current.title.filter((entry) => !titleKeys.has(buildReplaceEntryKey(entry))),
    body: current.body.filter((entry) => !bodyKeys.has(buildReplaceEntryKey(entry))),
    cover: current.cover.filter((entry) => !coverKeys.has(buildReplaceEntryKey(entry))),
  };
}

function buildScopeCountLabel(entriesByScope: PendingExtractedEntriesByScope) {
  return LIBRARY_SCOPES
    .map((item) => {
      const count = entriesByScope[item.scope].length;
      if (count === 0) return "";
      return `${item.label}${count}条`;
    })
    .filter(Boolean)
    .join("，");
}

function stringifyReplaceEntries(entries: Array<{ original: string; replacement: string }>) {
  return entries
    .map((entry) => `${entry.original.trim()} → ${entry.replacement.trim()}`)
    .join("\n");
}

function normalizeSavedText(value: string | undefined) {
  return (value || "").replace(/\r\n/g, "\n").trim();
}

function normalizeSavedTags(tags: string[] | undefined) {
  return dedupeTags(tags || []);
}

function buildRewriteSaveFingerprint(
  value: Pick<
    RewriteResult,
    | "rewrittenTitle"
    | "rewrittenBody"
    | "rewrittenCover"
    | "rewrittenCoverText"
    | "rewrittenTags"
    | "publishPersona"
  >
) {
  return JSON.stringify({
    rewrittenTitle: normalizeSavedText(value.rewrittenTitle),
    rewrittenBody: normalizeSavedText(value.rewrittenBody),
    rewrittenCover: normalizeSavedText(value.rewrittenCover),
    rewrittenCoverText: normalizeSavedCoverText(value.rewrittenCoverText),
    rewrittenTags: normalizeSavedTags(value.rewrittenTags),
    publishPersona: normalizeSavedText(value.publishPersona),
  });
}

function buildSavedSnapshotFallbackFingerprint(note: RewriteResult["originalNote"]) {
  return JSON.stringify({
    rewrittenTitle: normalizeSavedText(note.rewriteTitle),
    rewrittenBody: normalizeSavedText(note.rewriteBody),
    rewrittenCoverText: normalizeSavedCoverText(note.rewriteCoverText),
    rewrittenTags: normalizeSavedTags(note.rewriteTags),
    publishPersona: normalizeSavedText(note.publishPersona),
  });
}

function buildCurrentResultFallbackFingerprint(result: RewriteResult) {
  return JSON.stringify({
    rewrittenTitle: normalizeSavedText(result.rewrittenTitle),
    rewrittenBody: normalizeSavedText(result.rewrittenBody),
    rewrittenCoverText: normalizeSavedCoverText(result.rewrittenCoverText),
    rewrittenTags: normalizeSavedTags(buildDisplayTags(result)),
    publishPersona: normalizeSavedText(result.publishPersona),
  });
}

function buildTrackedEditBaseline(value: RewriteEditBaseline): RewriteEditBaseline {
  return {
    rewrittenTitle: value.rewrittenTitle || "",
    rewrittenBody: value.rewrittenBody || "",
    rewrittenCover: value.rewrittenCover || "",
    rewrittenCoverText: value.rewrittenCoverText || "",
    rewrittenTags: [...(value.rewrittenTags || [])],
    publishPersona: value.publishPersona || "",
  };
}

function buildCurrentTrackedEditBaseline(
  result: RewriteResult,
  overrides: Partial<RewriteEditBaseline> = {}
): RewriteEditBaseline {
  return buildTrackedEditBaseline({
    rewrittenTitle: overrides.rewrittenTitle ?? result.rewrittenTitle,
    rewrittenBody: overrides.rewrittenBody ?? result.rewrittenBody,
    rewrittenCover: overrides.rewrittenCover ?? result.rewrittenCover,
    rewrittenCoverText: overrides.rewrittenCoverText ?? result.rewrittenCoverText,
    rewrittenTags: overrides.rewrittenTags ?? result.rewrittenTags,
    publishPersona: overrides.publishPersona ?? result.publishPersona,
  });
}

function mergeTrackedEditBaseline(
  result: RewriteResult,
  updates: Partial<RewriteEditBaseline>
): RewriteEditBaseline {
  return buildTrackedEditBaseline({
    ...buildCurrentTrackedEditBaseline(result),
    ...(result.editBaseline || {}),
    ...updates,
    rewrittenTags: updates.rewrittenTags ?? result.editBaseline?.rewrittenTags ?? result.rewrittenTags,
    publishPersona:
      updates.publishPersona ?? result.editBaseline?.publishPersona ?? result.publishPersona,
  });
}

const EDITED_CATEGORY_LABELS: Record<keyof RewriteEditBaseline, string> = {
  rewrittenCover: "二创封面已编辑",
  publishPersona: "发布人设已编辑",
  rewrittenTitle: "二创标题已编辑",
  rewrittenBody: "二创正文已编辑",
  rewrittenTags: "二创标签已编辑",
  rewrittenCoverText: "二创封面文案已编辑",
};

const EDITED_CATEGORY_ORDER: Array<keyof RewriteEditBaseline> = [
  "rewrittenCover",
  "publishPersona",
  "rewrittenTitle",
  "rewrittenBody",
  "rewrittenTags",
  "rewrittenCoverText",
];

function isTrackedEditValueEqual(
  left: RewriteEditBaseline[keyof RewriteEditBaseline],
  right: RewriteEditBaseline[keyof RewriteEditBaseline]
) {
  if (Array.isArray(left) && Array.isArray(right)) {
    return JSON.stringify(left) === JSON.stringify(right);
  }

  return left === right;
}

function getTrackedResultValue<K extends keyof RewriteEditBaseline>(
  result: RewriteResult,
  field: K
): RewriteEditBaseline[K] {
  if (field === "rewrittenTags") {
    return buildDisplayTags(result) as RewriteEditBaseline[K];
  }

  return result[field] as RewriteEditBaseline[K];
}

function buildNextFieldModifiedAt(
  result: RewriteResult,
  updates: Partial<RewriteResult>,
  timestamp: string,
  currentFieldModifiedAt = getEffectiveFieldModifiedAt(result)
) {
  const nextFieldModifiedAt = { ...(currentFieldModifiedAt || {}) };
  let touched = false;

  EDITED_CATEGORY_ORDER.forEach((field) => {
    if (!(field in updates)) return;

    const nextValue = updates[field];
    if (typeof nextValue === "undefined") return;

    touched = true;

    const currentValue = getTrackedResultValue(result, field);
    if (isTrackedEditValueEqual(nextValue, currentValue)) {
      return;
    }

    const baselineValue = result.editBaseline?.[field] ?? currentValue;
    if (isTrackedEditValueEqual(nextValue, baselineValue)) {
      delete nextFieldModifiedAt[field];
      return;
    }

    nextFieldModifiedAt[field] = timestamp;
  });

  if (!touched) return result.fieldModifiedAt;
  return Object.keys(nextFieldModifiedAt).length > 0 ? nextFieldModifiedAt : undefined;
}

function omitFieldModifiedAt(
  result: RewriteResult,
  fields: Array<keyof RewriteEditBaseline>,
  currentFieldModifiedAt = getEffectiveFieldModifiedAt(result)
) {
  if (!currentFieldModifiedAt) return undefined;

  const nextFieldModifiedAt = { ...currentFieldModifiedAt };
  fields.forEach((field) => {
    delete nextFieldModifiedAt[field];
  });

  return Object.keys(nextFieldModifiedAt).length > 0 ? nextFieldModifiedAt : undefined;
}

function getEffectiveFieldModifiedAt(result: RewriteResult) {
  if (result.fieldModifiedAt) return result.fieldModifiedAt;
  if (!result.lastModifiedAt || !result.editBaseline) return undefined;

  const effectiveFieldModifiedAt: Partial<Record<keyof RewriteEditBaseline, string>> = {};
  EDITED_CATEGORY_ORDER.forEach((field) => {
    const currentValue = getTrackedResultValue(result, field);
    const baselineValue = result.editBaseline?.[field] ?? currentValue;

    if (!isTrackedEditValueEqual(currentValue, baselineValue)) {
      effectiveFieldModifiedAt[field] = result.lastModifiedAt!;
    }
  });

  return Object.keys(effectiveFieldModifiedAt).length > 0 ? effectiveFieldModifiedAt : undefined;
}

function getEditedRewriteCategories(
  result: RewriteResult,
  overrides: Partial<RewriteEditBaseline> = {}
) {
  if (!result.editBaseline) return [];

  const current = buildCurrentTrackedEditBaseline(result, overrides);
  const baseline = buildTrackedEditBaseline(result.editBaseline);

  return EDITED_CATEGORY_ORDER.filter((key) => {
    const currentValue = current[key];
    const baselineValue = baseline[key];

    return !isTrackedEditValueEqual(currentValue, baselineValue);
  }).map((key) => EDITED_CATEGORY_LABELS[key]);
}

function isAbortError(error: unknown) {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function isRewriteResultSaved(result: RewriteResult, note: RewriteResult["originalNote"]) {
  if (result.status !== "done") return false;

  const currentFingerprint = buildRewriteSaveFingerprint({
    rewrittenTitle: result.rewrittenTitle,
    rewrittenBody: result.rewrittenBody,
    rewrittenCover: result.rewrittenCover,
    rewrittenCoverText: result.rewrittenCoverText,
    rewrittenTags: buildDisplayTags(result),
    publishPersona: result.publishPersona,
  });

  if (result.savedFingerprint) {
    return result.savedFingerprint === currentFingerprint;
  }

  if (!note.hasRewritten) return false;
  return buildCurrentResultFallbackFingerprint(result) === buildSavedSnapshotFallbackFingerprint(note);
}

function getLiveOriginalNote(
  result: RewriteResult,
  collectRecordMap: Map<string, RewriteResult["originalNote"]>
) {
  const liveRecord = collectRecordMap.get(result.recordId);
  if (!liveRecord) return result.originalNote;

  return {
    ...result.originalNote,
    hasRewritten: liveRecord.hasRewritten ?? result.originalNote.hasRewritten,
    rewriteDate: liveRecord.rewriteDate || result.originalNote.rewriteDate,
    publishPersona: liveRecord.publishPersona || result.originalNote.publishPersona,
  };
}

export default function RewriteModule() {
  const {
    rewriteResults,
    updateRewriteResult,
    deleteRewriteResults,
    selectedRewriteIds,
    toggleRewriteSelect,
    selectAllRewriteIds,
    deselectRewriteIds,
    clearRewriteSelection,
    addDraftRecord,
    collectRecords,
    setCollectRecords,
  } = useAppStore();

  const {
    replaceLibraryEnabled,
    setReplaceLibraryEnabled,
    autoMergeExtractedEntries,
    setAutoMergeExtractedEntries,
    replaceEntriesByScope,
    resetToPresets,
    addReplaceEntry,
    updateReplaceEntry,
    removeReplaceEntry,
    buildReplaceInfoString,
    mergeExtractedEntries,
  } = useRewriteSettingsStore();

  const {
    buildBodyPrompt,
    buildTitlePrompt,
    buildCoverPrompt,
    extractReplacePrompt,
    getBodyPromptMode,
    getTitlePromptMode,
    getCoverPromptMode,
    getExtractPromptMode,
    bodyPromptHasInlineReplaceInfo,
    titlePromptHasInlineReplaceInfo,
    coverPromptHasInlineReplaceInfo,
    extractPromptHasInlineOriginalAndRewritten,
  } = usePromptsSettingsStore();

  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [bulkExpanded, setBulkExpanded] = useState(true);
  const [bulkExpandVersion, setBulkExpandVersion] = useState(0);
  const [pendingExtractedEntries, setPendingExtractedEntries] = useState<PendingExtractedEntriesByScope>(
    createEmptyPendingExtractedEntries
  );
  const rewriteAbortControllersRef = useRef(new Map<string, AbortController>());

  const collectRecordMap = useMemo(
    () =>
      new Map(
        collectRecords
          .filter((record) => record.recordId)
          .map((record) => [record.recordId!, record] as const)
      ),
    [collectRecords]
  );

  const existingEntriesByScope = useMemo(
    () => ({
      title: replaceEntriesByScope.title.map((entry) => ({
        original: entry.original,
        replacement: entry.replacement,
      })),
      body: replaceEntriesByScope.body.map((entry) => ({
        original: entry.original,
        replacement: entry.replacement,
      })),
      cover: replaceEntriesByScope.cover.map((entry) => ({
        original: entry.original,
        replacement: entry.replacement,
      })),
    }),
    [replaceEntriesByScope]
  );

  const buildRewritePromptPayload = useCallback(
    (field: RetryableRewriteField, replaceInfo: string) => {
      if (field === "title") {
        return {
          systemPrompt: buildTitlePrompt(replaceInfo),
          promptMode: getTitlePromptMode(),
          promptIncludesReplaceInfo: titlePromptHasInlineReplaceInfo(),
        };
      }

      if (field === "body") {
        return {
          systemPrompt: buildBodyPrompt(replaceInfo),
          promptMode: getBodyPromptMode(),
          promptIncludesReplaceInfo: bodyPromptHasInlineReplaceInfo(),
        };
      }

      return {
        systemPrompt: buildCoverPrompt(replaceInfo),
        promptMode: getCoverPromptMode(),
        promptIncludesReplaceInfo: coverPromptHasInlineReplaceInfo(),
      };
    },
    [
      bodyPromptHasInlineReplaceInfo,
      buildBodyPrompt,
      buildCoverPrompt,
      buildTitlePrompt,
      coverPromptHasInlineReplaceInfo,
      getBodyPromptMode,
      getCoverPromptMode,
      getTitlePromptMode,
      titlePromptHasInlineReplaceInfo,
    ]
  );

  const stopRewrite = useCallback(
    (resultId: string) => {
      const controller = rewriteAbortControllersRef.current.get(resultId);
      if (controller) {
        controller.abort();
        rewriteAbortControllersRef.current.delete(resultId);
      }

      updateRewriteResult(resultId, {
        status: "stopped",
        errorMsg: undefined,
      });
    },
    [updateRewriteResult]
  );

  const toggleRewriteProcessing = useCallback(
    (resultId: string) => {
      const current = useAppStore.getState().rewriteResults.find((item) => item.id === resultId);
      if (!current) return;

      if (current.status === "processing") {
        stopRewrite(resultId);
        return;
      }

      if (current.status === "stopped") {
        updateRewriteResult(resultId, {
          status: "pending",
          errorMsg: undefined,
        });
      }
    },
    [stopRewrite, updateRewriteResult]
  );

  const ensureOriginalCoverText = useCallback(
    async (note: RewriteResult["originalNote"], signal?: AbortSignal) => {
      if (note.cover && !note.coverText) {
        const res = await callRewriteApi({
          type: "extract-image-text",
          imageUrl: note.cover,
          signal,
        });
        return res.result || "";
      }
      return note.coverText || "";
    },
    []
  );

  const retryRewriteField = useCallback(
    async (resultId: string, field: RetryableRewriteField) => {
      const current = useAppStore.getState().rewriteResults.find((item) => item.id === resultId);
      if (!current) return;

      const note = current.originalNote;

      try {
        if (field === "title") {
          const titleReplaceInfo = replaceLibraryEnabled ? buildReplaceInfoString("title") : "";
          const titlePromptPayload = buildRewritePromptPayload("title", titleReplaceInfo);
          const titleRes = await callRewriteApi({
            type: "title",
            content: sanitizeTitle(note.originalTitle || "") || note.originalBody || "",
            replaceInfo: titleReplaceInfo,
            ...titlePromptPayload,
          });

          updateRewriteResult(resultId, {
            rewrittenTitle: titleRes.result || "",
            titleReplaceInfo,
            editBaseline: mergeTrackedEditBaseline(current, {
              rewrittenTitle: titleRes.result || "",
            }),
            fieldModifiedAt: omitFieldModifiedAt(current, ["rewrittenTitle"]),
            lastModifiedAt: getCurrentIsoTimestamp(),
            errorMsg: undefined,
          });
          return;
        }

        if (field === "body") {
          const bodyReplaceInfo = replaceLibraryEnabled ? buildReplaceInfoString("body") : "";
          const bodyPromptPayload = buildRewritePromptPayload("body", bodyReplaceInfo);
          const bodyRes = await callRewriteApi({
            type: "body",
            content: note.originalBody || "",
            replaceInfo: bodyReplaceInfo,
            ...bodyPromptPayload,
          });

          updateRewriteResult(resultId, {
            rewrittenBody: normalizeRewrittenBody(bodyRes.result || "", note.originalBody || ""),
            bodyReplaceInfo,
            editBaseline: mergeTrackedEditBaseline(current, {
              rewrittenBody: normalizeRewrittenBody(bodyRes.result || "", note.originalBody || ""),
            }),
            fieldModifiedAt: omitFieldModifiedAt(current, ["rewrittenBody"]),
            lastModifiedAt: getCurrentIsoTimestamp(),
            errorMsg: undefined,
          });
          return;
        }

        const coverReplaceInfo = replaceLibraryEnabled ? buildReplaceInfoString("cover") : "";
        const originalCoverText = await ensureOriginalCoverText(note);
        const coverPromptPayload = buildRewritePromptPayload("coverText", coverReplaceInfo);
        const coverTextRes = await callRewriteApi({
          type: "cover-text",
          originalTitle: note.originalTitle || "",
          originalBody: note.originalBody || "",
          originalCoverText,
          rewrittenTitle: current.rewrittenTitle,
          rewrittenBody: current.rewrittenBody,
          replaceInfo: coverReplaceInfo,
          ...coverPromptPayload,
        });

        const rewrittenCoverText = normalizeSavedCoverText(coverTextRes.result || "");
        const coverPayload = await buildRenderedCoverPayload({
          result: current,
          coverText: rewrittenCoverText,
        });

        updateRewriteResult(resultId, {
          originalNote: {
            ...note,
            coverText: originalCoverText,
          },
          rewrittenCoverText,
          ...coverPayload,
          coverReplaceInfo,
          editBaseline: mergeTrackedEditBaseline(current, {
            rewrittenCoverText,
            rewrittenCover: coverPayload.rewrittenCover,
          }),
          fieldModifiedAt: omitFieldModifiedAt(current, ["rewrittenCoverText", "rewrittenCover"]),
          lastModifiedAt: getCurrentIsoTimestamp(),
          errorMsg: undefined,
        });
      } catch (e: unknown) {
        const message =
          e instanceof Error
            ? `${RETRY_FIELD_LABELS[field]}重试失败：${e.message}`
            : `${RETRY_FIELD_LABELS[field]}重试失败`;
        setSaveMsg(message);
        window.setTimeout(() => {
          setSaveMsg((currentMsg) => (currentMsg === message ? "" : currentMsg));
        }, 3000);
        throw e;
      }
    },
    [
      buildRewritePromptPayload,
      buildReplaceInfoString,
      ensureOriginalCoverText,
      replaceLibraryEnabled,
      updateRewriteResult,
    ]
  );

  const startRewrite = useCallback(
    async (resultId: string) => {
      const result = useAppStore.getState().rewriteResults.find((item) => item.id === resultId);
      if (!result || !["pending", "error", "stopped"].includes(result.status)) return;

      const existingController = rewriteAbortControllersRef.current.get(resultId);
      if (existingController) {
        existingController.abort();
      }

      const controller = new AbortController();
      rewriteAbortControllersRef.current.set(resultId, controller);
      const initialCoverState = resolveResultCoverTemplateState(result);

      updateRewriteResult(resultId, {
        status: "processing",
        errorMsg: undefined,
        rewrittenTitle: "",
        rewrittenBody: "",
        rewrittenCoverText: "",
        rewrittenCover: initialCoverState.baseImage,
        coverTemplateFamilyId: initialCoverState.family.id,
        coverTemplateVariantId: initialCoverState.variant.id,
        coverBaseImage: initialCoverState.baseImage,
      });

      try {
        const note = result.originalNote;
        const titleReplaceInfo = replaceLibraryEnabled ? buildReplaceInfoString("title") : "";
        const bodyReplaceInfo = replaceLibraryEnabled ? buildReplaceInfoString("body") : "";
        const coverReplaceInfo = replaceLibraryEnabled ? buildReplaceInfoString("cover") : "";

        const isCurrentRunActive = () =>
          !controller.signal.aborted &&
          rewriteAbortControllersRef.current.get(resultId) === controller;

        const originalCoverTextPromise = ensureOriginalCoverText(note, controller.signal).then(
          (originalCoverText) => {
            if (isCurrentRunActive() && originalCoverText && originalCoverText !== note.coverText) {
              updateRewriteResult(resultId, {
                originalNote: {
                  ...note,
                  coverText: originalCoverText,
                },
              });
            }
            return originalCoverText;
          }
        );
        const titlePromptPayload = buildRewritePromptPayload("title", titleReplaceInfo);
        const bodyPromptPayload = buildRewritePromptPayload("body", bodyReplaceInfo);

        const titlePromise = callRewriteApi({
          type: "title",
          content: sanitizeTitle(note.originalTitle || "") || note.originalBody || "",
          replaceInfo: titleReplaceInfo,
          signal: controller.signal,
          ...titlePromptPayload,
        }).then((titleRes) => {
          const rewrittenTitle = titleRes.result || "";
          if (isCurrentRunActive()) {
            updateRewriteResult(resultId, {
              rewrittenTitle,
              titleReplaceInfo,
            });
          }
          return rewrittenTitle;
        });

        const bodyPromise = callRewriteApi({
          type: "body",
          content: note.originalBody || "",
          replaceInfo: bodyReplaceInfo,
          signal: controller.signal,
          ...bodyPromptPayload,
        }).then((bodyRes) => {
          const rewrittenBody = normalizeRewrittenBody(bodyRes.result || "", note.originalBody || "");
          if (isCurrentRunActive()) {
            updateRewriteResult(resultId, {
              rewrittenBody,
              bodyReplaceInfo,
            });
          }
          return rewrittenBody;
        });

        const [rewrittenTitle, rewrittenBody, originalCoverText] = await Promise.all([
          titlePromise,
          bodyPromise,
          originalCoverTextPromise,
        ]);

        if (!isCurrentRunActive()) {
          return;
        }

        const coverPromptPayload = buildRewritePromptPayload("coverText", coverReplaceInfo);
        const rewrittenCoverTextRes = await callRewriteApi({
          type: "cover-text",
          originalTitle: note.originalTitle || "",
          originalBody: note.originalBody || "",
          originalCoverText,
          rewrittenTitle,
          rewrittenBody,
          replaceInfo: coverReplaceInfo,
          signal: controller.signal,
          ...coverPromptPayload,
        });

        if (!isCurrentRunActive()) {
          return;
        }

        const rewrittenCoverText = normalizeSavedCoverText(rewrittenCoverTextRes.result || "");
        updateRewriteResult(resultId, {
          originalNote: {
            ...note,
            coverText: originalCoverText,
          },
          rewrittenCoverText,
          coverReplaceInfo,
        });

        if (!isCurrentRunActive()) {
          return;
        }

        const coverPayload = await buildRenderedCoverPayload({
          result,
          coverText: rewrittenCoverText,
        });

        if (!isCurrentRunActive()) {
          return;
        }

        const rewrittenCover = coverPayload.rewrittenCover;
        const nextEditBaseline = buildTrackedEditBaseline({
          rewrittenTitle,
          rewrittenBody,
          rewrittenCover,
          rewrittenCoverText,
          rewrittenTags: result.rewrittenTags,
          publishPersona: result.publishPersona,
        });

        updateRewriteResult(resultId, {
          status: "done",
          errorMsg: undefined,
          originalNote: {
            ...note,
            coverText: originalCoverText,
          },
          rewrittenTitle,
          rewrittenBody,
          rewrittenCover,
          rewrittenCoverText,
          coverTemplateFamilyId: coverPayload.coverTemplateFamilyId,
          coverTemplateVariantId: coverPayload.coverTemplateVariantId,
          coverBaseImage: coverPayload.coverBaseImage,
          titleReplaceInfo,
          bodyReplaceInfo,
          coverReplaceInfo,
          editBaseline: nextEditBaseline,
          fieldModifiedAt: undefined,
          lastModifiedAt: getCurrentIsoTimestamp(),
        });
      } catch (e: unknown) {
        if (controller.signal.aborted || isAbortError(e)) {
          return;
        }

        if (rewriteAbortControllersRef.current.get(resultId) !== controller) {
          return;
        }

        updateRewriteResult(resultId, {
          status: "error",
          errorMsg: e instanceof Error ? e.message : "二创失败",
        });
      } finally {
        if (rewriteAbortControllersRef.current.get(resultId) === controller) {
          rewriteAbortControllersRef.current.delete(resultId);
        }
      }
    },
    [
      buildRewritePromptPayload,
      buildReplaceInfoString,
      ensureOriginalCoverText,
      replaceLibraryEnabled,
      updateRewriteResult,
    ]
  );

  useEffect(() => {
    const abortControllers = rewriteAbortControllersRef.current;
    return () => {
      abortControllers.forEach((controller) => controller.abort());
      abortControllers.clear();
    };
  }, []);

  useEffect(() => {
    const pendingIds = rewriteResults
      .filter((item) => item.status === "pending")
      .map((item) => item.id);

    pendingIds.forEach((id) => {
      startRewrite(id);
    });
  }, [rewriteResults, startRewrite]);

  async function handleSaveToDraft() {
    const selected = rewriteResults.filter(
      (result) => selectedRewriteIds.has(result.id) && result.status === "done"
    );
    if (selected.length === 0) return;

    setSaving(true);
    setSaveMsg("");

    try {
      const res = await fetch("/api/feishu/save-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          results: selected,
          extractReplacePromptTemplate: extractReplacePrompt,
          extractReplacePromptMode: getExtractPromptMode(),
          extractPromptIncludesOriginalAndRewritten:
            extractPromptHasInlineOriginalAndRewritten(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");

      const persistedIds = new Set(
        Array.isArray(data.persistedResultIds)
          ? (data.persistedResultIds as unknown[]).filter(
              (item): item is string => typeof item === "string"
            )
          : []
      );
      const failedResults = Array.isArray(data.failedResults)
        ? (data.failedResults as Array<{ resultId?: unknown; error?: unknown }>).map((item) => ({
            resultId: typeof item?.resultId === "string" ? item.resultId : "",
            error: typeof item?.error === "string" ? item.error : "保存失败",
          }))
        : [];
      const persistedResults = selected.filter((item) => persistedIds.has(item.id));
      const persistedCount = persistedResults.length;
      const failedCount = failedResults.length;

      const extractedByScope = normalizeExtractedByScope(data.newlyExtractedByScope);
      const autoMergedEntriesByScope: PendingExtractedEntriesByScope = autoMergeExtractedEntries
        ? {
            title: collectUniqueExtractedEntries(extractedByScope.title, existingEntriesByScope.title),
            body: collectUniqueExtractedEntries(extractedByScope.body, existingEntriesByScope.body),
            cover: collectUniqueExtractedEntries(extractedByScope.cover, existingEntriesByScope.cover),
          }
        : createEmptyPendingExtractedEntries();
      const pendingCandidatesByScope: PendingExtractedEntriesByScope = autoMergeExtractedEntries
        ? createEmptyPendingExtractedEntries()
        : {
            title: collectUniqueExtractedEntries(
              extractedByScope.title,
              [...existingEntriesByScope.title, ...pendingExtractedEntries.title]
            ),
            body: collectUniqueExtractedEntries(
              extractedByScope.body,
              [...existingEntriesByScope.body, ...pendingExtractedEntries.body]
            ),
            cover: collectUniqueExtractedEntries(
              extractedByScope.cover,
              [...existingEntriesByScope.cover, ...pendingExtractedEntries.cover]
            ),
          };
      const autoMergedCount = countPendingExtractedEntries(autoMergedEntriesByScope);
      const pendingCount = countPendingExtractedEntries(pendingCandidatesByScope);

      if (autoMergedCount > 0) {
        LIBRARY_SCOPES.forEach((item) => {
          const scopeEntries = autoMergedEntriesByScope[item.scope];
          if (scopeEntries.length === 0) return;
          mergeExtractedEntries(item.scope, stringifyReplaceEntries(scopeEntries));
        });
        setPendingExtractedEntries((prev) => removeScopedEntries(prev, autoMergedEntriesByScope));
      }

      if (pendingCount > 0) {
        setPendingExtractedEntries((prev) => ({
          title: [...prev.title, ...pendingCandidatesByScope.title],
          body: [...prev.body, ...pendingCandidatesByScope.body],
          cover: [...prev.cover, ...pendingCandidatesByScope.cover],
        }));
      }

      if (persistedResults.length > 0) {
        const rewriteDate = new Date().toISOString().slice(0, 16).replace("T", " ");
        persistedResults.forEach((result) => {
          updateRewriteResult(result.id, {
            savedFingerprint: buildRewriteSaveFingerprint({
              rewrittenTitle: result.rewrittenTitle,
              rewrittenBody: result.rewrittenBody,
              rewrittenCover: result.rewrittenCover,
              rewrittenCoverText: result.rewrittenCoverText,
              rewrittenTags: buildDisplayTags(result),
              publishPersona: result.publishPersona,
            }),
            originalNote: {
              ...result.originalNote,
              hasRewritten: true,
              rewriteTitle: result.rewrittenTitle,
              rewriteBody: result.rewrittenBody,
              rewriteCover: result.rewrittenCover,
              rewriteCoverText: result.rewrittenCoverText,
              rewriteTags: buildDisplayTags(result),
              rewriteTitleReplaceInfo: result.titleReplaceInfo,
              rewriteBodyReplaceInfo: result.bodyReplaceInfo,
              rewriteCoverReplaceInfo: result.coverReplaceInfo,
              rewriteDate,
              publishPersona: result.publishPersona,
            },
          });
        });

        addDraftRecord({
          id: Date.now().toString(),
          savedAt: new Date().toISOString(),
          rewriteResults: persistedResults,
          feishuTableId: data.tableId,
          feishuTableName: data.tableName,
          targetLabel: data.tableName || "二创库",
        });

        deselectRewriteIds(Array.from(persistedIds));

        try {
          const recordsRes = await fetch("/api/feishu/records");
          const recordsData = await recordsRes.json();
          if (recordsRes.ok) {
            const nextRecords = (recordsData.records || []) as Array<
              RewriteResult["originalNote"]
            >;
            setCollectRecords(nextRecords);

            const nextRecordMap = new Map(
              nextRecords
                .filter((record) => record.recordId)
                .map((record) => [record.recordId!, record] as const)
            );

            persistedResults.forEach((result) => {
              const liveRecord = nextRecordMap.get(result.recordId);
              if (!liveRecord) return;

              updateRewriteResult(result.id, {
                originalNote: {
                  ...result.originalNote,
                  hasRewritten: liveRecord.hasRewritten ?? true,
                  rewriteTitle: liveRecord.rewriteTitle || result.rewrittenTitle,
                  rewriteBody: liveRecord.rewriteBody || result.rewrittenBody,
                  rewriteCover: liveRecord.rewriteCover || result.rewrittenCover,
                  rewriteCoverText:
                    liveRecord.rewriteCoverText || result.rewrittenCoverText,
                  rewriteTags: liveRecord.rewriteTags || buildDisplayTags(result),
                  rewriteTitleReplaceInfo:
                    liveRecord.rewriteTitleReplaceInfo || result.titleReplaceInfo,
                  rewriteBodyReplaceInfo:
                    liveRecord.rewriteBodyReplaceInfo || result.bodyReplaceInfo,
                  rewriteCoverReplaceInfo:
                    liveRecord.rewriteCoverReplaceInfo || result.coverReplaceInfo,
                  rewriteDate: liveRecord.rewriteDate || rewriteDate,
                  publishPersona: liveRecord.publishPersona || result.publishPersona,
                },
              });
            });
          }
        } catch (refreshError) {
          console.error("Refresh feishu records failed:", refreshError);
        }
      }

      const collectUpdateWarning =
        typeof data.collectUpdateWarning === "string" ? data.collectUpdateWarning.trim() : "";
      let nextMessage = "";

      if (persistedCount > 0) {
        if (autoMergedCount > 0 && pendingCount > 0) {
          nextMessage = `保存成功：已写入 ${persistedCount} 条，自动追加 ${autoMergedCount} 条到对应词库（${buildScopeCountLabel(autoMergedEntriesByScope)}），另有 ${pendingCount} 条待确认词条`;
        } else if (autoMergedCount > 0) {
          nextMessage = `保存成功：已写入 ${persistedCount} 条，并自动追加 ${autoMergedCount} 条到对应词库（${buildScopeCountLabel(autoMergedEntriesByScope)}）`;
        } else if (pendingCount > 0) {
          nextMessage = `保存成功：已写入 ${persistedCount} 条，发现 ${pendingCount} 条待确认词条`;
        } else {
          nextMessage = `保存成功：已写入 ${persistedCount} 条到二创库`;
        }

        if (failedCount > 0) {
          const firstError = failedResults[0]?.error;
          nextMessage = `${nextMessage}；失败 ${failedCount} 条，已保留勾选可直接重试${
            firstError ? `（首条原因：${firstError}）` : ""
          }`;
        }

        if (collectUpdateWarning) {
          nextMessage = `${nextMessage}；爆款库状态同步稍后重试`;
        }
      } else if (failedCount > 0) {
        nextMessage = `保存失败：0/${selected.length} 条写入成功`;
        if (failedResults[0]?.error) {
          nextMessage = `${nextMessage}，原因：${failedResults[0].error}`;
        }
      } else {
        nextMessage = "保存失败";
      }

      setSaveMsg(nextMessage);

      if (persistedCount > 0 && failedCount === 0) {
        window.setTimeout(() => {
          setSaveMsg("");
        }, 2000);
      } else if (persistedCount > 0) {
        window.setTimeout(() => {
          setSaveMsg("");
        }, 4000);
      }
    } catch (e: unknown) {
      setSaveMsg(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  function handleDeleteSelected() {
    if (selectedRewriteIds.size === 0) return;
    const confirmed = window.confirm(`确认删除已选中的 ${selectedRewriteIds.size} 条二创记录吗？`);
    if (!confirmed) return;
    deleteRewriteResults(Array.from(selectedRewriteIds));
    setSaveMsg(`已删除 ${selectedRewriteIds.size} 条二创记录`);
    window.setTimeout(() => setSaveMsg(""), 2000);
  }

  function handleImportPendingEntries(scope: ReplaceLibraryScope) {
    const scopeEntries = pendingExtractedEntries[scope].filter(
      (entry) => entry.original.trim() && entry.replacement.trim()
    );
    if (scopeEntries.length === 0) {
      setSaveMsg("待确认区没有可导入的有效词条");
      window.setTimeout(() => setSaveMsg(""), 2000);
      return;
    }

    mergeExtractedEntries(scope, stringifyReplaceEntries(scopeEntries));
    setSaveMsg(
      `已导入 ${scopeEntries.length} 条到${LIBRARY_SCOPES.find((item) => item.scope === scope)?.label}`
    );
    setPendingExtractedEntries((prev) => ({
      ...prev,
      [scope]: [],
    }));
    window.setTimeout(() => setSaveMsg(""), 2000);
  }

  function handleUpdatePendingEntry(
    scope: ReplaceLibraryScope,
    index: number,
    patch: Partial<ReplaceEntryDraft>
  ) {
    setPendingExtractedEntries((prev) => ({
      ...prev,
      [scope]: prev[scope].map((entry, entryIndex) =>
        entryIndex === index ? { ...entry, ...patch } : entry
      ),
    }));
  }

  function handleRemovePendingEntry(scope: ReplaceLibraryScope, index: number) {
    setPendingExtractedEntries((prev) => ({
      ...prev,
      [scope]: prev[scope].filter((_, entryIndex) => entryIndex !== index),
    }));
  }

  function handleDismissPendingEntries(scope: ReplaceLibraryScope) {
    const scopeCount = pendingExtractedEntries[scope].length;
    if (scopeCount === 0) return;
    setSaveMsg(`已忽略 ${scopeCount} 条${LIBRARY_SCOPES.find((item) => item.scope === scope)?.label}待确认词条`);
    setPendingExtractedEntries((prev) => ({
      ...prev,
      [scope]: [],
    }));
    window.setTimeout(() => setSaveMsg(""), 2000);
  }

  function handleResetReplaceLibraries() {
    const confirmed = window.confirm("确认将标题、正文、封面文案三份替换词库恢复为默认预设吗？");
    if (!confirmed) return;

    resetToPresets();
    setSaveMsg("已恢复默认替换词库");
    window.setTimeout(() => setSaveMsg(""), 2000);
  }

  const doneCount = rewriteResults.filter((item) => item.status === "done").length;
  const processingCount = rewriteResults.filter((item) => item.status === "processing").length;
  const selectedDoneCount = rewriteResults.filter(
    (item) => selectedRewriteIds.has(item.id) && item.status === "done"
  ).length;
  const allResultIds = rewriteResults.map((item) => item.id);
  const allSelected = allResultIds.length > 0 && allResultIds.every((id) => selectedRewriteIds.has(id));

  function handleToggleBulkExpanded() {
    setBulkExpanded((current) => {
      const next = !current;
      setBulkExpandVersion((version) => version + 1);
      return next;
    });
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-800">二创模块</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              共 {rewriteResults.length} 条 · 已完成 {doneCount} 条
              {processingCount > 0 && (
                <span className="ml-2 text-orange-500">· {processingCount} 条生成中...</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-3">
            {rewriteResults.length > 0 && (
              <button
                onClick={() => {
                  if (allSelected) {
                    clearRewriteSelection();
                    return;
                  }
                  selectAllRewriteIds(allResultIds);
                }}
                className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-gray-600 hover:text-gray-800 hover:border-gray-300 hover:bg-gray-50 text-sm rounded-lg font-medium transition-colors"
              >
                {allSelected ? "取消全选" : "全选当前列表"}
              </button>
            )}
            {selectedRewriteIds.size > 0 && (
              <span className="text-sm text-red-500 font-medium bg-red-50 px-2.5 py-1 rounded-full">
                已选 {selectedRewriteIds.size} 条，可保存 {selectedDoneCount} 条
              </span>
            )}
            {saveMsg && (
              <span
                className={clsx(
                  "text-sm px-3 py-1 rounded-full",
                  saveMsg.includes("失败") ? "text-red-600 bg-red-50" : "text-green-600 bg-green-50"
                )}
              >
                {saveMsg}
              </span>
            )}
            {selectedRewriteIds.size > 0 && (
              <button
                onClick={handleDeleteSelected}
                className="flex items-center gap-1.5 px-3 py-2 border border-gray-200 text-gray-600 hover:text-red-600 hover:border-red-200 hover:bg-red-50 text-sm rounded-lg font-medium transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                删除选中
              </button>
            )}
            <button
              onClick={handleSaveToDraft}
              disabled={selectedDoneCount === 0 || saving}
              className="flex items-center gap-1.5 px-4 py-2 bg-red-500 hover:bg-red-600 disabled:bg-gray-300 text-white text-sm rounded-lg font-medium transition-colors"
            >
              <Save className="w-4 h-4" />
              {saving ? "保存中..." : "保存到二创库"}
            </button>
          </div>
        </div>
      </div>

      <div className="shrink-0 border-b border-amber-200 bg-gradient-to-b from-amber-50 via-amber-50/95 to-white">
        <div
          role="button"
          tabIndex={0}
          className="w-full cursor-pointer px-6 py-3 transition-colors"
          onClick={() => setLibraryOpen(!libraryOpen)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              setLibraryOpen(!libraryOpen);
            }
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <BookOpen className="w-4 h-4 text-amber-600" />
              <span className="text-sm font-semibold text-amber-700">替换词库</span>
              {LIBRARY_SCOPES.map((item) => (
                <span key={item.scope} className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
                  {item.label} {replaceEntriesByScope[item.scope].length} 条
                </span>
              ))}
              {replaceLibraryEnabled && (
                <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-600">
                  已启用
                </span>
              )}
              <span
                className={clsx(
                  "rounded-full px-2 py-0.5 text-xs font-medium",
                  autoMergeExtractedEntries ? "bg-sky-100 text-sky-600" : "bg-gray-100 text-gray-500"
                )}
              >
                {autoMergeExtractedEntries ? "自动写入三份词库" : "自动学习关闭"}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleResetReplaceLibraries();
                }}
                className="flex items-center gap-1.5 rounded-full border border-amber-200 bg-white/85 px-3 py-1.5 text-xs font-medium text-amber-700 shadow-sm transition-colors hover:border-amber-300 hover:bg-white"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                重置默认替换词库
              </button>
              <div
                className="flex items-center gap-1.5 rounded-full bg-white/80 px-2 py-1 ring-1 ring-amber-100"
                onClick={(e) => e.stopPropagation()}
              >
                <span className="text-xs text-amber-600">启用</span>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setReplaceLibraryEnabled(!replaceLibraryEnabled)}
                  onKeyDown={(e) => e.key === "Enter" && setReplaceLibraryEnabled(!replaceLibraryEnabled)}
                  className="cursor-pointer text-amber-500 hover:text-amber-700 transition-colors"
                >
                  {replaceLibraryEnabled ? (
                    <ToggleRight className="w-6 h-6 text-green-500" />
                  ) : (
                    <ToggleLeft className="w-6 h-6 text-gray-400" />
                  )}
                </div>
              </div>
              <span className="text-xs text-amber-500">{libraryOpen ? "收起" : "展开"}</span>
              {libraryOpen ? (
                <ChevronUp className="w-4 h-4 text-amber-500" />
              ) : (
                <ChevronDown className="w-4 h-4 text-amber-500" />
              )}
            </div>
          </div>
        </div>

        {libraryOpen && (
          <div className="px-6 pb-4">
            <div className="overflow-hidden rounded-2xl border border-amber-200/80 bg-white/80 shadow-[0_10px_30px_rgba(245,158,11,0.08)]">
              <div className="border-b border-amber-100 bg-amber-50/70 px-4 py-3">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-amber-700">
                      <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-amber-200">
                        具体词：公司A → 公司B
                      </span>
                      <span className="rounded-full bg-white px-2.5 py-1 ring-1 ring-amber-200">
                        语义类别：地点 → 深圳
                      </span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-amber-700/90">
                      具体词用于只替换某个明确说法，比如公司名、岗位名、固定短语；
                      语义类别用于按类型整体替换，比如地点、薪资、公司性质，能把同类表达统一改掉。
                    </p>
                  </div>

                  <div className="rounded-2xl border border-amber-200 bg-white/85 px-3 py-2 shadow-sm xl:w-[340px]">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-amber-700">保存后是否自动写入词库</p>
                        <p className="mt-1 text-[11px] leading-5 text-amber-600/90">
                          开启后，AI 提炼出的标题、正文、封面文案替换词会直接进入对应词库。
                          关闭后，不会自动入库，而是先进入各自词库下方的待确认区，你可以先编辑、删除，再手动导入。
                        </p>
                      </div>
                      <div
                        role="button"
                        tabIndex={0}
                        onClick={() => setAutoMergeExtractedEntries(!autoMergeExtractedEntries)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setAutoMergeExtractedEntries(!autoMergeExtractedEntries);
                          }
                        }}
                        className="cursor-pointer text-amber-500 transition-colors hover:text-amber-700"
                      >
                        {autoMergeExtractedEntries ? (
                          <ToggleRight className="h-6 w-6 text-green-500" />
                        ) : (
                          <ToggleLeft className="h-6 w-6 text-gray-400" />
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="max-h-[min(42vh,460px)] overflow-y-auto overscroll-contain px-4 py-4">
                <div className="grid gap-4 xl:grid-cols-3">
                  {LIBRARY_SCOPES.map((item) => {
                    const scopePendingEntries = pendingExtractedEntries[item.scope];
                    const scopePendingCount = scopePendingEntries.length;

                    return (
                    <div key={item.scope} className="rounded-2xl border border-amber-100 bg-white p-3">
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div>
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-sm font-semibold text-amber-700">{item.label}</p>
                            {!autoMergeExtractedEntries && (
                              <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-600 ring-1 ring-sky-100">
                                待确认 {scopePendingCount} 条
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-[11px] text-amber-600/90">{item.desc}</p>
                        </div>
                        <button
                          onClick={() => addReplaceEntry(item.scope)}
                          className="inline-flex items-center gap-1 rounded-lg border border-dashed border-amber-300 px-2.5 py-1.5 text-xs text-amber-700 hover:border-amber-500 hover:bg-amber-50"
                        >
                          <Plus className="w-3 h-3" />
                          添加
                        </button>
                      </div>

                      <div className="space-y-2">
                        {replaceEntriesByScope[item.scope].length === 0 && (
                          <div className="rounded-xl border border-dashed border-amber-200 bg-amber-50/60 px-4 py-6 text-center text-xs text-amber-500">
                            暂无词条
                          </div>
                        )}
                        {replaceEntriesByScope[item.scope].map((entry) => (
                          <div
                            key={entry.id}
                            className="grid gap-2 rounded-2xl border border-amber-100 bg-white p-2 sm:grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)_36px] sm:items-center"
                          >
                            <input
                              type="text"
                              placeholder="原词或类别"
                              value={entry.original}
                              onChange={(e) =>
                                updateReplaceEntry(item.scope, entry.id, { original: e.target.value })
                              }
                              className="min-w-0 rounded-xl border border-amber-200 bg-amber-50/40 px-3 py-2 text-xs text-gray-700 placeholder:text-gray-300 focus:border-amber-400 focus:bg-white focus:outline-none"
                            />
                            <span className="hidden text-center text-xs text-amber-400 sm:block">→</span>
                            <span className="text-[11px] font-medium text-amber-400 sm:hidden">替换为</span>
                            <input
                              type="text"
                              placeholder="目标词"
                              value={entry.replacement}
                              onChange={(e) =>
                                updateReplaceEntry(item.scope, entry.id, { replacement: e.target.value })
                              }
                              className="min-w-0 rounded-xl border border-amber-200 bg-white px-3 py-2 text-xs text-gray-700 placeholder:text-gray-300 focus:border-amber-400 focus:outline-none"
                            />
                            <button
                              onClick={() => removeReplaceEntry(item.scope, entry.id)}
                              className="flex h-8 w-8 items-center justify-center justify-self-end rounded-full border border-transparent text-gray-300 hover:border-red-100 hover:bg-red-50 hover:text-red-400"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>

                      {!autoMergeExtractedEntries && (
                        <div className="mt-3 rounded-xl border border-sky-100 bg-sky-50/40 p-3">
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <p className="text-xs font-semibold text-sky-700">待确认区</p>
                              <p className="mt-1 text-[11px] leading-5 text-sky-700/85">
                                保存后 AI 新提炼出来、但还没正式入库的词条会先放在这里。
                                你可以先编辑、删除，再决定是否导入到 {item.label}。
                              </p>
                            </div>
                            {scopePendingCount > 0 && (
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  onClick={() => handleImportPendingEntries(item.scope)}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-sky-700 transition-colors hover:border-sky-400 hover:bg-sky-50"
                                >
                                  导入本组
                                </button>
                                <button
                                  onClick={() => handleDismissPendingEntries(item.scope)}
                                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1.5 text-[11px] font-medium text-gray-600 transition-colors hover:border-gray-300 hover:bg-gray-50"
                                >
                                  忽略本组
                                </button>
                              </div>
                            )}
                          </div>

                          <div className="mt-3 space-y-2">
                            {scopePendingCount === 0 && (
                              <div className="rounded-xl border border-dashed border-sky-200 bg-white/80 px-4 py-5 text-center text-xs text-sky-500">
                                暂无待确认词条
                              </div>
                            )}
                            {scopePendingEntries.map((entry, index) => (
                              <div
                                key={`${item.scope}-pending-${index}`}
                                className="grid gap-2 rounded-2xl border border-sky-100 bg-white p-2 sm:grid-cols-[minmax(0,1fr)_20px_minmax(0,1fr)_36px] sm:items-center"
                              >
                                <input
                                  type="text"
                                  placeholder="原词或类别"
                                  value={entry.original}
                                  onChange={(e) =>
                                    handleUpdatePendingEntry(item.scope, index, {
                                      original: e.target.value,
                                    })
                                  }
                                  className="min-w-0 rounded-xl border border-sky-200 bg-sky-50/40 px-3 py-2 text-xs text-gray-700 placeholder:text-gray-300 focus:border-sky-400 focus:bg-white focus:outline-none"
                                />
                                <span className="hidden text-center text-xs text-sky-400 sm:block">→</span>
                                <span className="text-[11px] font-medium text-sky-400 sm:hidden">替换为</span>
                                <input
                                  type="text"
                                  placeholder="目标词"
                                  value={entry.replacement}
                                  onChange={(e) =>
                                    handleUpdatePendingEntry(item.scope, index, {
                                      replacement: e.target.value,
                                    })
                                  }
                                  className="min-w-0 rounded-xl border border-sky-200 bg-white px-3 py-2 text-xs text-gray-700 placeholder:text-gray-300 focus:border-sky-400 focus:outline-none"
                                />
                                <button
                                  onClick={() => handleRemovePendingEntry(item.scope, index)}
                                  className="flex h-8 w-8 items-center justify-center justify-self-end rounded-full border border-transparent text-gray-300 hover:border-red-100 hover:bg-red-50 hover:text-red-400"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {replaceLibraryEnabled && (
                        <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50/40 p-3">
                          <p className="mb-2 text-xs font-medium text-amber-700">当前二创提示词注入预览</p>
                          <pre className="max-h-28 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-gray-600">
                            {buildReplaceInfoString(item.scope) || "（当前无有效词条）"}
                          </pre>
                        </div>
                      )}
                    </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        {rewriteResults.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <Sparkles className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">请先在「爆款库」选择笔记并点击一键二创</p>
          </div>
        ) : (
          <>
            <div className="sticky top-0 z-20 flex justify-end px-3 pb-2 pt-3 bg-gradient-to-b from-white via-white/95 to-white/0">
              <button
                onClick={handleToggleBulkExpanded}
                className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-white/90 px-3 py-1.5 text-xs font-medium text-gray-600 shadow-sm transition-colors hover:border-gray-300 hover:bg-white hover:text-gray-800"
              >
                {bulkExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                {bulkExpanded ? "全部收起" : "全部展开"}
              </button>
            </div>
            <div className="space-y-3 px-3 pb-3">
              {rewriteResults.map((result, index) => (
                <RewriteRow
                  key={result.id}
                  sequenceNumber={index + 1}
                  result={result}
                  originalNote={getLiveOriginalNote(result, collectRecordMap)}
                  selected={selectedRewriteIds.has(result.id)}
                  bulkExpanded={bulkExpanded}
                  bulkExpandVersion={bulkExpandVersion}
                  onToggleSelect={() => toggleRewriteSelect(result.id)}
                  onUpdate={(updates) => updateRewriteResult(result.id, updates)}
                  onRetry={() => startRewrite(result.id)}
                  onToggleProcessing={() => toggleRewriteProcessing(result.id)}
                  onRetryField={(field) => retryRewriteField(result.id, field)}
                  onDelete={() => {
                    const controller = rewriteAbortControllersRef.current.get(result.id);
                    if (controller) {
                      controller.abort();
                      rewriteAbortControllersRef.current.delete(result.id);
                    }
                    deleteRewriteResults([result.id]);
                  }}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function RewriteRow({
  sequenceNumber,
  result,
  originalNote,
  selected,
  bulkExpanded,
  bulkExpandVersion,
  onToggleSelect,
  onUpdate,
  onRetry,
  onToggleProcessing,
  onRetryField,
  onDelete,
}: {
  sequenceNumber: number;
  result: RewriteResult;
  originalNote: RewriteResult["originalNote"];
  selected: boolean;
  bulkExpanded: boolean;
  bulkExpandVersion: number;
  onToggleSelect: () => void;
  onUpdate: (updates: Partial<RewriteResult>) => void;
  onRetry: () => void;
  onToggleProcessing: () => void;
  onRetryField: (field: RetryableRewriteField) => Promise<void>;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingBody, setEditingBody] = useState(false);
  const [editingCoverText, setEditingCoverText] = useState(false);
  const [editingRewrittenTags, setEditingRewrittenTags] = useState(false);
  const [draftOverrides, setDraftOverrides] = useState<Partial<RewriteEditBaseline>>({});
  const [draftFieldModifiedAt, setDraftFieldModifiedAt] = useState<
    Partial<Record<keyof RewriteEditBaseline, string>>
  >({});
  const [showTemplates, setShowTemplates] = useState(false);
  const [generatingCover, setGeneratingCover] = useState(false);
  const [previewImage, setPreviewImage] = useState<{ src: string; title: string } | null>(null);
  const [retryingFields, setRetryingFields] = useState<Record<RetryableRewriteField, boolean>>({
    coverText: false,
    title: false,
    body: false,
  });

  const note = originalNote;
  const displayTitle = sanitizeTitle(note.originalTitle || "");
  const originalTags = buildOriginalTags(result);
  const rewrittenTags = buildDisplayTags(result);
  const resolvedCoverTemplate = resolveResultCoverTemplateState(result);
  const currentTemplateFamily = resolvedCoverTemplate.family;
  const currentTemplateVariant = resolvedCoverTemplate.variant;
  const isUsingCustomBaseImage =
    Boolean(result.coverBaseImage) && !isTemplateVariantSource(result.coverBaseImage);
  const currentTemplateVariantIndex = Math.max(
    currentTemplateFamily.variants.findIndex((variant) => variant.id === currentTemplateVariant.id),
    0
  );
  const selectedPublishPersona = (result.publishPersona || "").trim();
  const isSaved = isRewriteResultSaved(result, note);
  const editedCategories = getEditedRewriteCategories(result, draftOverrides);
  const effectiveFieldModifiedAt = getEffectiveFieldModifiedAt(result);
  const isProcessing = result.status === "processing";
  const canEditGeneratedFields = result.status !== "processing";
  const showInlineTitleLoading = isProcessing && !result.rewrittenTitle;
  const showInlineBodyLoading = isProcessing && !result.rewrittenBody;
  const showInlineCoverTextLoading = isProcessing && !result.rewrittenCoverText;
  const showInlineCoverLoading = (isProcessing && !result.rewrittenCover) || generatingCover;
  const latestModifiedLabel = formatRewriteModifiedTime(
    pickMostRecentTimestamp(
      ...EDITED_CATEGORY_ORDER.map((field) => draftFieldModifiedAt[field]),
      ...EDITED_CATEGORY_ORDER.map((field) => effectiveFieldModifiedAt?.[field]),
      result.lastModifiedAt,
      note.rewriteDate
    )
  );
  const sequenceLabel = sequenceNumber.toString().padStart(2, "0");

  useEffect(() => {
    setExpanded(bulkExpanded);
  }, [bulkExpanded, bulkExpandVersion]);

  function getCurrentEditableValue<K extends keyof RewriteEditBaseline>(
    field: K
  ): RewriteEditBaseline[K] {
    return getTrackedResultValue(result, field);
  }

  function setDraftOverride<K extends keyof RewriteEditBaseline>(
    field: K,
    value: RewriteEditBaseline[K]
  ) {
    const currentValue = getCurrentEditableValue(field);
    const changed = !isTrackedEditValueEqual(value, currentValue);
    const timestamp = getCurrentIsoTimestamp();

    setDraftOverrides((current) => {
      if (!changed) {
        if (!(field in current)) return current;
        const next = { ...current };
        delete next[field];
        return next;
      }

      return {
        ...current,
        [field]: Array.isArray(value) ? [...value] : value,
      };
    });

    setDraftFieldModifiedAt((current) => {
      if (!changed) {
        if (!(field in current)) return current;
        const next = { ...current };
        delete next[field];
        return next;
      }

      return {
        ...current,
        [field]: timestamp,
      };
    });
  }

  function clearDraftOverride(field: keyof RewriteEditBaseline) {
    setDraftOverrides((current) => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setDraftFieldModifiedAt((current) => {
      if (!(field in current)) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function hasMeaningfulResultChange(updates: Partial<RewriteResult>) {
    const trackedFields: Array<keyof RewriteEditBaseline> = [
      "rewrittenCover",
      "publishPersona",
      "rewrittenTitle",
      "rewrittenBody",
      "rewrittenTags",
      "rewrittenCoverText",
    ];

    return trackedFields.some((field) => {
      if (!(field in updates)) return false;
      const nextValue = updates[field];
      const currentValue = getCurrentEditableValue(field);

      if (Array.isArray(nextValue) && Array.isArray(currentValue)) {
        return JSON.stringify(nextValue) !== JSON.stringify(currentValue);
      }

      return nextValue !== currentValue;
    });
  }

  function applyManualUpdate(updates: Partial<RewriteResult>) {
    if (hasMeaningfulResultChange(updates)) {
      const timestamp = getCurrentIsoTimestamp();
      const nextFieldModifiedAt = buildNextFieldModifiedAt(
        result,
        updates,
        timestamp,
        effectiveFieldModifiedAt
      );
      const migratingLegacyFieldTime = !result.fieldModifiedAt && Boolean(effectiveFieldModifiedAt);

      onUpdate({
        ...updates,
        fieldModifiedAt: nextFieldModifiedAt,
        ...(migratingLegacyFieldTime && !nextFieldModifiedAt
          ? { lastModifiedAt: note.rewriteDate || undefined }
          : {}),
      });
      return;
    }

    onUpdate(updates);
  }

  function handlePublishPersonaSelect(value: string) {
    applyManualUpdate({ publishPersona: selectedPublishPersona === value ? "" : value });
  }

  async function handleRetryField(field: RetryableRewriteField) {
    if (retryingFields[field]) return;
    setRetryingFields((current) => ({ ...current, [field]: true }));
    try {
      await onRetryField(field);
    } catch (error) {
      console.error(`${RETRY_FIELD_LABELS[field]}重新生成失败:`, error);
    } finally {
      setRetryingFields((current) => ({ ...current, [field]: false }));
    }
  }

  async function rebuildCover(
    overrides: Partial<
      Pick<RewriteResult, "rewrittenCoverText" | "coverTemplateFamilyId" | "coverTemplateVariantId" | "coverBaseImage">
    > = {},
    options: { trackAsManual?: boolean } = {}
  ) {
    setGeneratingCover(true);
    try {
      const nextCoverText = overrides.rewrittenCoverText ?? result.rewrittenCoverText;
      const coverPayload = await buildRenderedCoverPayload({
        result,
        coverText: nextCoverText,
        overrides,
      });

      const updates: Partial<RewriteResult> = {
        ...coverPayload,
        ...(typeof overrides.rewrittenCoverText === "string"
          ? { rewrittenCoverText: overrides.rewrittenCoverText }
          : {}),
      };

      if (options.trackAsManual === false) {
        onUpdate(updates);
      } else {
        applyManualUpdate(updates);
      }
    } catch (e: unknown) {
      console.error("本地生成封面失败:", e);
    } finally {
      setGeneratingCover(false);
    }
  }

  async function handleBaseImageUpload(file: File) {
    if (!canEditGeneratedFields || generatingCover) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      await rebuildCover({ coverBaseImage: dataUrl });
    } catch (error) {
      console.error("读取底图失败:", error);
    }
  }

  async function handleFinishedImageUpload(file: File) {
    if (!canEditGeneratedFields) return;
    try {
      const dataUrl = await readFileAsDataUrl(file);
      applyManualUpdate({ rewrittenCover: dataUrl });
    } catch (error) {
      console.error("读取成品图片失败:", error);
    }
  }

  async function handleTemplateFamilyChange(familyId: string) {
    if (!canEditGeneratedFields || generatingCover) return;
    const nextFamily = COVER_TEMPLATE_FAMILIES.find((family) => family.id === familyId);
    if (!nextFamily) return;
    setShowTemplates(false);
    await rebuildCover({
      coverTemplateFamilyId: nextFamily.id,
      coverTemplateVariantId: nextFamily.variants[0].id,
      coverBaseImage: nextFamily.variants[0].src,
    });
  }

  async function handleSwapTemplateVariant() {
    if (!canEditGeneratedFields || generatingCover) return;
    const nextVariant = getNextCoverTemplateVariant(
      currentTemplateFamily.id,
      currentTemplateVariant.id
    );

    await rebuildCover({
      coverTemplateFamilyId: currentTemplateFamily.id,
      coverTemplateVariantId: nextVariant.id,
      coverBaseImage: nextVariant.src,
    });
  }

  async function handleResetTemplateBaseImage() {
    if (!canEditGeneratedFields || generatingCover) return;

    await rebuildCover({
      coverTemplateFamilyId: currentTemplateFamily.id,
      coverTemplateVariantId: currentTemplateVariant.id,
      coverBaseImage: currentTemplateVariant.src,
    });
  }

  return (
    <>
      <div
        className={clsx(
          "rounded-2xl border border-gray-200/80 bg-gradient-to-br from-white to-gray-50/50 px-4 py-3 shadow-[0_1px_3px_rgba(15,23,42,0.05)] transition-all duration-200",
          "hover:border-gray-300/80 hover:shadow-[0_8px_24px_rgba(15,23,42,0.06)]",
          selected && "border-red-200 bg-red-50/40 shadow-[0_10px_24px_rgba(239,68,68,0.08)]"
        )}
      >
        <div className="flex items-center gap-3 mb-2">
          <div className="flex-shrink-0 cursor-pointer" onClick={onToggleSelect}>
            <div
              className={clsx(
                "w-5 h-5 rounded border-2 flex items-center justify-center",
                selected ? "bg-red-500 border-red-500" : "border-gray-300 bg-white"
              )}
            >
              {selected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
            </div>
          </div>

          <span
            className="inline-flex min-w-11 items-center justify-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold tracking-[0.18em] text-amber-700"
            title={`第 ${sequenceNumber} 条`}
          >
            #{sequenceLabel}
          </span>
          <StatusBadge status={result.status} saved={isSaved} />
          {editedCategories.length > 0 && (
            <div className="flex max-w-[42%] min-w-0 flex-wrap items-center gap-1">
              {editedCategories.map((category) => (
                <span
                  key={category}
                  className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-600 ring-1 ring-violet-100"
                >
                  {category}
                </span>
              ))}
            </div>
          )}
          {result.batchTotal > 1 && (
            <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600 ring-1 ring-blue-100">
              第 {result.batchIndex}/{result.batchTotal} 版
            </span>
          )}

          <span className="flex-1 text-sm text-gray-600 truncate">{displayTitle}</span>
          {latestModifiedLabel && (
            <span className="shrink-0 whitespace-nowrap text-xs text-gray-400">
              {latestModifiedLabel}
            </span>
          )}

          {(result.status === "processing" || result.status === "stopped") && (
            <button
              onClick={onToggleProcessing}
              className={clsx(
                "transition-colors",
                result.status === "processing"
                  ? "text-amber-400 hover:text-amber-600"
                  : "text-sky-400 hover:text-sky-600"
              )}
              title={result.status === "processing" ? "停止生成" : "重新生成"}
              aria-label={result.status === "processing" ? "停止生成" : "重新生成"}
            >
              {result.status === "processing" ? (
                <Square className="h-4 w-4 fill-current" />
              ) : (
                <Play className="h-4 w-4 fill-current" />
              )}
            </button>
          )}
          <button
            onClick={() => {
              const confirmed = window.confirm("确认删除这条二创记录吗？");
              if (confirmed) onDelete();
            }}
            className="text-gray-300 hover:text-red-500 transition-colors"
            title="删除"
          >
            <Trash2 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
          >
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>

        {expanded && (
          <div className="mt-3 border-t border-gray-200/70 pt-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-50 rounded-xl p-3 space-y-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">封面</p>

                <div className="group relative aspect-[3/4] bg-gray-200 rounded-lg overflow-hidden w-24">
                  {note.cover ? (
                    <>
                      <Image
                        src={`/api/proxy-image?url=${encodeURIComponent(note.cover)}`}
                        alt="原封面"
                        fill
                        sizes="96px"
                        className="object-cover"
                        unoptimized
                      />
                      <HoverImageActions
                        previewLabel="预览"
                        onPreview={() =>
                          setPreviewImage({
                            src: `/api/proxy-image?url=${encodeURIComponent(note.cover || "")}`,
                            title: "预览",
                          })
                        }
                      />
                    </>
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-gray-400 text-xs">无封面</div>
                  )}
                </div>

                {note.coverText && (
                  <div>
                    <p className="text-xs text-gray-400 mb-0.5">封面文案</p>
                    <p className="text-xs text-gray-700 whitespace-pre-wrap">{note.coverText}</p>
                  </div>
                )}

                <div>
                  <p className="text-xs text-gray-400 mb-0.5">标题</p>
                  <p className="text-sm text-gray-800 font-medium">{note.originalTitle || "—"}</p>
                </div>

                <div>
                  <p className="text-xs text-gray-400 mb-0.5">正文</p>
                  <p className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto">
                    {note.originalBody || "—"}
                  </p>
                </div>

                <div>
                  <p className="mb-0.5 text-xs text-gray-400">标签</p>
                  {originalTags.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {originalTags.map((tag) => (
                        <span
                          key={`original-tag-${tag}`}
                          className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-500"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-800">—</p>
                  )}
                </div>
              </div>

              <div className="relative bg-white border border-gray-200 rounded-xl p-3 space-y-2">
                <div className="absolute right-3 top-0 z-10">
                  <PublishPersonaRail
                    options={PUBLISH_PERSONA_OPTIONS}
                    value={selectedPublishPersona}
                    onSelect={handlePublishPersonaSelect}
                    disabled={isProcessing}
                  />
                </div>

                {result.status === "stopped" && (
                  <div className="rounded-lg bg-amber-50/70 px-2.5 py-2 text-xs text-amber-600">
                    <p className="mb-1">已停止生成</p>
                    <button onClick={onToggleProcessing} className="text-xs text-sky-500 hover:underline">
                      继续生成
                    </button>
                  </div>
                )}

                {result.status === "error" && (
                  <div className="rounded-lg bg-red-50/80 px-2.5 py-2 text-xs text-red-500">
                    <p className="mb-1">{result.errorMsg}</p>
                    <button onClick={onRetry} className="text-xs text-red-500 hover:underline">
                      重试
                    </button>
                  </div>
                )}

                <>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    二创封面
                  </p>
                  <div className="space-y-1">
                    <div className="flex items-start gap-2">
                      <div className="relative aspect-[3/4] bg-gray-100 rounded-lg overflow-hidden w-24 flex-shrink-0 group">
                        {result.rewrittenCover ? (
                          <>
                            <Image
                              src={result.rewrittenCover}
                              alt="二创封面"
                              fill
                              sizes="96px"
                              className="object-cover"
                              unoptimized
                            />
                            <HoverImageActions
                              onPreview={() => setPreviewImage({ src: result.rewrittenCover, title: "二创封面预览" })}
                            />
                            {showInlineCoverLoading && (
                              <div className="absolute inset-0 flex items-center justify-center bg-white/65 text-[11px] text-gray-500">
                                <div className="flex flex-col items-center gap-1.5">
                                  <div className="h-4 w-4 rounded-full border-2 border-red-300 border-t-transparent animate-spin" />
                                  <span>封面更新中</span>
                                </div>
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs text-center px-1">
                            未生成
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap gap-1">
                          <label
                            className={clsx(
                              "flex items-center gap-1 text-xs border border-gray-200 rounded px-2 py-1",
                              canEditGeneratedFields
                                ? "cursor-pointer text-gray-500 hover:text-gray-700"
                                : "cursor-not-allowed text-gray-300"
                            )}
                          >
                            <Upload className="w-3 h-3" />
                            换背景
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              disabled={!canEditGeneratedFields}
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                e.currentTarget.value = "";
                                if (!file) return;
                                await handleBaseImageUpload(file);
                              }}
                            />
                          </label>
                          <label
                            className={clsx(
                              "flex items-center gap-1 text-xs border border-gray-200 rounded px-2 py-1",
                              canEditGeneratedFields
                                ? "cursor-pointer text-gray-500 hover:text-gray-700"
                                : "cursor-not-allowed text-gray-300"
                            )}
                          >
                            <Upload className="w-3 h-3" />
                            直接替换封面
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              disabled={!canEditGeneratedFields}
                              onChange={async (e) => {
                                const file = e.target.files?.[0];
                                e.currentTarget.value = "";
                                if (!file) return;
                                await handleFinishedImageUpload(file);
                              }}
                            />
                          </label>
                          <button
                            onClick={() => setShowTemplates((current) => !current)}
                            disabled={generatingCover || !canEditGeneratedFields}
                            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 disabled:text-gray-300 border border-gray-200 rounded px-2 py-1 disabled:cursor-not-allowed"
                          >
                            选模板
                          </button>
                          <button
                            onClick={() => void handleSwapTemplateVariant()}
                            disabled={generatingCover || !canEditGeneratedFields}
                            className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 disabled:text-gray-300 border border-gray-200 rounded px-2 py-1 disabled:cursor-not-allowed"
                          >
                            同款切换
                          </button>
                          {isUsingCustomBaseImage && (
                            <button
                              onClick={() => void handleResetTemplateBaseImage()}
                              disabled={generatingCover || !canEditGeneratedFields}
                              className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 disabled:text-gray-300 border border-gray-200 rounded px-2 py-1 disabled:cursor-not-allowed"
                            >
                              恢复模板
                            </button>
                          )}
                        </div>
                        <div className="rounded-lg bg-gray-50 px-2 py-1.5 text-[11px] text-gray-500">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span>当前模板：{currentTemplateFamily.label}</span>
                            <span>
                              搭配 {currentTemplateVariantIndex + 1}/{currentTemplateFamily.variants.length}
                            </span>
                            <span>{currentTemplateVariant.label}</span>
                            {isUsingCustomBaseImage && (
                              <span className="rounded-full bg-white px-2 py-0.5 text-[10px] text-red-500 ring-1 ring-red-100">
                                已启用自定义底图
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>

                    {showTemplates && canEditGeneratedFields && (
                      <div className="mt-2 p-2 bg-gray-50 rounded-lg">
                        <p className="mb-1.5 text-xs text-gray-500">选择模板族</p>
                        <div className="grid max-w-[540px] grid-cols-3 gap-2">
                          {COVER_TEMPLATE_FAMILIES.map((family) => {
                            const previewVariant =
                              family.id === currentTemplateFamily.id
                                ? currentTemplateVariant
                                : family.variants[0];

                            return (
                              <button
                                key={family.id}
                                onClick={() => void handleTemplateFamilyChange(family.id)}
                                className={clsx(
                                  "rounded-xl border p-1.5 text-left transition-colors",
                                  family.id === currentTemplateFamily.id
                                    ? "border-red-200 bg-red-50/50"
                                    : "border-gray-200 bg-white hover:border-gray-300"
                                )}
                              >
                                <div className="group relative aspect-[3/4] overflow-hidden rounded-lg bg-gray-100">
                                  <Image
                                    src={previewVariant.src}
                                    alt={family.label}
                                    fill
                                    sizes="96px"
                                    className="object-cover"
                                  />
                                  <HoverImageActions
                                    small
                                    previewLabel="预览"
                                    onPreview={() =>
                                      setPreviewImage({
                                        src: previewVariant.src,
                                        title: `${family.label} · ${previewVariant.label}`,
                                      })
                                    }
                                  />
                                </div>
                                <p className="mt-1.5 text-xs font-medium text-gray-700">{family.label}</p>
                                <p className="mt-0.5 text-[11px] leading-relaxed text-gray-400">
                                  {family.description}
                                </p>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>

                  <EditableField
                    label="二创封面文案"
                    value={result.rewrittenCoverText}
                    editing={editingCoverText}
                    retrying={retryingFields.coverText}
                    disabled={!canEditGeneratedFields}
                    loading={showInlineCoverTextLoading}
                    loadingLabel="二创封面文案生成中"
                    onEdit={() => {
                      setDraftOverride("rewrittenCoverText", result.rewrittenCoverText);
                      setEditingCoverText(true);
                    }}
                    onRetry={() => handleRetryField("coverText")}
                    onDraftChange={(value) => setDraftOverride("rewrittenCoverText", value)}
                    onSave={(value) => {
                      const nextValue = normalizeSavedCoverText(value);
                      setEditingCoverText(false);
                      clearDraftOverride("rewrittenCoverText");
                      void rebuildCover({ rewrittenCoverText: nextValue });
                    }}
                    onCancel={() => {
                      clearDraftOverride("rewrittenCoverText");
                      setEditingCoverText(false);
                    }}
                    multiline
                  />

                  <EditableField
                    label="二创标题"
                    value={result.rewrittenTitle}
                    editing={editingTitle}
                    retrying={retryingFields.title}
                    disabled={!canEditGeneratedFields}
                    loading={showInlineTitleLoading}
                    loadingLabel="二创标题生成中"
                    onEdit={() => {
                      setDraftOverride("rewrittenTitle", result.rewrittenTitle);
                      setEditingTitle(true);
                    }}
                    onRetry={() => handleRetryField("title")}
                    onDraftChange={(value) => setDraftOverride("rewrittenTitle", value)}
                    onSave={(value) => {
                      applyManualUpdate({ rewrittenTitle: value });
                      clearDraftOverride("rewrittenTitle");
                      setEditingTitle(false);
                    }}
                    onCancel={() => {
                      clearDraftOverride("rewrittenTitle");
                      setEditingTitle(false);
                    }}
                    multiline={false}
                  />

                  <EditableField
                    label="二创正文"
                    value={result.rewrittenBody}
                    editing={editingBody}
                    retrying={retryingFields.body}
                    disabled={!canEditGeneratedFields}
                    loading={showInlineBodyLoading}
                    loadingLabel="二创正文生成中"
                    onEdit={() => {
                      setDraftOverride("rewrittenBody", result.rewrittenBody);
                      setEditingBody(true);
                    }}
                    onRetry={() => handleRetryField("body")}
                    onDraftChange={(value) => setDraftOverride("rewrittenBody", value)}
                    onSave={(value) => {
                      applyManualUpdate({
                        rewrittenBody: normalizeRewrittenBody(value, note.originalBody || ""),
                      });
                      clearDraftOverride("rewrittenBody");
                      setEditingBody(false);
                    }}
                    onCancel={() => {
                      clearDraftOverride("rewrittenBody");
                      setEditingBody(false);
                    }}
                    multiline
                  />
                </>

                <EditableTagsField
                  label="二创标签"
                  tags={rewrittenTags}
                  editing={editingRewrittenTags}
                  disabled={!canEditGeneratedFields}
                  onEdit={() => {
                    setDraftOverride("rewrittenTags", rewrittenTags);
                    setEditingRewrittenTags(true);
                  }}
                  onDraftChange={(nextTags) => setDraftOverride("rewrittenTags", nextTags)}
                  onSave={(nextTags) => {
                    applyManualUpdate({ rewrittenTags: nextTags });
                    clearDraftOverride("rewrittenTags");
                    setEditingRewrittenTags(false);
                  }}
                  onCancel={() => {
                    clearDraftOverride("rewrittenTags");
                    setEditingRewrittenTags(false);
                  }}
                  chipClassName="bg-red-50 text-red-500"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {previewImage && (
        <ImagePreviewModal
          src={previewImage.src}
          title={previewImage.title}
          onClose={() => setPreviewImage(null)}
        />
      )}
    </>
  );
}

function HoverImageActions({
  onPreview,
  onEdit,
  small = false,
  previewLabel = "预览",
}: {
  onPreview: () => void;
  onEdit?: () => void;
  small?: boolean;
  previewLabel?: string;
}) {
  return (
    <div className="absolute inset-0 bg-black/40 opacity-0 transition-opacity group-hover:opacity-100 flex items-center justify-center gap-2">
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onPreview();
        }}
        className={clsx(
          "rounded-lg bg-white/90 text-gray-700 hover:bg-white",
          small ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-xs"
        )}
      >
        {previewLabel}
      </button>
      {onEdit && (
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onEdit();
          }}
          className={clsx(
            "rounded-lg bg-white/90 text-gray-700 hover:bg-white",
            small ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-xs"
          )}
        >
          编辑
        </button>
      )}
    </div>
  );
}

function ImagePreviewModal({
  src,
  title,
  onClose,
}: {
  src: string;
  title: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-6" onClick={onClose}>
      <div
        className="relative max-h-[90vh] max-w-[80vw] overflow-hidden rounded-2xl bg-white p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute right-3 top-3 z-10 rounded-full bg-black/60 p-1 text-white hover:bg-black/80"
        >
          <X className="w-4 h-4" />
        </button>
        <p className="mb-3 text-sm font-medium text-gray-700">{title}</p>
        <div className="relative h-[80vh] w-[60vh] max-w-[70vw]">
          <Image src={src} alt={title} fill className="object-contain" unoptimized />
        </div>
      </div>
    </div>
  );
}

function PublishPersonaRail({
  options,
  value,
  onSelect,
  disabled = false,
}: {
  options: readonly string[];
  value: string;
  onSelect: (value: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start justify-end gap-1.5">
      {options.map((option) => {
        const selected = option === value;

        return (
          <div key={option} className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                if (disabled) return;
                onSelect(option);
              }}
              disabled={disabled}
              className={clsx(
                "inline-flex w-[72px] items-center justify-center rounded-b-[16px] border px-2 text-[11px] font-medium leading-none whitespace-nowrap text-center",
                "h-8 transition-colors duration-200 ease-out",
                selected
                  ? "border-amber-200 bg-[#fff4dd] text-[#9a6a1f]"
                  : "border-stone-200 bg-[#f7f4ee] text-stone-500 hover:border-amber-200 hover:bg-[#fff4dd] hover:text-[#9a6a1f]",
                disabled && "cursor-not-allowed opacity-60"
              )}
              title={selected ? `取消${option}` : `设为${option}`}
            >
              {option}
            </button>
          </div>
        );
      })}
    </div>
  );
}

function EditableTagsField({
  label,
  tags,
  editing,
  onEdit,
  onDraftChange,
  onSave,
  onCancel,
  chipClassName,
  disabled = false,
}: {
  label: string;
  tags: string[];
  editing: boolean;
  onEdit: () => void;
  onDraftChange?: (tags: string[]) => void;
  onSave: (tags: string[]) => void;
  onCancel: () => void;
  chipClassName: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState(formatTagDraft(tags));

  useEffect(() => {
    setDraft(formatTagDraft(tags));
  }, [tags]);

  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <p className="text-xs text-gray-400">{label}</p>
        {!editing && (
          <button
            onClick={() => {
              if (disabled) return;
              setDraft(formatTagDraft(tags));
              onEdit();
            }}
            disabled={disabled}
            className={clsx(
              "text-xs transition-colors",
              disabled ? "cursor-not-allowed text-gray-300" : "text-gray-400 hover:text-gray-600"
            )}
          >
            <Edit3 className="w-3 h-3" />
          </button>
        )}
      </div>
      {editing ? (
        <div className="space-y-1">
          <textarea
            value={draft}
            onChange={(e) => {
              const nextDraft = e.target.value;
              setDraft(nextDraft);
              onDraftChange?.(parseTagDraft(nextDraft));
            }}
            className="w-full text-xs border border-gray-300 rounded p-2 resize-none focus:outline-none focus:border-red-400"
            rows={3}
            autoFocus
            placeholder="输入标签"
          />
          <div className="flex gap-2">
            <button
              onClick={() => onSave(parseTagDraft(draft))}
              className="text-xs px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600"
            >
              保存
            </button>
            <button
              onClick={onCancel}
              className="text-xs px-2 py-1 border border-gray-200 rounded hover:bg-gray-50"
            >
              取消
            </button>
          </div>
        </div>
      ) : tags.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span
              key={`${label}-${tag}`}
              className={clsx("inline-flex items-center rounded-full px-2 py-0.5 text-xs", chipClassName)}
            >
              {tag}
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-800">—</p>
      )}
    </div>
  );
}

function StatusBadge({
  status,
  saved = false,
}: {
  status: RewriteResult["status"];
  saved?: boolean;
}) {
  if (status === "done" && saved) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 bg-emerald-100 text-emerald-600">
        已保存
      </span>
    );
  }

  const map = {
    pending: { label: "等待中", cls: "bg-gray-100 text-gray-500" },
    processing: { label: "生成中", cls: "bg-orange-100 text-orange-600 animate-pulse" },
    done: { label: "已完成", cls: "bg-green-100 text-green-600" },
    error: { label: "失败", cls: "bg-red-100 text-red-600" },
    stopped: { label: "已停止", cls: "bg-amber-100 text-amber-600" },
  };
  const { label, cls } = map[status];
  return (
    <span className={clsx("text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0", cls)}>
      {label}
    </span>
  );
}

function LoadingInlineIndicator({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 py-1 text-xs text-gray-400">
      <div className="h-3.5 w-3.5 rounded-full border-2 border-red-300 border-t-transparent animate-spin" />
      <span>{label}</span>
    </div>
  );
}

function EditableField({
  label,
  value,
  editing,
  retrying = false,
  disabled = false,
  loading = false,
  loadingLabel,
  onEdit,
  onRetry,
  onDraftChange,
  onSave,
  onCancel,
  multiline,
}: {
  label: string;
  value: string;
  editing: boolean;
  retrying?: boolean;
  disabled?: boolean;
  loading?: boolean;
  loadingLabel?: string;
  onEdit: () => void;
  onRetry?: () => void | Promise<void>;
  onDraftChange?: (value: string) => void;
  onSave: (value: string) => void;
  onCancel: () => void;
  multiline: boolean;
}) {
  const [draft, setDraft] = useState(value);

  return (
    <div>
      <div className="flex items-center justify-between mb-0.5">
        <p className="text-xs text-gray-400">{label}</p>
        {!editing && (
          <div className="flex items-center gap-1">
            {onRetry && (
              <button
                onClick={() => void onRetry()}
                disabled={retrying || disabled}
                title={`重新生成${label}`}
                aria-label={`重新生成${label}`}
                className={clsx(
                  "text-xs transition-colors",
                  retrying || disabled
                    ? "cursor-not-allowed text-gray-300"
                    : "text-gray-400 hover:text-gray-600"
                )}
              >
                <RotateCcw className={clsx("w-3 h-3", retrying && "animate-spin")} />
              </button>
            )}
            <button
              onClick={() => {
                if (disabled) return;
                setDraft(value);
                onEdit();
              }}
              disabled={retrying || disabled}
              className={clsx(
                "text-xs transition-colors",
                retrying || disabled
                  ? "cursor-not-allowed text-gray-300"
                  : "text-gray-400 hover:text-gray-600"
              )}
            >
              <Edit3 className="w-3 h-3" />
            </button>
          </div>
        )}
      </div>
      {editing ? (
        <div className="space-y-1">
          {multiline ? (
            <textarea
              value={draft}
              onChange={(e) => {
                const nextDraft = e.target.value;
                setDraft(nextDraft);
                onDraftChange?.(nextDraft);
              }}
              className="min-h-[120px] w-full resize-y rounded border border-gray-300 p-2 text-xs focus:border-red-400 focus:outline-none"
              rows={6}
              autoFocus
            />
          ) : (
            <input
              type="text"
              value={draft}
              onChange={(e) => {
                const nextDraft = e.target.value;
                setDraft(nextDraft);
                onDraftChange?.(nextDraft);
              }}
              className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:border-red-400"
              autoFocus
            />
          )}
          <div className="flex gap-2">
            <button
              onClick={() => onSave(draft)}
              className="text-xs px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600"
            >
              保存
            </button>
            <button
              onClick={onCancel}
              className="text-xs px-2 py-1 border border-gray-200 rounded hover:bg-gray-50"
            >
              取消
            </button>
          </div>
        </div>
      ) : loading && !value ? (
        <LoadingInlineIndicator label={loadingLabel || `${label}生成中`} />
      ) : (
        <p className="text-xs text-gray-800 whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto">
          {value || "—"}
        </p>
      )}
    </div>
  );
}
