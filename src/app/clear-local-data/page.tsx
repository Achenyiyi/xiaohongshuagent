"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const LOCAL_STORAGE_KEYS = [
  "xhs-app-ui-state",
  "xhs-app-prompts-settings",
  "xhs-app-rewrite-settings",
] as const;

const INDEXED_DB_NAME = "xhs-app-operator-cache";

type CleanupStatus = "idle" | "running" | "success" | "blocked" | "error";

function deleteIndexedDbDatabase(name: string) {
  return new Promise<void>((resolve, reject) => {
    if (typeof window === "undefined" || typeof window.indexedDB === "undefined") {
      resolve();
      return;
    }

    const request = window.indexedDB.deleteDatabase(name);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error || new Error(`删除 IndexedDB 失败: ${name}`));
    request.onblocked = () =>
      reject(
        new Error("IndexedDB 正在被其他标签页占用，请关闭所有系统页面后重试。")
      );
  });
}

export default function ClearLocalDataPage() {
  const [status, setStatus] = useState<CleanupStatus>("running");
  const [message, setMessage] = useState("正在清理当前浏览器中的本地缓存...");

  async function runCleanup() {
    setStatus("running");
    setMessage("正在清理 localStorage 和 IndexedDB...");

    try {
      LOCAL_STORAGE_KEYS.forEach((key) => {
        window.localStorage.removeItem(key);
      });

      await deleteIndexedDbDatabase(INDEXED_DB_NAME);

      setStatus("success");
      setMessage("本地缓存已清理完成。现在交给下一位使用者时，不会继承当前浏览器里的本地数据。");
    } catch (error) {
      const nextMessage =
        error instanceof Error ? error.message : "清理失败，请关闭其他系统页面后重试。";
      const nextStatus = nextMessage.includes("占用") ? "blocked" : "error";
      setStatus(nextStatus);
      setMessage(nextMessage);
    }
  }

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        LOCAL_STORAGE_KEYS.forEach((key) => {
          window.localStorage.removeItem(key);
        });

        await deleteIndexedDbDatabase(INDEXED_DB_NAME);

        if (cancelled) return;
        setStatus("success");
        setMessage(
          "本地缓存已清理完成。现在交给下一位使用者时，不会继承当前浏览器里的本地数据。"
        );
      } catch (error) {
        if (cancelled) return;

        const nextMessage =
          error instanceof Error ? error.message : "清理失败，请关闭其他系统页面后重试。";
        const nextStatus = nextMessage.includes("占用") ? "blocked" : "error";
        setStatus(nextStatus);
        setMessage(nextMessage);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#fff1f2,_#f8fafc_55%,_#eef2ff)] px-6 py-10 text-gray-900">
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <div className="rounded-3xl border border-white/70 bg-white/90 p-8 shadow-[0_20px_80px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.28em] text-red-500">
                Local Cleanup
              </p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight text-gray-950">
                清理当前浏览器本地数据
              </h1>
              <p className="mt-3 text-sm leading-6 text-gray-600">
                这个页面只清理当前浏览器里属于 `http://127.0.0.1:3000` 的本地缓存，
                不会删除飞书表里的远端业务数据。
              </p>
            </div>
            <div
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                status === "success"
                  ? "bg-emerald-100 text-emerald-700"
                  : status === "running"
                    ? "bg-amber-100 text-amber-700"
                    : status === "blocked" || status === "error"
                      ? "bg-red-100 text-red-700"
                      : "bg-gray-100 text-gray-600"
              }`}
            >
              {status === "success"
                ? "已完成"
                : status === "running"
                  ? "清理中"
                  : status === "blocked"
                    ? "被占用"
                    : status === "error"
                      ? "失败"
                      : "待执行"}
            </div>
          </div>

          <div className="mt-8 rounded-2xl border border-gray-200 bg-gray-50/80 p-5">
            <p className="text-sm font-medium text-gray-900">本次会清理：</p>
            <ul className="mt-3 space-y-2 text-sm text-gray-600">
              {LOCAL_STORAGE_KEYS.map((key) => (
                <li key={key}>{key}</li>
              ))}
              <li>{INDEXED_DB_NAME}</li>
            </ul>
          </div>

          <div className="mt-6 rounded-2xl border border-gray-200 bg-white px-5 py-4 text-sm leading-6 text-gray-700">
            {message}
          </div>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void runCleanup()}
              disabled={status === "running"}
              className="rounded-xl bg-red-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-300"
            >
              {status === "running" ? "清理中..." : "立即清理"}
            </button>
            <Link
              href="/"
              className="rounded-xl border border-gray-200 bg-white px-5 py-2.5 text-sm font-medium text-gray-700 transition hover:border-gray-300 hover:bg-gray-50"
            >
              返回首页
            </Link>
          </div>
        </div>

        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm leading-6 text-amber-900">
          如果提示 IndexedDB 被占用，说明还有别的系统标签页开着。把所有
          `127.0.0.1:3000` 页面都关掉后，再重新运行一次清理脚本。
        </div>
      </div>
    </main>
  );
}
