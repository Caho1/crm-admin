"use client";

import { DeleteOutlined, EditOutlined, EyeOutlined, PaperClipOutlined, PlusOutlined, UploadOutlined } from "@ant-design/icons";
import { App, Button, DatePicker, Empty, Form, Input, Modal, Popconfirm, Select, Table, Tooltip, Upload, type TableProps, type UploadFile } from "antd";
import dayjs from "dayjs";
import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/client-fetch";
import { useLocale } from "./providers";
import { StatusTag } from "./status-tag";
import { VisitDetail } from "./visit-detail";
import resStyles from "./resource-page.module.css";
import styles from "./customer-profile.module.css";

type VisitRow = Record<string, unknown> & { id: number; canEdit?: number };
type ProductOption = { id: number; label: string; status: string };

const PAGE_SIZE = 10;

// 拜访记录不再有独立列表页，改为挂在客户档案下：
// 一个客户的拜访天然属于这个客户，从客户页进入比「先开列表再筛客户」少两步。
export function CustomerVisits({
  customerId,
  customerName,
  canEdit,
  onChanged,
}: {
  customerId: number;
  customerName: string;
  canEdit: boolean;
  onChanged?: () => void;
}) {
  const { t } = useLocale();
  const { message } = App.useApp();
  const [form] = Form.useForm();
  const [rows, setRows] = useState<VisitRow[]>([]);
  const [products, setProducts] = useState<ProductOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<VisitRow | null>(null);
  const [initialValues, setInitialValues] = useState<Record<string, unknown>>({});
  const [fileList, setFileList] = useState<UploadFile[]>([]);
  const [detail, setDetail] = useState<VisitRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        customerId: String(customerId),
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      const response = await apiFetch(`/api/visits?${params}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "拜访记录加载失败");
      setRows(payload.data);
      setTotal(payload.meta?.total || 0);
    } catch (error) {
      message.error(t(error instanceof Error ? error.message : "拜访记录加载失败"));
    } finally {
      setLoading(false);
    }
  }, [customerId, message, page, t]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    (async () => {
      try {
        const response = await apiFetch("/api/lookups");
        const payload = await response.json();
        if (response.ok) setProducts(payload.data.products);
      } catch {
        // 产品下拉加载失败不影响查看已有记录，静默处理
      }
    })();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setInitialValues({ status: "draft", visitDate: dayjs(), productIds: [] });
    setFileList([]);
    setModalOpen(true);
  };

  const openEdit = (row: VisitRow) => {
    setEditing(row);
    setInitialValues({ ...row, visitDate: row.visitDate ? dayjs(String(row.visitDate)) : undefined });
    setFileList([]);
    setModalOpen(true);
  };

  const submit = async () => {
    try {
      const values = await form.validateFields();
      const payload = {
        ...values,
        customerId,
        visitDate: values.visitDate ? values.visitDate.format("YYYY-MM-DD") : null,
      };
      setSaving(true);
      const response = await apiFetch(editing ? `/api/visits/${editing.id}` : "/api/visits", {
        method: editing ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) {
        if (result.error?.fields) {
          form.setFields(Object.entries(result.error.fields).map(([name, errors]) => ({ name, errors: [t(String(errors))] })));
        }
        throw new Error(result.error?.message || "保存失败");
      }
      // 正文保存成功后再传附件；附件失败只提示重传，不吞掉正文已保存的事实
      const file = fileList[0]?.originFileObj;
      if (file) {
        const visitId = editing ? editing.id : Number(result.data?.id);
        const body = new FormData();
        body.append("file", file);
        const uploadResponse = await apiFetch(`/api/visits/${visitId}/attachment`, { method: "POST", body });
        if (!uploadResponse.ok) {
          const uploadResult = await uploadResponse.json();
          message.error(t(uploadResult.error?.message || "附件上传失败"));
        }
      }
      message.success(editing ? t("保存成功") : t("创建成功"));
      setModalOpen(false);
      await load();
      onChanged?.();
    } catch (error) {
      if (error instanceof Error && error.message) message.error(t(error.message));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: VisitRow) => {
    try {
      const response = await apiFetch(`/api/visits/${row.id}`, { method: "DELETE" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message || "删除失败");
      message.success(t("记录已删除"));
      // 删掉当前页最后一条时自动回退一页，避免停留在空白页
      if (rows.length === 1 && page > 1) setPage(page - 1);
      else await load();
      onChanged?.();
    } catch (error) {
      message.error(t(error instanceof Error ? error.message : "删除失败"));
    }
  };

  const removeAttachment = async () => {
    if (!editing) return;
    const response = await apiFetch(`/api/visits/${editing.id}/attachment`, { method: "DELETE" });
    if (!response.ok) {
      const payload = await response.json();
      message.error(t(payload.error?.message || "删除失败"));
      return;
    }
    message.success(t("附件已删除"));
    setEditing({ ...editing, attachmentName: "" });
    await load();
  };

  const columns: TableProps<VisitRow>["columns"] = [
    { title: t("拜访日期"), dataIndex: "visitDate", width: 115, render: (value) => <span className={resStyles.nowrap}>{String(value || "-")}</span> },
    { title: t("报告编号"), dataIndex: "reportNo", width: 150 },
    {
      title: t("标题"),
      dataIndex: "title",
      ellipsis: true,
      render: (value, row) => (
        <span className={resStyles.primaryCell} onClick={() => setDetail(row)}>
          {row.attachmentName ? <PaperClipOutlined style={{ marginRight: 4, color: "#98a2b3" }} /> : null}
          {String(value || "-")}
        </span>
      ),
    },
    { title: t("关联产品"), dataIndex: "productLabels", width: 160, ellipsis: true, render: (value) => value || <span className={resStyles.muted}>-</span> },
    { title: t("创建人"), dataIndex: "creatorName", width: 90 },
    { title: t("状态"), dataIndex: "status", width: 90, render: (value) => <StatusTag value={String(value)} /> },
    {
      title: t("操作"),
      key: "actions",
      fixed: "right",
      width: 104,
      render: (_value, row) => (
        <div className={resStyles.rowActions}>
          <Tooltip title={t("查看报告")}>
            <Button type="text" size="small" icon={<EyeOutlined />} aria-label={t("查看")} onClick={() => setDetail(row)} />
          </Tooltip>
          {canEdit && row.canEdit !== 0 ? (
            <Tooltip title={t("编辑")}>
              <Button type="text" size="small" icon={<EditOutlined />} aria-label={t("编辑")} onClick={() => openEdit(row)} />
            </Tooltip>
          ) : null}
          {canEdit && row.canEdit !== 0 ? (
            <Popconfirm
              title={t("确认删除「{name}」？", { name: String(row.reportNo || row.id) })}
              okText={t("确认")}
              cancelText={t("取消")}
              onConfirm={() => void remove(row)}
            >
              <Tooltip title={t("删除")}>
                <Button danger type="text" size="small" icon={<DeleteOutlined />} aria-label={t("删除")} />
              </Tooltip>
            </Popconfirm>
          ) : null}
        </div>
      ),
    },
  ];

  // 新建时只列启用中的产品；编辑历史报告时保留停用项，否则原有关联会被清空
  const productOptions = products
    .filter((item) => item.status !== "inactive" || editing)
    .map((item) => ({
      value: item.id,
      label: item.status === "inactive" ? `${item.label}（${t("已停用")}）` : item.label,
    }));

  return (
    <section className={styles.section}>
      <div className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>{t("拜访记录")}</h2>
        <span className={styles.sectionCount}>{t("共 {n} 条", { n: total })}</span>
        {canEdit ? (
          <Button type="primary" size="small" icon={<PlusOutlined />} style={{ marginLeft: "auto" }} onClick={openCreate}>
            {t("新建拜访")}
          </Button>
        ) : null}
      </div>
      <div className={styles.tableFrame}>
        <Table<VisitRow>
          rowKey="id"
          size="middle"
          loading={loading}
          columns={columns}
          dataSource={rows}
          scroll={{ x: 860 }}
          pagination={total > PAGE_SIZE ? { current: page, pageSize: PAGE_SIZE, total, showSizeChanger: false, onChange: setPage } : false}
          locale={{
            emptyText: (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("暂无拜访")}>
                {canEdit ? <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>{t("新建拜访")}</Button> : null}
              </Empty>
            ),
          }}
        />
      </div>

      <Modal
        title={`${editing ? t("编辑拜访") : t("新建拜访")} · ${customerName}`}
        open={modalOpen}
        centered
        width={860}
        okText={t("保存")}
        cancelText={t("取消")}
        confirmLoading={saving}
        onOk={() => void submit()}
        onCancel={() => setModalOpen(false)}
        destroyOnHidden
        styles={{ body: { maxHeight: "calc(100vh - 190px)", overflowY: "auto", paddingRight: 4 } }}
      >
        {/* destroyOnHidden 保证每次打开重新挂载，initialValues 在首帧即生效，避免先空后填的闪烁 */}
        <Form
          form={form}
          layout="horizontal"
          labelCol={{ flex: "132px" }}
          wrapperCol={{ flex: "auto" }}
          requiredMark={false}
          preserve={false}
          initialValues={initialValues}
        >
          <div className={resStyles.formGrid}>
            <div className={`${resStyles.fieldFull} ${resStyles.sectionTitle}`}>{t("基本信息")}</div>
            <Form.Item name="reportNo" label={t("报告编号")}>
              <Input placeholder={t("留空自动生成")} />
            </Form.Item>
            <Form.Item name="status" label={t("报告状态")} rules={[{ required: true, message: t("{label}不能为空", { label: t("报告状态") }) }]}>
              <Select
                options={[
                  { label: t("草稿"), value: "draft" },
                  { label: t("已完成"), value: "completed" },
                  { label: t("已归档"), value: "archived" },
                ]}
              />
            </Form.Item>
            <Form.Item className={resStyles.fieldFull} name="title" label={t("报告标题")} rules={[{ required: true, message: t("{label}不能为空", { label: t("报告标题") }) }]}>
              <Input placeholder={t("请输入{label}", { label: t("报告标题") })} />
            </Form.Item>
            <Form.Item name="visitDate" label={t("拜访日期")} rules={[{ required: true, message: t("{label}不能为空", { label: t("拜访日期") }) }]}>
              <DatePicker style={{ width: "100%" }} format="YYYY-MM-DD" />
            </Form.Item>
            <Form.Item name="internalParticipants" label={t("我方参加人员")}>
              <Input placeholder={t("请输入{label}", { label: t("我方参加人员") })} />
            </Form.Item>
            <Form.Item className={resStyles.fieldFull} name="productIds" label={t("关联产品")}>
              <Select
                mode="multiple"
                showSearch
                allowClear
                maxTagCount="responsive"
                optionFilterProp="label"
                options={productOptions}
                placeholder={t("请选择{label}", { label: t("关联产品") })}
              />
            </Form.Item>
            <Form.Item className={resStyles.fieldFull} name="customerParticipants" label={t("客户方参加人员")}>
              <Input placeholder={t("请输入{label}", { label: t("客户方参加人员") })} />
            </Form.Item>
            <div className={`${resStyles.fieldFull} ${resStyles.sectionTitle}`}>{t("报告内容")}</div>
            <Form.Item className={resStyles.fieldFull} name="companyProfile" label={t("客户公司简介")}>
              <Input.TextArea rows={2} showCount maxLength={3000} />
            </Form.Item>
            <Form.Item className={resStyles.fieldFull} name="meetingNotes" label={t("沟通纪要")}>
              <Input.TextArea rows={4} showCount maxLength={8000} />
            </Form.Item>
            <Form.Item className={resStyles.fieldFull} name="followUp" label={t("后续跟进事项")}>
              <Input.TextArea rows={3} showCount maxLength={3000} />
            </Form.Item>
            <Form.Item className={resStyles.fieldFull} label={t("附件（docx）")}>
              {/* 手动上传：先选文件，随表单保存一起提交；重复选择会替换 */}
              <Upload
                accept=".docx"
                maxCount={1}
                fileList={fileList}
                beforeUpload={() => false}
                onChange={({ fileList: next }) => {
                  const size = next[0]?.size || 0;
                  if (size > 10 * 1024 * 1024) {
                    message.error(t("文件大小不能超过 10MB"));
                    return;
                  }
                  setFileList(next.slice(-1));
                }}
              >
                <Button icon={<UploadOutlined />}>{t("选择 docx 文件")}</Button>
              </Upload>
              {editing?.attachmentName ? (
                <div style={{ marginTop: 6, fontSize: 13 }}>
                  <a href={`/api/visits/${editing.id}/attachment`} download>
                    <PaperClipOutlined /> {String(editing.attachmentName)}
                  </a>
                  <Button type="link" danger size="small" onClick={() => void removeAttachment()}>{t("删除附件")}</Button>
                </div>
              ) : null}
            </Form.Item>
          </div>
        </Form>
      </Modal>

      <VisitDetail
        open={Boolean(detail)}
        data={detail}
        canEdit={canEdit && detail?.canEdit !== 0}
        onClose={() => setDetail(null)}
        onEdit={(record) => { setDetail(null); openEdit(record as VisitRow); }}
      />
    </section>
  );
}
