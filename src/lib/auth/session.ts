// This app's own session cookie: an HS256 JWT signed with SESSION_SECRET, aud = app slug,
// so a cookie from another Norflabs app can never be replayed here.
import "server-only";
import { jwtVerify, SignJWT } from "jose";
import { cookies } from "next/headers";
import { config, sessionSecretBytes } from "../config";

export const SESSION_COOKIE = "dd_session";
const ISSUER = "document-doctor";

export type Session = {
  userId: string;
  email: string;
  name: string;
  roles: string[];
};

export async function createSessionCookie(session: Session, hours = config.sessionHours) {
  const token = await new SignJWT({ email: session.email, name: session.name, roles: session.roles })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(session.userId)
    .setIssuer(ISSUER)
    .setAudience(config.norflabs.appSlug)
    .setIssuedAt()
    .setExpirationTime(`${hours}h`)
    .sign(sessionSecretBytes());
  return {
    name: SESSION_COOKIE,
    value: token,
    options: {
      httpOnly: true,
      sameSite: "lax" as const,
      secure: config.secureCookies,
      path: "/",
      maxAge: hours * 3600,
    },
  };
}

export async function readSession(token: string | undefined): Promise<Session | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionSecretBytes(), {
      issuer: ISSUER,
      audience: config.norflabs.appSlug,
      algorithms: ["HS256"],
    });
    if (!payload.sub) return null;
    return {
      userId: payload.sub,
      email: String(payload.email ?? ""),
      name: String(payload.name ?? ""),
      roles: Array.isArray(payload.roles) ? payload.roles.map(String) : [],
    };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  return readSession((await cookies()).get(SESSION_COOKIE)?.value);
}

/** Only allow same-origin relative paths as post-login destinations. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}
