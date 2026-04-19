import "server-only";

import { getTenantAccessToken } from "@/lib/feishu";
import { getImageRequestHeaders, isFeishuMediaUrl, normalizeImageUrl } from "@/lib/image";

async function fetchFeishuImage(url: string) {
  const token = await getTenantAccessToken();
  const headers = { Authorization: `Bearer ${token}` };

  if (url.includes("/batch_get_tmp_download_url")) {
    const metaResp = await fetch(url, { headers });
    const meta = await metaResp.json();

    if (meta.code !== 0) {
      throw new Error(`飞书附件临时地址获取失败: ${meta.msg}`);
    }

    const downloadUrl = meta.data?.tmp_download_urls?.[0]?.tmp_download_url as string | undefined;
    if (!downloadUrl) {
      throw new Error("飞书附件临时下载地址为空");
    }

    return fetch(downloadUrl);
  }

  return fetch(url, { headers });
}

export async function fetchImageResponse(imageUrl: string) {
  const normalizedUrl = normalizeImageUrl(imageUrl);
  return isFeishuMediaUrl(normalizedUrl)
    ? fetchFeishuImage(normalizedUrl)
    : fetch(normalizedUrl, {
        headers: getImageRequestHeaders(normalizedUrl),
        redirect: "follow",
      });
}

export async function fetchImageAsDataUrl(imageUrl: string) {
  const resp = await fetchImageResponse(imageUrl);

  if (!resp.ok) {
    throw new Error(`图片下载失败: ${resp.status}`);
  }

  const contentType = (resp.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
  const base64 = Buffer.from(await resp.arrayBuffer()).toString("base64");
  return `data:${contentType};base64,${base64}`;
}

