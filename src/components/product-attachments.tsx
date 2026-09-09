"use client";

import { DeleteOutlined, DownloadOutlined, PaperClipOutlined, UploadOutlined } from "@ant-design/icons";
import { App, Button, Image, Modal, Spin, Upload } from "antd";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/client-fetch";
import { useLocale } from "./providers";
import styles from "./product-attachments.module.css";

type AttachmentMeta = { id: number; fileName: string; mimeType: string; fileSize: number; createdAt: string };

const MAX_SIZE = 10 * 1024 * 1024;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// mime_type 拿不到时（部分老浏览器上传不带类型）按扩展名兜底判断
function previewKind(item: AttachmentMeta): "image" | "pdf" | "excel" | "none" {
  const mime = item.mimeType.toLowerCase();
  const ext = item.fileName.split(".").pop()?.toLowerCase() ?? "";
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext)) return "image";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  // 只认 xlsx / csv：老的二进制 .xls 格式 exceljs 读不了，落到 none 走下载
  if (["xlsx", "csv"].includes(ext)) return "excel";
  return "none";
}

/** 解析出来的一张工作表：表名 + 二维单元格文本（已按最大列数补齐） */
type SheetData = { name: string; rows: string[][] };

/** 单元格 → 纯文本：日期、公式结果、富文本、超链接都要能显示，公式报错按空处理 */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const cell = value as Record<string, unknown>;
    if ("error" in cell) return "";
    if ("richText" in cell) return (cell.richText as Array<{ text: string }>).map((part) => part.text).join("");
    if ("text" in cell) return String(cell.text);
    if ("result" in cell) return cellText(cell.result);
    if ("hyperlink" in cell) return String(cell.hyperlink);
    return "";
  }
  return String(value);
}

/**
 * 型号附件（RAPIDS / TDS / COA 等办公文档）：上传、下载、删除，点文件名弹窗预览
 * （图片 / PDF 直接内嵌，xlsx / csv 在浏览器里解析成表格；其他格式弹窗里给下载入口）。
 * 新建产品时还没有 productId，先提示保存后再上传；编辑已有产品时立即生效，
 * 每次增删都直接调接口，不随主表单一起提交。
 */
