import { fetchImageAsDataUrl } from "@/lib/serverImage";
import { runtimeConfig } from "@/lib/runtimeConfig";

const DASHSCOPE_API_KEY = runtimeConfig.dashscope.apiKey;
const DASHSCOPE_BASE_URL = runtimeConfig.dashscope.baseUrl;
const DASHSCOPE_VISION_MODEL = runtimeConfig.dashscope.visionModel;

const EMPTY_IMAGE_TEXT_PATTERNS = [
  /^(图中|图片中)?无(可见)?(文字|文案|文本|内容)[。！!,.，、\s]*$/u,
  /^(图中|图片中)?未(识别到|检测到|发现)(任何)?(可见)?(文字|文案|文本|内容)[。！!,.，、\s]*$/u,
  /^(图中|图片中)?没有(任何)?(可见)?(文字|文案|文本|内容)[。！!,.，、\s]*$/u,
  /^(无|暂无|空白|纯图片|仅图片|没有)[。！!,.，、\s]*$/u,
];

export function sanitizeExtractedImageText(value: string): string {
  const normalized = value
    .replace(/^#?\s*图[一二三四五六七八九十0-9]+\s*[:：]\s*/gim, "")
    .replace(/^封面文案\s*[:：]\s*/gim, "")
    .replace(/^文案\s*[:：]\s*/gim, "")
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .trim();

  if (!normalized) return "";

  if (EMPTY_IMAGE_TEXT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "";
  }

  return normalized;
}

export async function extractCoverTextFromImageUrl(
  imageUrl: string,
  model = DASHSCOPE_VISION_MODEL
): Promise<string> {
  const imageDataUrl = await fetchImageAsDataUrl(imageUrl);
  const prompt =
    "提取图片中所有可见文案，只输出文案内容本身，保留原有换行。禁止输出图一、图二、文案如下、说明、编号或其他额外内容。";

  const resp = await fetch(`${DASHSCOPE_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DASHSCOPE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: imageDataUrl } },
            { type: "text", text: prompt },
          ],
        },
      ],
      max_tokens: 512,
    }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(
      `DashScope vision error: ${data.error?.message || JSON.stringify(data)}`
    );
  }

  return sanitizeExtractedImageText(data.choices?.[0]?.message?.content || "");
}
