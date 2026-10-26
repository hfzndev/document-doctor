import "server-only";
import path from "node:path";

function env(name: string, fallback = ""): string {
  return (process.env[name] ?? "").trim() || fallback;
}

const publicUrl = env("APP_PUBLIC_URL", "http://localhost:3000").replace(/\/+$/, "");

export const config = {
  /** Public origin of this app; must match the origin registered in norflabs-auth. */
  publicUrl,
  dataDir: path.resolve(/*turbopackIgnore: true*/ env("DATA_DIR", "./data")),
  /** Signs this app's own session cookie (HS256). */
  sessionSecret: env("SESSION_SECRET"),
  sessionHours: Number(env("SESSION_HOURS", "12")) || 12,
  secureCookies: publicUrl.startsWith("https://"),

  norflabs: {
    baseUrl: env("NL_AUTH_BASE_URL", "https://auth.norflabs.com").replace(/\/+$/, ""),
    appSlug: env("NL_APP_SLUG", "docs"),
  },

  /**
   * Local-only sign-in with just an email, for development without norflabs-auth.
   * Never enable this on a deployed server.
   */
  devLogin: env("AUTH_DEV_LOGIN") === "true",

  /** Used for "today" in date fields and for numbering periods. */
  timeZone: env("APP_TIMEZONE", "Asia/Jakarta"),

  sofficePath: env("SOFFICE_PATH", "soffice"),
  maxUploadBytes: (Number(env("MAX_UPLOAD_MB", "20")) || 20) * 1024 * 1024,
};

export function sessionSecretBytes(): Uint8Array {
  const secret = config.sessionSecret;
  if (secret.length < 32) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET must be set to at least 32 characters.");
    }
    return new TextEncoder().encode("dev-only-session-secret-change-me-please");
  }
  return new TextEncoder().encode(secret);
}
