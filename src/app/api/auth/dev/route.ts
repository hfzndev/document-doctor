import { cookies } from "next/headers";
import { createSessionCookie, safeNext } from "@/lib/auth/session";
import { config } from "@/lib/config";
import { upsertUser } from "@/lib/data";

// Development-only sign-in (AUTH_DEV_LOGIN=true). Lets you run the app without norflabs-auth.
export async function POST(request: Request) {
  if (!config.devLogin) return new Response("Not found", { status: 404 });
  const form = await request.formData();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const next = safeNext(String(form.get("next") ?? "/"));
  if (!/^[^\s@]+@[^\s@]+$/.test(email)) {
    return Response.redirect(`${config.publicUrl}/login?error=invalid_email`, 303);
  }
  const user = upsertUser(`dev:${email}`, email, String(form.get("name") ?? "").trim() || email.split("@")[0]);
  const cookie = await createSessionCookie({ userId: user.id, email: user.email, name: user.name, roles: ["dev"] });
  (await cookies()).set(cookie.name, cookie.value, cookie.options);
  return Response.redirect(`${config.publicUrl}${next}`, 303);
}
