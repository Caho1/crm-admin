"use client";

import {
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  AppstoreOutlined,
  PlusOutlined,
  ReloadOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import {
  App,
  Button,
  DatePicker,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Pagination,
  Segmented,
  Select,
  Table,
  Tag,
  Tooltip,
  type TableProps,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TranslateVars } from "@/lib/i18n";
import { apiFetch } from "@/lib/client-fetch";
import { dictLabel, dictLabelOf, type DictMap, type DictType } from "@/lib/dicts";
import { useLocale } from "./providers";
import { useCurrentUser } from "./user-context";
import { StatusTag } from "./status-tag";
import styles from "./resource-page.module.css";

export type ResourceKind = "customers" | "products";
type RowData = Record<string, unknown> & { id: number; canEdit?: number };
type LookupItem = { id: number; name?: string; label?: string; className?: string; grade?: string; role?: string; status?: string };
type Lookups = { customers: LookupItem[]; products: LookupItem[]; users: LookupItem[]; dicts: DictMap };
type Option = { label: string; value: string | number };
type FieldType = "input" | "textarea" | "select" | "multi" | "date" | "month" | "number";
type Field = {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  full?: boolean;
  adminOnly?: boolean;
  source?: "customers" | "products" | "users";
  /** 取「设置 → 标签配置」里维护的下拉选项 */
  dictType?: DictType;
  options?: Option[];
  placeholder?: string;
  rows?: number;
  min?: number;
  precision?: number;
  maxLength?: number;
};
type Column = {
  title: string;
  dataIndex?: string;
  key?: string;
  width?: number;
  ellipsis?: boolean;
  kind?: "primary" | "status" | "product" | "money" | "date" | "number" | "dict";
  dictType?: DictType;
  classField?: string;
  currencyField?: string;
};
/** 由标签字典驱动的列表筛选下拉 */
type DictFilter = { key: string; dictType: DictType; placeholder: string };
// 栏目名由 AppShell 顶栏统一展示，Config 不再带 title
type Config = {
  endpoint: string;
  createLabel: string;
  editLabel: string;
  searchPlaceholder: string;
  filterKey?: string;
  filterPlaceholder?: string;
  filterOptions?: Option[];
  dictFilters?: DictFilter[];
  adminWriteOnly?: boolean;
  columns: Column[];
  fields: Field[];
  defaults: (userId: number) => Record<string, unknown>;
};

type TFn = (text: string, vars?: TranslateVars) => string;

// 配置随语言重建：所有标题、列名、字段名、占位符在这里统一翻译
function buildConfigs(t: TFn): Record<ResourceKind, Config> {
  const customerStatuses: Option[] = [
    { label: t("潜在客户"), value: "potential" },
    { label: t("活跃客户"), value: "active" },
    { label: t("已停用"), value: "inactive" },
  ];

  return {
    customers: {
      endpoint: "/api/customers",
      createLabel: t("新建客户"),
      editLabel: t("编辑客户"),
      searchPlaceholder: t("中英文名称、地址、地区、行业"),
      filterKey: "status",
      filterPlaceholder: t("客户状态"),
      filterOptions: customerStatuses,
      dictFilters: [
        { key: "category", dictType: "customer_category", placeholder: t("全部分类") },
        { key: "industry", dictType: "industry", placeholder: t("全部行业") },
      ],
      columns: [
        { title: t("客户名称"), dataIndex: "name", width: 200, kind: "primary", ellipsis: true },
        { title: t("英文名称"), dataIndex: "nameEn", width: 190, ellipsis: true },
        { title: t("客户分类"), dataIndex: "category", width: 110, kind: "dict", dictType: "customer_category" },
        { title: t("国家 / 地区"), key: "location", width: 130 },
        { title: t("行业"), dataIndex: "industry", width: 110, kind: "dict", dictType: "industry" },
        { title: t("负责人"), dataIndex: "ownerName", width: 100 },
        { title: t("协作人"), dataIndex: "memberNames", width: 110, ellipsis: true },
        { title: t("最近拜访"), dataIndex: "latestVisitDate", width: 110, kind: "date" },
        { title: t("订单"), dataIndex: "orderCount", width: 70, kind: "number" },
        { title: t("状态"), dataIndex: "status", width: 100, kind: "status" },
      ],
      fields: [
        { name: "name", label: t("客户名称（中文）"), type: "input", required: true, full: true },
        { name: "nameEn", label: t("客户名称（英文）"), type: "input", full: true, placeholder: t("完整英文名称，便于按英文模糊查找") },
        { name: "category", label: t("客户分类"), type: "select", dictType: "customer_category" },
        { name: "status", label: t("客户状态"), type: "select", required: true, options: customerStatuses },
        { name: "industry", label: t("行业"), type: "select", dictType: "industry" },
        { name: "ownerId", label: t("负责人"), type: "select", source: "users", adminOnly: true },
        { name: "country", label: t("国家"), type: "input" },
        { name: "region", label: t("地区"), type: "input" },
        { name: "memberIds", label: t("协作成员"), type: "multi", source: "users", adminOnly: true },
        { name: "address", label: t("详细地址"), type: "input", full: true, placeholder: t("详细到街道门牌，搜索时可按地址关键词查找") },
        { name: "description", label: t("客户简介"), type: "textarea", rows: 3, full: true, maxLength: 2000 },
        { name: "contactName", label: t("主要联系人"), type: "input" },
        { name: "contactTitle", label: t("联系人职位"), type: "input" },
        { name: "contactPhone", label: t("联系电话"), type: "input" },
        { name: "contactEmail", label: t("联系邮箱"), type: "input" },
      ],
      defaults: (userId) => ({ status: "potential", ownerId: userId, memberIds: [] }),
    },
    products: {
      endpoint: "/api/products",
      createLabel: t("新建产品"),
      editLabel: t("编辑产品"),
      searchPlaceholder: t("产品大类、型号/牌号、品牌、供应商"),
      filterKey: "status",
      filterPlaceholder: t("产品状态"),
      filterOptions: [{ label: t("启用"), value: "active" }, { label: t("停用"), value: "inactive" }],
      adminWriteOnly: true,
      dictFilters: [{ key: "className", dictType: "product_class", placeholder: t("全部大类") }],
      columns: [
        { title: t("产品大类"), dataIndex: "className", width: 100, kind: "dict", dictType: "product_class" },
        { title: t("型号 / 牌号（Grade）"), dataIndex: "grade", width: 180, kind: "primary" },
        { title: t("品牌"), dataIndex: "brand", width: 130, ellipsis: true },
        { title: t("供应商"), dataIndex: "supplier", width: 140, ellipsis: true },
        { title: t("用途"), dataIndex: "application", width: 200, ellipsis: true },
        { title: t("订单"), dataIndex: "orderCount", width: 70, kind: "number" },
        { title: t("状态"), dataIndex: "status", width: 85, kind: "status" },
      ],
      fields: [
        { name: "className", label: t("产品大类"), type: "select", dictType: "product_class", required: true },
        { name: "grade", label: t("型号 / 牌号（Grade）"), type: "input", required: true },
        { name: "brand", label: t("品牌"), type: "input" },
        { name: "supplier", label: t("供应商"), type: "input" },
        { name: "status", label: t("产品状态"), type: "select", required: true, options: [{ label: t("启用"), value: "active" }, { label: t("停用"), value: "inactive" }] },
        { name: "application", label: t("产品用途"), type: "textarea", rows: 3, full: true, maxLength: 500 },
        { name: "notes", label: t("备注"), type: "textarea", rows: 3, full: true, maxLength: 2000 },
      ],
      defaults: () => ({ status: "active" }),
    },
  };
}

function optionsFor(field: Field, lookups: Lookups, t: TFn, editing: boolean, locale: string): Option[] {
  if (field.options) return field.options;
  // 标签字典驱动的下拉：选项来自「设置 → 标签配置」，存 code、显示当前语言的 label
  if (field.dictType) {
    return (lookups.dicts?.[field.dictType] || []).map((item) => ({
      value: item.code,
      label: dictLabel(item, locale),
    }));
  }
  let source = field.source ? lookups[field.source] : [];
  // 新建时只能选启用中的产品；编辑历史单据时已停用产品仍要能回显（标注「已停用」）
  if (field.source === "products" && !editing) source = source.filter((item) => item.status !== "inactive");
  return source.map((item) => ({
    value: item.id,
    label:
      (item.label || item.name || `${item.className} / ${item.grade}`) +
      (item.status === "inactive" ? `（${t("已停用")}）` : ""),
  }));
}

function formatNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(Number(value));
}

