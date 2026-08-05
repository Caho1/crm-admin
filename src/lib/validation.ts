import { z } from "zod";
import { DICT_TYPE_VALUES } from "./dicts";

const optionalText = (max = 1000) => z.string().trim().max(max, `不能超过 ${max} 个字符`).optional().default("");
const optionalDate = z
  .union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.literal(""), z.null()])
  .optional()
  .transform((value) => value || null);
const optionalMonth = z
  .union([z.string().regex(/^\d{4}-\d{2}$/), z.literal(""), z.null()])
  .optional()
  .transform((value) => value || null);
const positiveId = z.coerce.number().int().positive();

export const loginSchema = z.object({
  username: z.string().trim().min(1, "请输入账号").max(80),
  password: z.string().min(1, "请输入密码").max(200),
});

// 标签字典项：code 是业务表实际存的值，建后不允许改，避免历史数据对不上
export const dictItemSchema = z.object({
  type: z.enum(DICT_TYPE_VALUES),
  code: z.string().trim().min(1, "请输入选项值").max(60).regex(/^[^\s]+$/, "选项值不能包含空格"),
  label: z.string().trim().min(1, "请输入中文名称").max(80),
  labelEn: optionalText(80),
  labelKo: optionalText(80),
  sortOrder: z.coerce.number().int().min(0).max(9999).optional().default(0),
  status: z.enum(["active", "inactive"]).default("active"),
});

export const dictItemUpdateSchema = dictItemSchema.omit({ type: true, code: true });

export const customerSchema = z.object({
  name: z.string().trim().min(2, "客户名称至少 2 个字符").max(160),
  nameEn: optionalText(160),
  category: optionalText(60),
  country: optionalText(80),
  region: optionalText(80),
  industry: optionalText(120),
  address: optionalText(240),
  description: optionalText(2000),
  ownerId: positiveId.optional(),
  status: z.enum(["potential", "active", "inactive"]).default("potential"),
  memberIds: z.array(positiveId).optional().default([]),
  contactName: optionalText(80),
  contactTitle: optionalText(80),
  contactPhone: optionalText(80),
  contactEmail: z.union([z.string().trim().email("邮箱格式不正确"), z.literal("")]).optional().default(""),
});

// 拜访记录从简：标题和日期必填即可，参加人员、纪要等都是可选补充；
// 正式的长报告可以用 docx 附件上传，不再强迫逐段填写
export const visitSchema = z.object({
  reportNo: z.string().trim().max(80).optional().default(""),
  title: z.string().trim().min(3, "请输入报告标题").max(240),
  customerId: positiveId,
  visitDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "请选择拜访日期"),
  internalParticipants: optionalText(300),
  customerParticipants: optionalText(300),
  companyProfile: optionalText(3000),
  meetingNotes: optionalText(8000),
  followUp: optionalText(3000),
  status: z.enum(["draft", "completed", "archived"]).default("draft"),
  productIds: z.array(positiveId).optional().default([]),
});

export const opportunitySchema = z.object({
  name: z.string().trim().min(2, "请输入商机名称").max(200),
  customerId: positiveId,
  productId: positiveId.nullable().optional(),
  stage: z.enum(["lead", "sample", "testing", "quotation", "order", "paused", "lost"]),
  estimatedQuantity: z.coerce.number().nonnegative().nullable().optional(),
  estimatedAmount: z.coerce.number().nonnegative().nullable().optional(),
  currency: z.string().trim().min(3).max(8).default("USD"),
  ownerId: positiveId.optional(),
  nextAction: optionalText(1000),
  nextFollowUpDate: optionalDate,
  notes: optionalText(3000),
  status: z.enum(["active", "closed"]).default("active"),
});

export const productSchema = z.object({
  className: z.string().trim().min(1, "请输入产品大类").max(80),
  grade: z.string().trim().min(1, "请输入型号/牌号").max(120),
  brand: optionalText(120),
  supplier: optionalText(160),
  application: optionalText(500),
  notes: optionalText(2000),
  status: z.enum(["active", "inactive"]).default("active"),
});

export const orderSchema = z.object({
  orderNo: z.string().trim().max(80).optional().default(""),
  orderDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "请选择下单日期"),
  customerId: positiveId,
  productId: positiveId,
  quantity: z.coerce.number().positive("数量必须大于 0"),
  price: z.coerce.number().nonnegative("单价不能小于 0"),
  currency: z.string().trim().min(3).max(8).default("USD"),
  destination: optionalText(120),
  tradeTerms: optionalText(80),
  paymentMethod: optionalText(80),
  shipmentMonth: optionalMonth,
  lcTtDate: optionalDate,
  actualShipmentDate: optionalDate,
  expectedArrivalDate: optionalDate,
  contractNo: optionalText(120),
  invoiceNo: optionalText(120),
  status: z.enum(["planned", "confirmed", "shipped", "arrived", "cancelled"]),
  ownerId: positiveId.optional(),
  notes: optionalText(2000),
});

export const userSchema = z.object({
  username: z.string().trim().min(3, "账号至少 3 个字符").max(80),
  name: z.string().trim().min(2, "姓名至少 2 个字符").max(80),
  password: z.string().min(8, "密码至少 8 个字符").max(200).optional(),
  role: z.enum(["admin", "user"]).default("user"),
  status: z.enum(["active", "disabled"]).default("active"),
});

export const resetPasswordSchema = z.object({
  password: z.string().min(8, "密码至少 8 个字符").max(200),
});

export const handoverSchema = z.object({
  fromUserId: positiveId,
  toUserId: positiveId,
});
