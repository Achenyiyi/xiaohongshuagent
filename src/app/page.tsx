"use client";

import { useAppStore } from "@/store/appStore";
import Sidebar from "@/components/Sidebar";
import CrawlModule from "@/components/CrawlModule";
import ListModule from "@/components/ListModule";
import RewriteModule from "@/components/RewriteModule";
import DraftModule from "@/components/DraftModule";
import AdvancedSettingsModule from "@/components/AdvancedSettingsModule";
import { useWorkspacePersistence } from "@/hooks/useWorkspacePersistence";

export default function HomePage() {
  const { activeModule, hasHydrated } = useAppStore();
  useWorkspacePersistence();

  if (!hasHydrated) {
    return <div className="h-screen bg-gray-50" />;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-hidden flex flex-col">
        {activeModule === "crawl" && <CrawlModule />}
        {activeModule === "list" && <ListModule />}
        {activeModule === "rewrite" && <RewriteModule />}
        {activeModule === "draft" && <DraftModule />}
        {activeModule === "settings" && <AdvancedSettingsModule />}
      </main>
    </div>
  );
}
