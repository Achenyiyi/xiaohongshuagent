import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type {
  ActiveModule,
  DraftRecord,
  FeishuCollectRecord,
  RewriteResult,
  SearchFilters,
  SearchHistory,
  XHSNote,
} from "@/types";

const MAX_SEARCH_HISTORIES = 8;

const DEFAULT_CRAWL_FILTERS: SearchFilters = {
  sort: "general",
  timeRange: "",
  minLike: undefined,
  minComment: undefined,
  minShare: undefined,
  minCollect: undefined,
};

interface AppState {
  hasHydrated: boolean;
  setHasHydrated: (hydrated: boolean) => void;

  activeModule: ActiveModule;
  setActiveModule: (module: ActiveModule) => void;

  searchHistories: SearchHistory[];
  setSearchHistories: (histories: SearchHistory[]) => void;
  addSearchHistory: (history: SearchHistory) => void;

  crawlKeyword: string;
  setCrawlKeyword: (keyword: string) => void;
  crawlFilters: SearchFilters;
  setCrawlFilters: (
    next:
      | SearchFilters
      | ((prev: SearchFilters) => SearchFilters)
  ) => void;
  crawlResults: XHSNote[];
  setCrawlResults: (results: XHSNote[]) => void;
  crawlTargetCount: number;
  setCrawlTargetCount: (count: number) => void;
  activeSearchHistoryId: string | null;
  setActiveSearchHistoryId: (id: string | null) => void;

  collectRecords: FeishuCollectRecord[];
  setCollectRecords: (records: FeishuCollectRecord[]) => void;
  selectedRecordIds: Set<string>;
  toggleRecordSelect: (id: string) => void;
  selectAllRecords: (ids: string[]) => void;
  clearRecordSelection: () => void;

  rewriteResults: RewriteResult[];
  setRewriteResults: (results: RewriteResult[]) => void;
  prependRewriteResults: (results: RewriteResult[]) => void;
  updateRewriteResult: (id: string, updates: Partial<RewriteResult>) => void;
  deleteRewriteResults: (ids: string[]) => void;
  selectedRewriteIds: Set<string>;
  toggleRewriteSelect: (id: string) => void;
  selectAllRewriteIds: (ids: string[]) => void;
  deselectRewriteIds: (ids: string[]) => void;
  clearRewriteSelection: () => void;

  draftRecords: DraftRecord[];
  setDraftRecords: (records: DraftRecord[]) => void;
  addDraftRecord: (draft: DraftRecord) => void;
  updateDraftRecord: (id: string, updates: Partial<DraftRecord>) => void;
}

export type WorkspaceSnapshot = Pick<
  AppState,
  "searchHistories" | "crawlResults" | "rewriteResults" | "draftRecords"
>;

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      hasHydrated: false,
      setHasHydrated: (hydrated) => set({ hasHydrated: hydrated }),

      activeModule: "crawl",
      setActiveModule: (module) => set({ activeModule: module }),

      searchHistories: [],
      setSearchHistories: (histories) => set({ searchHistories: histories }),
      addSearchHistory: (history) =>
        set((state) => ({
          searchHistories: [history, ...state.searchHistories].slice(0, MAX_SEARCH_HISTORIES),
        })),

      crawlKeyword: "",
      setCrawlKeyword: (keyword) => set({ crawlKeyword: keyword }),
      crawlFilters: DEFAULT_CRAWL_FILTERS,
      setCrawlFilters: (next) =>
        set((state) => ({
          crawlFilters: typeof next === "function" ? next(state.crawlFilters) : next,
        })),
      crawlResults: [],
      setCrawlResults: (results) => set({ crawlResults: results }),
      crawlTargetCount: 1,
      setCrawlTargetCount: (count) => set({ crawlTargetCount: count }),
      activeSearchHistoryId: null,
      setActiveSearchHistoryId: (id) => set({ activeSearchHistoryId: id }),

      collectRecords: [],
      setCollectRecords: (records) => set({ collectRecords: records }),
      selectedRecordIds: new Set(),
      toggleRecordSelect: (id) =>
        set((state) => {
          const next = new Set(state.selectedRecordIds);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return { selectedRecordIds: next };
        }),
      selectAllRecords: (ids) => set({ selectedRecordIds: new Set(ids) }),
      clearRecordSelection: () => set({ selectedRecordIds: new Set() }),

      rewriteResults: [],
      setRewriteResults: (results) => set({ rewriteResults: results }),
      prependRewriteResults: (results) =>
        set((state) => ({
          rewriteResults: [...results, ...state.rewriteResults],
        })),
      updateRewriteResult: (id, updates) =>
        set((state) => ({
          rewriteResults: state.rewriteResults.map((r) =>
            r.id === id ? { ...r, ...updates } : r
          ),
        })),
      deleteRewriteResults: (ids) =>
        set((state) => {
          const idSet = new Set(ids);
          const nextSelectedIds = new Set(state.selectedRewriteIds);
          ids.forEach((id) => nextSelectedIds.delete(id));

          return {
            rewriteResults: state.rewriteResults.filter((item) => !idSet.has(item.id)),
            selectedRewriteIds: nextSelectedIds,
          };
        }),
      selectedRewriteIds: new Set(),
      toggleRewriteSelect: (id) =>
        set((state) => {
          const next = new Set(state.selectedRewriteIds);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          return { selectedRewriteIds: next };
        }),
      selectAllRewriteIds: (ids) => set({ selectedRewriteIds: new Set(ids) }),
      deselectRewriteIds: (ids) =>
        set((state) => {
          const next = new Set(state.selectedRewriteIds);
          ids.forEach((id) => next.delete(id));
          return { selectedRewriteIds: next };
        }),
      clearRewriteSelection: () => set({ selectedRewriteIds: new Set() }),

      draftRecords: [],
      setDraftRecords: (records) => set({ draftRecords: records }),
      addDraftRecord: (draft) =>
        set((state) => ({
          draftRecords: [draft, ...state.draftRecords],
        })),
      updateDraftRecord: (id, updates) =>
        set((state) => ({
          draftRecords: state.draftRecords.map((d) =>
            d.id === id ? { ...d, ...updates } : d
          ),
        })),
    }),
    {
      name: "xhs-app-ui-state",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        activeModule: state.activeModule,
        crawlKeyword: state.crawlKeyword,
        crawlFilters: state.crawlFilters,
        crawlTargetCount: state.crawlTargetCount,
        activeSearchHistoryId: state.activeSearchHistoryId,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
