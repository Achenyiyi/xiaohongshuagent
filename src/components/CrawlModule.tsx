"use client";

import { useMemo, useState } from "react";
import {
  Search,
  Filter,
  History,
  ChevronDown,
  ChevronUp,
  Import,
  ExternalLink,
  X,
  Clock,
  Link2,
} from "lucide-react";
import clsx from "clsx";
import { useAppStore } from "@/store/appStore";
import EngagementStats from "@/components/EngagementStats";
import type { XHSNote, SearchFilters, SearchHistory, SearchMode } from "@/types";
import Image from "next/image";
import { buildOpenableNoteLink, extractXhsLinksFromText } from "@/lib/xhsLink";

const SORT_OPTIONS = [
  { value: "general", label: "综合" },
  { value: "time_descending", label: "最新" },
  { value: "popularity_descending", label: "最多点赞" },
  { value: "comment_descending", label: "最多评论" },
  { value: "collect_descending", label: "最多收藏" },
];

const TIME_OPTIONS = [
  { value: "", label: "不限" },
  { value: "day", label: "一天内" },
  { value: "week", label: "一周内" },
  { value: "halfyear", label: "半年内" },
];

type SearchErrorMeta = {
  code?: number;
  channel?: "app" | "web";
  channelLabel?: string;
  docMessage?: string;
  providerMessage?: string;
  docSource?: string;
  note?: string;
};

type SearchErrorState = {
  message: string;
  meta?: SearchErrorMeta | null;
};

const FEISHU_DOC_LIBRARY_URL =
  process.env.NEXT_PUBLIC_FEISHU_DOC_LIBRARY_URL?.trim() || "";

function parseNoteLinks(raw: string) {
  return extractXhsLinksFromText(raw);
}

