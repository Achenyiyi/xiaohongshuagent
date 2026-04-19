import { normalizeImageUrl } from "@/lib/image";

const INVALID_TITLE_VALUES = new Set(["无", "暂无标题", "null", "undefined"]);
const TOPIC_TAG_PATTERN = /#\s*[^\s#、，,]+(?:\[话题\])?/g;
const STANDALONE_HASH_PATTERN = /(^|[\s\u3000])#+(?=($|[\s\u3000]))/g;
const LEADING_HASH_NOISE_PATTERN = /(^|\n)\s*(?:#\s*)+(?=[^\s#])/g;
const URL_LIKE_TEXT_PATTERN =
  /^(https?:\/\/|www\.|xiaohongshu\.com\/|www\.xiaohongshu\.com\/|xhslink\.com\/|www\.xhslink\.com\/|\/explore\/)/i;

function toString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

export function toNumber(value: unknown, fallback = 0): number {
  if (value === null || value === undefined || value === "") return fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function sanitizeTitle(title: string): string {
  const normalized = title.trim();
  if (URL_LIKE_TEXT_PATTERN.test(normalized)) return "";
  return INVALID_TITLE_VALUES.has(normalized) ? "" : normalized;
}

export function normalizeTag(tag: string): string {
  const normalized = tag
    .trim()
    .replace(/^#+/, "")
    .replace(/\[话题\]/g, "")
    .replace(/[、，,]+$/g, "")
    .trim();

  return normalized ? `#${normalized}` : "";
}

export function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const tag of tags) {
    const normalized = normalizeTag(tag);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }

  return result;
}

export function formatTagsForStorage(tags: string[]): string {
  return dedupeTags(tags).join(" ");
}

export function extractTagsFromText(text: string): string[] {
  const matches = text.match(TOPIC_TAG_PATTERN) || [];
  return dedupeTags(matches);
}

export function stripTagsFromText(text: string): string {
  const withoutTags = text.replace(TOPIC_TAG_PATTERN, " ");

  return withoutTags
    .replace(/\[话题\]/g, " ")
    .replace(STANDALONE_HASH_PATTERN, " ")
    .replace(LEADING_HASH_NOISE_PATTERN, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function isTagOnlyText(text: string): boolean {
  return stripTagsFromText(text).length === 0;
}

export function pickSearchImageUrl(image: Record<string, unknown>): string {
  return normalizeImageUrl(
    toString(image.url_default) ||
      toString(image.url_size_large) ||
      toString(image.url) ||
      ""
  );
}

export function pickDetailImageUrl(image: Record<string, unknown>): string {
  const infoList = Array.isArray(image.info_list)
    ? (image.info_list as Array<Record<string, unknown>>)
    : [];

  for (const info of infoList) {
    const url = normalizeImageUrl(toString(info.url));
    if (url) return url;
  }

  return normalizeImageUrl(toString(image.url));
}

export function buildSearchNoteLink(noteId: string, xsecToken?: string): string {
  if (!noteId) return "";

  if (xsecToken) {
    const url = new URL(`https://www.xiaohongshu.com/explore/${noteId}`);
    url.searchParams.set("xsec_token", xsecToken);
    url.searchParams.set("xsec_source", "pc_search");
    return url.toString();
  }

  return `https://www.xiaohongshu.com/explore/${noteId}`;
}
