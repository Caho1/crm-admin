"use client";

import { ArrowLeftOutlined, DeleteOutlined, EditOutlined, MailOutlined, PhoneOutlined } from "@ant-design/icons";
import { App, Button, Empty, Image, Skeleton, Table, Tabs, Tag, type TableProps } from "antd";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/client-fetch";
import { dictLabelOf, type DictMap } from "@/lib/dicts";
import { CustomerEditModal } from "./customer-form";
import { CustomerOrders, STATUS_FLOW } from "./customer-orders";
import { CustomerVisits } from "./customer-visits";
import { useLocale } from "./providers";
import { useCurrentUser } from "./user-context";
import { StatusTag, statusLabel } from "./status-tag";
import resStyles from "./resource-page.module.css";
import styles from "./customer-profile.module.css";

type Contact = {
  id: number;
  name: string;
  nameEn: string;
  title: string;
  phone: string;
  email: string;
  personality: string;
  hasCardFront: number;
  hasCardBack: number;
};

/** 客户用到的我方产品 + 该产品登记的竞品（竞品本身在产品档案里维护） */
type CompetitorProduct = {
  id: number;
  className: string;
  grade: string;
  orderCount: number;
  competitors: Array<{ id: number; grade: string; manufacturer: string; notes: string }>;
};

type Detail = {
  customer: Record<string, string | number>;
  contacts: Contact[];
  members: Array<Record<string, string | number>>;
  canEdit?: boolean;
  orderStatusCounts?: Record<string, number>;
  competitorProducts?: CompetitorProduct[];
};

