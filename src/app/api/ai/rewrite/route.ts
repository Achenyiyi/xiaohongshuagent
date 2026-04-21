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
type PromptMode = "default" | "custom";

function normalizePromptMode(value: unknown): PromptMode {
  return value === "custom" ? "custom" : "default";
}

function buildPromptBlock(label: string, content: string) {
  return `【${label}】\n${content || "（空）"}`;
}

function buildCustomRewriteUserContent(args: {
  type: "title" | "body" | "cover-text";
  content?: string;
  replaceInfo?: string;
  promptIncludesReplaceInfo: boolean;
  originalTitle?: string;
  originalBody?: string;
  originalCoverText?: string;
  rewrittenTitle?: string;
  rewrittenBody?: string;
}) {
  const sections: string[] = [];

  if (args.type === "title") {
    sections.push(buildPromptBlock("原始标题", args.content || ""));
    if (!args.promptIncludesReplaceInfo && args.replaceInfo) {
      sections.push(buildPromptBlock("替换关键词", args.replaceInfo));
    }
    sections.push("直接输出最终标题，不要解释。");
    return sections.join("\n\n");
  }

  if (args.type === "body") {
    sections.push(buildPromptBlock("原笔记正文", args.content || ""));
    if (!args.promptIncludesReplaceInfo && args.replaceInfo) {
      sections.push(buildPromptBlock("替换关键词", args.replaceInfo));
    }
    sections.push("直接输出最终改写后的正文，不要解释。");
    return sections.join("\n\n");
  }

  sections.push(buildPromptBlock("原始标题", args.originalTitle || ""));
  sections.push(buildPromptBlock("原始正文", args.originalBody || ""));
  sections.push(
    buildPromptBlock("原始封面文案", args.originalCoverText || "（无封面文案，请从标题和正文提炼）")
  );
  sections.push(buildPromptBlock("当前二创标题", args.rewrittenTitle || ""));
  sections.push(buildPromptBlock("当前二创正文", args.rewrittenBody || ""));
  if (!args.promptIncludesReplaceInfo && args.replaceInfo) {
    sections.push(buildPromptBlock("替换关键词", args.replaceInfo));
  }
  sections.push("直接输出最终封面逐行文案，不要解释。");
  return sections.join("\n\n");
}

function normalizeGeneratedCoverCopy(raw: string) {
  const sanitized = sanitizeExtractedImageText(raw || "");
  if (!sanitized) return "";

  const lines = sanitized
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim());

  const mainMatch = lines.find((line) => /^主标题[：:]/.test(line));
  const subMatch = lines.find((line) => /^副标题[：:]/.test(line));

  if (mainMatch || subMatch) {
    const normalizedLines = [
      mainMatch?.replace(/^主标题[：:]\s*/, "").trim() || "",
      ...(subMatch
        ? subMatch
            .replace(/^副标题[：:]\s*/, "")
            .split(/[\/／]/)
            .map((line) => line.trim())
        : []),
    ].filter(Boolean);

    return normalizedLines.join("\n");
  }

  const structuredLines: string[] = [];
  let containsStructuredRows = false;

  lines.forEach((line) => {
    if (!line) return;
    if (/^版式[：:]/.test(line)) {
      containsStructuredRows = true;
      return;
    }

    const lineMatch = line.match(/^第[1-9]行[：:]\s*(.+)$/);
    if (lineMatch) {
      containsStructuredRows = true;
      structuredLines.push(lineMatch[1].trim());
      return;
    }

    const emphasisMatch = line.match(/^强调词[：:]\s*(.+)$/);
    if (emphasisMatch) {
      containsStructuredRows = true;
      const emphasis = emphasisMatch[1].trim();
      if (emphasis) structuredLines.push(emphasis);
      return;
    }

    structuredLines.push(line);
  });

  if (containsStructuredRows) {
    return structuredLines.filter(Boolean).join("\n");
  }

  return structuredLines.join("\n");
}

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
      promptMode: rawPromptMode,
      promptIncludesReplaceInfo = false,
    } = await req.json();
    const promptMode = normalizePromptMode(rawPromptMode);

    if (type === "title") {
      const systemPrompt = customSystemPrompt || buildTitleRewriteSystemPrompt();
      const userContent =
        promptMode === "custom"
          ? buildCustomRewriteUserContent({
              type,
              content,
              replaceInfo,
              promptIncludesReplaceInfo,
            })
          : `请对以下标题进行二创优化：\n${content}`;
      const result = await callDashScope(
        systemPrompt,
        userContent,
        DASHSCOPE_TEXT_MODEL
      );
      return NextResponse.json({ result: result.trim() });
    }

    if (type === "body") {
      const systemPrompt = customSystemPrompt || buildBodyRewriteSystemPrompt(replaceInfo || "");
      const userContent =
        promptMode === "custom"
          ? buildCustomRewriteUserContent({
              type,
              content,
              replaceInfo,
              promptIncludesReplaceInfo,
            })
          : `以下是参考文案，请进行仿写：\n\n${content}`;
      const result = await callDashScope(
        systemPrompt,
        userContent,
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
      const userContent =
        promptMode === "custom"
          ? buildCustomRewriteUserContent({
              type,
              replaceInfo,
              promptIncludesReplaceInfo,
              originalTitle,
              originalBody,
              originalCoverText,
              rewrittenTitle,
              rewrittenBody,
            })
          : [
              `原始标题：${originalTitle || ""}`,
              `原始正文：${originalBody || ""}`,
              `原始封面文案：${originalCoverText || "（无封面文案，请从二创标题和正文提炼）"}`,
              `二创标题：${rewrittenTitle || ""}`,
              `二创正文：${rewrittenBody || ""}`,
            ].join("\n");
      const raw = await callDashScope(
        systemPrompt,
        userContent,
        DASHSCOPE_TEXT_MODEL
      );
      return NextResponse.json({ result: normalizeGeneratedCoverCopy(raw) });
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
