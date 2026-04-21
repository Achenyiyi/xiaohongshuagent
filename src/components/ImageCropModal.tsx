"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

const VIEWPORT_WIDTH = 300;
const VIEWPORT_HEIGHT = 400;
const OUTPUT_WIDTH = 900;
const OUTPUT_HEIGHT = 1200;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

type DragState = {
  startX: number;
  startY: number;
  originX: number;
  originY: number;
} | null;

export default function ImageCropModal({
  imageSrc,
  title = "裁剪为 3:4",
  onCancel,
  onConfirm,
}: {
  imageSrc: string;
  title?: string;
  onCancel: () => void;
  onConfirm: (croppedDataUrl: string) => void;
}) {
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragState, setDragState] = useState<DragState>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const image = new window.Image();
    image.onload = () => {
      if (cancelled) return;
      const nextImageSize = { width: image.naturalWidth, height: image.naturalHeight };
      const initialScale = Math.max(
        VIEWPORT_WIDTH / nextImageSize.width,
        VIEWPORT_HEIGHT / nextImageSize.height
      );
      const displayWidth = nextImageSize.width * initialScale;
      const displayHeight = nextImageSize.height * initialScale;

      setImageSize(nextImageSize);
      setScale(initialScale);
      setOffset({
        x: (VIEWPORT_WIDTH - displayWidth) / 2,
        y: (VIEWPORT_HEIGHT - displayHeight) / 2,
      });
    };
    image.src = imageSrc;

    return () => {
      cancelled = true;
    };
  }, [imageSrc]);

  const minScale = useMemo(() => {
    if (!imageSize) return 1;
    return Math.max(VIEWPORT_WIDTH / imageSize.width, VIEWPORT_HEIGHT / imageSize.height);
  }, [imageSize]);

  function clampOffset(nextX: number, nextY: number, nextScale = scale) {
    if (!imageSize) return { x: nextX, y: nextY };

    const displayWidth = imageSize.width * nextScale;
    const displayHeight = imageSize.height * nextScale;
    const minX = Math.min(0, VIEWPORT_WIDTH - displayWidth);
    const minY = Math.min(0, VIEWPORT_HEIGHT - displayHeight);

    return {
      x: clamp(nextX, minX, 0),
      y: clamp(nextY, minY, 0),
    };
  }

  function handleZoomChange(nextScale: number) {
    if (!imageSize) return;

    const centerX = VIEWPORT_WIDTH / 2;
    const centerY = VIEWPORT_HEIGHT / 2;
    const contentX = (centerX - offset.x) / scale;
    const contentY = (centerY - offset.y) / scale;
    const unclamped = {
      x: centerX - contentX * nextScale,
      y: centerY - contentY * nextScale,
    };
    setScale(nextScale);
    setOffset(clampOffset(unclamped.x, unclamped.y, nextScale));
  }

  function handlePointerMove(clientX: number, clientY: number) {
    if (!dragState) return;
    setOffset(
      clampOffset(
        dragState.originX + (clientX - dragState.startX),
        dragState.originY + (clientY - dragState.startY)
      )
    );
  }

  function handleConfirm() {
    if (!imageSize) return;

    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_WIDTH;
    canvas.height = OUTPUT_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) return;

    const image = new window.Image();
    image.onload = () => {
      const sourceX = Math.max(0, -offset.x / scale);
      const sourceY = Math.max(0, -offset.y / scale);
      const sourceWidth = VIEWPORT_WIDTH / scale;
      const sourceHeight = VIEWPORT_HEIGHT / scale;

      context.drawImage(
        image,
        sourceX,
        sourceY,
        sourceWidth,
        sourceHeight,
        0,
        0,
        OUTPUT_WIDTH,
        OUTPUT_HEIGHT
      );
      onConfirm(canvas.toDataURL("image/png"));
    };
    image.src = imageSrc;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4" onClick={onCancel}>
      <div
        className="w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold text-gray-800">{title}</h3>
            <p className="mt-1 text-xs text-gray-500">
              裁剪框固定为 3:4。拖动图片调整范围，必要时用缩放滑块放大。
            </p>
          </div>
          <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-4 flex flex-col gap-4 lg:flex-row">
          <div className="flex-1">
            <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50 p-4">
              <div
                ref={viewportRef}
                className="relative mx-auto overflow-hidden rounded-2xl border border-white bg-white shadow-inner"
                style={{ width: VIEWPORT_WIDTH, height: VIEWPORT_HEIGHT }}
                onMouseLeave={() => setDragState(null)}
                onMouseMove={(event) => {
                  if (!dragState) return;
                  handlePointerMove(event.clientX, event.clientY);
                }}
                onMouseUp={() => setDragState(null)}
                onTouchMove={(event) => {
                  if (!dragState) return;
                  const touch = event.touches[0];
                  if (!touch) return;
                  handlePointerMove(touch.clientX, touch.clientY);
                }}
                onTouchEnd={() => setDragState(null)}
              >
                {imageSize ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={imageSrc}
                    alt="待裁剪图片"
                    draggable={false}
                    onMouseDown={(event) =>
                      setDragState({
                        startX: event.clientX,
                        startY: event.clientY,
                        originX: offset.x,
                        originY: offset.y,
                      })
                    }
                    onTouchStart={(event) => {
                      const touch = event.touches[0];
                      if (!touch) return;
                      setDragState({
                        startX: touch.clientX,
                        startY: touch.clientY,
                        originX: offset.x,
                        originY: offset.y,
                      });
                    }}
                    className="absolute max-w-none cursor-grab select-none active:cursor-grabbing"
                    style={{
                      width: imageSize.width * scale,
                      height: imageSize.height * scale,
                      left: offset.x,
                      top: offset.y,
                    }}
                  />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm text-gray-400">
                    图片加载中
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="w-full rounded-2xl border border-gray-100 bg-gray-50 p-4 lg:w-72">
            <p className="text-xs font-medium text-gray-500">缩放</p>
            <input
              type="range"
              min={minScale}
              max={Math.max(minScale * 3, minScale + 0.01)}
              step={0.01}
              value={scale}
              onChange={(event) => handleZoomChange(Number(event.target.value))}
              className="mt-3 w-full"
              disabled={!imageSize}
            />
            <p className="mt-3 text-[11px] leading-relaxed text-gray-400">
              当前裁剪结果会导出为 3:4 模板图，用于后续自动渲染封面文案。
            </p>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
          >
            取消
          </button>
          <button
            onClick={handleConfirm}
            className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600"
          >
            确认裁剪
          </button>
        </div>
      </div>
    </div>
  );
}
