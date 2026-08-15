"use client";

import { App, DatePicker, Form, Input, InputNumber, Modal, Select, Skeleton } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TranslateVars } from "@/lib/i18n";
import { apiFetch } from "@/lib/client-fetch";
import { dictLabel, type DictMap, type DictType } from "@/lib/dicts";
import { CompetitorsField } from "./competitor-fields";
import { ContactsField, type ContactValue } from "./contact-fields";
import { useLocale } from "./providers";
import { useCurrentUser } from "./user-context";
import styles from "./resource-page.module.css";

export type TFn = (text: string, vars?: TranslateVars) => string;
export type Option = { label: string; value: string | number };
export type LookupItem = { id: number; name?: string; label?: string; className?: string; grade?: string; role?: string; status?: string };
/** industries：客户表里实际录入过的行业（去重），供列表筛选下拉用，不是标签字典 */
export type Lookups = { customers: LookupItem[]; products: LookupItem[]; users: LookupItem[]; dicts: DictMap; industries: string[] };
export type FieldType = "input" | "textarea" | "select" | "multi" | "date" | "month" | "number" | "contacts" | "competitors" | "section";
export type Field = {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  full?: boolean;
  adminOnly?: boolean;
  source?: "customers" | "products" | "users";
  /** 取「设置 → 标签配置」里维护的下拉选项 */
  dictType?: DictType;
  options?: Option[];
  placeholder?: string;
  rows?: number;
  min?: number;
  precision?: number;
  maxLength?: number;
};

export const emptyLookups: Lookups = { customers: [], products: [], users: [], dicts: {}, industries: [] };

export function optionsFor(field: Field, lookups: Lookups, t: TFn, editing: boolean, locale: string): Option[] {
  if (field.options) return field.options;
  // 标签字典驱动的下拉：选项来自「设置 → 标签配置」，存 code、显示当前语言的 label
  if (field.dictType) {
    return (lookups.dicts?.[field.dictType] || []).map((item) => ({
      value: item.code,
      label: dictLabel(item, locale),
    }));
  }
  let source = field.source ? lookups[field.source] : [];
  // 新建时只能选启用中的产品；编辑历史单据时已停用产品仍要能回显（标注「已停用」）
  if (field.source === "products" && !editing) source = source.filter((item) => item.status !== "inactive");
  return source.map((item) => ({
    value: item.id,
    label:
      (item.label || item.name || `${item.className} / ${item.grade}`) +
      (item.status === "inactive" ? `（${t("已停用")}）` : ""),
  }));
}

/** 字段配置渲染成 Form.Item，列表页与客户详情页共用同一套控件与校验 */
export function ResourceFormFields({ fields, lookups, editing }: { fields: Field[]; lookups: Lookups; editing: boolean }) {
  const { t, locale } = useLocale();
  const user = useCurrentUser();

  const renderField = (field: Field) => {
    // 分区标题：把「基本信息」「联系人」这样的大块隔开
    if (field.type === "section") {
      return <div key={field.name} className={`${styles.fieldFull} ${styles.sectionTitle}`}>{field.label}</div>;
    }
    // 联系人是一组可增删的子表单，不走单控件那套渲染；
    // 分区标题由 ContactsField 自己出（第一条不再重复标题，第二条起才带序号）
    if (field.type === "contacts") {
      return (
        <div key={field.name} className={styles.fieldFull}>
          <ContactsField name={field.name} label={field.label} />
        </div>
      );
    }
    // 竞争型号同样是可增删的子表单，分区标题由 CompetitorsField 自己出
    if (field.type === "competitors") {
      return (
        <div key={field.name} className={styles.fieldFull}>
          <CompetitorsField name={field.name} label={field.label} />
        </div>
      );
    }
    const commonSelectProps = {
      showSearch: true,
      allowClear: !field.required,
      optionFilterProp: "label" as const,
      options: optionsFor(field, lookups, t, editing, locale),
      placeholder: field.placeholder || t("请选择{label}", { label: field.label }),
    };
    let control: React.ReactNode;
    if (field.type === "textarea") control = <Input.TextArea rows={field.rows || 3} placeholder={field.placeholder || t("请输入{label}", { label: field.label })} showCount maxLength={field.maxLength || 2000} />;
    else if (field.type === "select") control = <Select {...commonSelectProps} />;
    else if (field.type === "multi") control = <Select {...commonSelectProps} mode="multiple" maxTagCount="responsive" />;
    else if (field.type === "date") control = <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />;
    else if (field.type === "month") control = <DatePicker style={{ width: "100%" }} picker="month" format="YYYY-MM" />;
    else if (field.type === "number") control = <InputNumber style={{ width: "100%" }} min={field.min} precision={field.precision} placeholder={t("请输入{label}", { label: field.label })} />;
    else control = <Input placeholder={field.placeholder || t("请输入{label}", { label: field.label })} />;
    return (
      <Form.Item
        key={field.name}
        // 标签在左、控件在右，和联系人子表单保持一致，也省一半纵向空间
        layout="horizontal"
        labelCol={{ flex: "118px" }}
        wrapperCol={{ flex: "auto" }}
        className={field.full ? styles.fieldFull : undefined}
        name={field.name}
        label={field.label}
        rules={field.required ? [{ required: true, message: t("{label}不能为空", { label: field.label }) }] : undefined}
      >
        {control}
      </Form.Item>
    );
  };

  return <div className={styles.formGrid}>{fields.filter((field) => !field.adminOnly || user.role === "admin").map(renderField)}</div>;
}

