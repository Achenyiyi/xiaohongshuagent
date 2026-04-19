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
        <div>
          <div>
            <h1 className="text-white font-bold text-sm leading-tight">小红书内容智能体</h1>
            <p className="text-gray-400 text-xs">采集 · 二创</p>
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
        <p className="text-gray-600 text-xs text-center">v1.0.0 · 内容运营助手</p>
      </div>
    </aside>
  );
}
