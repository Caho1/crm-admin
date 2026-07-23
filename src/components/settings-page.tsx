"use client";

import { AuditOutlined, TeamOutlined, UploadOutlined } from "@ant-design/icons";
import { Tabs } from "antd";
import { AuditLogPage } from "./audit-log-page";
import { DataCenter } from "./data-center";
import { useLocale } from "./providers";
import { UserAdmin } from "./user-admin";

// 后台设置：把人员权限、数据导入、操作日志三个低频管理功能收进一个管理员专属页面，
// 日常侧边栏因此得以只保留业务模块。各 Tab 直接复用原有页面组件。
export function SettingsPage() {
  const { t } = useLocale();
  return (
    <Tabs
      defaultActiveKey="users"
      items={[
        { key: "users", label: <span><TeamOutlined /> {t("人员权限")}</span>, children: <UserAdmin /> },
        { key: "import", label: <span><UploadOutlined /> {t("数据导入")}</span>, children: <DataCenter /> },
        { key: "audit", label: <span><AuditOutlined /> {t("操作日志")}</span>, children: <AuditLogPage /> },
      ]}
    />
  );
}
