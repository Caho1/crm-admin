"use client";

import {
  DashboardOutlined,
  DownOutlined,
  GlobalOutlined,
  LogoutOutlined,
  MenuOutlined,
  ProductOutlined,
  SettingOutlined,
  ShoppingOutlined,
  TeamOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Avatar, Button, Drawer, Dropdown, Layout, Menu, type MenuProps } from "antd";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import type { SessionUser } from "@/lib/types";
import { localeOptions } from "@/lib/i18n";
import { useLocale } from "./providers";
import { UserProvider } from "./user-context";
import styles from "./app-shell.module.css";

const { Header, Content } = Layout;

function Brand() {
  const { t } = useLocale();
  return (
    <div className={styles.brand}>
      <div className={styles.brandMark}>S</div>
      <div className={styles.brandText}>
        <div className={styles.brandTitle}>{t("销售业务管理系统")}</div>
        <div className={styles.brandSub}>SALES OPERATIONS</div>
      </div>
    </div>
  );
}

export function AppShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { locale, setLocale, t } = useLocale();
  const [mobileOpen, setMobileOpen] = useState(false);

  const menuItems = useMemo<MenuProps["items"]>(() => {
    const base: MenuProps["items"] = [
      { key: "/dashboard", icon: <DashboardOutlined />, label: t("工作台") },
      { key: "/customers", icon: <TeamOutlined />, label: t("客户管理") },
      // 拜访记录仍挂在客户档案页（天然绑定客户）；订单有全局管理页
      { key: "/orders", icon: <ShoppingOutlined />, label: t("订单管理") },
      { key: "/products", icon: <ProductOutlined />, label: t("产品型号") },
    ];
    // 低频管理功能（人员权限 / 数据导入 / 操作日志）收进管理员专属的「设置」页
    if (user.role === "admin") {
      base.push(
        { type: "divider" },
        { key: "/settings", icon: <SettingOutlined />, label: t("设置") },
      );
    }
    return base;
  }, [t, user.role]);

  const onMenuClick: MenuProps["onClick"] = ({ key }) => {
    setMobileOpen(false);
    router.push(key);
  };

  // 顶部横向导航：当前栏目由选中态表达；子页面（客户详情等）高亮所属栏目
  const selectedKey =
    ["/dashboard", "/customers", "/orders", "/products", "/settings"].find((key) => pathname.startsWith(key)) || pathname;

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  };

  const accountMenu: MenuProps["items"] = [
    { key: "account", icon: <UserOutlined />, label: user.username, disabled: true },
    { type: "divider" },
    { key: "logout", icon: <LogoutOutlined />, label: t("退出登录"), danger: true, onClick: logout },
  ];

  const localeMenu: MenuProps["items"] = localeOptions.map((option) => ({
    key: option.value,
    label: option.label,
    onClick: () => setLocale(option.value),
  }));

  return (
    <UserProvider user={user}>
      <Layout className={styles.root}>
        <Header className={styles.header}>
          <div className={styles.headerLeft}>
            <Button
              className={styles.mobileMenuButton}
              type="text"
              icon={<MenuOutlined />}
              aria-label={t("打开导航")}
              onClick={() => setMobileOpen(true)}
            />
            <Brand />
          </div>
          <Menu
            className={styles.topMenu}
            mode="horizontal"
            selectedKeys={[selectedKey]}
            items={menuItems}
            onClick={onMenuClick}
          />
          <div className={styles.headerRight}>
            <Dropdown
              menu={{ items: localeMenu, selectedKeys: [locale] }}
              trigger={["click"]}
              placement="bottomRight"
            >
              <Button type="text" icon={<GlobalOutlined />} aria-label="Language">
                {localeOptions.find((option) => option.value === locale)?.label}
              </Button>
            </Dropdown>
            <Dropdown menu={{ items: accountMenu }} trigger={["click"]} placement="bottomRight">
              <div className={styles.userButton} role="button" tabIndex={0}>
                <Avatar size={34} style={{ background: user.role === "admin" ? "#1769aa" : "#2f855a" }}>
                  {user.name.slice(0, 1)}
                </Avatar>
                <span className={styles.userMeta}>
                  <span className={styles.userName}>{user.name}</span>
                  <span className={styles.userRole}>{user.role === "admin" ? t("管理员") : t("普通用户")}</span>
                </span>
                <DownOutlined style={{ color: "#98a2b3", fontSize: 10 }} />
              </div>
            </Dropdown>
          </div>
        </Header>
        <Content className={styles.content}>{children}</Content>
        <Drawer open={mobileOpen} onClose={() => setMobileOpen(false)} placement="left" size={280} styles={{ body: { padding: 0 } }}>
          <div className={styles.drawerBrand}><Brand /></div>
          <Menu
            className={styles.drawerMenu}
            mode="inline"
            selectedKeys={[selectedKey]}
            items={menuItems}
            onClick={onMenuClick}
          />
        </Drawer>
      </Layout>
    </UserProvider>
  );
}
