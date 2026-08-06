"use client";

import { DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from "@ant-design/icons";
import { Alert, App, Button, Empty, Form, Input, InputNumber, Modal, Segmented, Switch, Table, Tag, Tooltip, type TableProps } from "antd";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/client-fetch";
import { DICT_TYPES, type DictItem, type DictMap, type DictType } from "@/lib/dicts";
import { useLocale } from "./providers";
import styles from "./admin-pages.module.css";

// 标签配置：客户分类、产品大类、行业等下拉选项在这里维护。
// 新增一项后，对应业务表单的下拉框立即多一个选项，无需改代码。
export function DictAdmin() {
  const { t } = useLocale();
  const { message, modal } = App.useApp();
  const [form] = Form.useForm();
  const [type, setType] = useState<DictType>(DICT_TYPES[0].type);
  const [dicts, setDicts] = useState<DictMap>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<DictItem | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [initialValues, setInitialValues] = useState<Record<string, unknown>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // 管理页要看到停用项，并需要引用数来判断能否删除
      const response = await apiFetch("/api/dicts?includeInactive=1&withUsage=1");
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "标签加载失败");
      setDicts(payload.data);
    } catch (error) {
      message.error(t(error instanceof Error ? error.message : "标签加载失败"));
    } finally {
      setLoading(false);
    }
  }, [message, t]);

  useEffect(() => { void load(); }, [load]);

  const rows = dicts[type] || [];
  const currentType = DICT_TYPES.find((item) => item.type === type);

  const openCreate = () => {
    setEditing(null);
    // 排序号按 10 递增预填，方便日后在两项之间插入新选项
    const nextSort = rows.length ? Math.max(...rows.map((row) => row.sortOrder)) + 10 : 10;
    setInitialValues({ status: "active", sortOrder: nextSort });
    setModalOpen(true);
  };

  const openEdit = (row: DictItem) => {
    setEditing(row);
    // 启停由列表里的开关直接控制，弹窗只管名称 / 选项值 / 排序
    setInitialValues({ code: row.code, label: row.label, labelEn: row.labelEn, labelKo: row.labelKo, sortOrder: row.sortOrder });
    setModalOpen(true);
  };

  // 启停是可逆操作，开关点了就生效，不再弹确认框
  const toggleStatus = async (row: DictItem, checked: boolean) => {
    setTogglingId(row.id);
    try {
      const response = await apiFetch(`/api/dicts/${row.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: row.label,
          labelEn: row.labelEn,
          labelKo: row.labelKo,
          sortOrder: row.sortOrder,
          status: checked ? "active" : "inactive",
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "保存失败");
      // 停用只影响新建时的下拉框，已经用了这个标签的历史数据照常显示
      message.success(
        checked
          ? t("标签「{label}」已启用", { label: row.label })
          : (row.usageCount ?? 0) > 0
            ? t("标签「{label}」已停用，新建时不再出现；已有 {n} 条数据仍显示该标签", { label: row.label, n: row.usageCount ?? 0 })
            : t("标签「{label}」已停用，新建时不再出现在下拉框中", { label: row.label }),
      );
      await load();
    } catch (error) {
      message.error(t(error instanceof Error ? error.message : "保存失败"));
    } finally {
      setTogglingId(null);
    }
  };

  const save = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      // 状态不在表单里：编辑时沿用当前值，新增时默认启用
      const payloadValues = { ...values, status: editing ? editing.status : "active" };
      const response = await apiFetch(editing ? `/api/dicts/${editing.id}` : "/api/dicts", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editing ? payloadValues : { ...payloadValues, type }),
      });
      const payload = await response.json();
      if (!response.ok) {
        if (payload.error?.fields) {
          form.setFields(Object.entries(payload.error.fields).map(([name, errors]) => ({ name, errors: [t(String(errors))] })));
        }
        throw new Error(payload.error?.message || "保存失败");
      }
      message.success(editing ? t("标签已更新") : t("标签已新增"));
      setModalOpen(false);
      await load();
    } catch (error) {
      if (error instanceof Error && error.message) message.error(t(error.message));
    } finally {
      setSaving(false);
    }
  };

  const remove = (row: DictItem) => {
    const inUse = (row.usageCount ?? 0) > 0;
    modal.confirm({
      title: inUse ? t("确认停用标签「{label}」？", { label: row.label }) : t("确认删除标签「{label}」？", { label: row.label }),
      content: inUse
        ? t("该标签已被 {n} 条数据引用，将改为停用：历史数据仍显示原标签，但新建时不再出现在下拉框中。", { n: row.usageCount ?? 0 })
        : t("该标签尚未被任何数据引用，将直接删除。"),
      okText: inUse ? t("确认停用") : t("确认删除"),
      okButtonProps: { danger: true },
      cancelText: t("取消"),
      onOk: async () => {
        try {
          const response = await apiFetch(`/api/dicts/${row.id}`, { method: "DELETE" });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error?.message || "删除失败");
          message.success(payload.data.disabled ? t("标签已停用") : t("标签已删除"));
          await load();
        } catch (error) {
          message.error(t(error instanceof Error ? error.message : "删除失败"));
        }
      },
    });
  };

  const columns: TableProps<DictItem>["columns"] = [
    { title: t("中文名称"), dataIndex: "label", width: 150, render: (value) => <strong>{value}</strong> },
    { title: "English", dataIndex: "labelEn", width: 160, render: (value) => value || <span className={styles.counts}>-</span> },
    { title: "한국어", dataIndex: "labelKo", width: 140, render: (value) => value || <span className={styles.counts}>-</span> },
    { title: t("选项值"), dataIndex: "code", width: 130, render: (value) => <Tag>{value}</Tag> },
    {
      // 排序号只决定这一项在业务下拉框里的先后位置，和业务含义无关
      title: <Tooltip title={t("数字越小越靠前，决定该选项在下拉框里的位置")}><span>{t("排序")}</span></Tooltip>,
      dataIndex: "sortOrder",
      width: 70,
      align: "right",
    },
    { title: t("引用"), dataIndex: "usageCount", width: 80, align: "right", render: (value) => <span className={styles.counts}>{t("{n} 条", { n: value ?? 0 })}</span> },
    {
      title: t("启用"),
      dataIndex: "status",
      width: 80,
      render: (value, row) => (
        <Switch
          size="small"
          checked={value === "active"}
          loading={togglingId === row.id}
          onChange={(checked) => void toggleStatus(row, checked)}
        />
      ),
    },
    {
      title: t("操作"),
      key: "actions",
      fixed: "right",
      width: 90,
      render: (_, row) => (
        <div className={styles.rowActions}>
          <Tooltip title={t("编辑")}><Button type="text" size="small" icon={<EditOutlined />} aria-label={t("编辑")} onClick={() => openEdit(row)} /></Tooltip>
          <Tooltip title={(row.usageCount ?? 0) > 0 ? t("停用") : t("删除")}>
            <Button danger type="text" size="small" icon={<DeleteOutlined />} aria-label={t("删除")} onClick={() => remove(row)} />
          </Tooltip>
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className={styles.header}>
        <div className={styles.titleGroup}>
          <h1 className={styles.title}>{t("标签配置")}</h1>
          <span className={styles.total}>{t("{n} 条", { n: rows.length })}</span>
        </div>
        <div className={styles.headerActions}>
          <Tooltip title={t("刷新")}><Button icon={<ReloadOutlined />} aria-label={t("刷新")} onClick={() => void load()} /></Tooltip>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>{t("新增标签")}</Button>
        </div>
      </div>
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        title={t("这里维护的是各业务表单里下拉框的可选项。新增一项后，对应表单的下拉框立即多出该选项。")}
      />
      <div className={styles.toolbar}>
        <Segmented
          value={type}
          onChange={(value) => setType(value as DictType)}
          options={DICT_TYPES.map((item) => ({ label: `${t(item.label)}（${(dicts[item.type] || []).length}）`, value: item.type }))}
        />
      </div>
      {currentType ? <p className={styles.counts} style={{ margin: "0 0 12px" }}>{t("示例")}：{t(currentType.hint)}</p> : null}
      <section className={styles.tableFrame}>
        <Table<DictItem>
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={rows}
          pagination={rows.length > 10 ? { pageSize: 10, showSizeChanger: false, showTotal: (value) => t("共 {n} 条", { n: value }) } : false}
          scroll={{ x: 900 }}
          locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("暂无标签")}><Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>{t("新增标签")}</Button></Empty> }}
        />
      </section>
      <Modal
        centered
        title={editing ? t("编辑标签") : t("新增标签")}
        open={modalOpen}
        okText={t("保存")}
        cancelText={t("取消")}
        confirmLoading={saving}
        onOk={() => void save()}
        onCancel={() => setModalOpen(false)}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark="optional" preserve={false} initialValues={initialValues}>
          <div className={styles.formGrid}>
            <Form.Item name="label" label={t("中文名称")} rules={[{ required: true, message: t("请输入中文名称") }]}>
              <Input placeholder={t("下拉框里显示的名称")} />
            </Form.Item>
            <Form.Item
              name="code"
              label={t("选项值")}
              tooltip={t("存进数据库的值，建后不可修改。可用英文或直接用中文，不能包含空格。")}
              rules={[{ required: true, message: t("请输入选项值") }, { pattern: /^\S+$/, message: t("选项值不能包含空格") }]}
            >
              <Input placeholder="factory" disabled={Boolean(editing)} />
            </Form.Item>
            <Form.Item name="labelEn" label="English"><Input placeholder={t("留空则回退中文")} /></Form.Item>
            <Form.Item name="labelKo" label="한국어"><Input placeholder={t("留空则回退中文")} /></Form.Item>
            <Form.Item name="sortOrder" label={t("排序")} tooltip={t("数字越小越靠前，决定该选项在下拉框里的位置")}>
              <InputNumber style={{ width: "100%" }} min={0} max={9999} precision={0} />
            </Form.Item>
          </div>
        </Form>
      </Modal>
    </div>
  );
}
