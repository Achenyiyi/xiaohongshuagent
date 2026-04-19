import { NextRequest, NextResponse } from "next/server";
import { normalizeImageUrl } from "@/lib/image";
import { fetchImageResponse } from "@/lib/serverImage";

/**
 * 图片代理接口：规避前端跨域问题，将小红书/飞书等图片通过服务端转发
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const imageUrl = searchParams.get("url");

  if (!imageUrl) {
    return NextResponse.json({ error: "缺少url参数" }, { status: 400 });
  }

  try {
    const normalizedUrl = normalizeImageUrl(imageUrl);
    const resp = await fetchImageResponse(normalizedUrl);

    if (!resp.ok) {
      return new NextResponse("图片获取失败", { status: resp.status });
    }

    const contentType = resp.headers.get("content-type") || "image/jpeg";
    const buffer = await resp.arrayBuffer();

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (e: unknown) {
    console.error("Image proxy error:", e);
    return new NextResponse("代理请求失败", { status: 500 });
  }
}