export function ResourcePage({ resource }: { resource: ResourceKind }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const configs = useMemo(() => buildConfigs(t), [t]);
  const config = configs[resource];
  const user = useCurrentUser();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [rows, setRows] = useState<RowData[]>([]);
  const [lookups, setLookups] = useState<Lookups>({ customers: [], products: [], users: [], dicts: {} });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const pageSize = 10; // 固定每页 10 条，不提供页大小切换
  const [total, setTotal] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<string | undefined>();
  // 标签筛选统一放一个 map 里：新增一类标签筛选不用再加一个 useState
  const [dictFilter, setDictFilter] = useState<Record<string, string | undefined>>({});
  // 卡片 / 列表视图切换：只有客户列表提供卡片视图，选择记在 localStorage
  const supportsCards = resource === "customers";
  const [view, setView] = useState<"list" | "card">("list");
  useEffect(() => {
    if (!supportsCards) return;
    const saved = window.localStorage.getItem("crm_customers_view");
    if (saved === "card" || saved === "list") setView(saved);
  }, [supportsCards]);
  const changeView = (next: "list" | "card") => {
    setView(next);
    window.localStorage.setItem("crm_customers_view", next);
  };
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RowData | null>(null);
  const [initialValues, setInitialValues] = useState<Record<string, unknown>>({});
  const createHandled = useRef(false);
  const loadSeq = useRef(0);
  const canWrite = !config.adminWriteOnly || user.role === "admin";

  const loadLookups = useCallback(async () => {
    try {
      const response = await apiFetch("/api/lookups");
      const payload = await response.json();
      if (response.ok) setLookups(payload.data);
    } catch {
      message.error(t("基础数据加载失败"));
    }
  }, [message, t]);

  const loadRows = useCallback(async () => {
    // 序号防竞态：筛选连续变化时只采纳最后一次请求的结果
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
      if (query) params.set("q", query);
      if (filter && config.filterKey) params.set(config.filterKey, filter);
      for (const [key, value] of Object.entries(dictFilter)) if (value) params.set(key, value);
      const response = await apiFetch(`${config.endpoint}?${params}`);
      const payload = await response.json();
      if (seq !== loadSeq.current) return;
      if (!response.ok) throw new Error(payload.error?.message || "数据加载失败");
      setRows(payload.data);
      setTotal(payload.meta?.total || 0);
    } catch (error) {
      if (seq === loadSeq.current) message.error(t(error instanceof Error ? error.message : "数据加载失败"));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [config.endpoint, config.filterKey, dictFilter, filter, message, page, pageSize, query, t]);

  useEffect(() => {
    void loadLookups();
  }, [loadLookups]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

  // 搜索输入 350ms 防抖自动触发；Enter / 搜索按钮仍可立即搜索
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

  const openCreate = useCallback(() => {
    setEditing(null);
    setInitialValues(config.defaults(user.id));
    setModalOpen(true);
  }, [config, user.id]);

  useEffect(() => {
    if (!createHandled.current && typeof window !== "undefined" && new URLSearchParams(window.location.search).get("create") === "1") {
      createHandled.current = true;
      // 清掉 create=1，避免刷新页面时再次弹出新建框
      window.history.replaceState(null, "", window.location.pathname);
      openCreate();
    }
  }, [openCreate]);

  const normalizeForForm = (record: RowData) => {
    const values = { ...record };
    for (const field of config.fields) {
      if (field.type === "date" && values[field.name]) values[field.name] = dayjs(String(values[field.name]));
      if (field.type === "month" && values[field.name]) values[field.name] = dayjs(`${values[field.name]}-01`);
    }
    return values;
  };

  const openEdit = async (record: RowData) => {
    let values: RowData = record;
    if (resource === "customers") {
      try {
        const response = await apiFetch(`/api/customers/${record.id}`);
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error?.message || "客户详情加载失败");
        const firstContact = payload.data.contacts?.[0] || {};
        values = {
          ...payload.data.customer,
          memberIds: payload.data.members.map((item: LookupItem) => item.id),
          contactName: firstContact.name || "",
          contactTitle: firstContact.title || "",
          contactPhone: firstContact.phone || "",
          contactEmail: firstContact.email || "",
        };
      } catch (error) {
        message.error(t(error instanceof Error ? error.message : "客户详情加载失败"));
        return;
      }
    }
    setEditing(record);
    setInitialValues(normalizeForForm(values));
    setModalOpen(true);
  };

  // 客户详情页的「编辑客户」跳 /customers?edit=<id>，挂载后直接打开对应编辑弹窗；
  // openEdit 对 customers 会按 id 拉详情，无需行数据
  const editHandled = useRef(false);
  useEffect(() => {
    if (editHandled.current || typeof window === "undefined") return;
    const editId = new URLSearchParams(window.location.search).get("edit");
    if (!editId) return;
    editHandled.current = true;
    // 清掉 edit= 参数，避免刷新页面时再次弹出编辑框
    window.history.replaceState(null, "", window.location.pathname);
    void openEdit({ id: Number(editId) } as RowData);
  }, [openEdit]);

  // 客户详情改为独立子页，点击客户名 / 查看均跳转 /customers/[id]
  const viewCustomer = (record: RowData) => {
    router.push(`/customers/${record.id}`);
  };

  const submit = async () => {
    try {
      const values = await form.validateFields();
      const payload = { ...values };
      for (const field of config.fields) {
        const value = payload[field.name] as Dayjs | undefined;
        if (field.type === "date") payload[field.name] = value ? value.format("YYYY-MM-DD") : null;
        if (field.type === "month") payload[field.name] = value ? value.format("YYYY-MM") : null;
      }
      setSaving(true);
      const response = await apiFetch(editing ? `${config.endpoint}/${editing.id}` : config.endpoint, {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.error?.fields) {
          form.setFields(Object.entries(result.error.fields).map(([name, errors]) => ({ name, errors: [t(String(errors))] })));
        }
        throw new Error(result.error?.message || "保存失败");
      }
      message.success(editing ? t("保存成功") : t("创建成功"));
      setModalOpen(false);
      await Promise.all([loadRows(), loadLookups()]);
    } catch (error) {
      if (error instanceof Error && error.message) message.error(t(error.message));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (record: RowData) => {
    try {
      const response = await apiFetch(`${config.endpoint}/${record.id}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "删除失败");
      message.success(resource === "products" ? t("产品已停用") : t("记录已删除"));
      // 删掉当前页最后一条时自动回退一页，避免停留在空白页
      if (rows.length === 1 && page > 1) setPage(page - 1);
      else await loadRows();
    } catch (error) {
      message.error(t(error instanceof Error ? error.message : "删除失败"));
    }
  };

  // 删除确认里带上业务标识（订单号 / 报告编号 / 名称），防止误删
  const recordLabel = (record: RowData) => {
    if (resource === "products") return [record.className, record.grade].filter(Boolean).join(" / ");
    return String(record.name || record.id);
  };

  const visibleFields = config.fields.filter((field) => !field.adminOnly || user.role === "admin");
  const renderField = (field: Field) => {
    const commonSelectProps = {
      showSearch: true,
      allowClear: !field.required,
      optionFilterProp: "label" as const,
      options: optionsFor(field, lookups, t, Boolean(editing), locale),
      placeholder: field.placeholder || t("请选择{label}", { label: field.label }),
    };
    let control: React.ReactNode;
    if (field.type === "textarea") control = <Input.TextArea rows={field.rows || 3} placeholder={field.placeholder || t("请输入{label}", { label: field.label })} showCount maxLength={field.maxLength || 2000} />;
    else if (field.type === "select") control = <Select {...commonSelectProps} />;
    else if (field.type === "multi") control = <Select {...commonSelectProps} mode="multiple" maxTagCount="responsive" />;
    else if (field.type === "date") control = <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />;
    else if (field.type === "month") control = <DatePicker style={{ width: "100%" }} picker="month" format="YYYY-MM" />;
    else if (field.type === "number") control = <InputNumber style={{ width: "100%" }} min={field.min} precision={field.precision} placeholder={t("请输入{label}", { label: field.label })} />;
    else control = <Input placeholder={field.placeholder || t("请输入{label}", { label: field.label })} />;
    return (
      <Form.Item
        key={field.name}
        className={field.full ? styles.fieldFull : undefined}
        name={field.name}
        label={field.label}
        rules={field.required ? [{ required: true, message: t("{label}不能为空", { label: field.label }) }] : undefined}
      >
        {control}
      </Form.Item>
    );
  };

  const tableColumns: TableProps<RowData>["columns"] = (() => {
    const columns: TableProps<RowData>["columns"] = config.columns.map((column, index) => ({
      title: column.title,
      dataIndex: column.dataIndex,
      key: column.key || column.dataIndex,
      width: column.width,
      ellipsis: column.ellipsis,
      // 金额/数量类列右对齐，便于纵向扫读对比
      align: column.kind === "money" || column.kind === "number" ? ("right" as const) : undefined,
      // 首列为主键列时固定在左侧，横向滚动时不丢失行上下文
      fixed: index === 0 && column.kind === "primary" ? ("left" as const) : undefined,
      render: (value: unknown, record: RowData) => {
        if (column.key === "location") {
          const location = [record.country, record.region].filter(Boolean).join(" / ");
          return location || <span className={styles.muted}>-</span>;
        }
        if (column.kind === "primary") {
          const onClick = resource === "customers"
            ? () => viewCustomer(record)
            : canWrite && record.canEdit !== 0
              ? () => void openEdit(record)
              : undefined;
          return (
            <span className={onClick ? styles.primaryCell : styles.primaryCellStatic} onClick={onClick}>
              {String(value || "-")}
            </span>
          );
        }
        if (column.kind === "status") {
          const statusValue = String(value || "");
          const label = config.filterOptions?.find((option) => option.value === statusValue)?.label;
          return <StatusTag value={statusValue} label={label} />;
        }
        if (column.kind === "dict") {
          const code = String(value || "");
          if (!code) return <span className={styles.muted}>-</span>;
          return <Tag>{dictLabelOf(column.dictType ? lookups.dicts?.[column.dictType] : undefined, code, locale)}</Tag>;
        }
        if (column.kind === "product") {
          if (!record.grade) return <span className={styles.muted}>-</span>;
          return <span className={styles.product}><span className={styles.productClass}>{String(record.className)}</span>{String(record.grade)}</span>;
        }
        if (column.kind === "money") {
          return <span className={styles.money}>{formatNumber(value)} {column.currencyField ? String(record[column.currencyField] || "") : ""}</span>;
        }
        if (column.kind === "number") return <span className={styles.money}>{formatNumber(value)}</span>;
        if (column.kind === "date") return value ? <span className={styles.nowrap}>{String(value)}</span> : <span className={styles.muted}>-</span>;
        return value === null || value === undefined || value === "" ? <span className={styles.muted}>-</span> : String(value);
      },
    }));
    if (canWrite || resource === "customers") {
      columns.push({
        title: t("操作"),
        key: "actions",
        fixed: "right",
        width: 104,
        render: (_value, record) => (
          <div className={styles.rowActions}>
            {resource === "customers" ? (
              <Tooltip title={t("查看客户 360")}><Button type="text" size="small" icon={<EyeOutlined />} aria-label={t("查看")} onClick={() => viewCustomer(record)} /></Tooltip>
            ) : null}
            {canWrite && record.canEdit !== 0 ? (
              <Tooltip title={t("编辑")}><Button type="text" size="small" icon={<EditOutlined />} aria-label={t("编辑")} onClick={() => void openEdit(record)} /></Tooltip>
            ) : null}
            {canWrite && record.canEdit !== 0 ? (
              <Popconfirm title={resource === "products" ? t("确认停用该产品？") : t("确认删除「{name}」？", { name: recordLabel(record) })} okText={t("确认")} cancelText={t("取消")} onConfirm={() => void remove(record)}>
                <Tooltip title={resource === "products" ? t("停用") : t("删除")}><Button danger type="text" size="small" icon={<DeleteOutlined />} aria-label={t("删除")} /></Tooltip>
              </Popconfirm>
            ) : null}
          </div>
        ),
      });
    }
    return columns;
  })();

  return (
    <div className={styles.page}>
      {/* 栏目名已由顶栏展示，这里只保留条数和新建入口 */}
      <div className={styles.pageHeader}>
        <div className={styles.titleGroup}>
          <span className={styles.total}>{t("{n} 条", { n: total })}</span>
        </div>
        <div className={styles.actions}>
          {canWrite ? <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>{config.createLabel}</Button> : null}
        </div>
      </div>
      <div className={styles.toolbar}>
        <Input.Search
          className={styles.search}
          allowClear
          value={searchInput}
          placeholder={config.searchPlaceholder}
          onChange={(event) => setSearchInput(event.target.value)}
          onSearch={(value) => { setQuery(value.trim()); setPage(1); }}
        />
        {config.filterOptions ? (
          <Select className={styles.filter} allowClear placeholder={config.filterPlaceholder} options={config.filterOptions} value={filter} onChange={(value) => { setFilter(value); setPage(1); }} />
        ) : null}
        {config.dictFilters?.map((item) => (
          <Select
            key={item.key}
            className={styles.filter}
            allowClear
            showSearch
            optionFilterProp="label"
            placeholder={item.placeholder}
            value={dictFilter[item.key]}
            options={(lookups.dicts?.[item.dictType] || []).map((option) => ({ value: option.code, label: dictLabel(option, locale) }))}
            onChange={(value) => { setDictFilter((prev) => ({ ...prev, [item.key]: value })); setPage(1); }}
          />
        ))}
        <Tooltip title={t("刷新")}><Button icon={<ReloadOutlined />} aria-label={t("刷新")} onClick={() => void loadRows()} /></Tooltip>
        {supportsCards ? (
          <Segmented
            className={styles.viewSwitch}
            value={view}
            onChange={(value) => changeView(value as "list" | "card")}
            options={[
              { value: "list", icon: <UnorderedListOutlined />, title: t("列表视图") },
              { value: "card", icon: <AppstoreOutlined />, title: t("卡片视图") },
            ]}
          />
        ) : null}
      </div>
      {supportsCards && view === "card" ? (
        <section className={styles.cardGrid}>
          {loading && !rows.length ? null : rows.length ? rows.map((record) => {
            const location = [record.country, record.region].filter(Boolean).join(" / ");
            const category = dictLabelOf(lookups.dicts?.customer_category, String(record.category || ""), locale);
            const industry = dictLabelOf(lookups.dicts?.industry, String(record.industry || ""), locale);
            const statusLabelText = config.filterOptions?.find((option) => option.value === record.status)?.label;
            return (
              <article key={record.id} className={styles.customerCard}>
                <div className={styles.cardTop}>
                  <div className={styles.cardTitleGroup}>
                    <button type="button" className={styles.cardName} onClick={() => viewCustomer(record)}>
                      {String(record.name || "-")}
                    </button>
                    {record.nameEn ? <div className={styles.cardNameEn}>{String(record.nameEn)}</div> : null}
                  </div>
                  <StatusTag value={String(record.status || "")} label={statusLabelText} />
                </div>
                <div className={styles.cardTags}>
                  {category ? <Tag color="blue">{category}</Tag> : null}
                  {industry ? <Tag>{industry}</Tag> : null}
                </div>
                <dl className={styles.cardMeta}>
                  <div><dt>{t("国家 / 地区")}</dt><dd>{location || "-"}</dd></div>
                  <div><dt>{t("负责人")}</dt><dd>{String(record.ownerName || "-")}</dd></div>
                  <div><dt>{t("最近拜访")}</dt><dd>{String(record.latestVisitDate || "-")}</dd></div>
                  <div><dt>{t("订单")}</dt><dd>{formatNumber(record.orderCount)}</dd></div>
                </dl>
                <div className={styles.cardAddress}>{String(record.address || "-")}</div>
                <div className={styles.cardActions}>
                  <Button size="small" icon={<EyeOutlined />} onClick={() => viewCustomer(record)}>{t("查看")}</Button>
                  {canWrite && record.canEdit !== 0 ? (
                    <Button size="small" icon={<EditOutlined />} onClick={() => void openEdit(record)}>{t("编辑")}</Button>
                  ) : null}
                  {canWrite && record.canEdit !== 0 ? (
                    <Popconfirm
                      title={t("确认删除「{name}」？", { name: recordLabel(record) })}
                      okText={t("确认")}
                      cancelText={t("取消")}
                      onConfirm={() => void remove(record)}
                    >
                      <Button size="small" danger icon={<DeleteOutlined />} aria-label={t("删除")} />
                    </Popconfirm>
                  ) : null}
                </div>
              </article>
            );
          }) : (
            <div className={styles.cardEmpty}>
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("暂无数据")}>
                {canWrite ? <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>{config.createLabel}</Button> : null}
              </Empty>
            </div>
          )}
        </section>
      ) : (
        <section className={styles.tableFrame}>
          <Table<RowData>
            rowKey="id"
            loading={loading}
            columns={tableColumns}
            dataSource={rows}
            sticky
            scroll={{ x: Math.max(900, config.columns.reduce((sum, column) => sum + (column.width || 120), 0) + 110) }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: false,
              hideOnSinglePage: true,
              showTotal: (value) => t("共 {n} 条", { n: value }),
              onChange: (nextPage) => setPage(nextPage),
            }}
            locale={{
              emptyText: (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("暂无数据")}>
                  {canWrite ? <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>{config.createLabel}</Button> : null}
                </Empty>
              ),
            }}
          />
        </section>
      )}
      {/* 卡片视图的分页要自己出，Table 自带的那套用不上 */}
      {supportsCards && view === "card" && total > pageSize ? (
        <div className={styles.cardPagination}>
          <Pagination
            current={page}
            pageSize={pageSize}
            total={total}
            showSizeChanger={false}
            showTotal={(value) => t("共 {n} 条", { n: value })}
            onChange={(nextPage) => setPage(nextPage)}
          />
        </div>
      ) : null}
      <Modal
        title={editing ? config.editLabel : config.createLabel}
        open={modalOpen}
        centered
        width={860}
        okText={t("保存")}
        cancelText={t("取消")}
        confirmLoading={saving}
        onOk={() => void submit()}
        onCancel={() => setModalOpen(false)}
        destroyOnHidden
        styles={{ body: { maxHeight: "calc(100vh - 190px)", overflowY: "auto", paddingRight: 4 } }}
      >
        {/* destroyOnHidden 保证每次打开重新挂载，initialValues 在首帧即生效，避免先空后填的闪烁 */}
        <Form form={form} layout="vertical" requiredMark="optional" preserve={false} initialValues={initialValues}>
          <div className={styles.formGrid}>{visibleFields.map(renderField)}</div>
        </Form>
      </Modal>
    </div>
  );
}
