"use client";

import { ReloadOutlined } from "@ant-design/icons";
import { App, Button, Input, Select, Table, Tooltip, type TableProps } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/client-fetch";
import { useLocale } from "./providers";
import { statusLabel, StatusTag } from "./status-tag";
import styles from "./admin-pages.module.css";

type AuditRow = {
  id: number;
  userName: string | null;
  action: string;
  entityType: string;
  entityId: number | null;
  entityName: string | null;
  summary: string;
  createdAt: string;
};

// 审计对象类型中文化（存储的是英文表名）
const entityLabels: Record<string, string> = {
  customer: "客户",
  visit: "拜访报告",
  opportunity: "商机",
  product: "产品",
  order: "订单",
  user: "用户",
  dict_item: "标签",
  session: "会话",
};

export function AuditLogPage() {
  const { t } = useLocale();
  const { message } = App.useApp();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
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
      const response = await apiFetch(`/api/audit-logs?${params}`);
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

  // 搜索输入 350ms 防抖自动触发
  useEffect(() => {
    const timer = setTimeout(() => {
      const next = searchInput.trim();
      if (next !== query) {
        setQuery(next);
        setPage(1);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [searchInput, query]);

  // 时间放最后：先看谁做了什么，再看什么时候
  const columns: TableProps<AuditRow>["columns"] = [
    { title: t("操作人"), dataIndex: "userName", width: 110, render: (value) => value || t("系统") },
    { title: t("动作"), dataIndex: "action", width: 100, render: (value) => <StatusTag value={value} /> },
    {
      title: t("对象"),
      key: "entity",
      width: 210,
      ellipsis: true,
      render: (_, row) => {
        const type = t(entityLabels[row.entityType] || row.entityType);
        // 记录已删除时取不到名称，退回 #id 至少还能对上审计编号
        if (row.entityName) return <span>{type} · <strong>{row.entityName}</strong></span>;
        return <span className={styles.counts}>{type}{row.entityId ? ` #${row.entityId}` : ""}</span>;
      },
    },
    { title: t("操作内容"), dataIndex: "summary", ellipsis: true },
    // 「2026-08-06 22:43:56」要能一行放下，不换行
    { title: t("时间"), dataIndex: "createdAt", width: 210, render: (value) => <span className={styles.nowrap}>{value}</span> },
  ];

  return (
    <div>
      <div className={styles.header}><div className={styles.titleGroup}><h1 className={styles.title}>{t("操作日志")}</h1><span className={styles.total}>{t("{n} 条", { n: total })}</span></div></div>
      <div className={styles.toolbar}>
        <Input.Search className={styles.search} allowClear value={searchInput} placeholder={t("操作人、对象或内容")} onChange={(event) => setSearchInput(event.target.value)} onSearch={(value) => { setQuery(value.trim()); setPage(1); }} />
        <Select className={styles.filter} allowClear placeholder={t("全部动作")} value={action} options={["create", "update", "delete", "enable", "disable", "import", "handover", "reset_password", "login", "logout"].map((value) => ({ value, label: t(statusLabel(value)) }))} onChange={(value) => { setAction(value); setPage(1); }} />
        <Tooltip title={t("刷新")}><Button icon={<ReloadOutlined />} onClick={() => void load()} /></Tooltip>
      </div>
      <section className={styles.tableFrame}>
        <Table rowKey="id" loading={loading} columns={columns} dataSource={rows} scroll={{ x: 850 }} pagination={{ current: page, pageSize, total, showSizeChanger: true, showTotal: (value) => t("共 {n} 条", { n: value }), onChange: (next, size) => { setPage(size !== pageSize ? 1 : next); setPageSize(size); } }} />
      </section>
    </div>
  );
}
