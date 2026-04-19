"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Sparkles, ChevronDown, ChevronUp, Check } from "lucide-react";
import clsx from "clsx";
import { useAppStore } from "@/store/appStore";
import EngagementStats from "@/components/EngagementStats";
import { dedupeTags, sanitizeTitle } from "@/lib/xhs";
import { buildOpenableNoteLink } from "@/lib/xhsLink";
import type { FeishuCollectRecord, RewriteResult } from "@/types";
import Image from "next/image";

const PAGE_SIZE = 10;

function buildDisplayTags(record: FeishuCollectRecord) {
  return dedupeTags(record.originalTags || []);
}

function createRewriteResult(record: FeishuCollectRecord, batchIndex: number, batchTotal: number): RewriteResult {
  const inheritedTags = buildDisplayTags(record);

  return {
    id: `${record.recordId}-${Date.now()}-${batchIndex}-${Math.random().toString(36).slice(2, 8)}`,
    recordId: record.recordId!,
    batchIndex,
    batchTotal,
    originalNote: {
      ...record,
      originalTags: inheritedTags,
      hasRewritten: Boolean(record.hasRewritten),
      rewriteDate: record.rewriteDate || "",
    },
    rewrittenTitle: "",
    rewrittenBody: "",
    rewrittenCover: "",
    rewrittenCoverText: "",
    rewrittenTags: inheritedTags,
    titleReplaceInfo: "",
    bodyReplaceInfo: "",
    coverReplaceInfo: "",
    status: "pending",
  };
}