/**
 * 弹窗表单的 form 实例是跨记录复用的，上一条记录的值会留在 store 里。
 * 以前靠 preserve={false} 清，但那会把 Form.List（联系人）的初始值一并清掉，
 * 改为在表单内部挂载时按最新 initialValues 重置一次（挂在 Form 里才保证实例已连接）。
 */
export function FormValuesReset({ values }: { values: unknown }) {
  const form = Form.useFormInstance();
  useEffect(() => {
    form.resetFields();
  }, [form, values]);
  return null;
}

export function customerStatusOptions(t: TFn): Option[] {
  return [
    { label: t("潜在客户"), value: "potential" },
    { label: t("活跃客户"), value: "active" },
    { label: t("已停用"), value: "inactive" },
  ];
}

export function buildCustomerFields(t: TFn): Field[] {
  return [
    { name: "__basic", label: t("基本信息"), type: "section" },
    { name: "name", label: t("客户名称"), type: "input", required: true, full: true },
    { name: "nameEn", label: t("英文名称"), type: "input", full: true, placeholder: t("完整英文名称，便于按英文模糊查找") },
    { name: "shortName", label: t("客户简称"), type: "input", full: true, placeholder: t("日常沟通用的简称，搜索时同样可按简称查找") },
    { name: "category", label: t("客户分类"), type: "select", dictType: "customer_category" },
    { name: "status", label: t("客户状态"), type: "select", required: true, options: customerStatusOptions(t) },
    // 行业按客户实际说法手填，不走标签配置：口径太细，穷举成下拉反而卡住录入
    { name: "industry", label: t("行业"), type: "input", placeholder: t("如 注塑加工、家电制造") },
    { name: "ownerId", label: t("负责人"), type: "select", source: "users", adminOnly: true },
    { name: "country", label: t("国家"), type: "input" },
    { name: "region", label: t("地区"), type: "input" },
    { name: "memberIds", label: t("协作成员"), type: "multi", source: "users", adminOnly: true },
    { name: "address", label: t("详细地址"), type: "input", full: true, placeholder: t("详细到街道门牌，搜索时可按地址关键词查找") },
    { name: "description", label: t("客户简介"), type: "textarea", rows: 3, full: true, maxLength: 2000 },
    { name: "contacts", label: t("联系人"), type: "contacts", full: true },
  ];
}

