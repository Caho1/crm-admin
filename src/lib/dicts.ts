// 可配置下拉选项（标签）的类型登记表。
// 新增一类标签只需在这里加一行：设置页的分组、表单下拉、列表筛选会自动跟着出现。
// 「行业」曾经也是一类标签，现已改为客户表单里手动输入，不再需要维护选项。
export const DICT_TYPES = [
  { type: "customer_category", label: "客户分类" },
  { type: "product_class", label: "产品大类 / 材料分类" },
] as const;

export type DictType = (typeof DICT_TYPES)[number]["type"];

export const DICT_TYPE_VALUES = DICT_TYPES.map((item) => item.type) as unknown as [DictType, ...DictType[]];

export function isDictType(value: string): value is DictType {
  return DICT_TYPES.some((item) => item.type === value);
}

export type DictItem = {
  id: number;
  type: DictType;
  code: string;
  label: string;
  labelEn: string;
  labelKo: string;
  sortOrder: number;
  status: "active" | "inactive";
  /** 仅管理页请求（withUsage=1）时返回：被多少条业务数据引用 */
  usageCount?: number;
};

export type DictMap = Record<string, DictItem[]>;

// 字典项标签按当前语言取，缺译回退中文。业务表存的是 code，改名不影响历史数据。
export function dictLabel(item: Pick<DictItem, "label" | "labelEn" | "labelKo">, locale: string) {
  if (locale === "en-US") return item.labelEn || item.label;
  if (locale === "ko-KR") return item.labelKo || item.label;
  return item.label;
}

// code 在字典里找不到时（例如标签被删）直接显示原始 code，不吞数据
export function dictLabelOf(items: DictItem[] | undefined, code: string, locale: string) {
  if (!code) return "";
  const found = items?.find((item) => item.code === code);
  return found ? dictLabel(found, locale) : code;
}
