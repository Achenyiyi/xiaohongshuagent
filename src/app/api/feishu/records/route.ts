import { NextResponse } from "next/server";
import { getCollectRecords, getRecordsInTable } from "@/lib/feishu";
import { runtimeConfig } from "@/lib/runtimeConfig";
import { dedupeTags, extractTagsFromText, stripTagsFromText } from "@/lib/xhs";
import { buildOpenableNoteLink, extractNoteIdFromLink } from "@/lib/xhsLink";
import type { FeishuCollectRecord } from "@/types";

const REWRITE_TABLE_ID = runtimeConfig.feishu.rewriteTableId;
const REPLACE_INFO_FIELD_NAMES = {
  title: "标题替换信息",
  body: "正文替换信息",
  cover: "封面文案替换信息",
} as const;

type RewriteSnapshot = {
  rewriteTimestamp: number;
  rewriteTitleReplaceInfo: string;
  rewriteBodyReplaceInfo: string;
  rewriteCoverReplaceInfo: string;
  rewriteDate: string;
  rewriteTitle: string;
  rewriteBody: string;
  rewriteCover: string;
  rewriteCoverText: string;
  rewriteTags: string[];
  publishPersona: string;
};

/** 安全取数字 */
function toNum(v: unknown): number {
  if (v === null || v === undefined) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") return Number(v) || 0;
  return 0;
}

/** 安全取字符串 */
function toStr(v: unknown): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) return v.map(toStr).join("");
  if (typeof v === "object" && v !== null) {
    const obj = v as Record<string, unknown>;
    if (obj.text) return String(obj.text);
    if (obj.link) return String(obj.link);
  }
  return String(v);
}

function toLinkUrl(v: unknown): string {
  if (!v) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && v !== null) {
    const obj = v as Record<string, unknown>;
    if (typeof obj.link === "string") return obj.link;
    if (typeof obj.url === "string") return obj.url;
    if (typeof obj.text === "string") return obj.text;
  }
  return "";
}

