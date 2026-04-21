export type CoverTemplateLayout = {
  align: "left" | "center";
  box: { x: number; y: number; width: number; height: number };
  maxFontRatio: number;
  minFontRatio: number;
  lineHeightMultiplier: number;
  fontWeight: number;
  fontFamily: string;
  color: string;
};

export type CoverTemplateLayoutProfile = {
  id: string;
  label: string;
  layout: CoverTemplateLayout;
};

export type CoverTemplateSourceType = "builtin" | "upload" | "ai";

export type CoverTemplateAsset = {
  id: string;
  label: string;
  src: string;
  layoutId: string;
  sourceType: CoverTemplateSourceType;
  createdAt?: string;
  prompt?: string;
};

const DEFAULT_FONT_FAMILY = [
  '"PingFang SC"',
  '"Hiragino Sans GB"',
  '"Microsoft YaHei"',
  '"Noto Sans CJK SC"',
  '"Apple Color Emoji"',
  '"Segoe UI Emoji"',
  "sans-serif",
].join(", ");

export const DEFAULT_COVER_LAYOUT_ID = "standard";

export const COVER_TEMPLATE_LAYOUT_PROFILES: readonly CoverTemplateLayoutProfile[] = [
  {
    id: "standard",
    label: "通用排版",
    layout: {
      align: "left",
      box: { x: 0.11, y: 0.16, width: 0.76, height: 0.42 },
      maxFontRatio: 0.086,
      minFontRatio: 0.048,
      lineHeightMultiplier: 1.18,
      fontWeight: 700,
      fontFamily: DEFAULT_FONT_FAMILY,
      color: "#4f4b55",
    },
  },
  {
    id: "airy",
    label: "轻盈排版",
    layout: {
      align: "left",
      box: { x: 0.12, y: 0.15, width: 0.74, height: 0.38 },
      maxFontRatio: 0.084,
      minFontRatio: 0.046,
      lineHeightMultiplier: 1.18,
      fontWeight: 700,
      fontFamily: DEFAULT_FONT_FAMILY,
      color: "#514854",
    },
  },
  {
    id: "doodle",
    label: "涂鸦排版",
    layout: {
      align: "left",
      box: { x: 0.11, y: 0.17, width: 0.76, height: 0.44 },
      maxFontRatio: 0.086,
      minFontRatio: 0.048,
      lineHeightMultiplier: 1.16,
      fontWeight: 800,
      fontFamily: DEFAULT_FONT_FAMILY,
      color: "#612736",
    },
  },
] as const;

export const BUILTIN_COVER_TEMPLATE_ASSETS: readonly CoverTemplateAsset[] = [
  {
    id: "builtin-template1",
    label: "基础 01",
    src: "/templates/template1.png",
    layoutId: "standard",
    sourceType: "builtin",
  },
  {
    id: "builtin-template2",
    label: "基础 02",
    src: "/templates/template2.png",
    layoutId: "standard",
    sourceType: "builtin",
  },
  {
    id: "builtin-template7",
    label: "清新 01",
    src: "/templates/template7.png",
    layoutId: "airy",
    sourceType: "builtin",
  },
  {
    id: "builtin-template3",
    label: "清新 02",
    src: "/templates/template3.png",
    layoutId: "airy",
    sourceType: "builtin",
  },
  {
    id: "builtin-template4",
    label: "涂鸦 01",
    src: "/templates/template4.png",
    layoutId: "doodle",
    sourceType: "builtin",
  },
  {
    id: "builtin-template6",
    label: "涂鸦 02",
    src: "/templates/template6.png",
    layoutId: "doodle",
    sourceType: "builtin",
  },
] as const;

function hashSeed(seed: string) {
  return Array.from(seed).reduce((acc, char) => {
    return (acc * 31 + char.charCodeAt(0)) >>> 0;
  }, 7);
}

export function getCoverLayoutProfile(layoutId?: string | null) {
  return (
    COVER_TEMPLATE_LAYOUT_PROFILES.find((profile) => profile.id === layoutId) ||
    COVER_TEMPLATE_LAYOUT_PROFILES[0]
  );
}

export function getBuiltinCoverTemplateAsset(templateId?: string | null) {
  return BUILTIN_COVER_TEMPLATE_ASSETS.find((asset) => asset.id === templateId) || null;
}

export function getAllCoverTemplateAssets(customAssets: CoverTemplateAsset[] = []) {
  return [...BUILTIN_COVER_TEMPLATE_ASSETS, ...customAssets];
}

export function findCoverTemplateAssetById(
  templateId?: string | null,
  customAssets: CoverTemplateAsset[] = []
) {
  if (!templateId) return null;
  return getAllCoverTemplateAssets(customAssets).find((asset) => asset.id === templateId) || null;
}

export function pickDefaultCoverTemplateSelection(seed = "default") {
  const assetIndex = hashSeed(seed) % BUILTIN_COVER_TEMPLATE_ASSETS.length;
  const asset = BUILTIN_COVER_TEMPLATE_ASSETS[assetIndex];

  return {
    layoutId: asset.layoutId,
    templateId: asset.id,
    baseImage: asset.src,
  };
}

export function resolveCoverTemplateSelection(args: {
  layoutId?: string | null;
  templateId?: string | null;
  baseImage?: string | null;
  seed?: string;
  customAssets?: CoverTemplateAsset[];
}) {
  const fallback = pickDefaultCoverTemplateSelection(args.seed);
  const asset =
    findCoverTemplateAssetById(args.templateId, args.customAssets) ||
    findCoverTemplateAssetById(fallback.templateId, args.customAssets) ||
    BUILTIN_COVER_TEMPLATE_ASSETS[0];
  const layout = getCoverLayoutProfile(args.layoutId || asset.layoutId || fallback.layoutId);

  return {
    asset,
    layout,
    baseImage: (args.baseImage || "").trim() || asset.src,
  };
}

export function isBuiltinTemplateAssetId(templateId?: string | null) {
  if (!templateId) return false;
  return BUILTIN_COVER_TEMPLATE_ASSETS.some((asset) => asset.id === templateId);
}

export function isBuiltinTemplateSource(source?: string | null) {
  const normalized = (source || "").trim();
  if (!normalized) return false;

  return BUILTIN_COVER_TEMPLATE_ASSETS.some((asset) => asset.src === normalized);
}

export function createCustomCoverTemplateAsset(params: {
  id: string;
  label: string;
  src: string;
  sourceType: Exclude<CoverTemplateSourceType, "builtin">;
  layoutId?: string;
  createdAt?: string;
  prompt?: string;
}) {
  return {
    id: params.id,
    label: params.label,
    src: params.src,
    sourceType: params.sourceType,
    layoutId: params.layoutId || DEFAULT_COVER_LAYOUT_ID,
    createdAt: params.createdAt,
    prompt: params.prompt,
  } satisfies CoverTemplateAsset;
}
