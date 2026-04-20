"use client";

import { useMemo, useState } from "react";
import { RotateCcw, Save, ChevronDown, ChevronUp, Info } from "lucide-react";
import clsx from "clsx";
import {
  usePromptsSettingsStore,
  DEFAULT_BODY_REWRITE_PROMPT,
  DEFAULT_TITLE_REWRITE_PROMPT,
  DEFAULT_COVER_REWRITE_PROMPT,
  DEFAULT_EXTRACT_REPLACE_PROMPT,
} from "@/store/promptsSettingsStore";

interface PromptSection {
  key: "bodyRewritePrompt" | "titleRewritePrompt" | "coverRewritePrompt" | "extractReplacePrompt";
  label: string;
  desc: string;
  placeholder: string;
  defaultValue: string;
  variables: { name: string; desc: string }[];
}

const SECTIONS: PromptSection[] = [
  {
    key: "bodyRewritePrompt",
    label: "正文二创提示词",
    desc: "控制 AI 如何对笔记正文进行仿写改写",
    placeholder: "输入正文二创的系统提示词...",
    defaultValue: DEFAULT_BODY_REWRITE_PROMPT,
    variables: [
      { name: "{{REPLACE_INFO}}", desc: "正文替换词库，自动注入" },
      { name: "{{PROHIBITED_WORDS}}", desc: "违禁词列表，自动注入" },
    ],
  },
  {
    key: "titleRewritePrompt",
    label: "标题二创提示词",
    desc: "控制 AI 如何生成爆款标题",
    placeholder: "输入标题二创的系统提示词...",
    defaultValue: DEFAULT_TITLE_REWRITE_PROMPT,
    variables: [
      { name: "{{REPLACE_INFO}}", desc: "标题替换词库，自动注入" },
      { name: "{{PROHIBITED_WORDS}}", desc: "违禁词列表，自动注入" },
    ],
  },
  {
    key: "coverRewritePrompt",
    label: "封面文案提示词",
    desc: "控制 AI 如何生成大字报风格的封面主标题和副标题",
    placeholder: "输入封面文案的系统提示词...",
    defaultValue: DEFAULT_COVER_REWRITE_PROMPT,
    variables: [
      { name: "{{REPLACE_INFO}}", desc: "封面文案替换词库，自动注入" },
      { name: "{{PROHIBITED_WORDS}}", desc: "违禁词列表，自动注入" },
    ],
  },
  {
    key: "extractReplacePrompt",
    label: "提取替换词提示词",
    desc: "控制 AI 如何从原文与二创文中自动提取替换规律",
    placeholder: "输入提取替换词的提示词...",
    defaultValue: DEFAULT_EXTRACT_REPLACE_PROMPT,
    variables: [
      { name: "{{ORIGINAL_AND_REWRITTEN}}", desc: "原文与二创文内容，自动注入" },
    ],
  },
];

function PromptCard({
  section,
  value,
  onChange,
  onReset,
}: {
  section: PromptSection;
  value: string;
  onChange: (v: string) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(true);
  const isDirty = value !== section.defaultValue;

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3 text-left">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-800">{section.label}</span>
              {isDirty && (
                <span className="text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                  已修改
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">{section.desc}</p>
          </div>
        </div>
        <span className="text-gray-400 flex-shrink-0 ml-4">
          {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </span>
      </button>

      {open && (
        <div className="px-5 pb-5 border-t border-gray-100">
          <div className="mt-3 mb-3 flex flex-wrap gap-2">
            {section.variables.map((v) => (
              <div
                key={v.name}
                className="flex items-center gap-1.5 bg-blue-50 border border-blue-100 rounded-lg px-2.5 py-1"
              >
                <Info className="w-3 h-3 text-blue-400 flex-shrink-0" />
                <code className="text-xs text-blue-700 font-mono">{v.name}</code>
                <span className="text-xs text-blue-500">{v.desc}</span>
              </div>
            ))}
          </div>

          <textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={section.placeholder}
            rows={14}
            className="w-full text-sm font-mono bg-gray-50 border border-gray-200 rounded-lg px-3 py-3 text-gray-800 resize-y focus:outline-none focus:ring-2 focus:ring-red-400 focus:border-transparent leading-relaxed"
          />

          {isDirty && (
            <button
              onClick={onReset}
              className="mt-2 flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              恢复默认
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdvancedSettingsModule() {
  const store = usePromptsSettingsStore();
  const persistedPrompts = useMemo(
    () => ({
      bodyRewritePrompt: store.bodyRewritePrompt,
      titleRewritePrompt: store.titleRewritePrompt,
      coverRewritePrompt: store.coverRewritePrompt,
      extractReplacePrompt: store.extractReplacePrompt,
    }),
    [
      store.bodyRewritePrompt,
      store.titleRewritePrompt,
      store.coverRewritePrompt,
      store.extractReplacePrompt,
    ]
  );

  const [drafts, setDrafts] = useState<Record<string, string> | null>(null);
  const [saved, setSaved] = useState(false);

  const effectiveDrafts = drafts ?? persistedPrompts;
  const hasChanges = SECTIONS.some((section) => effectiveDrafts[section.key] !== store[section.key]);

  function handleChange(key: string, value: string) {
    setDrafts((current) => ({ ...(current ?? persistedPrompts), [key]: value }));
    setSaved(false);
  }

  function handleReset(section: PromptSection) {
    setDrafts((current) => ({
      ...(current ?? persistedPrompts),
      [section.key]: section.defaultValue,
    }));
    setSaved(false);
  }

  function handleResetAll() {
    const reset: Record<string, string> = {};
    SECTIONS.forEach((section) => {
      reset[section.key] = section.defaultValue;
    });
    setDrafts(reset);
    setSaved(false);
  }

  function handleSave() {
    store.setBodyRewritePrompt(effectiveDrafts.bodyRewritePrompt);
    store.setTitleRewritePrompt(effectiveDrafts.titleRewritePrompt);
    store.setCoverRewritePrompt(effectiveDrafts.coverRewritePrompt);
    store.setExtractReplacePrompt(effectiveDrafts.extractReplacePrompt);
    setDrafts(null);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2500);
  }

  return (
    <div className="flex flex-col h-full bg-gray-50">
      <div className="flex-shrink-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-900">高级设置</h2>
          <p className="text-xs text-gray-500 mt-0.5">自定义二创提示词，刷新页面后会自动恢复</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={handleResetAll}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <RotateCcw className="w-4 h-4" />
            重置提示词
          </button>
          <button
            onClick={handleSave}
            disabled={!hasChanges}
            className={clsx(
              "flex items-center gap-1.5 text-sm px-4 py-1.5 rounded-lg font-medium transition-colors",
              saved
                ? "bg-green-500 text-white"
                : hasChanges
                  ? "bg-red-600 hover:bg-red-700 text-white"
                  : "bg-gray-200 text-gray-400 cursor-not-allowed"
            )}
          >
            <Save className="w-4 h-4" />
            {saved ? "已保存" : "保存"}
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
        {SECTIONS.map((section) => (
          <PromptCard
            key={section.key}
            section={section}
            value={effectiveDrafts[section.key]}
            onChange={(v) => handleChange(section.key, v)}
            onReset={() => handleReset(section)}
          />
        ))}
      </div>
    </div>
  );
}
