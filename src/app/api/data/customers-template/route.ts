import ExcelJS from "exceljs";
import { handleApiError, requireApiUser } from "@/lib/api";
import { customerExcelColumns, styleCustomerSheet } from "@/lib/excel";

export const runtime = "nodejs";

export async function GET() {
  try {
    await requireApiUser();
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("客户导入模板");
    worksheet.columns = [...customerExcelColumns];
    // 示例行：尚未成交的开发中客户也能先入库，状态填「潜在客户」
    worksheet.addRow({
      name: "东莞市示例塑胶有限公司",
      nameEn: "Dongguan Example Plastics Co., Ltd.",
      shortName: "东莞示例",
      category: "工厂",
      industry: "注塑加工",
      country: "中国",
      region: "东莞",
      address: "广东省东莞市长安镇示例路 1 号",
      description: "开发中客户，样品测试阶段",
      ownerName: "金载敏",
      status: "潜在客户",
      contactName: "张三",
      contactNameEn: "Zhang San",
      contactTitle: "采购经理",
      contactPhone: "+86 138 0000 0000",
      contactEmail: "buyer@example.com",
      contactPersonality: "性格直爽，重视交期，爱好高尔夫",
    });
    styleCustomerSheet(worksheet);
    const buffer = await workbook.xlsx.writeBuffer();
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": "attachment; filename=customer-import-template.xlsx",
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
