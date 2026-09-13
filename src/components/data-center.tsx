"use client";

import { DownloadOutlined, FileExcelOutlined, InboxOutlined, TableOutlined, UploadOutlined } from "@ant-design/icons";
import { Alert, App, Button, Empty, Modal, Table, Tag, Upload, type TableProps, type UploadFile } from "antd";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/client-fetch";
import { useLocale } from "./providers";
import styles from "./data-center.module.css";

type ImportMode = "create" | "update";
/**
 * 预检弹窗里的一行，按「文件原样」展示：
 * cells 是这行在 Excel 里的原始单元格值（与 headers 一一对应），
 * row 是 Excel 行号（勾选与提交都按它对齐），duplicate 标红，error 不为空表示这行导不了
 */
type PreviewRow = {
  row: number;
  cells: string[];
  mode: ImportMode | null;
  duplicate: boolean;
  error: string | null;
  /** 这一行只差客户/产品没建：勾上「一起新建」后它就能导 */
  fixableByCreate: boolean;
};
type ProductRef = { className: string; grade: string };
type ImportResult = {
  valid: boolean;
  totalRows?: number;
  validCount?: number;
  createCount?: number;
  updateCount?: number;
  imported?: number;
  errors: Array<{ row: number; message: string }>;
  /** 上传文件自己的表头，弹窗按它动态出列 */
  headers?: string[];
  preview?: PreviewRow[];
  /** 仅订单导入才有：报错里提到的、系统里还没有的客户/产品，用来问「要不要顺手新建」 */
  missingCustomers?: string[];
  missingProducts?: ProductRef[];
  /** 报错是不是清一色「客户/产品不存在」——夹了别的错误就不提供一键新建，得先把文件改对 */
  onlyMissingReferences?: boolean;
};

type PanelConfig = {
  endpoint: string;
  templateHref: string;
  exportHref?: string;
  templateLabel: string;
  exportLabel?: string;
  uploadText: string;
  hint: string;
  /** 标红提示语里那个「重复」指的是什么重复——客户导入是客户名称，订单导入是订单编号 */
  duplicateLabel: string;
};

