import assert from "node:assert/strict";
import test from "node:test";
import { parseExcelDate, parseExcelNumber, parseShipmentMonth, readUploadWorksheet } from "./excel";
import { orderSchema } from "./validation";

test("date formats and Excel serials normalize without rolling invalid dates forward", () => {
  for (const value of ["2026-09-28", "2026/9/28", "2026.9.28", "2026年9月28日", "28/09/2026", "09/28/2026", "28-Sep-2026", "September 28, 2026", "20260928", "2026-09-28T00:00:00Z", 46293]) {
    assert.equal(parseExcelDate(value), "2026-09-28", String(value));
  }
  assert.equal(parseExcelDate("03/04/2026"), "2026-04-03");
  assert.equal(parseExcelDate("2024-02-29"), "2024-02-29");
  for (const value of ["2026-02-31", "2026-02-29", "2026/13/01", "31/04/2026", "not a date", new Date(NaN), 60]) assert.equal(parseExcelDate(value), null);
  assert.equal(parseExcelDate(0, true), "1904-01-01");
  assert.equal(parseShipmentMonth("13月", "2026-01-01"), null);
  assert.equal(parseShipmentMonth("2026/9", null), "2026-09");
});

test("blank prices remain null, explicit zero is kept, invalid text is rejected", () => {
  const price = orderSchema.shape.price;
  for (const value of [null, undefined, "", "  "]) {
    assert.equal(parseExcelNumber(value), null);
    assert.equal(price.parse(value), null);
  }
  assert.equal(price.parse(0), 0);
  assert.equal(parseExcelNumber("1,234.50"), 1234.5);
  assert.equal(price.safeParse(-1).success, false);
  assert.equal(price.safeParse("abc").success, false);
});

test("CSV reader preserves identifiers, blanks and dates for strict validation", async () => {
  const sheet = await readUploadWorksheet(new File(["Order No.,Order Date,Price\n00012,2026-02-31,\n"], "orders.csv"));
  assert.equal(sheet!.getRow(2).getCell(1).value, "00012");
  assert.equal(sheet!.getRow(2).getCell(2).value, "2026-02-31");
  assert.equal(parseExcelNumber(sheet!.getRow(2).getCell(3).value), null);
  await assert.rejects(readUploadWorksheet(new File(["broken workbook"], "broken.xlsx")));
});
