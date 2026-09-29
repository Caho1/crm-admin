/** Translate the application's bounded SQLite query dialect, preserving quoted values. */
export function postgresSql(input: string, returning = false) {
  let sql = input.trim().replace(/;$/, "");
  const ignore = /INSERT OR IGNORE/i.test(sql);
  sql = sql.replace(/INSERT OR IGNORE/gi, "INSERT");
  sql = sql.replace(/datetime\('now'\)/gi, "to_char(timezone('UTC', now()), 'YYYY-MM-DD HH24:MI:SS')")
    .replace(/datetime\(([\w.]+), '\+8 hours'\)/gi, "to_char($1::timestamptz AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI:SS')")
    .replace(/datetime\(([\w.]+)\)/gi, "to_char($1::timestamptz AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS')")
    .replace(/strftime\('%Y-%m', 'now', '\+8 hours'\)/gi, "to_char(now() AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM')")
    .replace(/strftime\('%Y-%m', ([\w.]+)\)/gi, "substring($1, 1, 7)")
    .replace(/strftime\('%Y', ([\w.]+)\)/gi, "substring($1, 1, 4)")
    .replace(/date\('now', '\+8 hours', '\+14 day'\)/gi, "to_char((now() AT TIME ZONE 'Asia/Shanghai') + interval '14 days', 'YYYY-MM-DD')")
    .replace(/date\('now', '\+8 hours'\)/gi, "to_char(now() AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD')")
    .replace(/date\(([\w.]+), 'weekday 0', '-6 days'\)/gi, "to_char(date_trunc('week', $1::timestamp), 'YYYY-MM-DD')")
    .replace(/([\w.]+)\s*=\s*\? COLLATE NOCASE/gi, "lower($1) = lower(?)")
    .replace(/([\w.]+) COLLATE NOCASE/gi, "lower($1)")
    .replace(/GROUP_CONCAT\(/gi, "STRING_AGG(")
    .replace(/json_group_array\(([^)]+)\)/gi, "COALESCE(json_agg($1)::text, '[]')");
  // Replacements below apply only outside string literals and quoted identifiers.
  let parameter = 0;
  sql = sql.split(/('(?:''|[^'])*'|"(?:""|[^"])*")/g).map((part, i) => i % 2 ? part : part
    .replace(/\bLIKE\b/gi, "ILIKE")
    .replace(/\bAS\s+([A-Za-z_][A-Za-z_0-9]*)/gi, 'AS "$1"')
    .replace(/\?/g, () => `$${++parameter}`)).join("");
  const aliases = [...sql.matchAll(/\bAS "([a-zA-Z_][a-zA-Z_0-9]*)"/g)].map(match => match[1]).filter(alias => /[A-Z]/.test(alias));
  if (aliases.length) {
    const names = new RegExp(`\\b(${aliases.join("|")})\\b`, "g");
    sql = sql.split(/('(?:''|[^'])*'|"(?:""|[^"])*")/g).map((part, i) => i % 2 ? part : part.replace(names, '\"$1\"')).join("");
  }
  if (ignore) sql += " ON CONFLICT DO NOTHING";
  if (returning && /^INSERT\s+INTO\s+(?!visit_products\b)/i.test(sql)) sql += " RETURNING id";
  return sql;
}