export default function CrawlModule() {
  const {
    searchHistories,
    addSearchHistory,
    crawlKeyword,
    setCrawlKeyword,
    crawlFilters,
    setCrawlFilters,
    crawlResults,
    setCrawlResults,
    crawlTargetCount,
    setCrawlTargetCount,
    activeSearchHistoryId,
    setActiveSearchHistoryId,
    setCollectRecords,
  } = useAppStore();

  const [searchMode, setSearchMode] = useState<SearchMode>("keyword");
  const [noteLinksInput, setNoteLinksInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<SearchErrorState | null>(null);
  const [warning, setWarning] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showHistory, setShowHistory] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importSuccess, setImportSuccess] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const activeHistory =
    searchHistories.find((history) => history.id === activeSearchHistoryId) || null;
  const displayResults = activeHistory ? activeHistory.results : crawlResults;
  const parsedLinks = useMemo(() => parseNoteLinks(noteLinksInput), [noteLinksInput]);

  async function runSearch() {
    const isKeywordMode = searchMode === "keyword";
    const canSearchKeyword = crawlKeyword.trim() && crawlTargetCount > 0;
    const canSearchLinks = parsedLinks.length > 0;

    if ((isKeywordMode && !canSearchKeyword) || (!isKeywordMode && !canSearchLinks)) return;

    setLoading(true);
    setError(null);
    setWarning("");
    setImportSuccess("");
    setCrawlResults([]);
    setActiveSearchHistoryId(null);
    setSelectedIds(new Set());

    try {
      const res = await fetch("/api/xhs/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          isKeywordMode
            ? {
                keyword: crawlKeyword,
                filters: crawlFilters,
                targetCount: crawlTargetCount,
              }
            : {
                noteLinks: parsedLinks,
              }
        ),
      });

      const data = await res.json();
      if (!res.ok) {
        setError({
          message: data.error || "搜索失败",
          meta: data.errorMeta || null,
        });
        return;
      }

      const notes: XHSNote[] = data.notes || [];
      setWarning(data.warning || "");
      setCrawlResults(notes);

      const history: SearchHistory = {
        id: Date.now().toString(),
        mode: searchMode,
        keyword:
          searchMode === "keyword"
            ? crawlKeyword
            : `链接搜索（${parsedLinks.length} 条）`,
        noteLinks: searchMode === "links" ? parsedLinks : undefined,
        timestamp: new Date().toISOString(),
        results: notes,
        filters: { ...crawlFilters },
      };
      addSearchHistory(history);
    } catch (e: unknown) {
      setError({
        message: e instanceof Error ? e.message : "搜索出错",
      });
    } finally {
      setLoading(false);
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (selectedIds.size === displayResults.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(displayResults.map((note) => note.id)));
    }
  }

  async function syncCollectList() {
    try {
      const res = await fetch("/api/feishu/records");
      const data = await res.json();
      if (res.ok) {
        setCollectRecords(data.records || []);
      }
    } catch {
      // 同步失败不阻断导入结果提示
    }
  }

  async function handleImport() {
    const toImport = displayResults.filter((note) => selectedIds.has(note.id));
    if (toImport.length === 0) return;

    setImporting(true);
    setError(null);
    setImportSuccess("");

    try {
      const res = await fetch("/api/feishu/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: toImport,
          keyword: searchMode === "keyword" ? crawlKeyword : "链接搜索导入",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "导入失败");

      const importedCount = Number(data.importedCount ?? data.count ?? 0);
      const skippedCount = Number(data.skippedCount ?? 0);

      if (importedCount > 0 && skippedCount > 0) {
        setImportSuccess(`成功导入 ${importedCount} 条笔记，过滤掉 ${skippedCount} 条已存在/重复笔记`);
      } else if (importedCount > 0) {
        setImportSuccess(`成功导入 ${importedCount} 条笔记到飞书`);
      } else if (skippedCount > 0) {
        setImportSuccess(`导入完成，过滤掉 ${skippedCount} 条已存在/重复笔记`);
      } else {
        setImportSuccess("导入完成");
      }

      setSelectedIds(new Set());
      await syncCollectList();
      window.setTimeout(() => setImportSuccess(""), 4000);
    } catch (e: unknown) {
      setError({
        message: e instanceof Error ? e.message : "导入失败",
      });
    } finally {
      setImporting(false);
    }
  }

  function handleOpenFeishu() {
    if (!FEISHU_DOC_LIBRARY_URL) return;
    window.open(FEISHU_DOC_LIBRARY_URL, "_blank", "noopener,noreferrer");
  }

  function formatTime(iso: string) {
    const date = new Date(iso);
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours()}:${String(date.getMinutes()).padStart(2, "0")}`;
  }

  function restoreHistory(history: SearchHistory) {
    setError(null);
    setWarning("");
    setSelectedIds(new Set());
    setActiveSearchHistoryId(history.id);
    setSearchMode(history.mode);
    if (history.mode === "keyword") {
      setCrawlKeyword(history.keyword);
      setNoteLinksInput("");
      setCrawlFilters(history.filters);
      return;
    }

    setCrawlKeyword("");
    setNoteLinksInput((history.noteLinks || []).join("\n"));
  }

  return (
    <div className="flex h-full overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="bg-white border-b border-gray-200 px-6 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-800">采集模块</h2>
            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
              <button
                onClick={() => setSearchMode("keyword")}
                className={clsx(
                  "rounded-md px-3 py-1.5 text-sm transition-colors",
                  searchMode === "keyword"
                    ? "bg-white text-red-600 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                )}
              >
                关键词搜索
              </button>
              <button
                onClick={() => setSearchMode("links")}
                className={clsx(
                  "rounded-md px-3 py-1.5 text-sm transition-colors",
                  searchMode === "links"
                    ? "bg-white text-red-600 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                )}
              >
                链接搜索
              </button>
            </div>
          </div>

          {searchMode === "keyword" ? (
            <div className="flex gap-2">
              <div className="flex-1 flex items-center border border-gray-300 rounded-lg overflow-hidden focus-within:border-red-400 focus-within:ring-1 focus-within:ring-red-200">
                <input
                  type="text"
                  value={crawlKeyword}
                  onChange={(e) => setCrawlKeyword(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && runSearch()}
                  placeholder="输入搜索关键词，回车或点击搜索"
                  className="flex-1 px-4 py-2.5 text-sm outline-none"
                />
                {crawlKeyword && (
                  <button
                    onClick={() => {
                      setCrawlKeyword("");
                      setActiveSearchHistoryId(null);
                    }}
                    className="px-2 text-gray-400 hover:text-gray-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5 border border-gray-300 rounded-lg px-3 bg-white">
                <span className="text-sm text-gray-500 whitespace-nowrap">采集</span>
                <input
                  type="number"
                  min={0}
                  max={200}
                  value={crawlTargetCount}
                  onChange={(e) => {
                    if (e.target.value === "") {
                      setCrawlTargetCount(0);
                      return;
                    }

                    const nextValue = Number(e.target.value);
                    if (!Number.isFinite(nextValue)) return;

                    setCrawlTargetCount(Math.min(200, Math.max(0, nextValue)));
                  }}
                  className="w-14 text-sm text-center outline-none"
                />
                <span className="text-sm text-gray-500">条</span>
              </div>

              <button
                onClick={runSearch}
                disabled={loading || !crawlKeyword.trim() || crawlTargetCount <= 0}
                className="px-5 py-2.5 bg-red-500 hover:bg-red-600 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
              >
                {loading ? (
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Search className="w-4 h-4" />
                )}
                搜索
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <textarea
                value={noteLinksInput}
                onChange={(e) => setNoteLinksInput(e.target.value)}
                placeholder="支持一行一个链接，也支持直接粘贴手机端的整段分享文案"
                rows={5}
                className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm outline-none focus:border-red-400 focus:ring-1 focus:ring-red-200 resize-none"
              />
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500">
                  当前识别 {parsedLinks.length} 条链接。搜索结果可直接勾选并导入飞书爆款库。
                </p>
                <button
                  onClick={runSearch}
                  disabled={loading || parsedLinks.length === 0}
                  className="px-5 py-2.5 bg-red-500 hover:bg-red-600 disabled:bg-gray-300 text-white rounded-lg text-sm font-medium flex items-center gap-2 transition-colors"
                >
                  {loading ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <Link2 className="w-4 h-4" />
                  )}
                  拉取笔记
                </button>
              </div>
            </div>
          )}

          {searchMode === "keyword" && (
            <div>
              <button
                onClick={() => setShowFilters(!showFilters)}
                className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
              >
                <Filter className="w-4 h-4" />
                筛选条件
                {showFilters ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              </button>

              {showFilters && (
                <div className="mt-2 p-3 bg-gray-50 rounded-lg space-y-3">
                  <div className="flex flex-wrap gap-4">
                    <label className="flex items-center gap-1.5 text-sm text-gray-600">
                      <input type="checkbox" checked readOnly className="cursor-not-allowed" />
                      <span className="text-gray-400">图文（固定）</span>
                    </label>

                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-600">排序：</span>
                      <select
                        value={crawlFilters.sort}
                        onChange={(e) =>
                          setCrawlFilters((prev) => ({
                            ...prev,
                            sort: e.target.value as SearchFilters["sort"],
                          }))
                        }
                        className="text-sm border border-gray-200 rounded px-2 py-1 bg-white"
                      >
                        {SORT_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-600">时间：</span>
                      <select
                        value={crawlFilters.timeRange}
                        onChange={(e) =>
                          setCrawlFilters((prev) => ({
                            ...prev,
                            timeRange: e.target.value as SearchFilters["timeRange"],
                          }))
                        }
                        className="text-sm border border-gray-200 rounded px-2 py-1 bg-white"
                      >
                        {TIME_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    {[
                      { key: "minLike", label: "点赞量 ≥" },
                      { key: "minComment", label: "评论量 ≥" },
                      { key: "minShare", label: "转发量 ≥" },
                      { key: "minCollect", label: "收藏量 ≥" },
                    ].map(({ key, label }) => (
                      <div key={key} className="flex items-center gap-1.5">
                        <span className="text-sm text-gray-600">{label}</span>
                        <input
                          type="number"
                          min={0}
                          value={crawlFilters[key as keyof SearchFilters] ?? ""}
                          onChange={(e) =>
                            setCrawlFilters((prev) => ({
                              ...prev,
                              [key]: e.target.value ? Number(e.target.value) : undefined,
                            }))
                          }
                          placeholder="不限"
                          className="w-20 text-sm border border-gray-200 rounded px-2 py-1"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {error && (
            <div className="m-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm space-y-1.5">
              <p className="font-medium">{error.message}</p>
              {error.meta && (
                <div className="space-y-1 text-xs text-red-600">
                  {error.meta.code !== undefined && <p>错误码：{error.meta.code}</p>}
                  {error.meta.channelLabel && <p>搜索通道：{error.meta.channelLabel}</p>}
                  {error.meta.docMessage && <p>文档说明：{error.meta.docMessage}</p>}
                  {error.meta.providerMessage &&
                    error.meta.providerMessage !== error.meta.docMessage && (
                      <p>接口原始消息：{error.meta.providerMessage}</p>
                    )}
                  {error.meta.docSource && <p>映射来源：{error.meta.docSource}</p>}
                  {error.meta.note && <p>{error.meta.note}</p>}
                </div>
              )}
            </div>
          )}

          {warning && (
            <div className="m-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">
              {warning}
            </div>
          )}

          {importSuccess && (
            <div className="m-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-600 text-sm">{importSuccess}</div>
          )}

          {displayResults.length > 0 && (
            <div className="relative">
              <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-6 py-2 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={selectedIds.size === displayResults.length && displayResults.length > 0}
                      onChange={toggleSelectAll}
                    />
                    全选 ({displayResults.length} 条)
                  </label>
                  {selectedIds.size > 0 && (
                    <span className="text-sm text-red-500 font-medium">已选 {selectedIds.size} 条</span>
                  )}
                </div>
                <div className="flex w-[230px] flex-shrink-0 justify-end">
                  <div className="flex w-full overflow-hidden rounded-lg border border-gray-200 shadow-sm">
                    <button
                      onClick={handleOpenFeishu}
                      disabled={!FEISHU_DOC_LIBRARY_URL}
                      className="flex flex-1 items-center justify-center gap-1.5 border-r border-gray-200 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      打开飞书
                    </button>
                    <button
                      onClick={handleImport}
                      disabled={importing || selectedIds.size === 0}
                      className="flex flex-1 items-center justify-center gap-1.5 bg-red-500 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:bg-gray-300"
                    >
                      {importing ? (
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Import className="w-3.5 h-3.5" />
                      )}
                      导入飞书
                    </button>
                  </div>
                </div>
              </div>

              <div className="p-4 grid grid-cols-3 md:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-2.5">
                {displayResults.map((note) => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    selected={selectedIds.has(note.id)}
                    onToggle={() => toggleSelect(note.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {!loading && displayResults.length === 0 && !error && (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
              <Search className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm">
                {searchMode === "keyword" ? "输入关键词搜索小红书笔记" : "粘贴笔记链接后批量拉取"}
              </p>
            </div>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center h-64 text-gray-400">
              <div className="w-10 h-10 border-3 border-red-500 border-t-transparent rounded-full animate-spin mb-3" />
              <p className="text-sm">正在搜索...</p>
            </div>
          )}
        </div>
      </div>

      <div
        className={clsx(
          "border-l border-gray-200 bg-white overflow-hidden transition-[width] duration-200 ease-out",
          showHistory ? "w-64" : "w-10"
        )}
      >
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="w-full flex items-center gap-2 overflow-hidden px-3 py-3 text-gray-500 hover:text-gray-700 hover:bg-gray-50 border-b border-gray-100"
          title="搜索历史"
        >
          <History className="w-4 h-4 shrink-0" />
          <span className="whitespace-nowrap text-sm font-medium">搜索历史</span>
        </button>

        {showHistory && (
          <div className="h-full overflow-y-auto pb-16">
            {searchHistories.length === 0 ? (
              <div className="px-4 py-6 text-center text-xs whitespace-nowrap text-gray-400">
                暂无历史记录
              </div>
            ) : (
              <div className="divide-y divide-gray-100">
                {searchHistories.map((history) => (
                  <button
                    key={history.id}
                    onClick={() => restoreHistory(history)}
                    className={clsx(
                      "w-full text-left px-3 py-2.5 hover:bg-gray-50",
                      activeHistory?.id === history.id && "bg-red-50"
                    )}
                  >
                    <div className="text-sm font-medium text-gray-700 truncate">{history.keyword}</div>
                    <div className="flex items-center gap-1 mt-0.5">
                      <Clock className="w-3 h-3 text-gray-400" />
                      <span className="text-xs text-gray-400">{formatTime(history.timestamp)}</span>
                      <span className="text-xs text-gray-400 ml-1">· {history.results.length}条</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function NoteCard({
  note,
  selected,
  onToggle,
}: {
  note: XHSNote;
  selected: boolean;
  onToggle: () => void;
}) {
  const noteDetailLink = buildOpenableNoteLink(note.noteLink, note.id);

  return (
    <div
      className={clsx(
        "relative rounded-xl overflow-hidden border bg-white transition-all hover:shadow-md",
        selected ? "border-red-500 shadow-md" : "border-gray-100 hover:border-gray-200"
      )}
    >
      <a
        href={noteDetailLink}
        target="_blank"
        rel="noopener noreferrer"
        className="block"
      >
        <div className="relative aspect-[3/4] bg-gray-100">
          {note.cover ? (
            <Image
              src={`/api/proxy-image?url=${encodeURIComponent(note.cover)}`}
              alt={note.title || "小红书笔记"}
              fill
              sizes="(max-width: 1280px) 25vw, 16vw"
              className="object-cover"
              unoptimized
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-gray-300 text-xs">无封面</div>
          )}
        </div>
        <div className="p-2">
          <p className="text-[12px] font-medium text-gray-800 line-clamp-2 leading-4 min-h-8">
            {note.title || "无标题"}
          </p>
          <EngagementStats
            likedCount={note.likedCount}
            collectedCount={note.collectedCount}
            commentCount={note.commentCount}
            shareCount={note.shareCount}
            compact
            className="mt-1.5"
          />
        </div>
      </a>

      <button
        onClick={onToggle}
        className="absolute left-2 top-2 rounded-full bg-white/90 p-1 shadow-sm transition hover:bg-white"
      >
        <div
          className={clsx(
            "w-4 h-4 rounded border-2 flex items-center justify-center",
            selected ? "bg-red-500 border-red-500" : "border-gray-300"
          )}
        >
          {selected && (
            <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          )}
        </div>
      </button>
    </div>
  );
}
