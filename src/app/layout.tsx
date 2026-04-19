import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "小红书内容智能体",
  description: "小红书内容爬取、二创、发布一体化工具",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full">
      <body className="h-full min-h-screen bg-gray-50 text-gray-900 antialiased">
        {children}
      </body>
    </html>
  );
}
