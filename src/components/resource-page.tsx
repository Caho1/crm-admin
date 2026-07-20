"use client";

import {
  DeleteOutlined,
  DownloadOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  ReloadOutlined,
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
  Select,
  Table,
  Tooltip,
  type TableProps,
} from "antd";
import dayjs, { type Dayjs } from "dayjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TranslateVars } from "@/lib/i18n";
import { useLocale } from "./providers";
import { useCurrentUser } from "./user-context";
import { CustomerDetail } from "./customer-detail";
import { VisitDetail } from "./visit-detail";
import { StatusTag } from "./status-tag";
import styles from "./resource-page.module.css";

export type ResourceKind = "customers" | "visits" | "opportunities" | "products" | "orders";
type RowData = Record<string, unknown> & { id: number; canEdit?: number };
type LookupItem = { id: number; name?: string; label?: string; className?: string; grade?: string; role?: string };
type Lookups = { customers: LookupItem[]; products: LookupItem[]; users: LookupItem[] };
type Option = { label: string; value: string | number };
type FieldType = "input" | "textarea" | "select" | "multi" | "date" | "month" | "number";
type Field = {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  full?: boolean;
  adminOnly?: boolean;
  source?: keyof Lookups;
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
  kind?: "primary" | "status" | "product" | "money" | "date" | "number";
  classField?: string;
  currencyField?: string;
};
type Config = {
  title: string;
  endpoint: string;
  createLabel: string;
  editLabel: string;
  searchPlaceholder: string;
  filterKey?: string;
  filterPlaceholder?: string;
  filterOptions?: Option[];
  customerFilter?: boolean;
  productFilter?: boolean;
  shipmentMonthFilter?: boolean;
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
  const visitStatuses: Option[] = [
    { label: t("草稿"), value: "draft" },
    { label: t("已完成"), value: "completed" },
    { label: t("已归档"), value: "archived" },
  ];
  const opportunityStages: Option[] = [
    { label: t("意向"), value: "lead" },
    { label: t("样品"), value: "sample" },
    { label: t("测试"), value: "testing" },
    { label: t("报价"), value: "quotation" },
    { label: t("已成单"), value: "order" },
    { label: t("暂停"), value: "paused" },
    { label: t("失败"), value: "lost" },
  ];
  const orderStatuses: Option[] = [
    { label: t("待确认"), value: "planned" },
    { label: t("待出货"), value: "confirmed" },
    { label: t("已出货"), value: "shipped" },
    { label: t("已到港"), value: "arrived" },
    { label: t("已取消"), value: "cancelled" },
  ];

  return {
    customers: {
      title: t("客户管理"),
      endpoint: "/api/customers",
      createLabel: t("新建客户"),
      editLabel: t("编辑客户"),
      searchPlaceholder: t("客户名称、地区、行业"),
      filterKey: "status",
      filterPlaceholder: t("客户状态"),
      filterOptions: customerStatuses,
      columns: [
        { title: t("客户名称"), dataIndex: "name", width: 210, kind: "primary", ellipsis: true },
        { title: t("国家 / 地区"), key: "location", width: 130 },
        { title: t("行业"), dataIndex: "industry", width: 110, ellipsis: true },
        { title: t("负责人"), dataIndex: "ownerName", width: 100 },
        { title: t("协作人"), dataIndex: "memberNames", width: 110, ellipsis: true },
        { title: t("最近拜访"), dataIndex: "latestVisitDate", width: 110, kind: "date" },
        { title: t("商机"), dataIndex: "opportunityCount", width: 70, kind: "number" },
        { title: t("订单"), dataIndex: "orderCount", width: 70, kind: "number" },
        { title: t("状态"), dataIndex: "status", width: 100, kind: "status" },
      ],
      fields: [
        { name: "name", label: t("客户名称"), type: "input", required: true, full: true },
        { name: "status", label: t("客户状态"), type: "select", required: true, options: customerStatuses },
        { name: "ownerId", label: t("负责人"), type: "select", source: "users", adminOnly: true },
        { name: "country", label: t("国家"), type: "input" },
        { name: "region", label: t("地区"), type: "input" },
        { name: "industry", label: t("行业"), type: "input" },
        { name: "memberIds", label: t("协作成员"), type: "multi", source: "users", adminOnly: true },
        { name: "address", label: t("详细地址"), type: "input", full: true },
        { name: "description", label: t("客户简介"), type: "textarea", rows: 3, full: true, maxLength: 2000 },
        { name: "contactName", label: t("主要联系人"), type: "input" },
        { name: "contactTitle", label: t("联系人职位"), type: "input" },
        { name: "contactPhone", label: t("联系电话"), type: "input" },
        { name: "contactEmail", label: t("联系邮箱"), type: "input" },
      ],
      defaults: (userId) => ({ status: "potential", ownerId: userId, memberIds: [] }),
    },
    visits: {
      title: t("拜访报告"),
      endpoint: "/api/visits",
      createLabel: t("新建拜访"),
      editLabel: t("编辑拜访"),
      searchPlaceholder: t("标题、报告编号、客户、纪要"),
      filterKey: "status",
      filterPlaceholder: t("报告状态"),
      filterOptions: visitStatuses,
      customerFilter: true,
      columns: [
        { title: t("拜访日期"), dataIndex: "visitDate", width: 120, kind: "date" },
        { title: t("报告编号"), dataIndex: "reportNo", width: 150 },
        { title: t("标题"), dataIndex: "title", width: 230, kind: "primary", ellipsis: true },
        { title: t("客户"), dataIndex: "customerName", width: 165, ellipsis: true },
        { title: t("关联产品"), dataIndex: "productLabels", width: 150, ellipsis: true },
        { title: t("创建人"), dataIndex: "creatorName", width: 90 },
        { title: t("状态"), dataIndex: "status", width: 90, kind: "status" },
      ],
      fields: [
        { name: "reportNo", label: t("报告编号"), type: "input", placeholder: t("留空自动生成") },
        { name: "status", label: t("报告状态"), type: "select", required: true, options: visitStatuses },
        { name: "title", label: t("报告标题"), type: "input", required: true, full: true },
        { name: "customerId", label: t("客户"), type: "select", source: "customers", required: true },
        { name: "visitDate", label: t("拜访日期"), type: "date", required: true },
        { name: "productIds", label: t("关联产品型号 / 牌号"), type: "multi", source: "products", full: true },
        { name: "internalParticipants", label: t("我方参加人员"), type: "input", required: true },
        { name: "customerParticipants", label: t("客户方参加人员"), type: "input", required: true },
        { name: "companyProfile", label: t("客户公司简介"), type: "textarea", rows: 3, required: true, full: true, maxLength: 3000 },
        { name: "meetingNotes", label: t("沟通纪要"), type: "textarea", rows: 5, required: true, full: true, maxLength: 8000 },
        { name: "followUp", label: t("后续跟进事项"), type: "textarea", rows: 4, required: true, full: true, maxLength: 3000 },
      ],
      defaults: () => ({ status: "draft", visitDate: dayjs(), productIds: [] }),
    },
    opportunities: {
      title: t("项目机会"),
      endpoint: "/api/opportunities",
      createLabel: t("新建商机"),
      editLabel: t("编辑商机"),
      searchPlaceholder: t("商机、客户、产品、下一步"),
      filterKey: "stage",
      filterPlaceholder: t("商机阶段"),
      filterOptions: opportunityStages,
      customerFilter: true,
      productFilter: true,
      columns: [
        { title: t("商机名称"), dataIndex: "name", width: 200, kind: "primary", ellipsis: true },
        { title: t("客户"), dataIndex: "customerName", width: 150, ellipsis: true },
        { title: t("产品"), key: "product", width: 130, kind: "product" },
        { title: t("阶段"), dataIndex: "stage", width: 90, kind: "status" },
        { title: t("预计金额"), dataIndex: "estimatedAmount", width: 130, kind: "money", currencyField: "currency" },
        { title: t("负责人"), dataIndex: "ownerName", width: 90 },
        { title: t("下一步"), dataIndex: "nextAction", width: 160, ellipsis: true },
        { title: t("下次跟进"), dataIndex: "nextFollowUpDate", width: 110, kind: "date" },
      ],
      fields: [
        { name: "name", label: t("商机名称"), type: "input", required: true, full: true },
        { name: "customerId", label: t("客户"), type: "select", source: "customers", required: true },
        { name: "productId", label: t("产品型号 / 牌号"), type: "select", source: "products" },
        { name: "stage", label: t("商机阶段"), type: "select", required: true, options: opportunityStages },
        { name: "status", label: t("商机状态"), type: "select", required: true, options: [{ label: t("进行中"), value: "active" }, { label: t("已关闭"), value: "closed" }] },
        { name: "estimatedQuantity", label: t("预计数量"), type: "number", min: 0, precision: 2 },
        { name: "estimatedAmount", label: t("预计金额"), type: "number", min: 0, precision: 2 },
        { name: "currency", label: t("币种"), type: "select", options: ["USD", "CNY", "KRW", "HKD"].map((value) => ({ label: value, value })) },
        { name: "ownerId", label: t("负责人"), type: "select", source: "users", adminOnly: true },
        { name: "nextFollowUpDate", label: t("下次跟进日期"), type: "date" },
        { name: "nextAction", label: t("下一步动作"), type: "textarea", rows: 3, full: true, maxLength: 1000 },
        { name: "notes", label: t("备注"), type: "textarea", rows: 3, full: true, maxLength: 3000 },
      ],
      defaults: (userId) => ({ stage: "lead", status: "active", currency: "USD", ownerId: userId }),
    },
    products: {
      title: t("产品型号 / 牌号"),
      endpoint: "/api/products",
      createLabel: t("新建产品"),
      editLabel: t("编辑产品"),
      searchPlaceholder: t("产品大类、型号/牌号、品牌、供应商"),
      filterKey: "status",
      filterPlaceholder: t("产品状态"),
      filterOptions: [{ label: t("启用"), value: "active" }, { label: t("停用"), value: "inactive" }],
      adminWriteOnly: true,
      columns: [
        { title: t("产品大类"), dataIndex: "className", width: 100 },
        { title: t("型号 / 牌号（Grade）"), dataIndex: "grade", width: 180, kind: "primary" },
        { title: t("品牌"), dataIndex: "brand", width: 130, ellipsis: true },
        { title: t("供应商"), dataIndex: "supplier", width: 140, ellipsis: true },
        { title: t("用途"), dataIndex: "application", width: 200, ellipsis: true },
        { title: t("商机"), dataIndex: "opportunityCount", width: 70, kind: "number" },
        { title: t("订单"), dataIndex: "orderCount", width: 70, kind: "number" },
        { title: t("状态"), dataIndex: "status", width: 85, kind: "status" },
      ],
      fields: [
        { name: "className", label: t("产品大类"), type: "input", required: true },
        { name: "grade", label: t("型号 / 牌号（Grade）"), type: "input", required: true },
        { name: "brand", label: t("品牌"), type: "input" },
        { name: "supplier", label: t("供应商"), type: "input" },
        { name: "status", label: t("产品状态"), type: "select", required: true, options: [{ label: t("启用"), value: "active" }, { label: t("停用"), value: "inactive" }] },
        { name: "application", label: t("产品用途"), type: "textarea", rows: 3, full: true, maxLength: 500 },
        { name: "notes", label: t("备注"), type: "textarea", rows: 3, full: true, maxLength: 2000 },
      ],
      defaults: () => ({ status: "active" }),
    },
    orders: {
      title: t("订单 / 出货 / 到港"),
      endpoint: "/api/orders",
      createLabel: t("新建订单"),
      editLabel: t("编辑订单"),
      searchPlaceholder: t("订单、客户、产品、合同号、发票号"),
      filterKey: "status",
      filterPlaceholder: t("履约状态"),
      filterOptions: orderStatuses,
      customerFilter: true,
      productFilter: true,
      shipmentMonthFilter: true,
      columns: [
        { title: t("订单编号"), dataIndex: "orderNo", width: 160, kind: "primary" },
        { title: t("下单日期"), dataIndex: "orderDate", width: 110, kind: "date" },
        { title: t("客户"), dataIndex: "customerName", width: 150, ellipsis: true },
        { title: t("产品"), key: "product", width: 130, kind: "product" },
        { title: t("数量"), dataIndex: "quantity", width: 80, kind: "number" },
        { title: t("单价"), dataIndex: "price", width: 120, kind: "money", currencyField: "currency" },
        { title: t("状态"), dataIndex: "status", width: 90, kind: "status" },
        { title: t("实际出货"), dataIndex: "actualShipmentDate", width: 110, kind: "date" },
        { title: t("预计到港"), dataIndex: "expectedArrivalDate", width: 110, kind: "date" },
        { title: t("合同号"), dataIndex: "contractNo", width: 110 },
        { title: t("发票号"), dataIndex: "invoiceNo", width: 110 },
      ],
      fields: [
        { name: "orderNo", label: t("订单编号"), type: "input", placeholder: t("留空自动生成") },
        { name: "status", label: t("履约状态"), type: "select", required: true, options: orderStatuses },
        { name: "orderDate", label: t("下单日期"), type: "date", required: true },
        { name: "customerId", label: t("客户"), type: "select", source: "customers", required: true },
        { name: "productId", label: t("产品型号 / 牌号"), type: "select", source: "products", required: true },
        { name: "ownerId", label: t("负责人"), type: "select", source: "users", adminOnly: true },
        { name: "quantity", label: t("数量"), type: "number", required: true, min: 0, precision: 2 },
        { name: "price", label: t("单价"), type: "number", required: true, min: 0, precision: 2 },
        { name: "currency", label: t("币种"), type: "select", options: ["USD", "CNY", "KRW", "HKD"].map((value) => ({ label: value, value })) },
        { name: "destination", label: t("目的地"), type: "input" },
        { name: "tradeTerms", label: t("贸易条款"), type: "input", placeholder: t("如 CFR、FOB") },
        { name: "paymentMethod", label: t("付款方式"), type: "input", placeholder: t("如 TT AD、LC") },
        { name: "shipmentMonth", label: t("出货月份"), type: "month" },
        { name: "lcTtDate", label: t("LC / TT 日期"), type: "date" },
        { name: "actualShipmentDate", label: t("实际出货日期"), type: "date" },
        { name: "expectedArrivalDate", label: t("预计到港日期"), type: "date" },
        { name: "contractNo", label: t("合同号"), type: "input" },
        { name: "invoiceNo", label: t("发票号"), type: "input" },
        { name: "notes", label: t("备注"), type: "textarea", rows: 3, full: true, maxLength: 2000 },
      ],
      defaults: (userId) => ({ status: "planned", orderDate: dayjs(), currency: "USD", ownerId: userId }),
    },
  };
}

