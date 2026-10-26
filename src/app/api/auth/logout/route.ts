import { cookies } from "next/headers";
import { norflabsLogoutUrl } from "@/lib/auth/norflabs";
import { getSession, SESSION_COOKIE } from "@/lib/auth/session";
import { config } from "@/lib/config";

// Clear our cookie, then end the auth.norflabs.com session too (it redirects back to us).
export async function POST() {
  const session = await getSession();
  (await cookies()).delete(SESSION_COOKIE);
  const loggedOut = `${config.publicUrl}/login?signed_out=1`;
  const devUser = session?.roles.includes("dev");
  return Response.redirect(devUser ? loggedOut : norflabsLogoutUrl(loggedOut), 303);
}
