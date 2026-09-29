import { getSqliteDb } from "../src/db/sqlite";
if (!/^postgres(?:ql)?:\/\//.test(process.env.DATABASE_URL || "")) {
  getSqliteDb();
  console.log("SQLite database is ready.");
}
