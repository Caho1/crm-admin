"use client";

import { DownloadOutlined, FileExcelOutlined, InboxOutlined, UploadOutlined } from "@ant-design/icons";
import { Alert, App, Button, Empty, Table, Tabs, Tag, Upload, type TableProps, type UploadFile } from "antd";
import { useState } from "react";
import { apiFetch } from "@/lib/client-fetch";
import { useLocale } from "./providers";
import styles from "./data-center.module.css";

type ImportMode = "create" | "update";
type PreviewRow = Record<string, unknown> & { mode?: ImportMode };
type ImportResult = {
  valid: boolean;
  totalRows?: number;
  validCount?: number;
  createCount?: number;
  updateCount?: number;
  imported?: number;
  errors: Array<{ row: number; message: string }>;
  preview?: PreviewRow[];
};

type PanelConfig = {
  endpoint: string;
  templateHref: string;
  exportHref?: string;
  templateLabel: string;
  exportLabel?: string;
  uploadText: string;
  hint: string;
  columns: TableProps<PreviewRow>["columns"];
  rowKey: (row: PreviewRow, index?: number) => string;
};

function ImportPanel({ config }: { config: PanelConfig }) {
  const { t } = useLocale();
  const { message } = App.useApp();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const upload = async (commit: boolean) => {
    const file = fileList[0]?.originFileObj;
    if (!file) {
      message.warning(t("请先选择 Excel 文件"));
      return;
    }
    if (commit) setImporting(true);
    else setChecking(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("commit", String(commit));
      const response = await apiFetch(config.endpoint, { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "Excel 处理失败");
      setResult(payload.data);
      if (commit) {
        message.success(t("新增 {created} 条，更新 {updated} 条", { created: payload.data.createCount ?? 0, updated: payload.data.updateCount ?? 0 }));
        setFileList([]);
      } else if (payload.data.valid) {
        message.success(t("预检通过，可以确认导入"));
      } else {
        message.warning(t("预检发现错误，请修正后重新上传"));
      }
    } catch (error) {
      message.error(t(error instanceof Error ? error.message : "Excel 处理失败"));
    } finally {
      setChecking(false);
      setImporting(false);
    }
  };

  const done = result?.imported !== undefined;

  return (
    <div>
      <div className={styles.header}>
        <div className={styles.headerActions}>
          <Button icon={<FileExcelOutlined />} href={config.templateHref}>{config.templateLabel}</Button>
          {config.exportHref ? (
            <Button icon={<DownloadOutlined />} href={config.exportHref}>{config.exportLabel}</Button>
          ) : null}
        </div>
      </div>
      <section className={styles.section}>
        <div className={styles.sectionBody}>
          <Upload.Dragger
            className={styles.upload}
            accept=".xlsx"
            maxCount={1}
            fileList={fileList}
            beforeUpload={() => false}
            onChange={({ fileList: next }) => { setFileList(next.slice(-1)); setResult(null); }}
            onRemove={() => { setFileList([]); setResult(null); }}
          >
            <p className="ant-upload-drag-icon"><InboxOutlined /></p>
            <p className="ant-upload-text">{config.uploadText}</p>
            <p className="ant-upload-hint">{config.hint}</p>
          </Upload.Dragger>
          <div className={styles.actions}>
            <Button icon={<UploadOutlined />} loading={checking} disabled={!fileList.length} onClick={() => void upload(false)}>{t("开始预检")}</Button>
            <Button type="primary" loading={importing} disabled={!result?.valid || !fileList.length} onClick={() => void upload(true)}>{t("确认导入")}</Button>
          </div>
        </div>
      </section>
      {result ? (
        <section className={styles.section}>
          <div className={styles.sectionHeader}><h2 className={styles.sectionTitle}>{done ? t("导入结果") : t("预检结果")}</h2></div>
          <div className={styles.sectionBody}>
            <div className={styles.resultSummary}>
              <Tag color={result.valid ? "green" : "red"}>{result.valid ? (done ? t("导入成功") : t("预检通过")) : t("存在错误")}</Tag>
              {result.totalRows !== undefined ? <span>{t("共 {total} 行，可导入 {valid} 行", { total: result.totalRows, valid: result.validCount ?? 0 })}</span> : null}
              {/* 新增与更新分开报数，导入前就能看清哪些是覆盖已有数据 */}
              {result.createCount !== undefined ? <Tag color="blue">{t("新增 {n} 条", { n: result.createCount })}</Tag> : null}
              {result.updateCount !== undefined ? <Tag color="gold">{t("更新 {n} 条", { n: result.updateCount })}</Tag> : null}
            </div>
            {done ? (
              <Alert
                showIcon
                type="success"
                title={t("新增 {created} 条，更新 {updated} 条", { created: result.createCount ?? 0, updated: result.updateCount ?? 0 })}
                action={<Button size="small" href="/customers">{t("查看客户")}</Button>}
              />
            ) : result.errors.length ? (
              <ul className={styles.errorList}>
                {result.errors.map((error) => <li key={`${error.row}-${error.message}`}>{t("第 {row} 行", { row: error.row })}：{error.message}</li>)}
              </ul>
            ) : result.preview?.length ? (
              <Table
                rowKey={config.rowKey}
                size="small"
                columns={config.columns}
                dataSource={result.preview}
                pagination={{ pageSize: 10, hideOnSinglePage: true, showSizeChanger: false }}
                scroll={{ x: 1000 }}
              />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("没有可预览的数据")} />
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}

export function DataCenter() {
  const { t } = useLocale();

  // 预检表格第一列统一标出这一行是新增还是覆盖已有记录
  const modeColumn = {
    title: t("处理方式"),
    dataIndex: "mode",
    width: 90,
    render: (value: ImportMode) => (
      <Tag color={value === "update" ? "gold" : "blue"}>{value === "update" ? t("更新") : t("新增")}</Tag>
    ),
  };

  const customerStatusLabels: Record<string, string> = {
    potential: t("潜在客户"),
    active: t("活跃客户"),
    inactive: t("已停用"),
  };

  const customers: PanelConfig = {
    endpoint: "/api/data/customers-import",
    templateHref: "/api/data/customers-template",
    templateLabel: t("下载客户模板"),
    uploadText: t("选择或拖入客户 Excel"),
    hint: t("支持 .xlsx，单个文件不超过 5MB；同名客户按名称匹配并更新，留空的列保持原值"),
    rowKey: (row, index) => `${String(row.name ?? "")}-${index}`,
    columns: [
      modeColumn,
      { title: t("客户名称"), dataIndex: "name", width: 200, ellipsis: true },
      { title: t("英文名称"), dataIndex: "nameEn", width: 190, ellipsis: true, render: (value) => String(value || "-") },
      { title: t("客户分类"), dataIndex: "category", width: 110, render: (value) => String(value || "-") },
      { title: t("行业"), dataIndex: "industry", width: 110, render: (value) => String(value || "-") },
      { title: t("负责人"), dataIndex: "ownerName", width: 100, render: (value) => String(value || "-") },
      { title: t("状态"), dataIndex: "status", width: 100, render: (value) => customerStatusLabels[String(value)] || String(value || "-") },
      { title: t("主要联系人"), dataIndex: "contactName", width: 120, ellipsis: true, render: (value) => String(value || "-") },
    ],
  };

  const orders: PanelConfig = {
    endpoint: "/api/data/orders-import",
    templateHref: "/api/data/orders-template",
    exportHref: "/api/data/orders-export",
    templateLabel: t("下载订单模板"),
    exportLabel: t("导出全部订单"),
    uploadText: t("选择或拖入订单 Excel"),
    hint: t("支持 .xlsx，单个文件不超过 5MB；订单编号已存在的行会更新该订单，留空的列保持原值"),
    rowKey: (row, index) => `${String(row.orderNo ?? "")}-${index}`,
    columns: [
      modeColumn,
      { title: t("订单编号"), dataIndex: "orderNo", width: 160 },
      { title: t("下单日期"), dataIndex: "orderDate", width: 110 },
      { title: t("客户"), dataIndex: "customerName", width: 190, ellipsis: true },
      { title: t("产品"), key: "product", width: 140, render: (_, row) => `${row.className} / ${row.grade}` },
      { title: t("数量"), dataIndex: "quantity", width: 90 },
      { title: t("单价"), dataIndex: "price", width: 100 },
      { title: t("实际出货"), dataIndex: "actualShipmentDate", width: 110, render: (value) => String(value || "-") },
      { title: t("预计到港"), dataIndex: "expectedArrivalDate", width: 110, render: (value) => String(value || "-") },
    ],
  };

  return (
    <Tabs
      defaultActiveKey="customers"
      items={[
        // 客户名单在前：先把开发中的客户导进来，订单导入时才能按客户名匹配上
        { key: "customers", label: t("客户名单"), children: <ImportPanel config={customers} /> },
        { key: "orders", label: t("订单"), children: <ImportPanel config={orders} /> },
      ]}
    />
  );
}
