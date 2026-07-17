"use client";

import { GlobalOutlined, LockOutlined, UserOutlined } from "@ant-design/icons";
import { Alert, Button, Form, Input, Select } from "antd";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { localeOptions } from "@/lib/i18n";
import { useLocale } from "./providers";
import styles from "./login-form.module.css";

type LoginValues = { username: string; password: string };

export function LoginForm() {
  const router = useRouter();
  const { locale, setLocale, t } = useLocale();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const login = async (values: LoginValues) => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const payload = await response.json();
      if (!response.ok) {
        setError(t(payload.error?.message || "登录失败，请重试"));
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    } catch {
      setError(t("无法连接系统，请检查网络后重试"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <div className={styles.brandSide}>
          <div className={styles.brandLockup}>
            <div className={styles.brandMark}>S</div>
            <div>
              <div className={styles.brandName}>{t("销售业务管理系统")}</div>
              <div className={styles.brandEn}>SALES OPERATIONS</div>
            </div>
          </div>
          <div className={styles.brandStatement}>
            <strong>{t("销售运营工作台")}</strong>
            <span>SALES OPERATIONS · 2026</span>
          </div>
          <div className={styles.accentLine} />
        </div>
        <div className={styles.formSide}>
          <div className={styles.localeSwitch}>
            <Select
              size="small"
              variant="borderless"
              value={locale}
              options={localeOptions}
              onChange={setLocale}
              prefix={<GlobalOutlined style={{ color: "#98a2b3" }} />}
              popupMatchSelectWidth={false}
            />
          </div>
          <h1 className={styles.title}>{t("登录系统")}</h1>
          <div className={styles.subtitle}>{t("请输入分配给你的账号与密码")}</div>
          {error ? <Alert className={styles.alert} type="error" showIcon message={error} /> : null}
          <Form<LoginValues> layout="vertical" onFinish={login} requiredMark={false} size="large">
            <Form.Item name="username" label={t("账号")} rules={[{ required: true, message: t("请输入账号") }]}>
              <Input prefix={<UserOutlined />} placeholder={t("请输入账号")} autoComplete="username" />
            </Form.Item>
            <Form.Item name="password" label={t("密码")} rules={[{ required: true, message: t("请输入密码") }]}>
              <Input.Password prefix={<LockOutlined />} placeholder={t("请输入密码")} autoComplete="current-password" />
            </Form.Item>
            <Form.Item style={{ marginBottom: 0 }}>
              <Button className={styles.submit} type="primary" htmlType="submit" loading={loading}>
                {t("登录")}
              </Button>
            </Form.Item>
          </Form>
          {process.env.NODE_ENV !== "production" ? (
            <div className={styles.demo}>
              <strong>{t("本地演示账号")}</strong><br />
              {t("管理员")}：admin / Admin@123<br />
              {t("普通用户")}：sales / Sales@123
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}