/** 客户详情接口的返回值摊平成编辑表单的初始值 */
export function customerFormValues(detail: {
  customer: Record<string, unknown>;
  contacts?: Array<Record<string, unknown>>;
  members?: Array<{ id: number }>;
}): Record<string, unknown> {
  const customerId = detail.customer?.id;
  // 名片图片不随详情下发，表单只拿到读取地址用于回显；updatedAt 当版本号，换图后不吃旧缓存
  const version = encodeURIComponent(String(detail.customer?.updatedAt || ""));
  const cardUrl = (contactId: unknown, side: "front" | "back") =>
    `/api/customers/${customerId}/contacts/${contactId}/card?side=${side}&v=${version}`;
  return {
    ...detail.customer,
    memberIds: (detail.members || []).map((item) => item.id),
    contacts: (detail.contacts || []).map((contact): ContactValue => ({
      id: Number(contact.id),
      name: String(contact.name || ""),
      nameEn: String(contact.nameEn || ""),
      title: String(contact.title || ""),
      phone: String(contact.phone || ""),
      email: String(contact.email || ""),
      personality: String(contact.personality || ""),
      cardFrontUrl: contact.hasCardFront ? cardUrl(contact.id, "front") : undefined,
      cardBackUrl: contact.hasCardBack ? cardUrl(contact.id, "back") : undefined,
    })),
  };
}

/**
 * 客户详情页就地编辑：和客户列表页用的是同一套字段配置与保存接口，
 * 详情页不再跳回列表页开弹窗。
 */
export function CustomerEditModal({
  customerId,
  open,
  onClose,
  onSaved,
}: {
  customerId: number;
  open: boolean;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { t } = useLocale();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const fields = useMemo(() => buildCustomerFields(t), [t]);
  const [lookups, setLookups] = useState<Lookups>(emptyLookups);
  const [initialValues, setInitialValues] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);
  // 回调由父组件内联传入，放 ref 里避免作为 effect 依赖反复触发加载
  const callbacks = useRef({ onClose, onSaved });
  useEffect(() => {
    callbacks.current = { onClose, onSaved };
  });

  // 每次打开都重新拉一遍详情，保证编辑的是最新数据
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setInitialValues(null);
    (async () => {
      try {
        const [lookupResponse, detailResponse] = await Promise.all([
          apiFetch("/api/lookups"),
          apiFetch(`/api/customers/${customerId}`),
        ]);
        const lookupPayload = await lookupResponse.json();
        const detailPayload = await detailResponse.json();
        if (cancelled) return;
        if (!detailResponse.ok) throw new Error(detailPayload.error?.message || "客户详情加载失败");
        if (lookupResponse.ok) setLookups(lookupPayload.data);
        setInitialValues(customerFormValues(detailPayload.data));
      } catch (error) {
        if (cancelled) return;
        message.error(t(error instanceof Error ? error.message : "客户详情加载失败"));
        callbacks.current.onClose();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [customerId, message, open, t]);

  const submit = useCallback(async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      const response = await apiFetch(`/api/customers/${customerId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.error?.fields) {
          form.setFields(Object.entries(result.error.fields).map(([name, errors]) => ({ name, errors: [t(String(errors))] })));
        }
        throw new Error(result.error?.message || "保存失败");
      }
      message.success(t("保存成功"));
      callbacks.current.onSaved?.();
      callbacks.current.onClose();
    } catch (error) {
      if (error instanceof Error && error.message) message.error(t(error.message));
    } finally {
      setSaving(false);
    }
  }, [customerId, form, message, t]);

  return (
    <Modal
      title={t("编辑客户")}
      open={open}
      centered
      width={860}
      okText={t("保存")}
      cancelText={t("取消")}
      confirmLoading={saving}
      okButtonProps={{ disabled: !initialValues }}
      onOk={() => void submit()}
      onCancel={onClose}
      destroyOnHidden
      styles={{ body: { maxHeight: "calc(100vh - 190px)", overflowY: "auto", paddingRight: 4 } }}
    >
      {/* destroyOnHidden 保证每次打开重新挂载，initialValues 在首帧即生效，避免先空后填的闪烁。
          这里不能用 preserve={false}：它会把 Form.List（联系人）里的初始值清掉，
          重复打开时的残留值改由下面的 resetFields 处理 */}
      {initialValues ? (
        <Form form={form} layout="vertical" requiredMark={false} initialValues={initialValues}>
          <FormValuesReset values={initialValues} />
          <ResourceFormFields fields={fields} lookups={lookups} editing />
        </Form>
      ) : (
        <Skeleton active paragraph={{ rows: 8 }} />
      )}
    </Modal>
  );
}
