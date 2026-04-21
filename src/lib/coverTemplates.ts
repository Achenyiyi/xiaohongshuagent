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

export type CoverTemplateVariant = {
  id: string;
  label: string;
  src: string;
};

export type CoverTemplateFamily = {
  id: string;
  label: string;
  description: string;
  layout: CoverTemplateLayout;
  variants: CoverTemplateVariant[];
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

export const COVER_TEMPLATE_FAMILIES: readonly CoverTemplateFamily[] = [
  {
    id: "basic",
    label: "基础",
    description: "干净留白，信息感更强",
    layout: {
      align: "left",
      box: { x: 0.11, y: 0.18, width: 0.76, height: 0.42 },
      maxFontRatio: 0.088,
      minFontRatio: 0.05,
      lineHeightMultiplier: 1.18,
      fontWeight: 700,
      fontFamily: DEFAULT_FONT_FAMILY,
      color: "#4e4a55",
    },
    variants: [
      { id: "template1", label: "基础 01", src: "/templates/template1.png" },
      { id: "template2", label: "基础 02", src: "/templates/template2.png" },
    ],
  },
  {
    id: "fresh",
    label: "清新",
    description: "柔和浅色，偏内容卡片",
    layout: {
      align: "left",
      box: { x: 0.12, y: 0.16, width: 0.74, height: 0.38 },
      maxFontRatio: 0.085,
      minFontRatio: 0.048,
      lineHeightMultiplier: 1.18,
      fontWeight: 700,
      fontFamily: DEFAULT_FONT_FAMILY,
      color: "#514854",
    },
    variants: [
      { id: "template7", label: "清新 01", src: "/templates/template7.png" },
      { id: "template3", label: "清新 02", src: "/templates/template3.png" },
    ],
  },
  {
    id: "doodle",
    label: "涂鸦",
    description: "笔触感更强，适合口语短句",
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
    variants: [
      { id: "template4", label: "涂鸦 01", src: "/templates/template4.png" },
      { id: "template6", label: "涂鸦 02", src: "/templates/template6.png" },
    ],
  },
] as const;

function hashSeed(seed: string) {
  return Array.from(seed).reduce((acc, char) => {
    return (acc * 31 + char.charCodeAt(0)) >>> 0;
  }, 7);
}

export function getCoverTemplateFamily(familyId?: string | null) {
  return (
    COVER_TEMPLATE_FAMILIES.find((family) => family.id === familyId) ||
    COVER_TEMPLATE_FAMILIES[0]
  );
}

export function getCoverTemplateVariant(
  familyId?: string | null,
  variantId?: string | null
) {
  const family = getCoverTemplateFamily(familyId);

  return (
    family.variants.find((variant) => variant.id === variantId) || family.variants[0]
  );
}

export function pickDefaultCoverTemplateSelection(seed = "default") {
  const familyIndex = hashSeed(seed) % COVER_TEMPLATE_FAMILIES.length;
  const family = COVER_TEMPLATE_FAMILIES[familyIndex];
  const variantIndex = hashSeed(`${seed}-${family.id}`) % family.variants.length;
  const variant = family.variants[variantIndex];

  return {
    familyId: family.id,
    variantId: variant.id,
    baseImage: variant.src,
  };
}

export function resolveCoverTemplateSelection(args: {
  familyId?: string | null;
  variantId?: string | null;
  baseImage?: string | null;
  seed?: string;
}) {
  const fallback = pickDefaultCoverTemplateSelection(args.seed);
  const family = getCoverTemplateFamily(args.familyId || fallback.familyId);
  const variant = getCoverTemplateVariant(family.id, args.variantId || fallback.variantId);

  return {
    family,
    variant,
    baseImage: (args.baseImage || "").trim() || variant.src,
  };
}

export function getNextCoverTemplateVariant(
  familyId?: string | null,
  currentVariantId?: string | null
) {
  const family = getCoverTemplateFamily(familyId);
  const currentIndex = family.variants.findIndex((variant) => variant.id === currentVariantId);
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % family.variants.length : 0;
  return family.variants[nextIndex];
}

export function isTemplateVariantSource(source?: string | null) {
  const normalized = (source || "").trim();
  if (!normalized) return false;

  return COVER_TEMPLATE_FAMILIES.some((family) =>
    family.variants.some((variant) => variant.src === normalized)
  );
}
