import { getDb } from "../src/db/client";
import { seedDatabase } from "../src/db/seed";

// 构建期脚本：初始化数据库（含演示数据）。
// 运行期首次建库由 src/db/client.ts 调用同一份种子逻辑（见 seedDatabase）。
const db = getDb();
seedDatabase(db);
console.log("SQLite database is ready with demo data.");
