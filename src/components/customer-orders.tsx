"use client";

import { DeleteOutlined, EditOutlined, EyeOutlined, PlusOutlined, RightOutlined } from "@ant-design/icons";
import { App, Button, DatePicker, Descriptions, Drawer, Empty, Form, Input, InputNumber, Modal, Popconfirm, Select, Table, Tag, Tooltip, type TableProps } from "antd";
import dayjs from "dayjs";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/client-fetch";
import { useLocale } from "./providers";
import { StatusTag, statusLabel } from "./status-tag";
import resStyles from "./resource-page.module.css";
import styles from "./customer-profile.module.css";

type OrderRow = Record<string, unknown> & { id: number; canEdit?: number };
type ProductOption = { id: number; label: string; status: string };
type UserOption = { id: number; name: string };
type CustomerOption = { id: number; name: string };

const CURRENCIES = ["USD", "CNY", "KRW", "HKD"];
// 履约概要按流程顺序汇总，一眼看出这个客户整体走到哪一步
const STATUS_FLOW = ["planned", "confirmed", "shipped", "arrived"] as const;

function formatNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return "-";
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 }).format(Number(value));
}

function text(row: OrderRow | null, key: string) {
  const value = row?.[key];
  return value === null || value === undefined || value === "" ? "-" : String(value);
}

/**
 * 订单记录。两种形态：
 * - 带 customerId：挂在客户档案下（compact 只留关键列，每页 5 条）
 * - 不带 customerId：/orders 全局订单管理页，支持搜索与状态筛选，
 *   新建时要先选客户
 */
