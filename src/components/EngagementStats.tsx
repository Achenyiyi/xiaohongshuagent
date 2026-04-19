"use client";

import clsx from "clsx";

const METRIC_LABELS = [
  { key: "likedCount", label: "点赞" },
  { key: "collectedCount", label: "收藏" },
  { key: "commentCount", label: "评论" },
  { key: "shareCount", label: "转发" },
] as const;

type MetricKey = (typeof METRIC_LABELS)[number]["key"];

interface EngagementStatsProps {
  likedCount: number;
  collectedCount: number;
  commentCount: number;
  shareCount: number;
  compact?: boolean;
  className?: string;
}

function formatMetricCount(value: number) {
  if (value >= 10000) return `${(value / 10000).toFixed(1)}w`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

export default function EngagementStats({
  likedCount,
  collectedCount,
  commentCount,
  shareCount,
  compact = false,
  className,
}: EngagementStatsProps) {
  const values: Record<MetricKey, number> = {
    likedCount,
    collectedCount,
    commentCount,
    shareCount,
  };

  return (
    <div className={clsx("flex flex-wrap items-center gap-1.5", className)}>
      {METRIC_LABELS.map(({ key, label }) => (
        <span
          key={key}
          className={clsx(
            "inline-flex items-center rounded-full border border-gray-200 bg-gray-50 text-gray-500",
            compact ? "gap-1 px-1.5 py-0.5 text-[11px]" : "gap-1.5 px-2 py-0.5 text-xs"
          )}
        >
          <span className="text-gray-400">{label}</span>
          <span className="font-medium tabular-nums text-gray-600">
            {formatMetricCount(values[key])}
          </span>
        </span>
      ))}
    </div>
  );
}
