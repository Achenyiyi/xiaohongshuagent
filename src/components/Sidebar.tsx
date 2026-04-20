"use client";

import { useAppStore } from "@/store/appStore";
import type { ActiveModule } from "@/types";
import { Search, List, Sparkles, Archive, Settings } from "lucide-react";
import clsx from "clsx";

const modules: { id: ActiveModule; label: string; icon: React.ReactNode; desc: string }[] = [
  {
    id: "crawl",
    label: "采集模块",
    icon: <Search className="w-5 h-5" />,
    desc: "搜索并采集小红书笔记",
  },
  {
    id: "list",
    label: "爆款库",
    icon: <List className="w-5 h-5" />,
    desc: "从飞书同步，选择爆款笔记二创",
  },
  {
    id: "rewrite",
    label: "二创模块",
    icon: <Sparkles className="w-5 h-5" />,
    desc: "AI生成对比，人工编辑",
  },
  {
    id: "draft",
    label: "草稿箱",
    icon: <Archive className="w-5 h-5" />,
    desc: "历史保存到二创库存档",
  },
  {
    id: "settings",
    label: "高级设置",
    icon: <Settings className="w-5 h-5" />,
    desc: "自定义提示词配置",
  },
];

export default function Sidebar() {
  const { activeModule, setActiveModule } = useAppStore();

  return (
    <aside className="w-1/4 min-w-[220px] max-w-[280px] bg-gray-900 flex flex-col h-full shadow-xl">
      {/* Logo区域 */}
      <div className="px-5 py-5 border-b border-gray-700">
        <div className="relative overflow-hidden rounded-2xl border border-orange-400/20 bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.24),_transparent_34%),linear-gradient(135deg,_rgba(17,24,39,0.98),_rgba(15,23,42,0.94))] px-4 py-4 shadow-[0_18px_40px_rgba(0,0,0,0.28)]">
          <div className="absolute inset-x-4 top-0 h-px bg-gradient-to-r from-transparent via-orange-200/70 to-transparent" />
          <div className="absolute -right-10 -top-12 h-28 w-28 rounded-full bg-orange-400/10 blur-2xl" />
          <div className="relative">
            <div className="relative inline-block">
              <span
                aria-hidden="true"
                className="absolute inset-0 translate-x-[2px] translate-y-[4px] text-[31px] font-black tracking-[0.18em] text-orange-500/25 blur-[2px]"
                style={{ fontFamily: '"STKaiti","KaiTi","DFKai-SB","Microsoft YaHei",serif' }}
              >
                剽之有道
              </span>
              <h1
                className="relative text-[31px] font-black leading-none tracking-[0.18em] text-transparent bg-clip-text bg-gradient-to-r from-orange-50 via-amber-200 to-orange-300 [transform:skewX(-8deg)]"
                style={{ fontFamily: '"STKaiti","KaiTi","DFKai-SB","Microsoft YaHei",serif' }}
              >
                剽之有道
              </h1>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <span className="h-px flex-1 bg-gradient-to-r from-orange-400/80 to-transparent" />
              <p className="rounded-full border border-orange-300/25 bg-white/5 px-2.5 py-1 text-[10px] font-medium tracking-[0.34em] text-orange-100/80 backdrop-blur-sm">
                采集 · 二创
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 导航模块 */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {modules.map((mod) => (
          <button
            key={mod.id}
            onClick={() => setActiveModule(mod.id)}
            className={clsx(
              "sidebar-item w-full text-left px-3 py-3 rounded-lg flex items-start gap-3 group",
              activeModule === mod.id
                ? "bg-red-600 text-white"
                : "text-gray-300 hover:bg-gray-700 hover:text-white"
            )}
          >
            <span className={clsx(
              "mt-0.5 flex-shrink-0",
              activeModule === mod.id ? "text-white" : "text-gray-400 group-hover:text-white"
            )}>
              {mod.icon}
            </span>
            <div>
              <div className="text-sm font-medium">{mod.label}</div>
              <div className={clsx(
                "text-xs mt-0.5",
                activeModule === mod.id ? "text-red-200" : "text-gray-500 group-hover:text-gray-400"
              )}>
                {mod.desc}
              </div>
            </div>
          </button>
        ))}
      </nav>

      {/* 底部版本信息 */}
      <div className="px-5 py-3 border-t border-gray-700">
        <p className="text-gray-600 text-xs text-center">精深求索内容运营助手</p>
      </div>
    </aside>
  );
}