function ImportPanel({ config }: { config: PanelConfig }) {
  const { t } = useLocale();
  const { message } = App.useApp();
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [checking, setChecking] = useState(false);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  // 预检表格里勾选要导入的 Excel 行号，默认全选
  const [selectedRows, setSelectedRows] = useState<number[]>([]);
  const [previewOpen, setPreviewOpen] = useState(false);

  // 一行能不能导：表里的客户/产品系统中还没有时一律自动新建，
  // 所以「只差客户/产品」不算问题，只有真正的数据错误（日期、数量等）才导不了
  const canImportRow = useCallback((row: PreviewRow) => !row.error || row.fixableByCreate, []);

  useEffect(() => {
    setSelectedRows((result?.preview ?? []).filter((row) => !row.error || row.fixableByCreate).map((row) => row.row));
  }, [result?.preview]);

  const upload = async (commit: boolean) => {
    const file = fileList[0]?.originFileObj;
    if (!file) {
      message.warning(t("请先选择导入文件"));
      return;
    }
    if (commit) setImporting(true);
    else setChecking(true);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("commit", String(commit));
      // 表里的客户/产品系统中还没有就直接建 —— 导一张月度订单表，本来就意味着
      // 要把里面的客户和牌号建进系统，没必要再让用户确认一次
      if (commit) {
        if (result?.missingCustomers?.length) form.append("createCustomers", JSON.stringify(result.missingCustomers));
        if (result?.missingProducts?.length) form.append("createProducts", JSON.stringify(result.missingProducts));
      }
      // 提交时带上勾选的行号，只导这几行；预检不需要
      if (commit && selectedRows.length) form.append("selectedRows", JSON.stringify(selectedRows));
      const response = await apiFetch(config.endpoint, { method: "POST", body: form });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "Excel 处理失败");
      setResult(payload.data);
      if (commit) {
        if (payload.data.valid) {
          message.success(t("新增 {created} 条，更新 {updated} 条", { created: payload.data.createCount ?? 0, updated: payload.data.updateCount ?? 0 }));
          setFileList([]);
          setPreviewOpen(false);
        } else {
          message.warning(t("预检发现错误，请修正后重新上传"));
        }
      } else {
        // 预检完直接把明细弹窗推到面前，问题也在弹窗里逐行看，省得页面上堆一屏红字
        if (payload.data.preview?.length) setPreviewOpen(true);
        if (payload.data.valid) message.success(t("预检通过，可以确认导入"));
      }
    } catch (error) {
      message.error(t(error instanceof Error ? error.message : "Excel 处理失败"));
    } finally {
      setChecking(false);
      setImporting(false);
    }
  };

  const done = result?.imported !== undefined;
  const previewRows = result?.preview ?? [];
  const duplicateCount = previewRows.filter((row) => row.duplicate).length;
  const missingCustomerCount = result?.missingCustomers?.length ?? 0;
  const missingProductCount = result?.missingProducts?.length ?? 0;
  // 可导入行数按前端口径重算：缺客户/产品会自动新建，这类行不算错误，
  // 而接口返回的 validCount 是「当前库里已经能对上」的行数，会把它们算成不可导入
  const importableCount = previewRows.filter((row) => !row.error || row.fixableByCreate).length;
  const blockedCount = previewRows.length - importableCount;
  // 表格列 = 固定的「行号 / 处理方式 / 问题」+ 上传文件自己的每一列，原样展示
  const previewColumns: TableProps<PreviewRow>["columns"] = [
    { title: t("行号"), dataIndex: "row", width: 76, fixed: "left", render: (value: number) => t("第 {row} 行", { row: value }) },
    {
      title: t("处理方式"),
      dataIndex: "mode",
      width: 90,
      fixed: "left",
      render: (value: ImportMode | null, record) => (canImportRow(record)
        ? <Tag color={value === "update" ? "gold" : "blue"}>{value === "update" ? t("更新") : t("新增")}</Tag>
        : <Tag color="red">{t("不可导入")}</Tag>),
    },
    ...(result?.headers ?? []).map((header, index) => ({
      title: header || `#${index + 1}`,
      key: `cell-${index}`,
      width: 150,
      ellipsis: true,
      render: (_: unknown, record: PreviewRow) => record.cells[index] || <span className={styles.muted}>-</span>,
    })),
    {
      title: t("问题"),
      dataIndex: "error",
      width: 220,
      render: (value: string | null, record) => {
        if (!value) return <span className={styles.muted}>-</span>;
        // 只差客户/产品不算错误，导入时会顺手建好
        return record.fixableByCreate
          ? <span className={styles.softText}>{t("将随导入一起新建")}</span>
          : <span className={styles.errorText}>{value}</span>;
      },
    },
  ];

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
            accept=".xlsx,.csv"
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
            {/* 勾选为空时不让点：避免一次什么都没导还提示成功 */}
            <Button type="primary" loading={importing} disabled={!result?.valid || !fileList.length || !selectedRows.length} onClick={() => void upload(true)}>{t("确认导入")}</Button>
          </div>
        </div>
      </section>
      {result ? (
        <section className={styles.section}>
          <div className={styles.sectionHeader}><h2 className={styles.sectionTitle}>{done ? t("导入结果") : t("预检结果")}</h2></div>
          <div className={styles.sectionBody}>
            {/* 导入完成后只留一条结果提示，不再把同样的数字用标签重复一遍 */}
            {!done ? (
              <div className={styles.resultSummary}>
                <Tag color={blockedCount ? "red" : "green"}>{blockedCount ? t("存在错误") : t("预检通过")}</Tag>
                <span>{t("共 {total} 行，可导入 {valid} 行", { total: previewRows.length, valid: importableCount })}</span>
                {missingCustomerCount || missingProductCount ? (
                  <span className={styles.missingHint}>
                    {t("将新建 {customers} 个客户、{products} 个产品", { customers: missingCustomerCount, products: missingProductCount })}
                  </span>
                ) : null}
                {duplicateCount ? (
                  <Tag color="red">{t("{label}重复 {n} 行", { label: config.duplicateLabel, n: duplicateCount })}</Tag>
                ) : null}
              </div>
            ) : null}
            {done ? (
              <Alert
                showIcon
                type="success"
                title={t("导入成功")}
                description={t("新增 {created} 条，更新 {updated} 条", { created: result.createCount ?? 0, updated: result.updateCount ?? 0 })}
                action={
                  <div className={styles.resultActions}>
                    <Button size="small" href="/orders">{t("查看订单")}</Button>
                    <Button size="small" type="link" href="/customers">{t("查看客户")}</Button>
                  </div>
                }
              />
            ) : result.preview?.length ? (
              // 明细、问题、缺失项处理全都收在弹窗里，页面上不再堆红字
              <Button type="primary" ghost icon={<TableOutlined />} onClick={() => setPreviewOpen(true)}>
                {t("查看并勾选导入明细（{n} 行）", { n: result.preview.length })}
              </Button>
            ) : (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("没有可预览的数据")} />
            )}
          </div>
        </section>
      ) : null}

      {/* 导入明细弹窗：整份文件逐行列出，重复行标红，勾掉的行不导入 */}
      <Modal
        title={t("导入明细")}
        open={previewOpen}
        onCancel={() => setPreviewOpen(false)}
        width={1080}
        centered
        okText={t("确认导入")}
        cancelText={t("取消")}
        okButtonProps={{ loading: importing, disabled: !selectedRows.length }}
        onOk={() => void upload(true).then(() => setPreviewOpen(false))}
        styles={{ body: { maxHeight: "calc(100vh - 260px)", overflowY: "auto" } }}
      >
        <div className={styles.modalSummary}>
          <span>{t("共 {n} 行", { n: result?.preview?.length ?? 0 })}</span>
          {duplicateCount ? (
            <Tag color="red">{t("{label}重复 {n} 行", { label: config.duplicateLabel, n: duplicateCount })}</Tag>
          ) : null}
          <span className={styles.selectedHint}>{t("已勾选 {n} 行导入", { n: selectedRows.length })}</span>
          {/* 表里的客户/产品系统中没有就直接建，不再让用户确认 —— 这里只把会建多少告诉他 */}
          {missingCustomerCount || missingProductCount ? (
            <span className={styles.missingHint}>
              {t("将新建 {customers} 个客户、{products} 个产品", { customers: missingCustomerCount, products: missingProductCount })}
            </span>
          ) : null}
        </div>
        <Table<PreviewRow>
          rowKey={(row) => String(row.row)}
          size="small"
          columns={previewColumns}
          dataSource={result?.preview ?? []}
          // 重复的行整行标红，一眼看出哪几行是同一个客户/同一个编号
          rowClassName={(row) => (row.duplicate ? styles.duplicateRow : "")}
          rowSelection={{
            selectedRowKeys: selectedRows.map(String),
            onChange: (keys) => setSelectedRows(keys.map((key) => Number(key))),
            // 只有真正有数据错误的行禁掉勾选；只差客户/产品的行会自动新建，可以导
            getCheckboxProps: (row) => ({ disabled: !canImportRow(row) }),
          }}
          pagination={{ pageSize: 10, showSizeChanger: false, showTotal: (total) => t("共 {n} 条", { n: total }) }}
          scroll={{ x: "max-content" }}
        />
      </Modal>
    </div>
  );
}

export function DataCenter() {
  const { t } = useLocale();

  // 只有一个导入入口：每月那张订单记录表。表里的客户/产品在系统中不存在时，
  // 预检会问「要不要顺手新建」，不需要再单独走一遍客户名单导入
  const orders: PanelConfig = {
    endpoint: "/api/data/orders-import",
    templateHref: "/api/data/orders-template",
    exportHref: "/api/data/orders-export",
    templateLabel: t("下载导入模板"),
    exportLabel: t("导出全部订单"),
    uploadText: t("选择或拖入订单记录表 Excel / CSV"),
    hint: t("支持 .xlsx / .csv，单个文件不超过 5MB；按行导入，表里的客户与产品如果系统中还没有，预检时可以一起新建"),
    duplicateLabel: t("订单编号"),
  };

  return <ImportPanel config={orders} />;
}
