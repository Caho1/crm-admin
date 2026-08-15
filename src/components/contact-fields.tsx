"use client";

import { DeleteOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import { App, Button, Form, Image, Input, Upload } from "antd";
import type React from "react";
import { useLocale } from "./providers";
import styles from "./contact-fields.module.css";

/** 表单里的联系人：cardFront / cardBack 是三态（不传=保持原图、""=删除、data URL=换新图） */
export type ContactValue = {
  id?: number;
  name?: string;
  nameEn?: string;
  title?: string;
  phone?: string;
  email?: string;
  personality?: string;
  cardFront?: string | null;
  cardBack?: string | null;
  /** 已存图片的读取地址，仅用于回显，提交时会被后端 schema 丢弃 */
  cardFrontUrl?: string;
  cardBackUrl?: string;
};

export const MAX_CONTACTS = 50;

/** 联系人字段一律「标签在左、输入框在右」，比纵向排布省一半高度；
 *  标签列宽与「基本信息」保持一致（118px），两个分区的输入框才会左右对齐 */
const INLINE_LAYOUT = { layout: "horizontal" as const, labelCol: { flex: "118px" }, wrapperCol: { flex: "auto" } };

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/** 名片是手机拍的照片，先压到长边 1600px 的 JPEG 再随表单提交，避免几 MB 的原图进库 */
async function toCompressedDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("名片图片处理失败");
  // 透明底的 PNG 转 JPEG 会变黑，先铺一层白底
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.82);
}

function CardUpload({
  value,
  onChange,
  existingUrl,
  label,
}: {
  value?: string | null;
  onChange?: (next: string | null) => void;
  existingUrl?: string;
  label: string;
}) {
  const { t } = useLocale();
  const { message } = App.useApp();
  // value 为 undefined 表示没动过，回显库里已有的图；置空过就什么都不显示
  const preview = typeof value === "string" && value.startsWith("data:") ? value : value === undefined ? existingUrl : undefined;

  const pick = async (file: File) => {
    if (file.size > 20 * 1024 * 1024) {
      message.error(t("名片图片不能超过 20MB"));
      return;
    }
    try {
      // 常见格式（png / jpg / webp / gif / bmp…）都能解码，统一压成 JPEG 进库；
      // 浏览器解不了的（如 iPhone 的 HEIC）就按原文件存，只要不超过 4MB
      onChange?.(await toCompressedDataUrl(file));
    } catch {
      try {
        const raw = await readAsDataUrl(file);
        if (!raw.startsWith("data:image/")) throw new Error("not an image");
        if (file.size > 4 * 1024 * 1024) {
          message.error(t("这张名片无法压缩，请换成 4MB 以内的图片"));
          return;
        }
        onChange?.(raw);
      } catch {
        message.error(t("名片图片处理失败，请换一张图片"));
      }
    }
  };

  const upload = (children: React.ReactNode) => (
    <Upload
      // 有些系统里 HEIC / TIFF 的 MIME 是空的，会被 image/* 挡在选择框外，按扩展名一并放行
      accept="image/*,.heic,.heif,.tif,.tiff"
      showUploadList={false}
      beforeUpload={(file) => {
        void pick(file as File);
        return false;
      }}
    >
      {children}
    </Upload>
  );

  return (
    <div className={styles.card}>
      <div className={styles.cardLabel}>{label}</div>
      {/* 空位本身就是上传区，不再单独摆一个上传按钮；已有图时鼠标移上去出更换 / 删除 */}
      {preview ? (
        <div className={styles.cardPreview}>
          <Image src={preview} alt={label} className={styles.cardImage} width={116} height={72} />
          <div className={styles.cardHover}>
            {upload(
              <button type="button" className={styles.cardHoverAction} title={t("更换")}>
                <UploadOutlined />
              </button>,
            )}
            <button
              type="button"
              className={styles.cardHoverAction}
              title={t("删除")}
              onClick={() => onChange?.("")}
            >
              <DeleteOutlined />
            </button>
          </div>
        </div>
      ) : (
        upload(
          <button type="button" className={styles.cardDropzone}>
            <PlusOutlined />
            <span>{t("上传")}</span>
          </button>,
        )
      )}
    </div>
  );
}

