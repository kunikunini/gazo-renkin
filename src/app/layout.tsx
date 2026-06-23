/* eslint-disable @next/next/no-page-custom-font -- App Routerのルートレイアウトから全ページへ適用します。 */
import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GAZO RENKIN｜画像を軽く、美しく",
  description:
    "画像のサイズ変更・形式変換・圧縮をブラウザ内だけで行う、冒険仕立ての画像ツール。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" className="h-full antialiased">
      <head>
        <link rel="icon" type="image/png" href="/icons/app-icon-192.png" sizes="192x192" />
        <link rel="icon" type="image/png" href="/icons/icon-512.png" sizes="512x512" />
        <link rel="apple-touch-icon" href="/icons/apple-icon-180.png" sizes="180x180" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=DotGothic16&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
