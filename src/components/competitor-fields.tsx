"use client";

import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Form, Input, Tooltip } from "antd";
import { useLocale } from "./providers";
import styles from "./competitor-fields.module.css";

/** 表单里的竞品对标牌号；id 是库里已有记录的主键，新增行不带 */
export type CompetitorValue = {
  id?: number;
  grade?: string;
  manufacturer?: string;
  notes?: string;
};

export const MAX_COMPETITORS = 100;

/**
 * 竞争对手对标型号：一个自家牌号可能对上几十个竞品（如「CJS700 / 广州石化」），
 * 所以按表格式一行一条排布，列头只出一次，列表内部滚动。
 */
export function CompetitorsField({ name, label }: { name: string; label: string }) {
  const { t } = useLocale();

  return (
    <Form.List name={name}>
      {(fields, { add, remove }) => (
        <div className={styles.list}>
          <div className={styles.sectionHead}>
            <span className={styles.sectionTitle}>
              {label}
              {fields.length ? <span className={styles.count}>{t("共 {n} 条", { n: fields.length })}</span> : null}
            </span>
          </div>
          {fields.length === 0 ? (
            <div className={styles.empty}>{t("暂无竞争型号")}</div>
          ) : (
            <div className={styles.rows}>
              <div className={`${styles.row} ${styles.head}`}>
                <span />
                <span className={`${styles.headCell} ${styles.required}`}>{t("竞争型号")}</span>
                <span className={styles.headCell}>{t("生产商")}</span>
                <span className={`${styles.headCell} ${styles.notes}`}>{t("备注")}</span>
                <span />
              </div>
              {fields.map((field, index) => (
                <div key={field.key} className={styles.row}>
                  <span className={styles.index}>{index + 1}</span>
                  {/* 已有记录的 id 必须显式注册，否则后端会当成新记录，导致旧行被删掉重建 */}
                  <Form.Item name={[field.name, "id"]} hidden>
                    <Input type="hidden" />
                  </Form.Item>
                  <Form.Item
                    name={[field.name, "grade"]}
                    rules={[{ required: true, message: t("竞争型号不能为空") }]}
                  >
                    <Input placeholder={t("如 CJS700")} maxLength={120} />
                  </Form.Item>
                  <Form.Item name={[field.name, "manufacturer"]}>
                    <Input placeholder={t("如 广州石化")} maxLength={160} />
                  </Form.Item>
                  <Form.Item name={[field.name, "notes"]} className={styles.notes}>
                    <Input placeholder={t("对比说明（可选）")} maxLength={500} />
                  </Form.Item>
                  <Tooltip title={t("删除")}>
                    <Button
                      className={styles.remove}
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      aria-label={t("删除")}
                      onClick={() => remove(field.name)}
                    />
                  </Tooltip>
                </div>
              ))}
            </div>
          )}
          <Button
            type="dashed"
            icon={<PlusOutlined />}
            disabled={fields.length >= MAX_COMPETITORS}
            onClick={() => add({ grade: "", manufacturer: "", notes: "" })}
            block
          >
            {t("添加竞争型号")}
          </Button>
        </div>
      )}
    </Form.List>
  );
}
