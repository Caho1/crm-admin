"use client";

import { App, DatePicker, Form, Input, InputNumber, Modal, Select, Skeleton } from "antd";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TranslateVars } from "@/lib/i18n";
import { apiFetch } from "@/lib/client-fetch";
import { dictLabel, type DictMap, type DictType } from "@/lib/dicts";
import { useLocale } from "./providers";
import { useCurrentUser } from "./user-context";
import styles from "./resource-page.module.css";

export type TFn = (text: string, vars?: TranslateVars) => string;
export type Option = { label: string; value: string | number };
export type LookupItem = { id: number; name?: string; label?: string; className?: string; grade?: string; role?: string; status?: string };
export type Lookups = { customers: LookupItem[]; products: LookupItem[]; users: LookupItem[]; dicts: DictMap };
export type FieldType = "input" | "textarea" | "select" | "multi" | "date" | "month" | "number";
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

export const emptyLookups: Lookups = { customers: [], products: [], users: [], dicts: {} };

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

export function customerStatusOptions(t: TFn): Option[] {
  return [
    { label: t("潜在客户"), value: "potential" },
    { label: t("活跃客户"), value: "active" },
    { label: t("已停用"), value: "inactive" },
  ];
}

export function buildCustomerFields(t: TFn): Field[] {
  return [
    { name: "name", label: t("客户名称（中文）"), type: "input", required: true, full: true },
    { name: "nameEn", label: t("客户名称（英文）"), type: "input", full: true, placeholder: t("完整英文名称，便于按英文模糊查找") },
    { name: "category", label: t("客户分类"), type: "select", dictType: "customer_category" },
    { name: "status", label: t("客户状态"), type: "select", required: true, options: customerStatusOptions(t) },
    { name: "industry", label: t("行业"), type: "select", dictType: "industry" },
    { name: "ownerId", label: t("负责人"), type: "select", source: "users", adminOnly: true },
    { name: "country", label: t("国家"), type: "input" },
    { name: "region", label: t("地区"), type: "input" },
    { name: "memberIds", label: t("协作成员"), type: "multi", source: "users", adminOnly: true },
    { name: "address", label: t("详细地址"), type: "input", full: true, placeholder: t("详细到街道门牌，搜索时可按地址关键词查找") },
    { name: "description", label: t("客户简介"), type: "textarea", rows: 3, full: true, maxLength: 2000 },
    { name: "contactName", label: t("主要联系人"), type: "input" },
    { name: "contactTitle", label: t("联系人职位"), type: "input" },
    { name: "contactPhone", label: t("联系电话"), type: "input" },
    { name: "contactEmail", label: t("联系邮箱"), type: "input" },
  ];
}

/** 客户详情接口的返回值摊平成编辑表单的初始值（主联系人取第一条） */
export function customerFormValues(detail: {
  customer: Record<string, unknown>;
  contacts?: Array<Record<string, unknown>>;
  members?: Array<{ id: number }>;
}): Record<string, unknown> {
  const firstContact = detail.contacts?.[0] || {};
  return {
    ...detail.customer,
    memberIds: (detail.members || []).map((item) => item.id),
    contactName: firstContact.name || "",
    contactTitle: firstContact.title || "",
    contactPhone: firstContact.phone || "",
    contactEmail: firstContact.email || "",
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
      {/* destroyOnHidden 保证每次打开重新挂载，initialValues 在首帧即生效，避免先空后填的闪烁 */}
      {initialValues ? (
        <Form form={form} layout="vertical" requiredMark="optional" preserve={false} initialValues={initialValues}>
          <ResourceFormFields fields={fields} lookups={lookups} editing />
        </Form>
      ) : (
        <Skeleton active paragraph={{ rows: 8 }} />
      )}
    </Modal>
  );
}
