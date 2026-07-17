"use client";

import { Descriptions, Drawer, Empty, Skeleton, Table, Tabs, Tag, type TableProps } from "antd";
import { useLocale } from "./providers";
import { StatusTag } from "./status-tag";
import styles from "./resource-page.module.css";

type Detail = {
  customer: Record<string, string | number>;
  contacts: Array<Record<string, string | number>>;
  members: Array<Record<string, string | number>>;
  visits: Array<Record<string, string | number>>;
  opportunities: Array<Record<string, string | number | null>>;
  orders: Array<Record<string, string | number | null>>;
};

export function CustomerDetail({
  open,
  loading,
  data,
  onClose,
}: {
  open: boolean;
  loading: boolean;
  data: Detail | null;
  onClose: () => void;
}) {
  const { t } = useLocale();
  const visitColumns: TableProps<Record<string, string | number>>["columns"] = [
    { title: t("日期"), dataIndex: "visitDate", width: 110 },
    { title: t("编号"), dataIndex: "reportNo", width: 150 },
    { title: t("标题"), dataIndex: "title", ellipsis: true },
    { title: t("状态"), dataIndex: "status", width: 90, render: (value) => <StatusTag value={value} /> },
  ];
  const opportunityColumns: TableProps<Record<string, string | number | null>>["columns"] = [
    { title: t("商机"), dataIndex: "name", ellipsis: true },
    { title: t("产品"), key: "product", width: 140, render: (_, row) => row.grade ? `${row.className} / ${row.grade}` : "-" },
    { title: t("阶段"), dataIndex: "stage", width: 90, render: (value) => <StatusTag value={String(value)} /> },
    { title: t("下次跟进"), dataIndex: "nextFollowUpDate", width: 110, render: (value) => value || "-" },
  ];
  const orderColumns: TableProps<Record<string, string | number | null>>["columns"] = [
    { title: t("订单编号"), dataIndex: "orderNo", width: 150 },
    { title: t("日期"), dataIndex: "orderDate", width: 105 },
    { title: t("产品"), key: "product", width: 130, render: (_, row) => `${row.className} / ${row.grade}` },
    { title: t("数量"), dataIndex: "quantity", width: 80 },
    { title: t("实际出货"), dataIndex: "actualShipmentDate", width: 110, render: (value) => value || "-" },
    { title: t("预计到港"), dataIndex: "expectedArrivalDate", width: 110, render: (value) => value || "-" },
    { title: t("状态"), dataIndex: "status", width: 90, render: (value) => <StatusTag value={String(value)} /> },
  ];

  return (
    <Drawer
      title={data?.customer.name || t("客户详情")}
      size={880}
      open={open}
      onClose={onClose}
      destroyOnHidden
    >
      {loading || !data ? (
        <Skeleton active paragraph={{ rows: 10 }} />
      ) : (
        <Tabs
          items={[
            {
              key: "overview",
              label: t("概览"),
              children: (
                <>
                  <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
                    <Descriptions.Item label={t("客户状态")}><StatusTag value={String(data.customer.status)} label={{ potential: "潜在客户", active: "活跃客户", inactive: "已停用" }[String(data.customer.status)]} /></Descriptions.Item>
                    <Descriptions.Item label={t("负责人")}>{data.customer.ownerName}</Descriptions.Item>
                    <Descriptions.Item label={t("国家 / 地区")}>{[data.customer.country, data.customer.region].filter(Boolean).join(" / ") || "-"}</Descriptions.Item>
                    <Descriptions.Item label={t("行业")}>{data.customer.industry || "-"}</Descriptions.Item>
                    <Descriptions.Item label={t("地址")} span={2}>{data.customer.address || "-"}</Descriptions.Item>
                    <Descriptions.Item label={t("客户简介")} span={2}><span className={styles.preWrap}>{data.customer.description || "-"}</span></Descriptions.Item>
                  </Descriptions>
                  <h3 className={styles.detailSectionTitle}>{t("联系人")}</h3>
                  {data.contacts.length ? data.contacts.map((contact) => (
                    <Tag key={contact.id} style={{ padding: "5px 9px", marginBottom: 8 }}>
                      {contact.name}{contact.title ? ` · ${contact.title}` : ""}{contact.phone ? ` · ${contact.phone}` : ""}
                    </Tag>
                  )) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("暂无联系人")} />}
                  <h3 className={styles.detailSectionTitle}>{t("协作成员")}</h3>
                  {data.members.length ? data.members.map((member) => (
                    <Tag key={member.id}>{member.name} · {member.access === "edit" ? t("可编辑") : t("可查看")}</Tag>
                  )) : <span className={styles.muted}>{t("暂无协作成员")}</span>}
                </>
              ),
            },
            { key: "visits", label: `${t("拜访")} ${data.visits.length}`, children: <Table rowKey="id" size="small" columns={visitColumns} dataSource={data.visits} pagination={false} scroll={{ x: 620 }} /> },
            { key: "opportunities", label: `${t("商机")} ${data.opportunities.length}`, children: <Table rowKey="id" size="small" columns={opportunityColumns} dataSource={data.opportunities} pagination={false} scroll={{ x: 620 }} /> },
            { key: "orders", label: `${t("订单")} ${data.orders.length}`, children: <Table rowKey="id" size="small" columns={orderColumns} dataSource={data.orders} pagination={false} scroll={{ x: 820 }} /> },
          ]}
        />
      )}
    </Drawer>
  );
}
