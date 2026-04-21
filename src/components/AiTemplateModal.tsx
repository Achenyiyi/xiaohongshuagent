"use client";

import Image from "next/image";
import clsx from "clsx";
import { Upload, X } from "lucide-react";

export type AiTemplateMode = "text" | "image";

export default function AiTemplateModal({
  mode,
  prompt,
  sourceImageSrc,
  loading,
  onModeChange,
  onPromptChange,
  onSourceImageUpload,
  onClose,
  onSubmit,
}: {
  mode: AiTemplateMode;
  prompt: string;
  sourceImageSrc: string;
  loading: boolean;
  onModeChange: (mode: AiTemplateMode) => void;
  onPromptChange: (value: string) => void;
  onSourceImageUpload: (file: File) => void | Promise<void>;
  onClose: () => void;
  onSubmit: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-gray-800">AI生成模板</h3>
            <p className="mt-1 text-xs text-gray-500">
              这里只负责生成模板底图。最终文字仍然由程序按当前封面文案渲染上去，不会额外拼接隐藏关键词。
            </p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1">
          <button
            type="button"
            onClick={() => onModeChange("text")}
            className={clsx(
              "rounded-lg px-3 py-1.5 text-sm transition-colors",
              mode === "text" ? "bg-white text-red-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
            )}
          >
            文生图
          </button>
          <button
            type="button"
            onClick={() => onModeChange("image")}
            className={clsx(
              "rounded-lg px-3 py-1.5 text-sm transition-colors",
              mode === "image" ? "bg-white text-red-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
            )}
          >
            图生图
          </button>
        </div>

        {mode === "image" && (
          <div className="mt-4 rounded-xl border border-gray-200 bg-gray-50 p-3">
            <div className="flex items-start gap-3">
              <div className="relative aspect-[3/4] w-24 flex-shrink-0 overflow-hidden rounded-lg bg-white">
                {sourceImageSrc ? (
                  <Image
                    src={sourceImageSrc}
                    alt="图生图垫图"
                    fill
                    sizes="96px"
                    className="object-cover"
                    unoptimized
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center px-2 text-center text-xs text-gray-400">
                    暂无垫图
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1 space-y-2">
                <label className="inline-flex cursor-pointer items-center gap-1 rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-600 hover:bg-gray-50">
                  <Upload className="h-3 w-3" />
                  更换垫图
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      event.currentTarget.value = "";
                      if (!file) return;
                      await onSourceImageUpload(file);
                    }}
                  />
                </label>
                <p className="text-[11px] leading-relaxed text-gray-400">
                  图生图会参考这张图片生成新的 3:4 模板底图。
                </p>
              </div>
            </div>
          </div>
        )}

        <textarea
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          rows={6}
          className="mt-4 w-full rounded-xl border border-gray-200 px-3 py-3 text-sm leading-relaxed outline-none focus:border-red-400 focus:ring-1 focus:ring-red-200"
          placeholder={mode === "text" ? "直接输入你想要的背景描述" : "直接输入图生图提示词"}
        />

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            取消
          </button>
          <button
            onClick={onSubmit}
            disabled={loading || !prompt.trim() || (mode === "image" && !sourceImageSrc)}
            className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:bg-gray-300"
          >
            {loading ? "生成中..." : "生成模板"}
          </button>
        </div>
      </div>
    </div>
  );
}
