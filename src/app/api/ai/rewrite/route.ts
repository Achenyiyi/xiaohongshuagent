import { NextRequest, NextResponse } from "next/server";
import {
  buildCoverRewriteSystemPrompt,
  buildBodyRewriteSystemPrompt,
  buildTitleRewriteSystemPrompt,
} from "@/lib/prompts";
import { extractCoverTextFromImageUrl, sanitizeExtractedImageText } from "@/lib/coverText";
import { runtimeConfig } from "@/lib/runtimeConfig";

const DASHSCOPE_API_KEY = runtimeConfig.dashscope.apiKey;
const DASHSCOPE_BASE_URL = runtimeConfig.dashscope.baseUrl;
const DASHSCOPE_TEXT_MODEL = runtimeConfig.dashscope.textModel;
const DASHSCOPE_VISION_MODEL = runtimeConfig.dashscope.visionModel;

/**
 * 调用 DashScope（阿里云）文本模型
 */
async function callDashScope(
  systemPrompt: string,
  userContent: string,
  model = DASHSCOPE_TEXT_MODEL
): Promise<string> {
  const resp = await fetch(`${DASHSCOPE_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${DASHSCOPE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      temperature: 0.7,
      max_tokens: 2048,
    }),
  });
  const data = await resp.json();
  if (!resp.ok) {
    throw new Error(
      `DashScope error: ${data.error?.message || JSON.stringify(data)}`
    );
  }
  return data.choices?.[0]?.message?.content || "";
}

export async function POST(req: NextRequest) {
  try {
    const {
      type, // "title" | "body" | "extract-image-text"
      content, // 正文或标题文本
      imageUrl, // 用于图片文案提取
      replaceInfo, // 替换信息
      originalTitle,
      originalBody,
      originalCoverText,
      rewrittenTitle,
      rewrittenBody,
      systemPrompt: customSystemPrompt, // 客户端传入的自定义提示词（可选）
    } = await req.json();

    if (type === "title") {
      const systemPrompt = customSystemPrompt || buildTitleRewriteSystemPrompt();
      const result = await callDashScope(
        systemPrompt,
        `请对以下标题进行二创优化：\n${content}`,
        DASHSCOPE_TEXT_MODEL
      );
      return NextResponse.json({ result: result.trim() });
    }

    if (type === "body") {
      const systemPrompt = customSystemPrompt || buildBodyRewriteSystemPrompt(replaceInfo || "");
      const result = await callDashScope(
        systemPrompt,
        `以下是参考文案，请进行仿写：\n\n${content}`,
        DASHSCOPE_TEXT_MODEL
      );
      return NextResponse.json({ result: result.trim() });
    }

    if (type === "extract-image-text") {
      if (!imageUrl) {
        return NextResponse.json({ error: "缺少imageUrl" }, { status: 400 });
      }
      const result = await extractCoverTextFromImageUrl(imageUrl, DASHSCOPE_VISION_MODEL);
      return NextResponse.json({ result });
    }

    if (type === "cover-text") {
      const systemPrompt = customSystemPrompt || buildCoverRewriteSystemPrompt(replaceInfo || "");
      const raw = await callDashScope(
        systemPrompt,
        [
          `原始标题：${originalTitle || ""}`,
          `原始正文：${originalBody || ""}`,
          `原始封面文案：${originalCoverText || "（无封面文案，请从二创标题和正文提炼）"}`,
          `二创标题：${rewrittenTitle || ""}`,
          `二创正文：${rewrittenBody || ""}`,
        ].join("\n"),
        DASHSCOPE_TEXT_MODEL
      );
      // 解析结构化输出：主标题 + 副标题
      const mainMatch = raw.match(/主标题[：:]\s*(.+)/);
      const subMatch = raw.match(/副标题[：:]\s*(.+)/);
      let result = raw.trim();
      if (mainMatch && subMatch) {
        const mainTitle = mainMatch[1].trim();
        const subTitle = subMatch[1].trim().replace(/\//g, "\n");
        result = `${mainTitle}\n${subTitle}`;
      }
      return NextResponse.json({ result: sanitizeExtractedImageText(result) });
    }

    return NextResponse.json({ error: `未知type: ${type}` }, { status: 400 });
  } catch (e: unknown) {
    console.error("AI rewrite error:", e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "AI处理失败" },
      { status: 500 }
    );
  }
}