export function CustomerOrders({
  customerId,
  customerName,
  canEdit,
  isAdmin,
  compact = false,
}: {
  customerId?: number;
  customerName?: string;
  canEdit: boolean;
  isAdmin: boolean;
  compact?: boolean;
}) {
  const { t } = useLocale();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const isGlobal = customerId === undefined;
  const pageSize = compact ? 5 : 10;
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<OrderRow[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  // 全局页支持从工作台统计卡带筛选条件深链进来（待出货 / 14 天内到港）
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<string | undefined>(() => searchParams.get("status") || undefined);
  const [arrivingSoon, setArrivingSoon] = useState(() => searchParams.get("arrivingSoon") === "1");
  const [dateFrom, setDateFrom] = useState(() => searchParams.get("dateFrom") || "");
  const [dateTo, setDateTo] = useState(() => searchParams.get("dateTo") || "");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<OrderRow | null>(null);
  const [initialValues, setInitialValues] = useState<Record<string, unknown>>({});
  const [detail, setDetail] = useState<OrderRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (customerId !== undefined) params.set("customerId", String(customerId));
      if (query) params.set("q", query);
      if (status) params.set("status", status);
      if (arrivingSoon) params.set("arrivingSoon", "1");
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
      const response = await apiFetch(`/api/orders?${params}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "订单加载失败");
      setRows(payload.data);
      setTotal(payload.meta?.total || 0);
      setStatusCounts(payload.meta?.statusCounts || {});
    } catch (error) {
      message.error(t(error instanceof Error ? error.message : "订单加载失败"));
    } finally {
      setLoading(false);
    }
  }, [arrivingSoon, customerId, dateFrom, dateTo, message, page, pageSize, query, status, t]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    (async () => {
      try {
        const response = await apiFetch("/api/lookups");
        const payload = await response.json();
        if (response.ok) {
          setCustomers(payload.data.customers);
          setProducts(payload.data.products);
          setUsers(payload.data.users);
        }
      } catch {
        // 下拉数据加载失败不影响查看已有订单，静默处理
      }
    })();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setInitialValues({ status: "planned", orderDate: dayjs(), currency: "USD" });
    setModalOpen(true);
  };

  const openEdit = (row: OrderRow) => {
    setEditing(row);
    const dateOf = (key: string) => (row[key] ? dayjs(String(row[key])) : undefined);
    setInitialValues({
      ...row,
      orderDate: dateOf("orderDate"),
      lcTtDate: dateOf("lcTtDate"),
      actualShipmentDate: dateOf("actualShipmentDate"),
      expectedArrivalDate: dateOf("expectedArrivalDate"),
      shipmentMonth: row.shipmentMonth ? dayjs(`${row.shipmentMonth}-01`) : undefined,
    });
    setModalOpen(true);
  };

  const submit = async () => {
    try {
      const values = await form.validateFields();
      const payload: Record<string, unknown> = { ...values, customerId: customerId ?? values.customerId };
      for (const key of ["orderDate", "lcTtDate", "actualShipmentDate", "expectedArrivalDate"]) {
        payload[key] = values[key] ? values[key].format("YYYY-MM-DD") : null;
      }
      payload.shipmentMonth = values.shipmentMonth ? values.shipmentMonth.format("YYYY-MM") : null;
      setSaving(true);
      const response = await apiFetch(editing ? `/api/orders/${editing.id}` : "/api/orders", {
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
      await load();
    } catch (error) {
      if (error instanceof Error && error.message) message.error(t(error.message));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: OrderRow) => {
    try {
      const response = await apiFetch(`/api/orders/${row.id}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "删除失败");
      message.success(t("记录已删除"));
      if (rows.length === 1 && page > 1) setPage(page - 1);
      else await load();
    } catch (error) {
      message.error(t(error instanceof Error ? error.message : "删除失败"));
    }
  };

  // 客户档案页只留关键列（字段太多会挤爆表格），完整字段在子页与详情抽屉里看
  const compactColumns: TableProps<OrderRow>["columns"] = [
    {
      title: t("订单编号"),
      dataIndex: "orderNo",
      width: 155,
      render: (value, row) => <span className={resStyles.primaryCell} onClick={() => setDetail(row)}>{String(value || "-")}</span>,
    },
    { title: t("下单日期"), dataIndex: "orderDate", width: 110, render: (value) => <span className={resStyles.nowrap}>{String(value || "-")}</span> },
    {
      title: t("产品"),
      key: "product",
      width: 135,
      render: (_, row) => (row.grade
        ? <span className={resStyles.product}><span className={resStyles.productClass}>{String(row.className)}</span>{String(row.grade)}</span>
        : <span className={resStyles.muted}>-</span>),
    },
    { title: t("数量"), dataIndex: "quantity", width: 80, align: "right", render: (value) => <span className={resStyles.money}>{formatNumber(value)}</span> },
    { title: t("金额"), dataIndex: "amount", width: 130, align: "right", render: (value, row) => <span className={resStyles.money}>{formatNumber(value)} {String(row.currency || "")}</span> },
    { title: t("状态"), dataIndex: "status", width: 92, render: (value) => <StatusTag value={String(value)} /> },
  ];

  const fullColumns: TableProps<OrderRow>["columns"] = [
    ...compactColumns,
    { title: t("单价"), dataIndex: "price", width: 115, align: "right", render: (value, row) => <span className={resStyles.money}>{formatNumber(value)} {String(row.currency || "")}</span> },
    { title: t("目的地"), dataIndex: "destination", width: 120, ellipsis: true, render: (value) => value || <span className={resStyles.muted}>-</span> },
    { title: t("贸易条款"), dataIndex: "tradeTerms", width: 100, render: (value) => value || <span className={resStyles.muted}>-</span> },
    { title: t("付款方式"), dataIndex: "paymentMethod", width: 110, render: (value) => value || <span className={resStyles.muted}>-</span> },
    { title: t("出货月份"), dataIndex: "shipmentMonth", width: 105, render: (value) => value || <span className={resStyles.muted}>-</span> },
    { title: t("LC / TT 日期"), dataIndex: "lcTtDate", width: 120, render: (value) => value || <span className={resStyles.muted}>-</span> },
    { title: t("实际出货"), dataIndex: "actualShipmentDate", width: 110, render: (value) => value || <span className={resStyles.muted}>-</span> },
    { title: t("预计到港"), dataIndex: "expectedArrivalDate", width: 110, render: (value) => value || <span className={resStyles.muted}>-</span> },
    { title: t("合同号"), dataIndex: "contractNo", width: 110, render: (value) => value || <span className={resStyles.muted}>-</span> },
    { title: t("发票号"), dataIndex: "invoiceNo", width: 110, render: (value) => value || <span className={resStyles.muted}>-</span> },
    { title: t("负责人"), dataIndex: "ownerName", width: 90 },
  ];

  const dataColumns = compact ? compactColumns : fullColumns;
  const columns: TableProps<OrderRow>["columns"] = [
    // 全局页多一列客户，点击跳到对应客户档案
    ...(isGlobal
      ? [
          dataColumns[0],
          {
            title: t("客户"),
            dataIndex: "customerName",
            width: 170,
            ellipsis: true,
            render: (value: unknown, row: OrderRow) => (
              <Link href={`/customers/${row.customerId}`} className={resStyles.primaryCell}>{String(value || "-")}</Link>
            ),
          },
          ...dataColumns.slice(1),
        ]
      : dataColumns),
    {
      title: t("操作"),
      key: "actions",
      fixed: "right",
      width: 104,
      render: (_value, row) => (
        <div className={resStyles.rowActions}>
          <Tooltip title={t("查看订单详情")}>
            <Button type="text" size="small" icon={<EyeOutlined />} aria-label={t("查看")} onClick={() => setDetail(row)} />
          </Tooltip>
          {canEdit && row.canEdit !== 0 ? (
            <Tooltip title={t("编辑")}>
              <Button type="text" size="small" icon={<EditOutlined />} aria-label={t("编辑")} onClick={() => openEdit(row)} />
            </Tooltip>
          ) : null}
          {canEdit && row.canEdit !== 0 ? (
            <Popconfirm
              title={t("确认删除「{name}」？", { name: String(row.orderNo || row.id) })}
              okText={t("确认")}
              cancelText={t("取消")}
              onConfirm={() => void remove(row)}
            >
              <Tooltip title={t("删除")}>
                <Button danger type="text" size="small" icon={<DeleteOutlined />} aria-label={t("删除")} />
              </Tooltip>
            </Popconfirm>
          ) : null}
        </div>
      ),
    },
  ];

  // 新建时只列启用中的产品；编辑历史订单时保留停用项，否则原有产品会被清空
  const productOptions = products
    .filter((item) => item.status !== "inactive" || editing)
    .map((item) => ({ value: item.id, label: item.status === "inactive" ? `${item.label}（${t("已停用")}）` : item.label }));

  const orderStatuses = [
    { label: t("待确认"), value: "planned" },
    { label: t("待出货"), value: "confirmed" },
    { label: t("已出货"), value: "shipped" },
    { label: t("已到港"), value: "arrived" },
    { label: t("已取消"), value: "cancelled" },
  ];

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{isGlobal ? t("订单管理") : t("订单记录")}</h2>
        <span className={styles.sectionCount}>{t("共 {n} 单", { n: total })}</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {compact && customerId !== undefined ? (
            <Link href={`/customers/${customerId}/orders`}>
              <Button size="small" icon={<RightOutlined />} iconPlacement="end">{t("展开全部")}</Button>
            </Link>
          ) : null}
          {canEdit ? (
            <Button type="primary" size="small" icon={<PlusOutlined />} onClick={openCreate}>{t("新建订单")}</Button>
          ) : null}
        </div>
      </div>

      {isGlobal ? (
        <div className={resStyles.toolbar}>
          <Input.Search
            className={resStyles.search}
            allowClear
            value={searchInput}
            placeholder={t("订单号、客户、产品、合同号")}
            onChange={(event) => setSearchInput(event.target.value)}
            onSearch={(value) => { setQuery(value.trim()); setPage(1); setArrivingSoon(false); setDateFrom(""); setDateTo(""); }}
          />
          <Select
            className={resStyles.filter}
            allowClear
            placeholder={t("全部状态")}
            value={status}
            options={orderStatuses}
            onChange={(value) => { setStatus(value); setPage(1); setArrivingSoon(false); setDateFrom(""); setDateTo(""); }}
          />
          {/* 从工作台统计卡带进来的筛选条件，给个可见可关的标记，免得疑惑列表为什么这么短 */}
          {arrivingSoon ? (
            <Tag closable onClose={() => { setArrivingSoon(false); setPage(1); }}>{t("14 天内到港")}</Tag>
          ) : null}
          {dateFrom || dateTo ? (
            <Tag closable onClose={() => { setDateFrom(""); setDateTo(""); setPage(1); }}>
              {t("下单日期")}：{dateFrom || "…"} ~ {dateTo || "…"}
            </Tag>
          ) : null}
        </div>
      ) : null}

      {total > 0 ? (
        <div className={styles.summary}>
          {STATUS_FLOW.map((status) => (
            <div key={status} className={styles.summaryChip}>
              <span className={styles.summaryNum}>{statusCounts[status] || 0}</span>
              <span className={styles.summaryLabel}>{t(statusLabel(status))}</span>
            </div>
          ))}
        </div>
      ) : null}

      <div className={styles.tableFrame}>
        <Table<OrderRow>
          rowKey="id"
          size="middle"
          loading={loading}
          columns={columns}
          dataSource={rows}
          scroll={{ x: compact ? 860 : isGlobal ? 1890 : 1720 }}
          pagination={total > pageSize ? { current: page, pageSize, total, showSizeChanger: false, showTotal: (value) => t("共 {n} 条", { n: value }), onChange: setPage } : false}
          locale={{
            emptyText: (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("暂无订单")}>
                {canEdit ? <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>{t("新建订单")}</Button> : null}
              </Empty>
            ),
          }}
        />
      </div>

      <Modal
        title={`${editing ? t("编辑订单") : t("新建订单")}${customerName ? ` · ${customerName}` : ""}`}
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
        <Form form={form} layout="vertical" requiredMark="optional" preserve={false} initialValues={initialValues}>
          <div className={resStyles.formGrid}>
            {isGlobal ? (
              <Form.Item name="customerId" label={t("客户")} rules={[{ required: true, message: t("{label}不能为空", { label: t("客户") }) }]}>
                <Select
                  showSearch
                  optionFilterProp="label"
                  options={customers.map((item) => ({ value: item.id, label: item.name }))}
                  placeholder={t("请选择{label}", { label: t("客户") })}
                />
              </Form.Item>
            ) : null}
            <Form.Item name="orderNo" label={t("订单编号")}><Input placeholder={t("留空自动生成")} /></Form.Item>
            <Form.Item name="status" label={t("履约状态")} rules={[{ required: true, message: t("{label}不能为空", { label: t("履约状态") }) }]}>
              <Select options={orderStatuses} />
            </Form.Item>
            <Form.Item name="orderDate" label={t("下单日期")} rules={[{ required: true, message: t("{label}不能为空", { label: t("下单日期") }) }]}>
              <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
            </Form.Item>
            <Form.Item name="productId" label={t("产品型号 / 牌号")} rules={[{ required: true, message: t("{label}不能为空", { label: t("产品型号 / 牌号") }) }]}>
              <Select showSearch optionFilterProp="label" options={productOptions} placeholder={t("请选择{label}", { label: t("产品型号 / 牌号") })} />
            </Form.Item>
            <Form.Item name="quantity" label={t("数量")} rules={[{ required: true, message: t("{label}不能为空", { label: t("数量") }) }]}>
              <InputNumber style={{ width: "100%" }} min={0} precision={2} />
            </Form.Item>
            <Form.Item name="price" label={t("单价")} rules={[{ required: true, message: t("{label}不能为空", { label: t("单价") }) }]}>
              <InputNumber style={{ width: "100%" }} min={0} precision={2} />
            </Form.Item>
            <Form.Item name="currency" label={t("币种")}>
              <Select options={CURRENCIES.map((value) => ({ label: value, value }))} />
            </Form.Item>
            {isAdmin ? (
              <Form.Item name="ownerId" label={t("负责人")}>
                <Select showSearch optionFilterProp="label" options={users.map((item) => ({ value: item.id, label: item.name }))} />
              </Form.Item>
            ) : null}
            <Form.Item name="destination" label={t("目的地")}><Input /></Form.Item>
            <Form.Item name="tradeTerms" label={t("贸易条款")}><Input placeholder={t("如 CFR、FOB")} /></Form.Item>
            <Form.Item name="paymentMethod" label={t("付款方式")}><Input placeholder={t("如 TT AD、LC")} /></Form.Item>
            <Form.Item name="shipmentMonth" label={t("出货月份")}><DatePicker style={{ width: "100%" }} picker="month" format="YYYY-MM" /></Form.Item>
            <Form.Item name="lcTtDate" label={t("LC / TT 日期")}><DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" /></Form.Item>
            <Form.Item name="actualShipmentDate" label={t("实际出货日期")}><DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" /></Form.Item>
            <Form.Item name="expectedArrivalDate" label={t("预计到港日期")}><DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" /></Form.Item>
            <Form.Item name="contractNo" label={t("合同号")}><Input /></Form.Item>
            <Form.Item name="invoiceNo" label={t("发票号")}><Input /></Form.Item>
            <Form.Item className={resStyles.fieldFull} name="notes" label={t("备注")}>
              <Input.TextArea rows={3} showCount maxLength={2000} />
            </Form.Item>
          </div>
        </Form>
      </Modal>

      {/* 订单完整字段：客户档案页表格里放不下的都在这里 */}
      <Drawer
        title={detail ? String(detail.orderNo || t("订单详情")) : t("订单详情")}
        size={720}
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        extra={canEdit && detail?.canEdit !== 0 && detail ? (
          <Button icon={<EditOutlined />} onClick={() => { const row = detail; setDetail(null); openEdit(row); }}>{t("编辑")}</Button>
        ) : null}
      >
        {detail ? (
          <>
            <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
              <Descriptions.Item label={t("客户")}>{customerName ?? text(detail, "customerName")}</Descriptions.Item>
              <Descriptions.Item label={t("履约状态")}><StatusTag value={String(detail.status)} /></Descriptions.Item>
              <Descriptions.Item label={t("下单日期")}>{text(detail, "orderDate")}</Descriptions.Item>
              <Descriptions.Item label={t("产品型号 / 牌号")}>{detail.grade ? `${detail.className} / ${detail.grade}` : "-"}</Descriptions.Item>
              <Descriptions.Item label={t("数量")}>{formatNumber(detail.quantity)}</Descriptions.Item>
              <Descriptions.Item label={t("单价")}>{`${formatNumber(detail.price)} ${detail.currency || ""}`}</Descriptions.Item>
              <Descriptions.Item label={t("金额")}>{`${formatNumber(detail.amount)} ${detail.currency || ""}`}</Descriptions.Item>
              <Descriptions.Item label={t("负责人")}>{text(detail, "ownerName")}</Descriptions.Item>
              <Descriptions.Item label={t("目的地")}>{text(detail, "destination")}</Descriptions.Item>
              <Descriptions.Item label={t("贸易条款")}>{text(detail, "tradeTerms")}</Descriptions.Item>
              <Descriptions.Item label={t("付款方式")}>{text(detail, "paymentMethod")}</Descriptions.Item>
              <Descriptions.Item label={t("出货月份")}>{text(detail, "shipmentMonth")}</Descriptions.Item>
              <Descriptions.Item label={t("LC / TT 日期")}>{text(detail, "lcTtDate")}</Descriptions.Item>
              <Descriptions.Item label={t("实际出货日期")}>{text(detail, "actualShipmentDate")}</Descriptions.Item>
              <Descriptions.Item label={t("预计到港日期")}>{text(detail, "expectedArrivalDate")}</Descriptions.Item>
              <Descriptions.Item label={t("合同号")}>{text(detail, "contractNo")}</Descriptions.Item>
              <Descriptions.Item label={t("发票号")}>{text(detail, "invoiceNo")}</Descriptions.Item>
            </Descriptions>
            <h3 className={resStyles.detailSectionTitle}>{t("备注")}</h3>
            <p className={resStyles.preWrap}>{text(detail, "notes")}</p>
          </>
        ) : null}
      </Drawer>
    </section>
  );
}
