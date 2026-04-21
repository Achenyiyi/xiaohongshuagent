import { create } from "zustand";
import type { CoverTemplateAsset } from "@/lib/coverTemplates";

interface CoverTemplateLibraryState {
  hasHydrated: boolean;
  setHasHydrated: (hydrated: boolean) => void;
  customTemplates: CoverTemplateAsset[];
  setCustomTemplates: (templates: CoverTemplateAsset[]) => void;
  addCustomTemplate: (template: CoverTemplateAsset) => void;
  removeCustomTemplate: (templateId: string) => void;
}

export const useCoverTemplateLibraryStore = create<CoverTemplateLibraryState>()((set) => ({
  hasHydrated: false,
  setHasHydrated: (hydrated) => set({ hasHydrated: hydrated }),
  customTemplates: [],
  setCustomTemplates: (templates) => set({ customTemplates: templates }),
  addCustomTemplate: (template) =>
    set((state) => ({
      customTemplates: [template, ...state.customTemplates.filter((item) => item.id !== template.id)],
    })),
  removeCustomTemplate: (templateId) =>
    set((state) => ({
      customTemplates: state.customTemplates.filter((item) => item.id !== templateId),
    })),
}));
