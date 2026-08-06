"use client";

import { EditOutlined, KeyOutlined, PlusOutlined, ReloadOutlined, SwapOutlined } from "@ant-design/icons";
import { Alert, App, Button, Form, Input, Modal, Select, Switch, Table, Tooltip, type TableProps } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/client-fetch";
import { useLocale } from "./providers";
import { StatusTag } from "./status-tag";
import { useCurrentUser } from "./user-context";
import styles from "./admin-pages.module.css";

type UserRow = {
  id: number;
  username: string;
  name: string;
  role: "admin" | "user";
  status: "active" | "disabled";
  customerCount: number;
  opportunityCount: number;
  orderCount: number;
  createdAt: string;
};

type UserOption = {
  id: number;
  username: string;
  name: string;
  status: "active" | "disabled";
};

export function UserAdmin() {
  const currentUser = useCurrentUser();
  const { t } = useLocale();
  const { message, modal } = App.useApp();
  const [form] = Form.useForm();
  const [passwordForm] = Form.useForm();
  const [handoverForm] = Form.useForm();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [role, setRole] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [initialValues, setInitialValues] = useState<Record<string, unknown>>({});
  const [modalOpen, setModalOpen] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState<UserRow | null>(null);
  const [handoverOpen, setHandoverOpen] = useState(false);
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  const handoverFrom = Form.useWatch("fromUserId", handoverForm);

  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (query) params.set("q", query);
      if (role) params.set("role", role);
      if (status) params.set("status", status);
      const response = await apiFetch(`/api/users?${params}`);
      const payload = await response.json();
      if (seq !== loadSeq.current) return;
      if (!response.ok) throw new Error(payload.error?.message || "用户加载失败");
      setRows(payload.data);
      setTotal(payload.meta.total);
    } catch (error) {
      if (seq === loadSeq.current) message.error(t(error instanceof Error ? error.message : "用户加载失败"));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [message, page, pageSize, query, role, status, t]);

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

  const openCreate = () => {
    setEditing(null);
    setInitialValues({ role: "user", status: "active" });
    setModalOpen(true);
  };

  const openEdit = (row: UserRow) => {
    setEditing(row);
    setInitialValues({ username: row.username, name: row.name, role: row.role, status: row.status });
    setModalOpen(true);
  };

  const openHandover = async () => {
    setHandoverOpen(true);
    try {
      const response = await apiFetch("/api/users/options");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "用户列表加载失败");
      setUserOptions(payload.data);
    } catch (error) {
      message.error(t(error instanceof Error ? error.message : "用户列表加载失败"));
    }
  };

  const save = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const response = await apiFetch(editing ? `/api/users/${editing.id}` : "/api/users", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "保存失败");
      message.success(editing ? t("用户已更新") : t("用户已创建"));
      setModalOpen(false);
      await load();
    } catch (error) {
      if (error instanceof Error && error.message) message.error(t(error.message));
    } finally {
      setSaving(false);
    }
  };

  const toggleStatus = async (row: UserRow, active: boolean) => {
    try {
      const response = await apiFetch(`/api/users/${row.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: row.username, name: row.name, role: row.role, status: active ? "active" : "disabled" }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "状态更新失败");
      message.success(active ? t("账号已启用") : t("账号已停用"));
      await load();
    } catch (error) {
      message.error(t(error instanceof Error ? error.message : "状态更新失败"));
    }
  };

  const resetPassword = async () => {
    if (!passwordTarget) return;
    try {
      const values = await passwordForm.validateFields();
      setSaving(true);
      const response = await apiFetch(`/api/users/${passwordTarget.id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "密码重置失败");
      message.success(t("密码已重置，该账号需要重新登录"));
      setPasswordTarget(null);
    } catch (error) {
      if (error instanceof Error && error.message) message.error(t(error.message));
    } finally {
      setSaving(false);
    }
  };

  const handover = async () => {
    try {
      const values = await handoverForm.validateFields();
      setSaving(true);
      const response = await apiFetch("/api/users/handover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "数据交接失败");
      message.success(t("交接完成：客户 {customers}，商机 {opportunities}，订单 {orders}", {
        customers: payload.data.customers,
        opportunities: payload.data.opportunities,
        orders: payload.data.orders,
      }));
      setHandoverOpen(false);
      await load();
    } catch (error) {
      if (error instanceof Error && error.message) message.error(t(error.message));
    } finally {
      setSaving(false);
    }
  };

  const columns: TableProps<UserRow>["columns"] = [
    { title: t("姓名"), dataIndex: "name", width: 120, render: (value) => <strong>{value}</strong> },
    { title: t("登录账号"), dataIndex: "username", width: 140 },
    { title: t("角色"), dataIndex: "role", width: 100, render: (value) => <StatusTag value={value} /> },
    { title: t("业务数据"), key: "counts", width: 220, render: (_, row) => <span className={styles.counts}>{t("客户")} {row.customerCount} · {t("商机")} {row.opportunityCount} · {t("订单")} {row.orderCount}</span> },
    { title: t("创建时间"), dataIndex: "createdAt", width: 165 },
    {
      title: t("启用"), dataIndex: "status", width: 80,
      render: (value, row) => (
        <Switch
          size="small"
          checked={value === "active"}
          disabled={row.id === currentUser.id}
          onChange={(checked) => {
            // 启用是无害操作直接生效；停用会强制下线，需二次确认（受控组件，取消则状态不变）
            if (checked) { void toggleStatus(row, true); return; }
            modal.confirm({
              title: t("确认停用账号"),
              content: t("停用后 {name} 将立即无法登录，其名下数据保留，可随时重新启用。", { name: row.name }),
              okText: t("确认停用"),
              okButtonProps: { danger: true },
              cancelText: t("取消"),
              onOk: () => toggleStatus(row, false),
            });
          }}
        />
      ),
    },
    {
      title: t("操作"),
      key: "actions",
      fixed: "right",
      width: 100,
      render: (_, row) => (
        <div className={styles.rowActions}>
          <Tooltip title={t("编辑")}><Button type="text" size="small" icon={<EditOutlined />} onClick={() => openEdit(row)} /></Tooltip>
          <Tooltip title={t("重置密码")}><Button type="text" size="small" icon={<KeyOutlined />} onClick={() => setPasswordTarget(row)} /></Tooltip>
        </div>
      ),
    },
  ];

  // 交出人允许选择已停用账号（离职场景通常先停用再交接）；接收人必须是启用账号
  const handoverFromOptions = userOptions.map((item) => ({
    value: item.id,
    label: `${item.name}（${item.username}）${item.status === "disabled" ? ` · ${t("已停用")}` : ""}`,
  }));
  const handoverToOptions = userOptions
    .filter((item) => item.status === "active" && item.id !== handoverFrom)
    .map((item) => ({ value: item.id, label: `${item.name}（${item.username}）` }));

  return (
    <div>
      <div className={styles.header}>
        <div className={styles.titleGroup}><h1 className={styles.title}>{t("用户权限")}</h1><span className={styles.total}>{t("{n} 人", { n: total })}</span></div>
        <div className={styles.headerActions}>
          <Button icon={<SwapOutlined />} onClick={() => void openHandover()}>{t("数据交接")}</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>{t("新建用户")}</Button>
        </div>
      </div>
      <div className={styles.toolbar}>
        <Input.Search className={styles.search} allowClear value={searchInput} placeholder={t("姓名或登录账号")} onChange={(event) => setSearchInput(event.target.value)} onSearch={(value) => { setQuery(value.trim()); setPage(1); }} />
        <Select className={styles.filter} allowClear placeholder={t("全部角色")} value={role} options={[{ label: t("管理员"), value: "admin" }, { label: t("普通用户"), value: "user" }]} onChange={(value) => { setRole(value); setPage(1); }} />
        <Select className={styles.filter} allowClear placeholder={t("全部状态")} value={status} options={[{ label: t("启用"), value: "active" }, { label: t("停用"), value: "disabled" }]} onChange={(value) => { setStatus(value); setPage(1); }} />
        <Tooltip title={t("刷新")}><Button icon={<ReloadOutlined />} onClick={() => void load()} /></Tooltip>
      </div>
      <section className={styles.tableFrame}>
        <Table rowKey="id" loading={loading} columns={columns} dataSource={rows} scroll={{ x: 900 }} pagination={{ current: page, pageSize, total, showSizeChanger: true, showTotal: (value) => t("共 {n} 人", { n: value }), onChange: (next, size) => { setPage(size !== pageSize ? 1 : next); setPageSize(size); } }} />
      </section>
      <Modal centered title={editing ? t("编辑用户") : t("新建用户")} open={modalOpen} okText={t("保存")} cancelText={t("取消")} confirmLoading={saving} onOk={() => void save()} onCancel={() => setModalOpen(false)} destroyOnHidden>
        <Form form={form} layout="vertical" requiredMark="optional" preserve={false} initialValues={initialValues}>
          <div className={styles.formGrid}>
            <Form.Item name="name" label={t("姓名")} rules={[{ required: true, message: t("请输入姓名") }]}><Input /></Form.Item>
            <Form.Item name="username" label={t("登录账号")} rules={[{ required: true, min: 3, message: t("账号至少 3 个字符") }]}><Input autoComplete="off" /></Form.Item>
            <Form.Item name="role" label={t("角色")} rules={[{ required: true }]}><Select options={[{ label: t("管理员"), value: "admin" }, { label: t("普通用户"), value: "user" }]} /></Form.Item>
            <Form.Item name="status" label={t("账号状态")} rules={[{ required: true }]}><Select options={[{ label: t("启用"), value: "active" }, { label: t("停用"), value: "disabled" }]} /></Form.Item>
            {!editing ? <Form.Item className={styles.full} name="password" label={t("初始密码")} rules={[{ required: true, min: 8, message: t("密码至少 8 个字符") }]}><Input.Password autoComplete="new-password" /></Form.Item> : null}
          </div>
        </Form>
      </Modal>
      <Modal centered title={t("重置 {name} 的密码", { name: passwordTarget?.name || t("用户") })} open={Boolean(passwordTarget)} okText={t("确认重置")} cancelText={t("取消")} confirmLoading={saving} onOk={() => void resetPassword()} onCancel={() => setPasswordTarget(null)} destroyOnHidden>
        <Form form={passwordForm} layout="vertical" preserve={false}>
          <Form.Item name="password" label={t("新密码")} rules={[{ required: true, min: 8, message: t("密码至少 8 个字符") }]}><Input.Password autoComplete="new-password" /></Form.Item>
        </Form>
      </Modal>
      <Modal centered title={t("离职数据交接")} open={handoverOpen} okText={t("确认交接")} okButtonProps={{ danger: true }} cancelText={t("取消")} confirmLoading={saving} onOk={() => void handover()} onCancel={() => setHandoverOpen(false)} destroyOnHidden>
        <Alert type="warning" showIcon style={{ marginBottom: 16 }} title={t("交接后，交出人名下的客户、商机、订单将立即转移给接收人，此操作不可撤销。")} />
        <Form form={handoverForm} layout="vertical" preserve={false}>
          <Form.Item name="fromUserId" label={t("交出人")} rules={[{ required: true, message: t("请选择交出人") }]}>
            <Select showSearch optionFilterProp="label" placeholder={t("请选择交出人（含已停用账号）")} options={handoverFromOptions} onChange={() => handoverForm.setFieldValue("toUserId", undefined)} />
          </Form.Item>
          <Form.Item name="toUserId" label={t("接收人")} rules={[{ required: true, message: t("请选择接收人") }]}>
            <Select showSearch optionFilterProp="label" placeholder={t("请选择接收人")} options={handoverToOptions} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
