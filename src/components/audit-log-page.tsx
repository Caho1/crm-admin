"use client";

import { ReloadOutlined } from "@ant-design/icons";
import { App, Button, Input, Select, Table, Tooltip, type TableProps } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocale } from "./providers";
import { statusLabel, StatusTag } from "./status-tag";
import styles from "./admin-pages.module.css";

type AuditRow = {
  id: number;
  userName: string | null;
  action: string;
  entityType: string;
  entityId: number | null;
  summary: string;
  createdAt: string;
};

export function AuditLogPage() {
  const { t } = useLocale();
  const { message } = App.useApp();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [action, setAction] = useState<string>();

  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (query) params.set("q", query);
      if (action) params.set("action", action);
      const response = await fetch(`/api/audit-logs?${params}`);
      const payload = await response.json();
      if (seq !== loadSeq.current) return;
      if (!response.ok) throw new Error(payload.error?.message || "日志加载失败");
      setRows(payload.data);
      setTotal(payload.meta.total);
    } catch (error) {
      if (seq === loadSeq.current) message.error(t(error instanceof Error ? error.message : "日志加载失败"));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [action, message, page, pageSize, query, t]);

  useEffect(() => { void load(); }, [load]);

  const columns: TableProps<AuditRow>["columns"] = [
    { title: t("时间"), dataIndex: "createdAt", width: 170 },
    { title: t("操作人"), dataIndex: "userName", width: 120, render: (value) => value || t("系统") },
    { title: t("动作"), dataIndex: "action", width: 105, render: (value) => <StatusTag value={value} /> },
    { title: t("对象"), key: "entity", width: 150, render: (_, row) => `${row.entityType}${row.entityId ? ` #${row.entityId}` : ""}` },
    { title: t("操作内容"), dataIndex: "summary", ellipsis: true },
  ];

  return (
    <div>
      <div className={styles.header}><div className={styles.titleGroup}><h1 className={styles.title}>{t("审计日志")}</h1><span className={styles.total}>{t("{n} 条", { n: total })}</span></div></div>
      <div className={styles.toolbar}>
        <Input.Search className={styles.search} allowClear value={searchInput} placeholder={t("操作人、对象或内容")} onChange={(event) => { setSearchInput(event.target.value); if (!event.target.value) { setQuery(""); setPage(1); } }} onSearch={(value) => { setQuery(value.trim()); setPage(1); }} />
        <Select className={styles.filter} allowClear placeholder={t("全部动作")} value={action} options={["create", "update", "delete", "disable", "import", "handover", "reset_password", "login", "logout"].map((value) => ({ value, label: t(statusLabel(value)) }))} onChange={(value) => { setAction(value); setPage(1); }} />
        <Tooltip title={t("刷新")}><Button icon={<ReloadOutlined />} onClick={() => void load()} /></Tooltip>
      </div>
      <section className={styles.tableFrame}>
        <Table rowKey="id" loading={loading} columns={columns} dataSource={rows} scroll={{ x: 850 }} pagination={{ current: page, pageSize, total, showSizeChanger: true, showTotal: (value) => t("共 {n} 条", { n: value }), onChange: (next, size) => { setPage(size !== pageSize ? 1 : next); setPageSize(size); } }} />
      </section>
    </div>
  );
}
