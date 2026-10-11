"use client";

import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Form, Input, Select } from "antd";
import { useLocale } from "./providers";
import styles from "./customer-material-fields.module.css";

export type MaterialProductOption = {
  id: number; className?: string; grade?: string; brand?: string; status?: string;
  competitors?: Array<{ id: number; grade: string; manufacturer: string }>;
};

function MaterialRow({ index, products, remove }: { index: number; products: MaterialProductOption[]; remove: () => void }) {
  const form = Form.useFormInstance();
  const { t } = useLocale();
  const productId = Form.useWatch(["materials", index, "productId"], form);
  const product = products.find((item) => item.id === productId);
  return <div className={styles.card}>
    <div className={styles.cardHeader}>
      <span>{t("使用产品 {n}", { n: index + 1 })}</span>
      <Button danger type="text" size="small" icon={<DeleteOutlined />} onClick={remove}>{t("移除关联")}</Button>
    </div>
    <Form.Item name={[index, "productId"]} layout="vertical" label={t("产品型号")} rules={[{ required: true, message: t("请选择使用产品") }]}>
      <Select showSearch optionFilterProp="label" placeholder={t("请选择使用产品")}
        options={products.map((item) => ({ value: item.id, label: [item.className, item.grade, item.brand].filter(Boolean).join(" / "), disabled: item.status === "inactive" && item.id !== productId }))}
        onChange={() => form.setFieldValue(["materials", index, "competitorIds"], [])} />
    </Form.Item>
    <Form.Item name={[index, "competitorIds"]} layout="vertical" label={t("客户使用的竞品")}>
      <Select mode="multiple" allowClear showSearch optionFilterProp="label" disabled={!productId}
        placeholder={t("选择该客户实际使用的竞品，可多选")}
        options={(product?.competitors || []).map((item) => ({ value: item.id, label: [item.grade, item.manufacturer].filter(Boolean).join(" / ") }))} />
    </Form.Item>
  </div>;
}

export function CustomerMaterialFields({ products }: { products: MaterialProductOption[] }) {
  const { t } = useLocale();
  return <section className={styles.section}>
    <Form.List name="materials">{(fields, { add, remove }) => <>
      <div className={styles.sectionHeader}>
        <h3>{t("使用产品与竞争对手")}</h3>
        <Button icon={<PlusOutlined />} disabled={fields.length >= 100} onClick={() => add({ competitorIds: [] })}>{t("关联产品")}</Button>
      </div>
      <p className={styles.hint}>{t("选择产品后，关联客户实际使用的竞品牌号。")}</p>
      <div className={styles.cards}>
        {fields.map((field) => <MaterialRow key={field.key} index={field.name} products={products} remove={() => remove(field.name)} />)}
        {!fields.length && <div className={styles.empty}>{t("暂无关联产品，点击右上角添加")}</div>}
      </div>
      <p className={styles.footnote}>{t("找不到型号？请先在「产品型号」中维护产品和竞品。")}</p>
    </>}</Form.List>
    <div className={styles.supplement}>
      <Form.Item name="materialModels" label={t("补充型号")} layout="vertical">
        <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} maxLength={2000} showCount placeholder={t("未登记的型号可填在这里，多个型号用逗号分隔")} />
      </Form.Item>
    </div>
  </section>;
}
