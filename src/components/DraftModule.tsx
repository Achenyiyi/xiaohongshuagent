"use client";

import { useState } from "react";
import { Archive, ChevronDown, ChevronUp } from "lucide-react";
import clsx from "clsx";
import { useAppStore } from "@/store/appStore";
import { dedupeTags, sanitizeTitle } from "@/lib/xhs";
import type { RewriteResult } from "@/types";
import Image from "next/image";

export default function DraftModule() {
  const { draftRecords } = useAppStore();
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const sortedRecords = [...draftRecords].sort((a, b) =>
    (b.savedAt || "").localeCompare(a.savedAt || "")
  );

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* 顶部栏 */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <h2 className="text-lg font-semibold text-gray-800">草稿箱</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          共 {draftRecords.length} 次本机保存记录，统一写入飞书二创库
        </p>
      </div>

      {/* 内容区 */}
      <div className="flex-1 overflow-y-auto">
        {draftRecords.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <Archive className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-sm">暂无保存记录，请先完成二创并保存到二创库</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {sortedRecords.map((draft) => {
              const totalCount = draft.rewriteResults.length;
              const isExpanded = expandedIds.has(draft.id);
              const targetLabel = draft.targetLabel || draft.feishuTableName || "二创库";
              const savedAtLabel = formatSavedAt(draft.savedAt);

              return (
                <div key={draft.id}>
                  {/* 保存批次头 */}
                  <button
                    onClick={() => toggleExpand(draft.id)}
                    className="w-full flex items-center justify-between px-6 py-3 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-gray-800">{savedAtLabel}</span>
                      <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                        {totalCount} 条二创笔记
                      </span>
                      <span className="text-xs text-blue-500">已写入：{targetLabel}</span>
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-gray-400" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-gray-400" />
                    )}
                  </button>

                  {/* 展开：本次保存的所有二创记录 */}
                  {isExpanded && (
                    <div className="bg-gray-50 divide-y divide-gray-100">
                      {draft.rewriteResults.map((result) => (
                        <DraftResultRow
                          key={`${draft.id}-${result.id}`}
                          result={result}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function formatSavedAt(savedAt: string) {
  if (!savedAt) return "刚刚保存";
  const date = new Date(savedAt);
  if (Number.isNaN(date.getTime())) return savedAt;

  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function buildOriginalTags(result: RewriteResult) {
  return dedupeTags(result.originalNote.originalTags || []);
}

function buildRewrittenTags(result: RewriteResult) {
  return dedupeTags(result.rewrittenTags || []);
}

function DraftResultRow({ result }: { result: RewriteResult }) {
  const [expanded, setExpanded] = useState(false);
  const rewrittenTitle = sanitizeTitle(result.rewrittenTitle || "");
  const originalTitle = sanitizeTitle(result.originalNote.originalTitle || "");
  const originalTags = buildOriginalTags(result);
  const rewrittenTags = buildRewrittenTags(result);
  const previewTags = rewrittenTags.slice(0, 4);

  return (
    <div className="px-6 py-3">
      {/* 折叠头 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          {/* 封面缩略图 */}
          {result.rewrittenCover && (
            <div className="relative w-10 h-12 rounded overflow-hidden flex-shrink-0">
              <Image
                src={result.rewrittenCover}
                alt="二创封面"
                fill
                className="object-cover"
                unoptimized
              />
            </div>
          )}
          <div className="min-w-0">
            {rewrittenTitle && (
              <p className="text-sm font-medium text-gray-800 truncate">
                {rewrittenTitle}
              </p>
            )}
            {originalTitle && (
              <p className="mt-0.5 truncate text-xs text-gray-400">
                原：{originalTitle}
              </p>
            )}
            {previewTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {previewTags.map((tag) => (
                  <span
                    key={`preview-${result.recordId}-${tag}`}
                    className="inline-flex items-center rounded-full bg-red-50 px-1.5 py-0.5 text-[11px] text-red-500"
                  >
                    {tag}
                  </span>
                ))}
                {rewrittenTags.length > previewTags.length && (
                  <span className="inline-flex items-center rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-400">
                    +{rewrittenTags.length - previewTags.length}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 flex-shrink-0 ml-2"
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* 展开：左右对比 */}
      {expanded && (
        <div className="grid grid-cols-2 gap-4 mt-3">
          {/* 左：原笔记 */}
          <div className="bg-white rounded-xl p-3 border border-gray-100 space-y-2">
            <p className="text-xs font-semibold text-gray-400">封面</p>
            {result.originalNote.cover && (
              <div className="relative aspect-[3/4] w-20 rounded overflow-hidden">
                <Image
                  src={`/api/proxy-image?url=${encodeURIComponent(result.originalNote.cover)}`}
                  alt="原封面"
                  fill
                  className="object-cover"
                  unoptimized
                />
              </div>
            )}
            {result.originalNote.coverText && (
              <div>
                <p className="text-xs text-gray-400">封面文案</p>
                <p className="text-xs text-gray-700 whitespace-pre-wrap">
                  {result.originalNote.coverText}
                </p>
              </div>
            )}
            <div>
              <p className="text-xs text-gray-400">标题</p>
              <p className="text-sm text-gray-800">{result.originalNote.originalTitle || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">正文</p>
              <p className="text-xs text-gray-700 whitespace-pre-wrap max-h-32 overflow-y-auto">
                {result.originalNote.originalBody || "—"}
              </p>
            </div>
            {originalTags.length > 0 && (
              <div>
                <p className="text-xs text-gray-400">标签</p>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {originalTags.map((tag) => (
                    <span
                      key={`original-${result.recordId}-${tag}`}
                      className="inline-flex items-center rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-500"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 右：二创结果 */}
          <div className={clsx("rounded-xl p-3 border space-y-2", "bg-red-50 border-red-100")}>
            <p className="text-xs font-semibold text-gray-400">二创封面</p>
            {result.rewrittenCover && (
              <div className="relative aspect-[3/4] w-20 rounded overflow-hidden">
                <Image
                  src={result.rewrittenCover}
                  alt="二创封面"
                  fill
                  className="object-cover"
                  unoptimized
                />
              </div>
            )}
            {result.rewrittenCoverText && (
              <div>
                <p className="text-xs text-gray-400">二创封面文案</p>
                <p className="text-xs text-gray-700 whitespace-pre-wrap">
                  {result.rewrittenCoverText}
                </p>
              </div>
            )}
            <div>
              <p className="text-xs text-gray-400">二创标题</p>
              <p className="text-sm text-gray-800">{result.rewrittenTitle || "—"}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">二创正文</p>
              <p className="text-xs text-gray-700 whitespace-pre-wrap max-h-32 overflow-y-auto">
                {result.rewrittenBody || "—"}
              </p>
            </div>
            {rewrittenTags.length > 0 && (
              <div>
                <p className="text-xs text-gray-400">二创标签</p>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {rewrittenTags.map((tag) => (
                    <span
                      key={`rewritten-${result.recordId}-${tag}`}
                      className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-500"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
