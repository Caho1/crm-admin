/** Text addresses open search so users can confirm the destination before navigation. */
export function amapSearchUrl(address: unknown): string | null {
  const keyword = String(address ?? "").trim();
  if (!keyword) return null;
  const params = new URLSearchParams({ keyword, view: "list", src: "crm-admin", callnative: "1" });
  return `https://uri.amap.com/search?${params.toString()}`;
}
