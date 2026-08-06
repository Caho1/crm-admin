"use client";

import { Tag } from "antd";
import { useLocale } from "./providers";

const labels: Record<string, string> = {
  potential: "潜在客户",
  active: "进行中",
  inactive: "已停用",
  draft: "草稿",
  completed: "已完成",
  archived: "已归档",
  lead: "意向",
  sample: "样品",
  testing: "测试",
  quotation: "报价",
  order: "已成单",
  paused: "暂停",
  lost: "失败",
  closed: "已关闭",
  planned: "待确认",
  confirmed: "待出货",
  shipped: "已出货",
  arrived: "已到港",
  cancelled: "已取消",
  admin: "管理员",
  user: "普通用户",
  disabled: "已停用",
  create: "新建",
  update: "更新",
  delete: "删除",
  enable: "启用",
  disable: "停用",
  login: "登录",
  logout: "退出",
  import: "导入",
  handover: "交接",
  reset_password: "重置密码",
};

const colors: Record<string, string> = {
  potential: "gold",
  active: "green",
  inactive: "default",
  draft: "default",
  completed: "green",
  archived: "default",
  lead: "blue",
  sample: "cyan",
  testing: "gold",
  quotation: "orange",
  order: "green",
  paused: "default",
  lost: "red",
  closed: "default",
  planned: "default",
  confirmed: "gold",
  shipped: "blue",
  arrived: "green",
  cancelled: "red",
  admin: "blue",
  user: "green",
  disabled: "red",
  create: "green",
  update: "blue",
  delete: "red",
  enable: "green",
  disable: "orange",
  import: "purple",
  handover: "gold",
};

export function statusLabel(value: string | null | undefined) {
  if (!value) return "-";
  return labels[value] || value;
}

export function StatusTag({ value, label }: { value: string | null | undefined; label?: string }) {
  // 中文标签统一在这里过一次 t()，已翻译或未登记的文本原样返回
  const { t } = useLocale();
  if (!value) return <span>-</span>;
  return <Tag color={colors[value] || "default"}>{t(label || statusLabel(value))}</Tag>;
}
