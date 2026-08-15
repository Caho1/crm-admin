export const schemaSql = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'user')) DEFAULT 'user',
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')) DEFAULT 'active',
  locale TEXT NOT NULL DEFAULT 'zh-CN',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 可配置标签字典：分类、行业、产品大类等下拉选项统一在「设置 → 标签配置」维护，
-- 业务表只存 code，展示时按当前语言取 label / label_en / label_ko。
CREATE TABLE IF NOT EXISTS dict_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  code TEXT NOT NULL,
  label TEXT NOT NULL,
  label_en TEXT NOT NULL DEFAULT '',
  label_ko TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')) DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(type, code)
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  name_en TEXT NOT NULL DEFAULT '',
  short_name TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  region TEXT NOT NULL DEFAULT '',
  industry TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN ('potential', 'active', 'inactive')) DEFAULT 'potential',
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS customer_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access TEXT NOT NULL CHECK (access IN ('view', 'edit')) DEFAULT 'view',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(customer_id, user_id)
);

-- 一个客户可以挂多个联系人（实际业务里十几二十位都有），顺序按 sort_order。
-- 名片正反面以 BLOB 直接存库，随客户档案一起备份，不额外依赖文件目录。
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_en TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  personality TEXT NOT NULL DEFAULT '',
  card_front_mime TEXT NOT NULL DEFAULT '',
  card_front_data BLOB,
  card_back_mime TEXT NOT NULL DEFAULT '',
  card_back_data BLOB,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_name TEXT NOT NULL,
  grade TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  supplier TEXT NOT NULL DEFAULT '',
  application TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('active', 'inactive')) DEFAULT 'active',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(class_name, grade)
);

-- 竞争对手的对标牌号：一个自家牌号往往对应多家竞品（数量不固定），
-- 逐条记录竞品牌号与生产商，顺序按 sort_order。
CREATE TABLE IF NOT EXISTS product_competitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  grade TEXT NOT NULL,
  manufacturer TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_no TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  visit_date TEXT NOT NULL,
  internal_participants TEXT NOT NULL DEFAULT '',
  customer_participants TEXT NOT NULL DEFAULT '',
  company_profile TEXT NOT NULL DEFAULT '',
  meeting_notes TEXT NOT NULL DEFAULT '',
  follow_up TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('draft', 'completed', 'archived')) DEFAULT 'draft',
  attachment_name TEXT NOT NULL DEFAULT '',
  attachment_data BLOB,
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS visit_products (
  visit_id INTEGER NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  PRIMARY KEY (visit_id, product_id)
);

CREATE TABLE IF NOT EXISTS opportunities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
  stage TEXT NOT NULL CHECK (stage IN ('lead', 'sample', 'testing', 'quotation', 'order', 'paused', 'lost')) DEFAULT 'lead',
  estimated_quantity REAL,
  estimated_amount REAL,
  currency TEXT NOT NULL DEFAULT 'USD',
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  next_action TEXT NOT NULL DEFAULT '',
  next_follow_up_date TEXT,
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('active', 'closed')) DEFAULT 'active',
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no TEXT NOT NULL UNIQUE,
  order_date TEXT NOT NULL,
  customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  quantity REAL NOT NULL CHECK (quantity > 0),
  price REAL NOT NULL CHECK (price >= 0),
  currency TEXT NOT NULL DEFAULT 'USD',
  destination TEXT NOT NULL DEFAULT '',
  trade_terms TEXT NOT NULL DEFAULT '',
  payment_method TEXT NOT NULL DEFAULT '',
  shipment_month TEXT,
  lc_tt_date TEXT,
  actual_shipment_date TEXT,
  expected_arrival_date TEXT,
  contract_no TEXT NOT NULL DEFAULT '',
  invoice_no TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('planned', 'confirmed', 'shipped', 'arrived', 'cancelled')) DEFAULT 'planned',
  owner_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  notes TEXT NOT NULL DEFAULT '',
  created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id INTEGER,
  summary TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash, expires_at);
CREATE INDEX IF NOT EXISTS idx_customers_owner ON customers(owner_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_customer_members_user ON customer_members(user_id, customer_id);
CREATE INDEX IF NOT EXISTS idx_visits_customer_date ON visits(customer_id, visit_date, deleted_at);
CREATE INDEX IF NOT EXISTS idx_opportunities_customer_stage ON opportunities(customer_id, stage, deleted_at);
CREATE INDEX IF NOT EXISTS idx_orders_customer_date ON orders(customer_id, order_date, deleted_at);
CREATE INDEX IF NOT EXISTS idx_orders_shipment ON orders(actual_shipment_date, expected_arrival_date, status);
CREATE INDEX IF NOT EXISTS idx_products_grade ON products(grade, class_name);
CREATE INDEX IF NOT EXISTS idx_product_competitors_product ON product_competitors(product_id, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_product_competitors_grade ON product_competitors(grade);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dict_items_type ON dict_items(type, status, sort_order);
`;

// 已存在的库不会重跑 CREATE TABLE，新增列必须走 ALTER TABLE。
// 每次开库时检查一遍，缺什么补什么（幂等，重复启动无副作用）。
export const columnMigrations: Array<{ table: string; column: string; ddl: string }> = [
  { table: "customers", column: "name_en", ddl: "ALTER TABLE customers ADD COLUMN name_en TEXT NOT NULL DEFAULT ''" },
  { table: "customers", column: "short_name", ddl: "ALTER TABLE customers ADD COLUMN short_name TEXT NOT NULL DEFAULT ''" },
  { table: "customers", column: "category", ddl: "ALTER TABLE customers ADD COLUMN category TEXT NOT NULL DEFAULT ''" },
  { table: "visits", column: "attachment_name", ddl: "ALTER TABLE visits ADD COLUMN attachment_name TEXT NOT NULL DEFAULT ''" },
  { table: "visits", column: "attachment_data", ddl: "ALTER TABLE visits ADD COLUMN attachment_data BLOB" },
  { table: "contacts", column: "name_en", ddl: "ALTER TABLE contacts ADD COLUMN name_en TEXT NOT NULL DEFAULT ''" },
  { table: "contacts", column: "personality", ddl: "ALTER TABLE contacts ADD COLUMN personality TEXT NOT NULL DEFAULT ''" },
  { table: "contacts", column: "card_front_mime", ddl: "ALTER TABLE contacts ADD COLUMN card_front_mime TEXT NOT NULL DEFAULT ''" },
  { table: "contacts", column: "card_front_data", ddl: "ALTER TABLE contacts ADD COLUMN card_front_data BLOB" },
  { table: "contacts", column: "card_back_mime", ddl: "ALTER TABLE contacts ADD COLUMN card_back_mime TEXT NOT NULL DEFAULT ''" },
  { table: "contacts", column: "card_back_data", ddl: "ALTER TABLE contacts ADD COLUMN card_back_data BLOB" },
  { table: "contacts", column: "sort_order", ddl: "ALTER TABLE contacts ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0" },
];

// 依赖新增列的索引，必须等 columnMigrations 补完列之后再建
export const postMigrationSql = `
CREATE INDEX IF NOT EXISTS idx_customers_category ON customers(category, deleted_at);
CREATE INDEX IF NOT EXISTS idx_contacts_customer ON contacts(customer_id, sort_order, id);
`;
