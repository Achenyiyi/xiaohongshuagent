"use client";

import { useEffect, useRef } from "react";
import { getIndexedDbValue, setIndexedDbValue } from "@/lib/indexedDb";
import { useAppStore, type WorkspaceSnapshot } from "@/store/appStore";

const WORKSPACE_SNAPSHOT_KEY = "workspace-snapshot-v1";
const SAVE_DELAY_MS = 250;

export function useWorkspacePersistence() {
  const searchHistories = useAppStore((state) => state.searchHistories);
  const setSearchHistories = useAppStore((state) => state.setSearchHistories);
  const crawlResults = useAppStore((state) => state.crawlResults);
  const setCrawlResults = useAppStore((state) => state.setCrawlResults);
  const rewriteResults = useAppStore((state) => state.rewriteResults);
  const setRewriteResults = useAppStore((state) => state.setRewriteResults);
  const draftRecords = useAppStore((state) => state.draftRecords);
  const setDraftRecords = useAppStore((state) => state.setDraftRecords);
  const loadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const snapshot = await getIndexedDbValue<WorkspaceSnapshot>(WORKSPACE_SNAPSHOT_KEY);
        if (cancelled || !snapshot) {
          loadedRef.current = true;
          return;
        }

        setSearchHistories(snapshot.searchHistories ?? []);
        setCrawlResults(snapshot.crawlResults ?? []);
        setRewriteResults(snapshot.rewriteResults ?? []);
        setDraftRecords(snapshot.draftRecords ?? []);
      } catch (error) {
        console.error("恢复本地工作区快照失败:", error);
      } finally {
        loadedRef.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setCrawlResults, setDraftRecords, setRewriteResults, setSearchHistories]);

  useEffect(() => {
    if (!loadedRef.current) return;

    const timeoutId = window.setTimeout(() => {
      void setIndexedDbValue<WorkspaceSnapshot>(WORKSPACE_SNAPSHOT_KEY, {
        searchHistories,
        crawlResults,
        rewriteResults,
        draftRecords,
      }).catch((error) => {
        console.error("保存本地工作区快照失败:", error);
      });
    }, SAVE_DELAY_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [crawlResults, draftRecords, rewriteResults, searchHistories]);
}

