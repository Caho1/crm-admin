/** Accept legacy newlines and either comma style; preserve spaces within a grade. */
export function formatMaterialModels(value: unknown): string {
  return String(value ?? "").split(/[,，\r\n]+/).map((part) => part.trim()).filter(Boolean).join(", ");
}
