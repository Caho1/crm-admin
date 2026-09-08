import dayjs, { type Dayjs } from "dayjs";
import { getDb } from "@/db/client";
import { handleApiError, ok, requireApiUser } from "@/lib/api";
import { customerScope } from "@/lib/permissions";

export type TrendGranularity = "year" | "month" | "week";

// 各粒度的桶数：年 5、月 12、周 12
const BUCKET_COUNTS: Record<TrendGranularity, number> = { year: 5, month: 12, week: 12 };

// SQL 分桶表达式，需与 JS 侧 bucketKey 的格式一致；column 按查询各自传入
function bucketExpr(column: string, granularity: TrendGranularity) {
  if (granularity === "year") return `strftime('%Y', ${column})`;
  if (granularity === "month") return `strftime('%Y-%m', ${column})`;
  // 'weekday 0' 前进到本周日，再回退 6 天得到周一：按周一至周日归周
  return `date(${column}, 'weekday 0', '-6 days')`;
}

function bucketKey(date: Dayjs, granularity: TrendGranularity) {
  if (granularity === "year") return date.format("YYYY");
  if (granularity === "month") return date.format("YYYY-MM");
  return date.format("YYYY-MM-DD");
}

// 从当前时间往回生成完整桶序列（缺单的桶补零），并给出查询下界
function buildBuckets(granularity: TrendGranularity) {
  const count = BUCKET_COUNTS[granularity];
  let cursor: Dayjs;
  let step: "year" | "month" | "week";
  if (granularity === "year") {
    cursor = dayjs().startOf("year");
    step = "year";
  } else if (granularity === "month") {
    cursor = dayjs().startOf("month");
    step = "month";
  } else {
    // dayjs().day()：0 为周日；换算为距周一的天数
    cursor = dayjs().subtract((dayjs().day() + 6) % 7, "day");
    step = "week";
  }
  const starts = Array.from({ length: count }, (_, index) => cursor.subtract(count - 1 - index, step));
  return { keys: starts.map((start) => bucketKey(start, granularity)), rangeStart: starts[0].format("YYYY-MM-DD") };
}

export async function GET(request: Request) {
  try {
    const user = await requireApiUser();
    const db = getDb();
    const scope = customerScope(user, "c");

    const raw = new URL(request.url).searchParams.get("granularity");
    const granularity: TrendGranularity = raw === "year" || raw === "week" ? raw : "month";

    const { keys, rangeStart } = buildBuckets(granularity);

    // 新增客户趋势：按客户建档时间分桶（围绕客户管理，工作台第一张趋势图看的是客户增长而不是订单量）
    const customerRows = db
      .prepare(`
        SELECT ${bucketExpr("c.created_at", granularity)} AS bucket, COUNT(*) AS count
        FROM customers c
        WHERE c.deleted_at IS NULL AND c.created_at >= ? AND ${scope.sql}
        GROUP BY bucket
      `)
      .all(rangeStart, ...scope.params) as Array<{ bucket: string; count: number }>;

    // 拜访活跃度趋势：按拜访日期分桶，看客情维护是否跟得上
    const visitRows = db
      .prepare(`
        SELECT ${bucketExpr("v.visit_date", granularity)} AS bucket, COUNT(*) AS count
        FROM visits v
        JOIN customers c ON c.id = v.customer_id
        WHERE v.deleted_at IS NULL AND c.deleted_at IS NULL AND v.visit_date >= ? AND ${scope.sql}
        GROUP BY bucket
      `)
      .all(rangeStart, ...scope.params) as Array<{ bucket: string; count: number }>;

    const trend = keys.map((bucket) => ({
      bucket,
      newCustomers: customerRows.find((item) => item.bucket === bucket)?.count ?? 0,
      visits: visitRows.find((item) => item.bucket === bucket)?.count ?? 0,
    }));

    return ok({ granularity, trend });
  } catch (error) {
    return handleApiError(error);
  }
}