/** 联系人名片墙：一位联系人一张卡，名片正反面点开可看大图 */
function ContactList({ contacts, customerId, version }: { contacts: Contact[]; customerId: number; version: string }) {
  const { t } = useLocale();
  if (!contacts.length) return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("暂无联系人")} />;
  const cardUrl = (contactId: number, side: "front" | "back") =>
    `/api/customers/${customerId}/contacts/${contactId}/card?side=${side}&v=${encodeURIComponent(version)}`;
  return (
    <div className={styles.contactGrid}>
      {contacts.map((contact) => (
        <div key={contact.id} className={styles.contactCard}>
          <div className={styles.contactHead}>
            <span className={styles.contactName}>{contact.name}</span>
            {contact.nameEn ? <span className={styles.contactNameEn}>{contact.nameEn}</span> : null}
            {contact.title ? <Tag color="blue">{contact.title}</Tag> : null}
          </div>
          <div className={styles.contactMeta}>
            <span><PhoneOutlined /> {contact.phone || "-"}</span>
            <span><MailOutlined /> {contact.email || "-"}</span>
          </div>
          <div className={styles.contactBlock}>
            <div className={styles.contactBlockLabel}>{t("性格爱好")}</div>
            <div className={`${styles.contactBlockValue} ${resStyles.preWrap}`}>{contact.personality || "-"}</div>
          </div>
          <div className={styles.contactCards}>
            {contact.hasCardFront ? (
              <Image src={cardUrl(contact.id, "front")} alt={t("名片正面")} width={132} height={84} className={styles.contactCardImage} />
            ) : null}
            {contact.hasCardBack ? (
              <Image src={cardUrl(contact.id, "back")} alt={t("名片反面")} width={132} height={84} className={styles.contactCardImage} />
            ) : null}
            {!contact.hasCardFront && !contact.hasCardBack ? <span className={resStyles.muted}>{t("未上传名片")}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * 竞品列表：按客户下过单 / 在谈的我方产品聚合，列出每个产品对应的竞争型号。
 * 竞品数据在「产品型号」里维护，这里只读展示，避免同一份竞品在客户下重复录入。
 */
function CompetitorList({ products }: { products: CompetitorProduct[] }) {
  const { t } = useLocale();

  // 拍平成表格行：同一个我方产品的多条竞品用 rowSpan 合并首列，
  // 没登记竞品的产品占一行，提示文案横跨后三列
  type Row = {
    key: string;
    className: string;
    grade: string;
    orderCount: number;
    span: number;
    competitorGrade: string;
    manufacturer: string;
    notes: string;
    empty?: boolean;
  };
  const rows: Row[] = [];
  for (const product of products) {
    const base = { className: product.className, grade: product.grade, orderCount: product.orderCount };
    if (!product.competitors.length) {
      rows.push({ key: `p${product.id}`, ...base, span: 1, competitorGrade: "", manufacturer: "", notes: "", empty: true });
      continue;
    }
    product.competitors.forEach((item, index) => {
      rows.push({
        key: `c${item.id}`,
        ...base,
        span: index === 0 ? product.competitors.length : 0,
        competitorGrade: item.grade,
        manufacturer: item.manufacturer,
        notes: item.notes,
      });
    });
  }

  const dash = <span className={resStyles.muted}>-</span>;
  const columns: TableProps<Row>["columns"] = [
    {
      title: t("我方产品"),
      dataIndex: "grade",
      width: 190,
      onCell: (row) => ({ rowSpan: row.span }),
      render: (_value, row) => (
        <div className={styles.competitorProduct}>
          <span className={resStyles.product}>
            <span className={resStyles.productClass}>{row.className}</span>
            {row.grade}
          </span>
          {row.orderCount ? <span className={resStyles.muted}>{t("{n} 单", { n: row.orderCount })}</span> : null}
        </div>
      ),
    },
    {
      title: t("竞争型号"),
      dataIndex: "competitorGrade",
      width: 170,
      // 未登记竞品的产品：提示文案占满剩下三列
      onCell: (row) => (row.empty ? { colSpan: 3 } : {}),
      render: (value, row) =>
        row.empty
          ? <span className={resStyles.muted}>{t("该产品尚未登记竞争型号，可在「产品型号」里补充")}</span>
          : <span className={resStyles.primaryCellStatic}>{String(value)}</span>,
    },
    {
      title: t("生产商"),
      dataIndex: "manufacturer",
      width: 160,
      onCell: (row) => (row.empty ? { colSpan: 0 } : {}),
      render: (value) => String(value || "") || dash,
    },
    {
      title: t("备注"),
      dataIndex: "notes",
      onCell: (row) => (row.empty ? { colSpan: 0 } : {}),
      render: (value) => String(value || "") || dash,
    },
  ];

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{t("竞品列表")}</h2>
        <span className={styles.sectionCount}>{t("共 {n} 条", { n: rows.filter((row) => !row.empty).length })}</span>
      </div>
      <div className={styles.tableFrame}>
        <Table<Row>
          rowKey="key"
          size="middle"
          columns={columns}
          dataSource={rows}
          pagination={false}
          scroll={{ x: 760 }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("该客户还没有关联的产品")} /> }}
        />
      </div>
    </section>
  );
}

export function CustomerProfile({ id }: { id: number }) {
  const { t, locale } = useLocale();
  const router = useRouter();
  const { message, modal } = App.useApp();
  const currentUser = useCurrentUser();
  const [data, setData] = useState<Detail | null>(null);
  const [dicts, setDicts] = useState<DictMap>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [removing, setRemoving] = useState(false);

  // silent：只刷新数据（如订单增删改后同步页头履约概要），不闪骨架屏
  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const response = await apiFetch(`/api/customers/${id}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "客户详情加载失败");
      setData(payload.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "客户详情加载失败");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  // 删除入口从客户卡片移到了详情页：确认弹窗过一道，删完直接回列表
  const remove = useCallback(async () => {
    setRemoving(true);
    try {
      const response = await apiFetch(`/api/customers/${id}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "删除失败");
      message.success(t("记录已删除"));
      router.push("/customers");
    } catch (err) {
      message.error(t(err instanceof Error ? err.message : "删除失败"));
    } finally {
      setRemoving(false);
    }
  }, [id, message, router, t]);

  const confirmRemove = useCallback(() => {
    modal.confirm({
      title: t("确认删除该客户？"),
      content: t("「{name}」及其联系人、名片将一并删除，订单与拜访记录保留。", { name: String(data?.customer.name || "") }),
      okText: t("确认删除"),
      cancelText: t("取消"),
      okButtonProps: { danger: true },
      centered: true,
      onOk: () => remove(),
    });
  }, [data?.customer.name, modal, remove, t]);

  // 分类 / 行业存的是 code，展示要查字典换成当前语言的名称
  useEffect(() => {
    (async () => {
      try {
        const response = await apiFetch("/api/lookups");
        const payload = await response.json();
        if (response.ok) setDicts(payload.data.dicts || {});
      } catch {
        // 字典拿不到时回退显示原始 code，不阻塞页面
      }
    })();
  }, []);


  if (loading) return <div className={styles.page}><Skeleton active paragraph={{ rows: 10 }} /></div>;

  if (error || !data) {
    return (
      <div className={styles.page}>
        <Link href="/customers" className={styles.back}><ArrowLeftOutlined /> {t("返回客户列表")}</Link>
        <Empty description={error || t("客户详情加载失败")} />
      </div>
    );
  }

  const { customer } = data;
  const location = [customer.country, customer.region].filter(Boolean).join(" / ");
  const categoryLabel = dictLabelOf(dicts.customer_category, String(customer.category || ""), locale);
  const industryLabel = String(customer.industry || "");
  const orderStatusCounts = data.orderStatusCounts || {};
  const orderTotal = Object.values(orderStatusCounts).reduce((sum, count) => sum + count, 0);
  // 页签角标显示竞品条数（跨产品合计），没有就不显示数字
  const competitorCount = (data.competitorProducts || []).reduce((sum, product) => sum + product.competitors.length, 0);

  return (
    <div className={styles.page}>
      <Link href="/customers" className={styles.back}><ArrowLeftOutlined /> {t("返回客户列表")}</Link>

      <div className={styles.header}>
        <div className={styles.headerMain}>
          <div className={styles.titleGroup}>
            <h1 className={styles.title}>{customer.name}</h1>
            <StatusTag value={String(customer.status)} label={{ potential: "潜在客户", active: "活跃客户", inactive: "已停用" }[String(customer.status)]} />
            {categoryLabel ? <Tag color="blue">{categoryLabel}</Tag> : null}
          </div>
          {customer.nameEn ? <div className={styles.nameEn}>{customer.nameEn}</div> : null}
          <div className={styles.headerMeta}>
            {customer.shortName ? <span><b>{t("简称")}</b> {customer.shortName}</span> : null}
            <span><b>{t("负责人")}</b> {customer.ownerName}</span>
            {location ? <span><b>{t("国家 / 地区")}</b> {location}</span> : null}
            {industryLabel ? <span><b>{t("行业")}</b> {industryLabel}</span> : null}
          </div>
        </div>
        <div className={styles.headerSide}>
          {/* 主操作放页头最上方：编辑就地开弹窗，删除先弹确认框，确认后回列表 */}
          {data.canEdit !== false ? (
            <div className={styles.headerActions}>
              <Button type="primary" icon={<EditOutlined />} onClick={() => setEditOpen(true)}>{t("编辑客户")}</Button>
              <Button danger icon={<DeleteOutlined />} loading={removing} onClick={confirmRemove}>{t("删除客户")}</Button>
            </div>
          ) : null}
          {/* 订单履约概要跟在操作下面，打开档案第一眼就能看到整体进度 */}
          {orderTotal > 0 ? (
            <div className={styles.summary}>
              {STATUS_FLOW.map((status) => (
                <div key={status} className={styles.summaryChip}>
                  <span className={styles.summaryNum}>{orderStatusCounts[status] || 0}</span>
                  <span className={styles.summaryLabel}>{t(statusLabel(status))}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {/* 名称 / 状态 / 分类 / 负责人 / 国家地区 / 行业 都已在页头呈现，
          这里只补页头没有的字段，压成一条窄信息条，把纵向空间让给订单表格 */}
      <div className={styles.facts}>
        <div className={styles.fact}>
          <div className={styles.factLabel}>{t("地址")}</div>
          <div className={styles.factValue}>{customer.address || "-"}</div>
        </div>
        <div className={styles.fact}>
          <div className={styles.factLabel}>{t("客户简介")}</div>
          <div className={`${styles.factValue} ${resStyles.preWrap}`}>{customer.description || "-"}</div>
        </div>
        <div className={styles.fact}>
          <div className={styles.factLabel}>{t("联系人")}</div>
          {/* 联系人可能有二十几位，这里只速览前三位，完整名单看下方「联系人」页签 */}
          <div className={styles.tagWrap}>
            {data.contacts.length ? (
              <>
                {data.contacts.slice(0, 3).map((contact) => (
                  <Tag key={contact.id}>{contact.name}{contact.title ? ` · ${contact.title}` : ""}{contact.phone ? ` · ${contact.phone}` : ""}</Tag>
                ))}
                {data.contacts.length > 3 ? <Tag>+{data.contacts.length - 3}</Tag> : null}
              </>
            ) : <span className={resStyles.muted}>-</span>}
          </div>
        </div>
        <div className={styles.fact}>
          <div className={styles.factLabel}>{t("协作成员")}</div>
          <div className={styles.tagWrap}>
            {data.members.length ? data.members.map((member) => (
              <Tag key={member.id}>{member.name} · {member.access === "edit" ? t("可编辑") : t("可查看")}</Tag>
            )) : <span className={resStyles.muted}>-</span>}
          </div>
        </div>
      </div>

      {/* 订单与拜访都挂在客户档案下，用 tab 切换避免页面纵向过长；
          订单在上（更常用），拜访在后 */}
      <Tabs
        className={styles.recordTabs}
        defaultActiveKey="orders"
        items={[
          {
            key: "orders",
            label: t("订单记录"),
            children: (
              <CustomerOrders
                customerId={id}
                customerName={String(customer.name)}
                canEdit={data.canEdit !== false}
                isAdmin={currentUser.role === "admin"}
                compact
                onChanged={() => void load(true)}
              />
            ),
          },
          {
            key: "contacts",
            label: `${t("联系人")}${data.contacts.length ? ` (${data.contacts.length})` : ""}`,
            children: <ContactList contacts={data.contacts} customerId={id} version={String(customer.updatedAt || "")} />,
          },
          {
            key: "competitors",
            label: `${t("竞品列表")}${competitorCount ? ` (${competitorCount})` : ""}`,
            children: <CompetitorList products={data.competitorProducts || []} />,
          },
          {
            key: "visits",
            label: t("拜访记录"),
            children: (
              <CustomerVisits
                customerId={id}
                customerName={String(customer.name)}
                canEdit={data.canEdit !== false}
                onChanged={() => void load()}
              />
            ),
          },
        ]}
      />

      {/* 保存后就地刷新详情，不离开当前页面 */}
      <CustomerEditModal
        customerId={id}
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onSaved={() => void load()}
      />
    </div>
  );
}
