"use client";

import { App, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import enUS from "antd/locale/en_US";
import koKR from "antd/locale/ko_KR";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";
import "dayjs/locale/en";
import "dayjs/locale/ko";
import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { LOCALE_COOKIE, translate, type Locale, type TranslateVars } from "@/lib/i18n";

const antdLocales = { "zh-CN": zhCN, "en-US": enUS, "ko-KR": koKR } as const;
const dayjsLocales = { "zh-CN": "zh-cn", "en-US": "en", "ko-KR": "ko" } as const;

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (text: string, vars?: TranslateVars) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function useLocale() {
  const value = useContext(LocaleContext);
  if (!value) throw new Error("useLocale 必须在 Providers 内使用");
  return value;
}

export function Providers({ children, initialLocale = "zh-CN" }: { children: React.ReactNode; initialLocale?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);

  // 在渲染子树之前同步 dayjs 全局语言，保证 dddd 等本地化格式正确
  useMemo(() => {
    dayjs.locale(dayjsLocales[locale]);
  }, [locale]);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  }, []);

  const t = useCallback((text: string, vars?: TranslateVars) => translate(locale, text, vars), [locale]);

  const contextValue = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

  return (
    <LocaleContext.Provider value={contextValue}>
      <ConfigProvider
        locale={antdLocales[locale]}
        theme={{
          token: {
            colorPrimary: "#1769aa",
            colorSuccess: "#2f855a",
            colorWarning: "#b7791f",
            colorError: "#c2413b",
            colorText: "#172033",
            colorTextSecondary: "#667085",
            colorBorder: "#e3e8ef",
            borderRadius: 6,
            controlHeight: 34,
            fontSize: 14,
          },
          components: {
            Layout: { bodyBg: "#f4f6f9", headerBg: "#ffffff", siderBg: "#ffffff" },
            Menu: { itemBorderRadius: 6, itemHeight: 42, itemMarginInline: 10 },
            Table: { headerBg: "#f8fafc", rowHoverBg: "#f6f9fc" },
            Button: { primaryShadow: "none" },
          },
        }}
      >
        <App>{children}</App>
      </ConfigProvider>
    </LocaleContext.Provider>
  );
}
