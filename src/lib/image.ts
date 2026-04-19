const DEFAULT_IMAGE_ACCEPT =
  "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

export function normalizeImageUrl(url: string): string {
  if (!url) return "";

  return url
    .replace(/format\/heif/gi, "format/jpg")
    .replace(/format\/heic/gi, "format/jpg");
}

export function getImageRequestHeaders(url: string): HeadersInit {
  const normalizedUrl = normalizeImageUrl(url);

  if (normalizedUrl.includes("xhscdn.com") || normalizedUrl.includes("xiaohongshu.com")) {
    return {
      Referer: "https://www.xiaohongshu.com",
      "User-Agent": DEFAULT_USER_AGENT,
      Accept: DEFAULT_IMAGE_ACCEPT,
    };
  }

  return {
    "User-Agent": DEFAULT_USER_AGENT,
    Accept: DEFAULT_IMAGE_ACCEPT,
  };
}

export function isFeishuMediaUrl(url: string) {
  return url.includes("open.feishu.cn/open-apis/drive/v1/medias");
}

export function guessImageExtension(contentType?: string | null, url?: string): string {
  const mime = (contentType || "").toLowerCase();

  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("bmp")) return "bmp";

  const normalizedUrl = normalizeImageUrl(url || "");
  const match = normalizedUrl.match(/\.([a-z0-9]+)(?:[?#]|$)/i);
  if (match?.[1]) {
    const ext = match[1].toLowerCase();
    if (["jpg", "jpeg", "png", "webp", "gif", "bmp"].includes(ext)) {
      return ext === "jpeg" ? "jpg" : ext;
    }
  }

  return "jpg";
}
