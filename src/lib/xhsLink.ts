const XHS_URL_PATTERN =
  /((?:https?:\/\/)?(?:www\.)?(?:xiaohongshu\.com|xhslink\.com)\/[^\s<>"'`]+)/gi;
const TRAILING_URL_PUNCTUATION_PATTERN = /[。。，,！!？?；;：:）)\]】》>」』"'`]+$/u;
const LEADING_URL_PUNCTUATION_PATTERN = /^[（(\[【《<「『"'`]+/u;

function ensureProtocol(value: string) {
  if (/^https?:\/\//i.test(value)) return value;
  if (/^(?:www\.)?(?:xiaohongshu\.com|xhslink\.com)\//i.test(value)) {
    return `https://${value}`;
  }
  return value;
}

function stripOuterPunctuation(value: string) {
  return value
    .trim()
    .replace(LEADING_URL_PUNCTUATION_PATTERN, "")
    .replace(TRAILING_URL_PUNCTUATION_PATTERN, "");
}

function sanitizeCandidateLink(value: string) {
  return ensureProtocol(stripOuterPunctuation(value));
}

function safeDecodeURIComponent(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function unwrapRedirectPath(url: URL): string {
  const redirectPath = url.searchParams.get("redirectPath");
  return redirectPath ? safeDecodeURIComponent(redirectPath) : "";
}

function toUrl(value: string): URL | null {
  const sanitized = sanitizeCandidateLink(value);
  if (!sanitized) return null;

  try {
    return new URL(sanitized);
  } catch {
    return null;
  }
}

function isXiaohongshuHost(hostname: string) {
  return hostname === "xiaohongshu.com" || hostname.endsWith(".xiaohongshu.com");
}

export function isXhsShortLink(link: string) {
  const url = toUrl(link);
  if (!url) return false;
  const hostname = url.hostname.toLowerCase();
  return hostname === "xhslink.com" || hostname.endsWith(".xhslink.com");
}

export function extractXhsLinksFromText(text: string) {
  const matches = Array.from(text.matchAll(XHS_URL_PATTERN), (match) =>
    sanitizeCandidateLink(match[1] || "")
  ).filter(Boolean);

  const seen = new Set<string>();
  const result: string[] = [];

  for (const link of matches) {
    const key = link.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(link);
  }

  return result;
}

export function pickFirstXhsLink(text: string) {
  return extractXhsLinksFromText(text)[0] || "";
}

export function extractNoteIdFromLink(link: string): string {
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

    return (
      url.searchParams.get("noteId") ||
      url.searchParams.get("note_id") ||
      ""
    );
  }

  const match =
    candidate.match(/\/explore\/([^/?#]+)/i) ||
    candidate.match(/\/discovery\/item\/([^/?#]+)/i);

  return match?.[1] || "";
}

export function buildOpenableNoteLink(link: string, fallbackNoteId?: string): string {
  const candidate = pickFirstXhsLink(link) || sanitizeCandidateLink(link);

  if (candidate) {
    const url = toUrl(candidate);

    if (url) {
      const redirected = unwrapRedirectPath(url);
      if (redirected) {
        return buildOpenableNoteLink(redirected, fallbackNoteId);
      }

      url.hash = "";

      const hostname = url.hostname.toLowerCase();
      if (isXiaohongshuHost(hostname) || isXhsShortLink(url.toString())) {
        return url.toString();
      }
    }
  }

  if (fallbackNoteId) {
    return `https://www.xiaohongshu.com/explore/${fallbackNoteId}`;
  }

  return candidate;
}