function toTimestamp(v: unknown): number {
  if (!v) return 0;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const numeric = Number(v);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
    const parsed = Date.parse(v);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function normalizeNoteLink(link: string): string {
  const openableLink = buildOpenableNoteLink(link);
  if (!openableLink) return "";

  try {
    const url = new URL(openableLink);
    url.hash = "";
    return url.toString();
  } catch {
    return openableLink;
  }
}

function buildRewriteLookupKeys(params: { sourceRecordId?: string; noteLink?: string }) {
  const sourceRecordId = params.sourceRecordId?.trim();
  const noteLink = params.noteLink || "";
  const noteId = extractNoteIdFromLink(noteLink).trim().toLowerCase();
  const normalizedLink = normalizeNoteLink(noteLink);
  const keys = new Set<string>();

  if (sourceRecordId) {
    keys.add(`record:${sourceRecordId}`);
  }
  if (noteId) {
    keys.add(`note:${noteId}`);
  }
  if (normalizedLink) {
    keys.add(`link:${normalizedLink}`);
  }

  return Array.from(keys);
}

function parseTags(v: unknown): string[] {
  const raw = toStr(v).trim();
  if (!raw) return [];
  if (["无", "暂无标签", "-", "—"].includes(raw)) return [];

  const extracted = extractTagsFromText(raw);
  if (extracted.length > 0) return extracted;

  return dedupeTags(raw.split(/[\s、，,]+/));
}

/** 取附件URL */
function toAttachmentUrl(v: unknown): string {
  if (!v) return "";
  if (Array.isArray(v) && v.length > 0) {
    const first = v[0] as Record<string, unknown>;
    return (first.tmp_url || first.url || first.link || "") as string;
  }
  if (typeof v === "string") return v;
  return "";
}

function toAttachmentUrls(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((item) => {
      if (!item || typeof item !== "object") return "";
      const attachment = item as Record<string, unknown>;
      return String(attachment.tmp_url || attachment.url || attachment.link || "");
    })
    .filter(Boolean);
}

function buildRewriteSnapshot(fields: Record<string, unknown>): RewriteSnapshot {
  const rewriteTags = parseTags(fields["二创标签"]);
  const rewriteDate = tsToStr(fields["二创日期"]);

  return {
    rewriteTimestamp: toTimestamp(fields["二创日期"]),
    rewriteTitleReplaceInfo: toStr(fields[REPLACE_INFO_FIELD_NAMES.title]),
    rewriteBodyReplaceInfo: toStr(fields[REPLACE_INFO_FIELD_NAMES.body]),
    rewriteCoverReplaceInfo: toStr(fields[REPLACE_INFO_FIELD_NAMES.cover]),
    rewriteDate,
    rewriteTitle: toStr(fields["二创标题"]),
    rewriteBody: toStr(fields["二创正文"]),
    rewriteCover: toAttachmentUrl(fields["二创封面"]),
    rewriteCoverText: toStr(fields["二创封面文案"]),
    rewriteTags,
    publishPersona: toStr(fields["发布人设"]),
  };
}

function pickNewerSnapshot(current: RewriteSnapshot | undefined, incoming: RewriteSnapshot) {
  if (!current) return incoming;
  return incoming.rewriteTimestamp >= current.rewriteTimestamp ? incoming : current;
}

async function loadRewriteSnapshotIndex() {
  const index = new Map<string, RewriteSnapshot>();

  if (!REWRITE_TABLE_ID) {
    return index;
  }

  let pageToken: string | undefined;

  while (true) {
    const result = await getRecordsInTable(REWRITE_TABLE_ID, 100, pageToken);

    for (const item of result.items || []) {
      const fields = item.fields;
      const snapshot = buildRewriteSnapshot(fields);
      const keys = buildRewriteLookupKeys({
        sourceRecordId: toStr(fields["源记录ID"]),
        noteLink: toLinkUrl(fields["笔记链接"]),
      });

      keys.forEach((key) => {
        index.set(key, pickNewerSnapshot(index.get(key), snapshot));
      });
    }

    if (!result.has_more || !result.page_token) break;
    pageToken = result.page_token;
  }

  return index;
}

function findRewriteSnapshot(
  recordId: string,
  noteLink: string,
  rewriteSnapshotIndex: Map<string, RewriteSnapshot>
) {
  const keys = buildRewriteLookupKeys({
    sourceRecordId: recordId,
    noteLink,
  });

  for (const key of keys) {
    const snapshot = rewriteSnapshotIndex.get(key);
    if (snapshot) return snapshot;
  }

  return undefined;
}

function tsToStr(v: unknown): string {
  if (!v) return "";
  if (typeof v === "string") {
    return v.slice(0, 16);
  }
  const ts = typeof v === "number" ? v : Number(v);
  if (!ts) return "";
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export async function GET() {
  try {
    let allItems: Array<{ record_id: string; fields: Record<string, unknown> }> = [];
    let pageToken: string | undefined;
    const rewriteSnapshotIndex = await loadRewriteSnapshotIndex();

    // 循环拉取所有记录（处理分页）
    while (true) {
      const result = await getCollectRecords(100, pageToken);
      allItems = allItems.concat(result.items || []);
      if (!result.has_more || !result.page_token) break;
      pageToken = result.page_token;
    }

    const records: FeishuCollectRecord[] = allItems.map((item) => {
      const f = item.fields;
      const noteLink = buildOpenableNoteLink(toLinkUrl(f["笔记链接"]));
      const rewriteSnapshot = findRewriteSnapshot(
        item.record_id,
        noteLink,
        rewriteSnapshotIndex
      );
      const rewriteTagsFromCollect = parseTags(f["二创标签"]);

      return {
        recordId: item.record_id,
        collectDate: tsToStr(f["采集日期"]),
        searchKeyword: toStr(f["搜索关键词"]),
        noteLink,
        publishTime: tsToStr(f["发布时间"]),
        likedCount: toNum(f["点赞数"]),
        collectedCount: toNum(f["收藏数"]),
        commentCount: toNum(f["评论数"]),
        shareCount: toNum(f["转发数"]),
        cover: toAttachmentUrl(f["封面"]),
        coverText: toStr(f["封面文案"]),
        rewriteTitleReplaceInfo:
          toStr(f[REPLACE_INFO_FIELD_NAMES.title]) ||
          rewriteSnapshot?.rewriteTitleReplaceInfo ||
          "",
        rewriteBodyReplaceInfo:
          toStr(f[REPLACE_INFO_FIELD_NAMES.body]) ||
          rewriteSnapshot?.rewriteBodyReplaceInfo ||
          "",
        rewriteCoverReplaceInfo:
          toStr(f[REPLACE_INFO_FIELD_NAMES.cover]) ||
          rewriteSnapshot?.rewriteCoverReplaceInfo ||
          "",
        rewriteDate: tsToStr(f["二创日期"]) || rewriteSnapshot?.rewriteDate || "",
        rewriteTitle: toStr(f["二创标题"]) || rewriteSnapshot?.rewriteTitle || "",
        rewriteBody: toStr(f["二创正文"]) || rewriteSnapshot?.rewriteBody || "",
        rewriteCover:
          toAttachmentUrl(f["二创封面"]) ||
          rewriteSnapshot?.rewriteCover ||
          toAttachmentUrls(f["封面"])[1] ||
          "",
        rewriteCoverText:
          toStr(f["二创封面文案"]) || rewriteSnapshot?.rewriteCoverText || "",
        rewriteTags:
          rewriteTagsFromCollect.length > 0
            ? rewriteTagsFromCollect
            : rewriteSnapshot?.rewriteTags || [],
        publishPersona:
          toStr(f["发布人设"]) ||
          rewriteSnapshot?.publishPersona ||
          "",
        hasRewritten: Boolean(f["已二创"]) || Boolean(rewriteSnapshot),
        // 标题和正文字段（实际字段名已确认）
        originalTitle: toStr(f["标题"]),
        originalBody: stripTagsFromText(toStr(f["正文"])),
        originalTags: parseTags(f["标签"]),
      };
    });

    return NextResponse.json({ records, total: records.length });
  } catch (e: unknown) {
    console.error("Feishu records error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "获取记录失败" },
      { status: 500 }
    );
  }
}
