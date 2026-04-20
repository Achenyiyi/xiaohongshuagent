import { PROHIBITED_WORDS } from "@/lib/prompts";

const DEFAULT_REPLACE_INFO_TEXT = "暂无替换信息，请根据笔记内容进行通用改写";
const REPLACE_INFO_VARIABLE = "{{REPLACE_INFO}}";
const PROHIBITED_WORDS_VARIABLE = "{{PROHIBITED_WORDS}}";
const ORIGINAL_AND_REWRITTEN_VARIABLE = "{{ORIGINAL_AND_REWRITTEN}}";

function replaceTemplateVariableIfPresent(
  template: string,
  variableName: string,
  injectedContent: string
) {
  if (!template.includes(variableName)) {
    return template;
  }

  return template.split(variableName).join(injectedContent);
}

function injectTemplateVariable(
  template: string,
  variableName: string,
  injectedContent: string,
  fallbackHeading: string
) {
  if (template.includes(variableName)) {
    return template.split(variableName).join(injectedContent);
  }

  const trimmedTemplate = template.trimEnd();
  const separator = trimmedTemplate ? "\n\n" : "";
  return `${trimmedTemplate}${separator}${fallbackHeading}\n\n${injectedContent}`;
}

export function injectReplaceInfo(template: string, replaceInfo: string) {
  return injectTemplateVariable(
    template,
    REPLACE_INFO_VARIABLE,
    replaceInfo || DEFAULT_REPLACE_INFO_TEXT,
    "## 替换信息"
  );
}

export function injectProhibitedWords(template: string) {
  return injectTemplateVariable(
    template,
    PROHIBITED_WORDS_VARIABLE,
    PROHIBITED_WORDS,
    "## 严禁包含的违禁词"
  );
}

export function hasReplaceInfoPlaceholder(template: string) {
  return template.includes(REPLACE_INFO_VARIABLE);
}

export function replaceReplaceInfoIfPresent(template: string, replaceInfo: string) {
  return replaceTemplateVariableIfPresent(
    template,
    REPLACE_INFO_VARIABLE,
    replaceInfo || DEFAULT_REPLACE_INFO_TEXT
  );
}

export function replaceProhibitedWordsIfPresent(template: string) {
  return replaceTemplateVariableIfPresent(template, PROHIBITED_WORDS_VARIABLE, PROHIBITED_WORDS);
}

export function buildOriginalAndRewrittenBlock(
  original: { title: string; body: string; coverText: string },
  rewritten: { title: string; body: string; coverText: string }
) {
  return `原始标题：${original.title}
原始正文：${original.body}
原始封面文案：${original.coverText}

二创标题：${rewritten.title}
二创正文：${rewritten.body}
二创封面文案：${rewritten.coverText}`;
}

export function injectOriginalAndRewritten(
  template: string,
  original: { title: string; body: string; coverText: string },
  rewritten: { title: string; body: string; coverText: string }
) {
  return injectTemplateVariable(
    template,
    ORIGINAL_AND_REWRITTEN_VARIABLE,
    buildOriginalAndRewrittenBlock(original, rewritten),
    "## 原文与二创内容"
  );
}

export function hasOriginalAndRewrittenPlaceholder(template: string) {
  return template.includes(ORIGINAL_AND_REWRITTEN_VARIABLE);
}

export function replaceOriginalAndRewrittenIfPresent(
  template: string,
  original: { title: string; body: string; coverText: string },
  rewritten: { title: string; body: string; coverText: string }
) {
  return replaceTemplateVariableIfPresent(
    template,
    ORIGINAL_AND_REWRITTEN_VARIABLE,
    buildOriginalAndRewrittenBlock(original, rewritten)
  );
}
