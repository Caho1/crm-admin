"use client";

import { FileExcelOutlined, InboxOutlined, UploadOutlined } from "@ant-design/icons";
import { Alert, App, Button, Empty, Table, Tag, Upload, type TableProps, type UploadFile } from "antd";
import { useState } from "react";
import { apiFetch } from "@/lib/client-fetch";
import { useLocale } from "./providers";
import styles from "./data-center.module.css";

type PreviewRow = {
  orderNo: string;
  orderDate: string;
  customerName: string;
  className: string;
  grade: string;
  quantity: number;
  price: number;
  actualShipmentDate: string | null;
  expectedArrivalDate: string | null;
};
type ImportResult = {
  valid: boolean;
  totalRows?: number;
  validCount?: number;
  imported?: number;
  errors: Array<{ row: number; message: string }>;
  preview?: PreviewRow[];
};

export function DataCenter() {
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
      const response = await apiFetch("/api/data/orders-import", { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "Excel 处理失败");
      setResult(payload.data);
      if (commit) {
        message.success(t("成功导入 {n} 条订单", { n: payload.data.imported }));
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

  const previewColumns: TableProps<PreviewRow>["columns"] = [
    { title: t("订单编号"), dataIndex: "orderNo", width: 160 },
    { title: t("下单日期"), dataIndex: "orderDate", width: 110 },
    { title: t("客户"), dataIndex: "customerName", width: 190, ellipsis: true },
    { title: t("产品"), key: "product", width: 140, render: (_, row) => `${row.className} / ${row.grade}` },
    { title: t("数量"), dataIndex: "quantity", width: 90 },
    { title: t("单价"), dataIndex: "price", width: 100 },
    { title: t("实际出货"), dataIndex: "actualShipmentDate", width: 110, render: (value) => value || "-" },
    { title: t("预计到港"), dataIndex: "expectedArrivalDate", width: 110, render: (value) => value || "-" },
  ];

  return (
    <div>
      <div className={styles.header}>
        <h2 className={styles.sectionTitle}>{t("订单 Excel 导入")}</h2>
        <div className={styles.headerActions}>
          <Button icon={<FileExcelOutlined />} href="/api/data/orders-template">{t("下载订单模板")}</Button>
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
            <p className="ant-upload-text">{t("选择或拖入订单 Excel")}</p>
            <p className="ant-upload-hint">{t("支持 .xlsx，单个文件不超过 5MB")}</p>
          </Upload.Dragger>
          <div className={styles.actions}>
            <Button icon={<UploadOutlined />} loading={checking} disabled={!fileList.length} onClick={() => void upload(false)}>{t("开始预检")}</Button>
            <Button type="primary" loading={importing} disabled={!result?.valid || !fileList.length} onClick={() => void upload(true)}>{t("确认导入")}</Button>
          </div>
        </div>
      </section>
      {result ? (
        <section className={styles.section}>
          <div className={styles.sectionHeader}><h2 className={styles.sectionTitle}>{result.imported !== undefined ? t("导入结果") : t("预检结果")}</h2></div>
          <div className={styles.sectionBody}>
            <div className={styles.resultSummary}>
              <Tag color={result.valid ? "green" : "red"}>{result.valid ? (result.imported !== undefined ? t("导入成功") : t("预检通过")) : t("存在错误")}</Tag>
              {result.totalRows !== undefined ? <span>{t("共 {total} 行，可导入 {valid} 行", { total: result.totalRows, valid: result.validCount ?? 0 })}</span> : null}
              {result.imported !== undefined ? <span>{t("已导入 {n} 行", { n: result.imported })}</span> : null}
            </div>
            {result.imported !== undefined ? (
              // 导入成功后给出明确收尾与下一步，不再展示空预览
              <Alert
                showIcon
                type="success"
                title={t("成功导入 {n} 条订单", { n: result.imported })}
                action={<Button size="small" href="/orders">{t("查看订单")}</Button>}
              />
            ) : result.errors.length ? (
              <ul className={styles.errorList}>
                {result.errors.map((error) => <li key={`${error.row}-${error.message}`}>{t("第 {row} 行", { row: error.row })}：{error.message}</li>)}
              </ul>
            ) : result.preview?.length ? (
              <Table rowKey="orderNo" size="small" columns={previewColumns} dataSource={result.preview} pagination={false} scroll={{ x: 1000 }} />
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("没有可预览的数据")} />
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
