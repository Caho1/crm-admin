import type { Metadata } from "next";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { cookies } from "next/headers";
import { Providers } from "@/components/providers";
import { LOCALE_COOKIE, normalizeLocale } from "@/lib/i18n";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "销售业务管理系统",
    template: "%s | 销售业务管理系统",
  },
  description: "客户、拜访、商机与订单出货管理后台",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const store = await cookies();
  const locale = normalizeLocale(store.get(LOCALE_COOKIE)?.value);
  return (
    <html lang={locale}>
      <body>
        <AntdRegistry>
          <Providers initialLocale={locale}>{children}</Providers>
        </AntdRegistry>
      </body>
    </html>
  );
}
