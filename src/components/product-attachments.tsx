"use client";

import { DeleteOutlined, DownloadOutlined, PaperClipOutlined, UploadOutlined } from "@ant-design/icons";
import { App, Button, Image, Modal, Upload } from "antd";
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
function previewKind(item: AttachmentMeta): "image" | "pdf" | "none" {
  const mime = item.mimeType.toLowerCase();
  const ext = item.fileName.split(".").pop()?.toLowerCase() ?? "";
  if (mime.startsWith("image/") || ["png", "jpg", "jpeg", "gif", "webp", "bmp"].includes(ext)) return "image";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  return "none";
}

/**
 * 型号附件（RAPIDS / TDS / COA 等办公文档）：上传、下载、删除，点文件名弹窗预览
 * （图片 / PDF 直接内嵌；其他格式弹窗里给下载入口）。
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

  const fileUrl = (item: AttachmentMeta) => `/api/products/${productId}/attachments/${item.id}`;
  const kind = previewItem ? previewKind(previewItem) : "none";

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
        width={kind === "none" ? 420 : 800}
        destroyOnHidden
      >
        {previewItem ? (
          kind === "image" ? (
            <Image src={fileUrl(previewItem)} alt={previewItem.fileName} className={styles.previewImage} preview={false} />
          ) : kind === "pdf" ? (
            <iframe src={fileUrl(previewItem)} title={previewItem.fileName} className={styles.previewFrame} />
          ) : (
            <div className={styles.previewFallback}>{t("该文件类型暂不支持预览，请下载后查看")}</div>
          )
        ) : null}
      </Modal>
    </div>
  );
}