/**
 * 客户联系人列表：数量不固定（实际能到二十几位），逐条增删，
 * 每条含中英文姓名、职位、电话、邮箱、性格爱好与名片正反面。
 */
export function ContactsField({ name, label }: { name: string; label: string }) {
  const { t } = useLocale();
  const form = Form.useFormInstance();

  return (
    <Form.List name={name}>
      {(fields, { add, remove }) => (
        <div className={styles.list}>
          {/* 分区标题与「基本信息」同级；第一条联系人直接接在标题下，删除按钮跟在标题行右侧 */}
          <div className={styles.sectionHead}>
            <span className={styles.sectionTitle}>{label}</span>
            {fields.length ? (
              <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => remove(fields[0].name)}>
                {t("删除")}
              </Button>
            ) : null}
          </div>
          {fields.length === 0 ? <div className={styles.empty}>{t("暂无联系人")}</div> : null}
          {fields.map((field, index) => {
            const existing = (form.getFieldValue([name, field.name]) || {}) as ContactValue;
            return (
              <div key={field.key} className={styles.item}>
                {index > 0 ? (
                  <div className={styles.itemHeader}>
                    <span className={styles.itemTitle}>{t("联系人 {n}", { n: index + 1 })}</span>
                    <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => remove(field.name)}>
                      {t("删除")}
                    </Button>
                  </div>
                ) : null}
                <div className={styles.itemGrid}>
                  {/* 提交时只会带上「注册过」的字段，已有联系人的 id 必须显式注册，
                      否则后端会当成新联系人，导致旧记录连同名片一起被删掉重建 */}
                  <Form.Item name={[field.name, "id"]} hidden>
                    <Input type="hidden" />
                  </Form.Item>
                  {/* 联系人可能有二十几位，标签与输入框同行排布，尽量压低每条的高度 */}
                  <Form.Item
                    {...INLINE_LAYOUT}
                    name={[field.name, "name"]}
                    label={t("姓名")}
                    rules={[{ required: true, message: t("联系人姓名不能为空") }]}
                  >
                    <Input placeholder={t("请输入姓名")} />
                  </Form.Item>
                  <Form.Item {...INLINE_LAYOUT} name={[field.name, "nameEn"]} label={t("英文名")}>
                    <Input placeholder={t("请输入英文名")} />
                  </Form.Item>
                  <Form.Item {...INLINE_LAYOUT} name={[field.name, "title"]} label={t("职位")}>
                    <Input placeholder={t("请输入职位")} />
                  </Form.Item>
                  <Form.Item {...INLINE_LAYOUT} name={[field.name, "phone"]} label={t("联系电话")}>
                    <Input placeholder={t("请输入联系电话")} />
                  </Form.Item>
                  <Form.Item
                    {...INLINE_LAYOUT}
                    name={[field.name, "email"]}
                    label={t("邮箱")}
                    rules={[{ type: "email", message: t("邮箱格式不正确") }]}
                  >
                    <Input placeholder={t("请输入邮箱")} />
                  </Form.Item>
                  <Form.Item {...INLINE_LAYOUT} name={[field.name, "personality"]} label={t("性格爱好")} className={styles.full}>
                    <Input.TextArea rows={2} maxLength={1000} placeholder={t("性格特点、兴趣爱好、沟通偏好等")} />
                  </Form.Item>
                  <div className={`${styles.cardsRow} ${styles.full}`}>
                    <div className={styles.cardsLabel}>{t("名片")}</div>
                    <div className={styles.cards}>
                      <Form.Item name={[field.name, "cardFront"]} noStyle>
                        <CardUpload label={t("正面")} existingUrl={existing.cardFrontUrl} />
                      </Form.Item>
                      <Form.Item name={[field.name, "cardBack"]} noStyle>
                        <CardUpload label={t("反面")} existingUrl={existing.cardBackUrl} />
                      </Form.Item>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          <Button
            type="dashed"
            icon={<PlusOutlined />}
            disabled={fields.length >= MAX_CONTACTS}
            onClick={() => add({ name: "", nameEn: "", title: "", phone: "", email: "", personality: "" })}
            block
          >
            {t("添加联系人")}
          </Button>
        </div>
      )}
    </Form.List>
  );
}
