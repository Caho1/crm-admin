import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Dedicated local cluster only; never use an inherited business DATABASE_URL.
const directory = mkdtempSync(join(tmpdir(), "crm-pg-regression-"));
const data = join(directory, "data");
const binary = (name) => process.env.CRM_TEST_PG_BIN ? join(process.env.CRM_TEST_PG_BIN, name) : name;
function run(name, args, env = process.env) {
  const result = spawnSync(name, args, { stdio: "inherit", env });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${name} exited with ${result.status}`);
}
let started = false;
try {
  const server = createServer();
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  run(binary("initdb"), ["-D", data, "-A", "trust", "--no-locale", "--encoding=UTF8", "-U", "crm_test"]);
  run(binary("pg_ctl"), ["-D", data, "-l", join(directory, "postgres.log"), "-o", `-h 127.0.0.1 -p ${port} -k ${directory}`, "-w", "start"]);
  started = true;
  const database = `crm_regression_${Date.now()}`;
  run(binary("createdb"), ["-h", "127.0.0.1", "-p", String(port), "-U", "crm_test", database]);
  console.log("Running real API regressions against isolated PostgreSQL on loopback.");
  run(process.execPath, ["--import", "tsx", "--test", "src/lib/app-regressions.test.ts"], {
    ...process.env, DATABASE_URL: "", CRM_TEST_POSTGRES_URL: `postgresql://crm_test@127.0.0.1:${port}/${database}`,
  });
} finally {
  if (started) {
    const result = spawnSync(binary("pg_ctl"), ["-D", data, "-m", "fast", "-w", "stop"], { stdio: "inherit" });
    if (result.status !== 0) throw new Error(`Temporary PostgreSQL could not stop; preserved ${directory}`);
  }
  rmSync(directory, { recursive: true, force: true });
}
