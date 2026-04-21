import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export interface ReplaceEntry {
  id: string;
  original: string;
  replacement: string;
}

export interface ReplaceEntryDraft {
  original: string;
  replacement: string;
}

export type ReplaceLibraryScope = "title" | "body" | "cover";

const DEFAULT_SCOPE_ENABLEMENT: Record<ReplaceLibraryScope, boolean> = {
  title: true,
  body: true,
  cover: true,
};

const DEFAULT_ENTRIES: ReplaceEntry[] = [
  { id: "preset-1", original: "公司类型", replacement: "初创传媒公司 / 初创电商公司" },
  { id: "preset-2", original: "地点", replacement: "深圳宝安" },
  { id: "preset-3", original: "具体地址", replacement: "平峦山地铁站附近 / 卓越鹏信创意园" },
  { id: "preset-4", original: "行业赛道", replacement: "教培产品，知识付费赛道" },
  { id: "preset-5", original: "岗位名称", replacement: "带货主播 / 教培主播 / 知识付费主播" },
  { id: "preset-6", original: "招聘数量", replacement: "10名" },
  { id: "preset-7", original: "急迫程度", replacement: "初创公司扩招的黄金窗口期" },
  { id: "preset-8", original: "保底薪资", replacement: "保底6-15K，面试定" },
  { id: "preset-9", original: "分成比例", replacement: "18%-30%" },
  { id: "preset-10", original: "实际收入", replacement: "在职30K+，成熟70K+，最低也有20K+" },
  { id: "preset-11", original: "培养保底期", replacement: "最长6个月培养保底" },
  { id: "preset-12", original: "工作时长", replacement: "每天2-6小时，不坐班不打卡" },
  { id: "preset-13", original: "培训体系", replacement: "资深老师一对一带教，完整孵化培训体系，带薪培训" },
  { id: "preset-14", original: "公司性质", replacement: "正规公司，内部员工，绝非中介" },
  { id: "preset-15", original: "年龄要求", replacement: "18-45岁，不卡学历、颜值、性别" },
  { id: "preset-16", original: "直播风格", replacement: "教培讲题型直播，不用费心费力喊，超好上手" },
];

function createDefaultEntries(scope: ReplaceLibraryScope) {
  return DEFAULT_ENTRIES.map((entry) => ({
    ...entry,
    id: `${scope}-${entry.id}`,
  }));
}

function createDefaultLibraries() {
  return {
    title: createDefaultEntries("title"),
    body: createDefaultEntries("body"),
    cover: createDefaultEntries("cover"),
  };
}

function createDefaultScopeEnablement() {
  return { ...DEFAULT_SCOPE_ENABLEMENT };
}

interface RewriteSettingsState {
  hasHydrated: boolean;
  setHasHydrated: (hydrated: boolean) => void;

  replaceLibraryEnabledByScope: Record<ReplaceLibraryScope, boolean>;
  setReplaceLibraryScopeEnabled: (scope: ReplaceLibraryScope, enabled: boolean) => void;

  autoMergeExtractedEntries: boolean;
  setAutoMergeExtractedEntries: (enabled: boolean) => void;

  replaceEntriesByScope: Record<ReplaceLibraryScope, ReplaceEntry[]>;
  addReplaceEntry: (scope: ReplaceLibraryScope) => void;
  updateReplaceEntry: (
    scope: ReplaceLibraryScope,
    id: string,
    patch: Partial<Omit<ReplaceEntry, "id">>
  ) => void;
  removeReplaceEntry: (scope: ReplaceLibraryScope, id: string) => void;
  resetToPresets: () => void;

  buildReplaceInfoString: (scope: ReplaceLibraryScope) => string;
  mergeExtractedEntries: (scope: ReplaceLibraryScope, raw: string) => void;
}

export function parseExtractedReplaceEntries(raw: string): ReplaceEntryDraft[] {
  if (!raw || raw.trim() === "暂无") return [];

  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("→") || line.includes("->"));

  const parsed: ReplaceEntryDraft[] = [];
  for (const line of lines) {
    const separator = line.includes("→") ? "→" : "->";
    const parts = line.split(separator);
    if (parts.length !== 2) continue;

    const original = parts[0].trim();
    const replacement = parts[1].trim();
    if (!original || !replacement) continue;

    parsed.push({ original, replacement });
  }

  return parsed;
}

function buildEntryKey(entry: ReplaceEntryDraft) {
  return `${entry.original.trim()}→${entry.replacement.trim()}`;
}

