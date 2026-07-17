import bcrypt from "bcryptjs";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import type { SessionUser } from "./types";

export const SESSION_COOKIE = "crm_session";

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function sessionDays() {
  const configured = Number(process.env.SESSION_DAYS || 7);
  return Number.isFinite(configured) && configured > 0 ? configured : 7;
}

export async function verifyCredentials(username: string, password: string) {
  const db = getDb();
  const user = db
    .prepare(`
      SELECT id, username, name, password_hash AS passwordHash, role, status
      FROM users
      WHERE username = ? COLLATE NOCASE
    `)
    .get(username.trim()) as (SessionUser & { passwordHash: string }) | undefined;

  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    return { ok: false as const, reason: "invalid" as const };
  }
  if (user.status !== "active") {
    return { ok: false as const, reason: "disabled" as const };
  }
  const { passwordHash: _passwordHash, ...safeUser } = user;
  void _passwordHash;
  return { ok: true as const, user: safeUser };
}

export async function createSession(userId: number) {
  const db = getDb();
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionDays() * 24 * 60 * 60 * 1000);
  db.prepare("DELETE FROM sessions WHERE datetime(expires_at) <= datetime('now')").run();
  db.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)",
  ).run(hashToken(token), userId, expiresAt.toISOString());

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  }
  store.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const user = getDb()
    .prepare(`
      SELECT u.id, u.username, u.name, u.role, u.status
      FROM sessions s
      JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?
        AND datetime(s.expires_at) > datetime('now')
        AND u.status = 'active'
    `)
    .get(hashToken(token)) as SessionUser | undefined;

  return user || null;
}

export async function requirePageUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function requirePageAdmin() {
  const user = await requirePageUser();
  if (user.role !== "admin") redirect("/dashboard");
  return user;
}

export function invalidateUserSessions(userId: number) {
  getDb().prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}
