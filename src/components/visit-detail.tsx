"use client";

import { EditOutlined } from "@ant-design/icons";
import { Button, Descriptions, Drawer } from "antd";
import { useLocale } from "./providers";
import { StatusTag } from "./status-tag";
import styles from "./resource-page.module.css";

type VisitRecord = Record<string, unknown> & { id: number };

function text(record: VisitRecord, key: string) {
  const value = record[key];
  return value === null || value === undefined || value === "" ? "-" : String(value);
}

export function VisitDetail({
  open,
  data,
  canEdit,
  onClose,
  onEdit,
}: {
  open: boolean;
  data: VisitRecord | null;
  canEdit: boolean;
  onClose: () => void;
  onEdit: (record: VisitRecord) => void;
}) {
  const { t } = useLocale();
  return (
    <Drawer
      title={data ? String(data.title || t("拜访报告")) : t("拜访报告")}
      size={760}
      open={open}
      onClose={onClose}
      extra={
        canEdit && data ? (
          <Button icon={<EditOutlined />} onClick={() => onEdit(data)}>{t("编辑")}</Button>
        ) : null
      }
    >
      {data ? (
        <>
          <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
            <Descriptions.Item label={t("报告编号")}>{text(data, "reportNo")}</Descriptions.Item>
            <Descriptions.Item label={t("报告状态")}>
              <StatusTag value={String(data.status || "")} />
            </Descriptions.Item>
            <Descriptions.Item label={t("客户")}>{text(data, "customerName")}</Descriptions.Item>
            <Descriptions.Item label={t("拜访日期")}>{text(data, "visitDate")}</Descriptions.Item>
            <Descriptions.Item label={t("关联产品")} span={2}>{text(data, "productLabels")}</Descriptions.Item>
            <Descriptions.Item label={t("我方参加人员")}>{text(data, "internalParticipants")}</Descriptions.Item>
            <Descriptions.Item label={t("客户方参加人员")}>{text(data, "customerParticipants")}</Descriptions.Item>
            <Descriptions.Item label={t("创建人")}>{text(data, "creatorName")}</Descriptions.Item>
          </Descriptions>
          <h3 className={styles.detailSectionTitle}>{t("客户公司简介")}</h3>
          <p className={styles.preWrap}>{text(data, "companyProfile")}</p>
          <h3 className={styles.detailSectionTitle}>{t("沟通纪要")}</h3>
          <p className={styles.preWrap}>{text(data, "meetingNotes")}</p>
          <h3 className={styles.detailSectionTitle}>{t("后续跟进事项")}</h3>
          <p className={styles.preWrap}>{text(data, "followUp")}</p>
        </>
      ) : null}
    </Drawer>
  );
}