function stringifyEntries(entries: ReplaceEntry[]) {
  const valid = entries.filter((entry) => entry.original.trim() && entry.replacement.trim());
  if (valid.length === 0) return "";

  return valid
    .map((entry) => `${entry.original.trim()} → ${entry.replacement.trim()}`)
    .join("\n");
}

export const useRewriteSettingsStore = create<RewriteSettingsState>()(
  persist(
    (set, get) => ({
      hasHydrated: false,
      setHasHydrated: (hydrated) => set({ hasHydrated: hydrated }),

      replaceLibraryEnabledByScope: createDefaultScopeEnablement(),
      setReplaceLibraryScopeEnabled: (scope, enabled) =>
        set((state) => ({
          replaceLibraryEnabledByScope: {
            ...state.replaceLibraryEnabledByScope,
            [scope]: enabled,
          },
        })),

      autoMergeExtractedEntries: false,
      setAutoMergeExtractedEntries: (enabled) => set({ autoMergeExtractedEntries: enabled }),

      replaceEntriesByScope: createDefaultLibraries(),

      addReplaceEntry: (scope) =>
        set((state) => ({
          replaceEntriesByScope: {
            ...state.replaceEntriesByScope,
            [scope]: [
              ...state.replaceEntriesByScope[scope],
              { id: `${scope}-${Date.now()}-${Math.random()}`, original: "", replacement: "" },
            ],
          },
        })),

      updateReplaceEntry: (scope, id, patch) =>
        set((state) => ({
          replaceEntriesByScope: {
            ...state.replaceEntriesByScope,
            [scope]: state.replaceEntriesByScope[scope].map((entry) =>
              entry.id === id ? { ...entry, ...patch } : entry
            ),
          },
        })),

      removeReplaceEntry: (scope, id) =>
        set((state) => ({
          replaceEntriesByScope: {
            ...state.replaceEntriesByScope,
            [scope]: state.replaceEntriesByScope[scope].filter((entry) => entry.id !== id),
          },
        })),

      resetToPresets: () =>
        set({
          replaceEntriesByScope: createDefaultLibraries(),
        }),

      buildReplaceInfoString: (scope) => stringifyEntries(get().replaceEntriesByScope[scope]),

      mergeExtractedEntries: (scope, raw) => {
        const drafts = parseExtractedReplaceEntries(raw);
        if (drafts.length === 0) return;

        set((state) => {
          const existingKeys = new Set(
            state.replaceEntriesByScope[scope].map((entry) =>
              buildEntryKey({ original: entry.original, replacement: entry.replacement })
            )
          );

          const deduplicated = drafts
            .filter((entry) => !existingKeys.has(buildEntryKey(entry)))
            .map((entry) => ({
              id: `${scope}-extracted-${Date.now()}-${Math.random()}`,
              original: entry.original,
              replacement: entry.replacement,
            }));

          if (deduplicated.length === 0) return state;

          return {
            replaceEntriesByScope: {
              ...state.replaceEntriesByScope,
              [scope]: [...state.replaceEntriesByScope[scope], ...deduplicated],
            },
          };
        });
      },
    }),
    {
      name: "xhs-app-rewrite-settings",
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        replaceLibraryEnabledByScope: state.replaceLibraryEnabledByScope,
        autoMergeExtractedEntries: state.autoMergeExtractedEntries,
        replaceEntriesByScope: state.replaceEntriesByScope,
      }),
      migrate: (persistedState) => {
        const state = persistedState as {
          replaceLibraryEnabled?: boolean;
          replaceLibraryEnabledByScope?: Partial<Record<ReplaceLibraryScope, boolean>>;
          autoMergeExtractedEntries?: boolean;
          replaceEntriesByScope?: Record<ReplaceLibraryScope, ReplaceEntry[]>;
        };
        const legacyEnabled =
          typeof state?.replaceLibraryEnabled === "boolean"
            ? state.replaceLibraryEnabled
            : undefined;
        const persistedEnablement = state?.replaceLibraryEnabledByScope || {};

        return {
          ...state,
          replaceLibraryEnabledByScope: {
            ...createDefaultScopeEnablement(),
            ...(legacyEnabled === undefined
              ? {}
              : {
                  title: legacyEnabled,
                  body: legacyEnabled,
                  cover: legacyEnabled,
                }),
            ...persistedEnablement,
          },
        };
      },
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);