export default function ListModule() {
  const {
    collectRecords,
    setCollectRecords,
    selectedRecordIds,
    toggleRecordSelect,
    selectAllRecords,
    clearRecordSelection,
    prependRewriteResults,
    setActiveModule,
  } = useAppStore();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [rewriting, setRewriting] = useState(false);
  const [batchCountMap, setBatchCountMap] = useState<Record<string, number>>({});
  const initRef = useRef(false);

  const totalPages = Math.max(1, Math.ceil(collectRecords.length / PAGE_SIZE));
  const pageRecords = collectRecords.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const pageSelectableIds = pageRecords
    .filter((record) => record.recordId)
    .map((record) => record.recordId!);
  const selectedPageCount = pageSelectableIds.filter((id) => selectedRecordIds.has(id)).length;
  const allPageSelected =
    pageSelectableIds.length > 0 && selectedPageCount === pageSelectableIds.length;
  const selectedRecords = useMemo(
    () => collectRecords.filter((record) => record.recordId && selectedRecordIds.has(record.recordId)),
    [collectRecords, selectedRecordIds]
  );
  const selectedGenerateCount = selectedRecords.reduce(
    (sum, record) => sum + (batchCountMap[record.recordId!] || 1),
    0
  );

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/feishu/records");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "获取失败");
      setCollectRecords(data.records || []);
      setPage((current) => Math.min(current, Math.max(1, Math.ceil((data.records || []).length / PAGE_SIZE))));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, [setCollectRecords]);

  useEffect(() => {
    if (!initRef.current) {
      initRef.current = true;
      fetchRecords();
    }
  }, [fetchRecords]);

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSelectCurrentPage() {
    if (allPageSelected) {
      const nextIds = Array.from(selectedRecordIds).filter((id) => !pageSelectableIds.includes(id));
      selectAllRecords(nextIds);
      return;
    }

    const nextIds = new Set(selectedRecordIds);
    pageSelectableIds.forEach((id) => nextIds.add(id));
    selectAllRecords(Array.from(nextIds));
  }

  function updateBatchCount(recordId: string, nextValue: number) {
    setBatchCountMap((prev) => ({
      ...prev,
      [recordId]: Math.min(20, Math.max(1, nextValue || 1)),
    }));
  }

  async function handleStartRewrite() {
    const selected = collectRecords.filter(
      (record) => record.recordId && selectedRecordIds.has(record.recordId)
    );
    if (selected.length === 0) return;

    setRewriting(true);

    const newResults = selected.flatMap((record) => {
      const batchTotal = batchCountMap[record.recordId!] || 1;
      return Array.from({ length: batchTotal }, (_, index) =>
        createRewriteResult(record, index + 1, batchTotal)
      );
    });

    prependRewriteResults(newResults);
    setActiveModule("rewrite");
    clearRecordSelection();
    setRewriting(false);
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-800">爆款库</h2>
          <div className="flex items-center gap-3">
            {selectedRecords.length > 0 && (
              <span className="text-sm text-red-500 font-medium bg-red-50 px-2.5 py-1 rounded-full">
                已选 {selectedRecords.length} 条，待生成 {selectedGenerateCount} 份
              </span>
            )}
            <button
              onClick={fetchRecords}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              <RefreshCw className={clsx("w-4 h-4", loading && "animate-spin")} />
              {loading ? "同步中..." : "同步飞书"}
            </button>
            <button
              onClick={handleStartRewrite}
              disabled={selectedRecords.length === 0 || rewriting}
              className="flex items-center gap-1.5 px-4 py-2 bg-red-500 hover:bg-red-600 disabled:bg-gray-300 text-white text-sm rounded-lg font-medium transition-colors"
            >
              <Sparkles className="w-4 h-4" />
              一键二创
            </button>
          </div>
        </div>

        {collectRecords.length > 0 && (
          <div className="mt-2 flex items-center gap-3 text-sm text-gray-600">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={allPageSelected}
                onChange={handleSelectCurrentPage}
                disabled={pageSelectableIds.length === 0}
              />
              本页全选 ({pageSelectableIds.length} 条)
            </label>
            {selectedRecordIds.size > 0 && (
              <button
                onClick={clearRecordSelection}
                className="text-xs text-gray-500 hover:text-gray-700"
              >
                清空选择
              </button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {error && (
          <div className="m-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">{error}</div>
        )}

        {loading && (
          <div className="flex justify-center items-center h-40">
            <div className="w-8 h-8 border-2 border-red-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && collectRecords.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center h-64 text-gray-400">
            <p className="text-sm">暂无数据，请先在采集模块采集笔记</p>
            <button
              onClick={fetchRecords}
              className="mt-3 text-sm text-red-500 hover:underline"
            >
              重新同步飞书
            </button>
          </div>
        )}

        {!loading && pageRecords.length > 0 && (
          <div className="divide-y divide-gray-100">
            {pageRecords.map((record) => (
              <RecordRow
                key={record.recordId}
                record={record}
                selected={selectedRecordIds.has(record.recordId || "")}
                expanded={expandedIds.has(record.recordId || "")}
                batchCount={batchCountMap[record.recordId || ""] || 1}
                onBatchCountChange={(count) => record.recordId && updateBatchCount(record.recordId, count)}
                onToggleSelect={() => record.recordId && toggleRecordSelect(record.recordId)}
                onToggleExpand={() => record.recordId && toggleExpand(record.recordId)}
              />
            ))}
          </div>
        )}
      </div>

      {totalPages > 1 && (
        <div className="bg-white border-t border-gray-200 px-6 py-3 flex items-center justify-between">
          <span className="text-sm text-gray-500">
            第 {page} / {totalPages} 页，共 {collectRecords.length} 条
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((current) => Math.max(1, current - 1))}
              disabled={page === 1}
              className="px-3 py-1 text-sm border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-40"
            >
              上一页
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, index) => {
              const base = Math.max(1, Math.min(totalPages - 4, page - 2));
              const currentPage = base + index;
              return (
                <button
                  key={currentPage}
                  onClick={() => setPage(currentPage)}
                  className={clsx(
                    "px-3 py-1 text-sm border rounded",
                    currentPage === page
                      ? "bg-red-500 text-white border-red-500"
                      : "border-gray-200 hover:bg-gray-50"
                  )}
                >
                  {currentPage}
                </button>
              );
            })}
            <button
              onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
              disabled={page === totalPages}
              className="px-3 py-1 text-sm border border-gray-200 rounded hover:bg-gray-50 disabled:opacity-40"
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RecordRow({
  record,
  selected,
  expanded,
  batchCount,
  onBatchCountChange,
  onToggleSelect,
  onToggleExpand,
}: {
  record: FeishuCollectRecord;
  selected: boolean;
  expanded: boolean;
  batchCount: number;
  onBatchCountChange: (count: number) => void;
  onToggleSelect: () => void;
  onToggleExpand: () => void;
}) {
  const displayTitle = sanitizeTitle(record.originalTitle || "");
  const displayTags = buildDisplayTags(record);
  const previewTags = displayTags.slice(0, 4);
  const noteDetailLink = buildOpenableNoteLink(record.noteLink);

  return (
    <div
      className={clsx(
        "px-6 py-3 transition-colors hover:bg-gray-50",
        selected && "bg-red-50"
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className="mt-1 flex-shrink-0 cursor-pointer"
          onClick={onToggleSelect}
        >
          <div
            className={clsx(
              "w-5 h-5 rounded border-2 flex items-center justify-center",
              selected ? "bg-red-500 border-red-500" : "border-gray-300 bg-white"
            )}
          >
            {selected && <Check className="w-3 h-3 text-white" strokeWidth={3} />}
          </div>
        </div>

        <div className="flex-shrink-0 w-14 h-18 rounded overflow-hidden bg-gray-100">
          {record.cover ? (
            <Image
              src={`/api/proxy-image?url=${encodeURIComponent(record.cover)}`}
              alt="封面"
              width={56}
              height={72}
              className="w-full h-full object-cover"
              unoptimized
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">无图</div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              {displayTitle && (
                <p className="text-sm font-medium text-gray-800 truncate">
                  {displayTitle}
                </p>
              )}
              <div className={clsx("flex flex-wrap items-center gap-2", displayTitle && "mt-1")}>
                <EngagementStats
                  likedCount={record.likedCount || 0}
                  collectedCount={record.collectedCount || 0}
                  commentCount={record.commentCount || 0}
                  shareCount={record.shareCount || 0}
                />
                {record.rewriteDate && (
                  <span className="text-xs text-gray-400">
                    最近二创：{record.rewriteDate}
                  </span>
                )}
              </div>
              {previewTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {previewTags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center text-xs text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded"
                    >
                      {tag}
                    </span>
                  ))}
                  {displayTags.length > previewTags.length && (
                    <span className="inline-flex items-center text-xs text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded">
                      +{displayTags.length - previewTags.length}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div className="flex items-center gap-3 flex-shrink-0">
              <label className="flex items-center gap-1.5 text-xs text-gray-500">
                批量生成
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={batchCount}
                  onChange={(e) => onBatchCountChange(Number(e.target.value))}
                  className="w-14 rounded border border-gray-200 px-2 py-1 text-center text-xs outline-none focus:border-red-400"
                />
              </label>
              <button
                onClick={onToggleExpand}
                className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"
              >
                {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                {expanded ? "收起" : "展开"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 ml-8 pl-8 border-l-2 border-gray-100 space-y-2">
          {record.originalBody && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">正文</p>
              <p className="text-xs text-gray-700 whitespace-pre-wrap leading-relaxed">{record.originalBody}</p>
            </div>
          )}
          {record.coverText && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">封面文案</p>
              <p className="text-xs text-gray-700">{record.coverText}</p>
            </div>
          )}
          {displayTags.length > 0 && (
            <div>
              <p className="text-xs font-medium text-gray-500 mb-1">标签</p>
              <div className="flex flex-wrap gap-1.5">
                {displayTags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center text-xs text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span>采集：{record.collectDate}</span>
            <span>发布：{record.publishTime}</span>
          </div>
          {noteDetailLink && (
            <a
              href={noteDetailLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-500 hover:underline"
            >
              查看原笔记 ↗
            </a>
          )}
        </div>
      )}
    </div>
  );
}
