import { createHash } from "node:crypto";
import { Client } from "minio";

// Content-addressed objects are immutable. Unreferenced objects are retained for
// backup/rollback; deleting shared objects here could break concurrent requests.
let client: Client | undefined;
export function objectStore() {
  if (!process.env.MINIO_ENDPOINT || !process.env.MINIO_ACCESS_KEY || !process.env.MINIO_SECRET_KEY) throw new Error("MinIO configuration is missing");
  const url = new URL(process.env.MINIO_ENDPOINT);
  return client ||= new Client({ endPoint: url.hostname, port: Number(url.port || (url.protocol === "https:" ? 443 : 80)), useSSL: url.protocol === "https:", accessKey: process.env.MINIO_ACCESS_KEY, secretKey: process.env.MINIO_SECRET_KEY });
}
export function bucketName() { return process.env.MINIO_BUCKET || "crm-files"; }
export async function putFile(data: Buffer) {
  const key = `sha256/${createHash("sha256").update(data).digest("hex")}`;
  await objectStore().putObject(bucketName(), key, data, data.length, { "Content-Type": "application/octet-stream" });
  return key;
}
export async function readFile(key: string | null | undefined, legacyData: Buffer | null): Promise<Buffer> {
  if (!key) { if (legacyData) return legacyData; throw new Error("File data is missing"); }
  const stream = await objectStore().getObject(bucketName(), key);
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
export async function storeFile(data: Buffer): Promise<{ key: string | null; data: Buffer | null }> {
  if (/^postgres(?:ql)?:\/\//.test(process.env.DATABASE_URL || "")) return { key: await putFile(data), data: null };
  return { key: null, data };
}
