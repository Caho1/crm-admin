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
            controlHeight: 36,
            fontSize: 15,
            // 与 globals.css body 的字体栈保持一致（Google Fonts 变量在前，系统字体兜底）
            fontFamily:
              "var(--font-inter), var(--font-noto-sc), var(--font-noto-kr), -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans KR', Arial, sans-serif",
          },
          components: {
            Layout: { bodyBg: "#f4f6f9", headerBg: "#ffffff", siderBg: "#ffffff" },
            // 横向导航保持 antd 规范：选中态是主色文字 + 底部指示条，不加背景块；
            // 抽屉里的 inline 菜单才用软底选中样式
            Menu: { itemBorderRadius: 6, itemHeight: 42, itemMarginInline: 10, itemSelectedBg: "#eaf3fb", itemSelectedColor: "#1769aa", horizontalLineHeight: "62px" },
            Table: { headerBg: "#f8fafc", rowHoverBg: "#f6f9fc" },
            Button: { primaryShadow: "none" },
          },
        }}
      >
        {/* 顶栏 72px，提示条下移到顶栏下方，避免盖住导航 */}
        <App message={{ top: 84 }}>{children}</App>
      </ConfigProvider>
    </LocaleContext.Provider>
  );
}
