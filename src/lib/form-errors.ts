import type { FormInstance } from "antd";

type FieldPath = Array<string | number>;

export function showFormValidationError(form: FormInstance, error: unknown): boolean {
  if (!error || typeof error !== "object" || !("errorFields" in error)) return false;
  const fields = error.errorFields as Array<{ name: FieldPath }>;
  if (!Array.isArray(fields) || !fields.length) return false;
  form.scrollToField(fields[0].name, { block: "center", focus: true });
  return true;
}

export function setServerFormErrors(form: FormInstance, fields: Record<string, string>, t: (text: string) => string) {
  const errors = Object.entries(fields).map(([path, message]) => ({
    name: path.split(".").map((part) => /^\d+$/.test(part) ? Number(part) : part),
    errors: [t(message)],
  }));
  form.setFields(errors);
  if (errors.length) form.scrollToField(errors[0].name, { block: "center", focus: true });
}