export function AttachmentsField({ label, productId }: { label: string; productId?: number }) {
  const { t } = useLocale();
  const { message } = App.useApp();
  const [items, setItems] = useState<AttachmentMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [previewItem, setPreviewItem] = useState<AttachmentMeta | null>(null);
  // Excel 预览：在浏览器里解析出来的工作表，以及当前看的是哪一张
  const [sheets, setSheets] = useState<SheetData[] | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [sheetError, setSheetError] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);

  const load = useCallback(async () => {
    if (!productId) {
      setItems([]);
      return;
    }
    setLoading(true);
    try {
      const response = await apiFetch(`/api/products/${productId}/attachments`);
      const payload = await response.json();
      if (response.ok) setItems(payload.data);
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    void load();
  }, [load]);

  const upload = async (file: File) => {
    if (!productId) return;
    if (file.size > MAX_SIZE) {
      message.error(t("附件不能超过 10MB"));
      return;
    }
    setUploading(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const response = await apiFetch(`/api/products/${productId}/attachments`, { method: "POST", body });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "附件上传失败");
      await load();
    } catch (error) {
      message.error(t(error instanceof Error ? error.message : "附件上传失败"));
    } finally {
      setUploading(false);
    }
  };

  const remove = async (id: number) => {
    if (!productId) return;
    const response = await apiFetch(`/api/products/${productId}/attachments/${id}`, { method: "DELETE" });
    if (!response.ok) {
      const payload = await response.json();
      message.error(t(payload.error?.message || "删除失败"));
      return;
    }
    message.success(t("附件已删除"));
    await load();
  };

  const fileUrl = useCallback(
    (item: AttachmentMeta) => `/api/products/${productId}/attachments/${item.id}`,
    [productId],
  );
  const kind = previewItem ? previewKind(previewItem) : "none";

  // Excel 在浏览器里解析：exceljs 已经是项目依赖（导入导出在用），自带浏览器构建，
  // 这里动态 import，只有真的点开 Excel 附件时才会加载这段代码，不进首屏包
  useEffect(() => {
    if (!previewItem || previewKind(previewItem) !== "excel") {
      setSheets(null);
      setSheetError(null);
      return;
    }
    let cancelled = false;
    setParsing(true);
    setSheets(null);
    setSheetError(null);
    setSheetIndex(0);
    void (async () => {
      try {
        const [{ default: ExcelJS }, response] = await Promise.all([
          import("exceljs"),
          apiFetch(fileUrl(previewItem)),
        ]);
        if (!response.ok) throw new Error("读取附件失败");
        const buffer = await response.arrayBuffer();
        const workbook = new ExcelJS.Workbook();
        if (previewItem.fileName.toLowerCase().endsWith(".csv")) {
          // exceljs 的 csv.read 要 Node 流，浏览器里直接按文本切分更省事
          const text = new TextDecoder().decode(buffer);
          const rows = text.split(/\r?\n/).map((line) => line.split(","));
          if (!cancelled) setSheets([{ name: "CSV", rows }]);
          return;
        }
        await workbook.xlsx.load(buffer);
        const parsed: SheetData[] = workbook.worksheets.map((worksheet) => {
          const rows: string[][] = [];
          let width = 0;
          worksheet.eachRow({ includeEmpty: true }, (row) => {
            const cells: string[] = [];
            row.eachCell({ includeEmpty: true }, (cell, column) => {
              cells[column - 1] = cellText(cell.value);
            });
            width = Math.max(width, cells.length);
            rows.push(cells);
          });
          // 每行补齐到最大列数，否则表格右侧会参差不齐
          return { name: worksheet.name, rows: rows.map((cells) => Array.from({ length: width }, (_, i) => cells[i] ?? "")) };
        });
        if (!cancelled) setSheets(parsed);
      } catch {
        if (!cancelled) setSheetError(t("这个 Excel 解析不了，可能是加密文件或老的 .xls 格式，请下载后查看"));
      } finally {
        if (!cancelled) setParsing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [previewItem, fileUrl, t]);

  return (
    <div className={styles.wrap}>
      {/* 上传入口跟着分区标题走，与「联系人」「竞争型号对比」的分区头部按钮同一套位置和交互 */}
      <div className={styles.sectionHead}>
        <span className={styles.sectionTitle}>{label}</span>
        {productId ? (
          <Upload
            showUploadList={false}
            beforeUpload={(file) => {
              void upload(file as File);
              return false;
            }}
          >
            <Button size="small" icon={<UploadOutlined />} loading={uploading}>{t("上传附件")}</Button>
          </Upload>
        ) : null}
      </div>
      {!productId ? (
        <span className={styles.muted}>{t("保存产品后可上传附件")}</span>
      ) : items.length ? (
        <div className={styles.list}>
          {items.map((item) => (
            <div key={item.id} className={styles.item}>
              <button type="button" className={styles.name} onClick={() => setPreviewItem(item)}>
                <PaperClipOutlined /> {item.fileName}
              </button>
              <span className={styles.size}>{formatBytes(item.fileSize)}</span>
              <span className={styles.spacer} />
              <Button
                type="text"
                size="small"
                icon={<DownloadOutlined />}
                aria-label={t("下载")}
                href={fileUrl(item)}
                download
                target="_blank"
                rel="noreferrer"
              />
              <Button danger type="text" size="small" icon={<DeleteOutlined />} aria-label={t("删除")} onClick={() => void remove(item.id)} />
            </div>
          ))}
        </div>
      ) : !loading ? (
        <span className={styles.muted}>{t("暂无附件")}</span>
      ) : null}

      <Modal
        title={previewItem?.fileName}
        open={Boolean(previewItem)}
        centered
        onCancel={() => setPreviewItem(null)}
        footer={
          previewItem ? (
            <a href={fileUrl(previewItem)} download>
              <Button icon={<DownloadOutlined />}>{t("下载")}</Button>
            </a>
          ) : null
        }
        width={kind === "none" ? 420 : kind === "excel" ? 1080 : kind === "pdf" ? 1000 : 800}
        destroyOnHidden
      >
        {previewItem ? (
          kind === "image" ? (
            <Image src={fileUrl(previewItem)} alt={previewItem.fileName} className={styles.previewImage} preview={false} />
          ) : kind === "pdf" ? (
            // navpanes=0 关掉浏览器阅读器左侧的缩略图栏（窄窗口里它要占掉一半宽度），
            // view=FitH 让正文按窗口宽度铺满，不然默认缩到 40% 左右根本看不清
            <iframe
              src={`${fileUrl(previewItem)}#navpanes=0&view=FitH`}
              title={previewItem.fileName}
              className={styles.previewFrame}
            />
          ) : kind === "excel" ? (
            parsing ? (
              <div className={styles.previewFallback}><Spin /> {t("正在解析表格…")}</div>
            ) : sheetError ? (
              <div className={styles.previewFallback}>{sheetError}</div>
            ) : sheets?.length ? (
              <div className={styles.sheetWrap}>
                {/* 多个工作表时给一排切换按钮；只有一张就不占位置 */}
                {sheets.length > 1 ? (
                  <div className={styles.sheetTabs}>
                    {sheets.map((sheet, index) => (
                      <button
                        key={sheet.name}
                        type="button"
                        className={index === sheetIndex ? `${styles.sheetTab} ${styles.sheetTabActive}` : styles.sheetTab}
                        onClick={() => setSheetIndex(index)}
                      >
                        {sheet.name}
                      </button>
                    ))}
                  </div>
                ) : null}
                <div className={styles.sheetScroll}>
                  <table className={styles.sheetTable}>
                    <tbody>
                      {(sheets[sheetIndex]?.rows ?? []).map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          {/* 左侧行号 + 第一行当表头，跟 Excel 里看到的对得上 */}
                          <th className={styles.rowHead}>{rowIndex + 1}</th>
                          {row.map((cell, cellIndex) => (
                            <td key={cellIndex} title={cell}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className={styles.sheetMeta}>
                  {t("{rows} 行 × {cols} 列", {
                    rows: sheets[sheetIndex]?.rows.length ?? 0,
                    cols: sheets[sheetIndex]?.rows[0]?.length ?? 0,
                  })}
                </div>
              </div>
            ) : (
              <div className={styles.previewFallback}>{t("这个表格是空的")}</div>
            )
          ) : (
            <div className={styles.previewFallback}>{t("该文件类型暂不支持预览，请下载后查看")}</div>
          )
        ) : null}
      </Modal>
    </div>
  );
}
