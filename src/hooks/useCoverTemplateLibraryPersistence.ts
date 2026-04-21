"use client";

import { useEffect, useRef } from "react";
import { getIndexedDbValue, setIndexedDbValue } from "@/lib/indexedDb";
import { useCoverTemplateLibraryStore } from "@/store/coverTemplateLibraryStore";
import type { CoverTemplateAsset } from "@/lib/coverTemplates";

const COVER_TEMPLATE_LIBRARY_KEY = "cover-template-library-v1";
const SAVE_DELAY_MS = 250;

export function useCoverTemplateLibraryPersistence() {
  const customTemplates = useCoverTemplateLibraryStore((state) => state.customTemplates);
  const setCustomTemplates = useCoverTemplateLibraryStore((state) => state.setCustomTemplates);
  const setHasHydrated = useCoverTemplateLibraryStore((state) => state.setHasHydrated);
  const loadedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const snapshot = await getIndexedDbValue<CoverTemplateAsset[]>(COVER_TEMPLATE_LIBRARY_KEY);
        if (cancelled) return;

        setCustomTemplates(Array.isArray(snapshot) ? snapshot : []);
      } catch (error) {
        console.error("恢复模板库失败:", error);
      } finally {
        loadedRef.current = true;
        setHasHydrated(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setCustomTemplates, setHasHydrated]);

  useEffect(() => {
    if (!loadedRef.current) return;

    const timeoutId = window.setTimeout(() => {
      void setIndexedDbValue<CoverTemplateAsset[]>(COVER_TEMPLATE_LIBRARY_KEY, customTemplates).catch(
        (error) => {
          console.error("保存模板库失败:", error);
        }
      );
    }, SAVE_DELAY_MS);

    return () => window.clearTimeout(timeoutId);
  }, [customTemplates]);
}