function optionsFor(field: Field, lookups: Lookups): Option[] {
  if (field.options) return field.options;
  const source = field.source ? lookups[field.source] : [];
  return source.map((item) => ({
    value: item.id,
    label: item.label || item.name || `${item.className} / ${item.grade}`,
  }));
}

function formatNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(Number(value));
}

export function ResourcePage({ resource }: { resource: ResourceKind }) {
  const { t } = useLocale();
  const configs = useMemo(() => buildConfigs(t), [t]);
  const config = configs[resource];
  const user = useCurrentUser();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [rows, setRows] = useState<RowData[]>([]);
  const [lookups, setLookups] = useState<Lookups>({ customers: [], products: [], users: [] });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<string | undefined>();
  const [customerId, setCustomerId] = useState<number | undefined>();
  const [productId, setProductId] = useState<number | undefined>();
  const [shipmentMonth, setShipmentMonth] = useState<string | undefined>();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<RowData | null>(null);
  const [initialValues, setInitialValues] = useState<Record<string, unknown>>({});
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailData, setDetailData] = useState<Parameters<typeof CustomerDetail>[0]["data"]>(null);
  const [visitDetail, setVisitDetail] = useState<RowData | null>(null);
  const createHandled = useRef(false);
  const loadSeq = useRef(0);
  const canWrite = !config.adminWriteOnly || user.role === "admin";

  const loadLookups = useCallback(async () => {
    try {
      const response = await fetch("/api/lookups");
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
      if (customerId) params.set("customerId", String(customerId));
      if (productId) params.set("productId", String(productId));
      if (shipmentMonth) params.set("shipmentMonth", shipmentMonth);
      const response = await fetch(`${config.endpoint}?${params}`);
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
  }, [config.endpoint, config.filterKey, customerId, filter, message, page, pageSize, productId, query, shipmentMonth, t]);

  useEffect(() => {
    void loadLookups();
  }, [loadLookups]);

  useEffect(() => {
    void loadRows();
  }, [loadRows]);

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
        const response = await fetch(`/api/customers/${record.id}`);
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

  const viewCustomer = async (record: RowData) => {
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const response = await fetch(`/api/customers/${record.id}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "客户详情加载失败");
      setDetailData(payload.data);
    } catch (error) {
      message.error(t(error instanceof Error ? error.message : "客户详情加载失败"));
      setDetailOpen(false);
    } finally {
      setDetailLoading(false);
    }
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
      const response = await fetch(editing ? `${config.endpoint}/${editing.id}` : config.endpoint, {
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
      const response = await fetch(`${config.endpoint}/${record.id}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "删除失败");
      message.success(resource === "products" ? t("产品已停用") : t("记录已删除"));
      await loadRows();
    } catch (error) {
      message.error(t(error instanceof Error ? error.message : "删除失败"));
    }
  };

  const visibleFields = config.fields.filter((field) => !field.adminOnly || user.role === "admin");
  const renderField = (field: Field) => {
    const commonSelectProps = {
      showSearch: true,
      allowClear: !field.required,
      optionFilterProp: "label" as const,
      options: optionsFor(field, lookups),
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
            ? () => void viewCustomer(record)
            : resource === "visits"
              ? () => setVisitDetail(record)
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
    if (canWrite || resource === "customers" || resource === "visits") {
      columns.push({
        title: t("操作"),
        key: "actions",
        fixed: "right",
        width: 104,
        render: (_value, record) => (
          <div className={styles.rowActions}>
            {resource === "customers" ? (
              <Tooltip title={t("查看客户 360")}><Button type="text" size="small" icon={<EyeOutlined />} aria-label={t("查看")} onClick={() => void viewCustomer(record)} /></Tooltip>
            ) : null}
            {resource === "visits" ? (
              <Tooltip title={t("查看报告")}><Button type="text" size="small" icon={<EyeOutlined />} aria-label={t("查看")} onClick={() => setVisitDetail(record)} /></Tooltip>
            ) : null}
            {canWrite && record.canEdit !== 0 ? (
              <Tooltip title={t("编辑")}><Button type="text" size="small" icon={<EditOutlined />} aria-label={t("编辑")} onClick={() => void openEdit(record)} /></Tooltip>
            ) : null}
            {canWrite && record.canEdit !== 0 ? (
              <Popconfirm title={resource === "products" ? t("确认停用该产品？") : t("确认删除该记录？")} okText={t("确认")} cancelText={t("取消")} onConfirm={() => void remove(record)}>
                <Tooltip title={resource === "products" ? t("停用") : t("删除")}><Button danger type="text" size="small" icon={<DeleteOutlined />} aria-label={t("删除")} /></Tooltip>
              </Popconfirm>
            ) : null}
          </div>
        ),
      });
    }
    return columns;
  })();

  const exportOrders = () => {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    if (filter) params.set("status", filter);
    if (customerId) params.set("customerId", String(customerId));
    if (productId) params.set("productId", String(productId));
    if (shipmentMonth) params.set("shipmentMonth", shipmentMonth);
    window.location.href = `/api/data/orders-export?${params}`;
  };

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>{config.title}</h1>
          <span className={styles.total}>{t("{n} 条", { n: total })}</span>
        </div>
        <div className={styles.actions}>
          {resource === "orders" ? <Button icon={<DownloadOutlined />} onClick={exportOrders}>{t("导出当前筛选")}</Button> : null}
          {canWrite ? <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>{config.createLabel}</Button> : null}
        </div>
      </div>
      <div className={styles.toolbar}>
        <Input.Search
          className={styles.search}
          allowClear
          value={searchInput}
          placeholder={config.searchPlaceholder}
          onChange={(event) => {
            setSearchInput(event.target.value);
            if (!event.target.value) { setQuery(""); setPage(1); }
          }}
          onSearch={(value) => { setQuery(value.trim()); setPage(1); }}
        />
        {config.filterOptions ? (
          <Select className={styles.filter} allowClear placeholder={config.filterPlaceholder} options={config.filterOptions} value={filter} onChange={(value) => { setFilter(value); setPage(1); }} />
        ) : null}
        {config.customerFilter ? (
          <Select className={styles.filter} showSearch allowClear optionFilterProp="label" placeholder={t("全部客户")} value={customerId} options={lookups.customers.map((item) => ({ value: item.id, label: item.name }))} onChange={(value) => { setCustomerId(value); setPage(1); }} />
        ) : null}
        {config.productFilter ? (
          <Select className={styles.filter} showSearch allowClear optionFilterProp="label" placeholder={t("全部产品")} value={productId} options={lookups.products.map((item) => ({ value: item.id, label: item.label }))} onChange={(value) => { setProductId(value); setPage(1); }} />
        ) : null}
        {config.shipmentMonthFilter ? (
          <DatePicker className={styles.filter} picker="month" format="YYYY-MM" placeholder={t("出货月份")} value={shipmentMonth ? dayjs(`${shipmentMonth}-01`) : null} onChange={(value) => { setShipmentMonth(value ? value.format("YYYY-MM") : undefined); setPage(1); }} />
        ) : null}
        <Tooltip title={t("刷新")}><Button icon={<ReloadOutlined />} aria-label={t("刷新")} onClick={() => void loadRows()} /></Tooltip>
      </div>
      <section className={styles.tableFrame}>
        <Table<RowData>
          rowKey="id"
          loading={loading}
          columns={tableColumns}
          dataSource={rows}
          scroll={{ x: Math.max(900, config.columns.reduce((sum, column) => sum + (column.width || 120), 0) + 110) }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: true,
            showTotal: (value) => t("共 {n} 条", { n: value }),
            onChange: (nextPage, nextPageSize) => { setPage(nextPageSize !== pageSize ? 1 : nextPage); setPageSize(nextPageSize); },
          }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("暂无数据")} /> }}
        />
      </section>
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
      {resource === "customers" ? (
        <CustomerDetail open={detailOpen} loading={detailLoading} data={detailData} onClose={() => { setDetailOpen(false); setDetailData(null); }} />
      ) : null}
      {resource === "visits" ? (
        <VisitDetail
          open={Boolean(visitDetail)}
          data={visitDetail}
          canEdit={canWrite && visitDetail?.canEdit !== 0}
          onClose={() => setVisitDetail(null)}
          onEdit={(record) => { setVisitDetail(null); void openEdit(record as RowData); }}
        />
      ) : null}
    </div>
  );
}
