import { getCoverTemplateFamily, type CoverTemplateLayout } from "@/lib/coverTemplates";

type ComposeCoverImageParams = {
  text: string;
  familyId: string;
  baseImageSrc: string;
};

type FittedCoverLayout = {
  fontSize: number;
  lineHeight: number;
  lines: string[];
};

const loadedImageCache = new Map<string, Promise<HTMLImageElement>>();

function loadImage(src: string) {
  const normalized = src.trim();
  if (!normalized) {
    return Promise.reject(new Error("缺少底图"));
  }

  let task = loadedImageCache.get(normalized);
  if (!task) {
    task = new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new window.Image();
      image.crossOrigin = "anonymous";
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`底图加载失败: ${normalized}`));
      image.src = normalized;
    });
    loadedImageCache.set(normalized, task);
  }

  return task;
}

function normalizeCoverText(text: string) {
  return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function wrapSingleLine(
  context: CanvasRenderingContext2D,
  line: string,
  maxWidth: number
) {
  if (!line) return [""];

  const wrappedLines: string[] = [];
  let currentLine = "";

  for (const char of Array.from(line)) {
    const nextLine = `${currentLine}${char}`;
    if (currentLine && context.measureText(nextLine).width > maxWidth) {
      wrappedLines.push(currentLine);
      currentLine = char;
      continue;
    }

    currentLine = nextLine;
  }

  if (currentLine || wrappedLines.length === 0) {
    wrappedLines.push(currentLine);
  }

  return wrappedLines;
}

function wrapCoverText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
) {
  return normalizeCoverText(text)
    .split("\n")
    .flatMap((line) => wrapSingleLine(context, line, maxWidth));
}

function buildFont(fontSize: number, layout: CoverTemplateLayout) {
  return `${layout.fontWeight} ${fontSize}px ${layout.fontFamily}`;
}

function fitCoverText(
  context: CanvasRenderingContext2D,
  text: string,
  layout: CoverTemplateLayout,
  width: number,
  height: number
): FittedCoverLayout {
  const boxWidth = layout.box.width * width;
  const boxHeight = layout.box.height * height;
  const maxFontSize = Math.max(Math.round(height * layout.maxFontRatio), 24);
  const minFontSize = Math.max(Math.round(height * layout.minFontRatio), 18);

  for (let fontSize = maxFontSize; fontSize >= minFontSize; fontSize -= 2) {
    context.font = buildFont(fontSize, layout);
    const lines = wrapCoverText(context, text, boxWidth);
    const lineHeight = Math.round(fontSize * layout.lineHeightMultiplier);
    const totalHeight = lines.length === 0 ? lineHeight : lines.length * lineHeight;

    if (totalHeight <= boxHeight) {
      return { fontSize, lineHeight, lines };
    }
  }

  context.font = buildFont(minFontSize, layout);
  return {
    fontSize: minFontSize,
    lineHeight: Math.round(minFontSize * layout.lineHeightMultiplier),
    lines: wrapCoverText(context, text, boxWidth),
  };
}

export async function composeCoverImage({
  text,
  familyId,
  baseImageSrc,
}: ComposeCoverImageParams) {
  const family = getCoverTemplateFamily(familyId);
  const baseImage = await loadImage(baseImageSrc);

  const canvas = document.createElement("canvas");
  canvas.width = baseImage.naturalWidth || 576;
  canvas.height = baseImage.naturalHeight || 768;

  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("封面画布初始化失败");
  }

  context.drawImage(baseImage, 0, 0, canvas.width, canvas.height);

  const normalizedText = normalizeCoverText(text);
  if (normalizedText.trim()) {
    const fitted = fitCoverText(context, normalizedText, family.layout, canvas.width, canvas.height);
    const boxX = family.layout.box.x * canvas.width;
    const boxY = family.layout.box.y * canvas.height;
    const boxWidth = family.layout.box.width * canvas.width;
    const boxHeight = family.layout.box.height * canvas.height;
    const totalHeight =
      fitted.lines.length === 0 ? fitted.lineHeight : fitted.lines.length * fitted.lineHeight;
    const startY = boxY + Math.max((boxHeight - totalHeight) / 2, 0);

    context.font = buildFont(fitted.fontSize, family.layout);
    context.fillStyle = family.layout.color;
    context.textBaseline = "top";
    context.textAlign = family.layout.align === "center" ? "center" : "left";

    fitted.lines.forEach((line, index) => {
      const drawX =
        family.layout.align === "center" ? boxX + boxWidth / 2 : boxX;
      const drawY = startY + index * fitted.lineHeight;
      context.fillText(line, drawX, drawY);
    });
  }

  return canvas.toDataURL("image/png");
}
