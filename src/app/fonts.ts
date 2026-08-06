import { Inter, Noto_Sans_KR, Noto_Sans_SC } from "next/font/google";

// Google Fonts 统一入口：英数用 Inter（可变字体），中文 Noto Sans SC，韩文 Noto Sans KR。
// next/font 在构建时下载字体并自托管，运行时零外部请求，Electron 离线可用。
// 中文/韩文字体按 unicode-range 分片，浏览器只加载页面实际用到的分片。
export const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const notoSansSC = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-noto-sc",
});

export const notoSansKR = Noto_Sans_KR({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-noto-kr",
});
