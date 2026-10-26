import { cookies } from "next/headers";
import type { NextRequest } from "next/server";
import { redeemTicket, TicketError } from "@/lib/auth/norflabs";
import { createSessionCookie, safeNext } from "@/lib/auth/session";
import { config } from "@/lib/config";
import { upsertUser } from "@/lib/data";

export async function GET(request: NextRequest) {
  const ticket = request.nextUrl.searchParams.get("ticket") ?? "";
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  const fail = (reason: string) =>
    Response.redirect(`${config.publicUrl}/login?${new URLSearchParams({ error: reason, next })}`, 303);

  if (!ticket) return fail("missing_ticket");
  let claims;
  try {
    claims = await redeemTicket(ticket);
  } catch (e) {
    console.warn("[auth] ticket rejected:", (e as Error).message);
    return fail(e instanceof TicketError && /unreachable/.test(e.message) ? "auth_unreachable" : "ticket_rejected");
  }

  const user = upsertUser(`norflabs:${claims.sub}`, claims.email, claims.name || claims.email.split("@")[0]);
  const hours = Math.min(claims.session_hours || config.sessionHours, 24 * 7);
  const cookie = await createSessionCookie(
    { userId: user.id, email: user.email, name: user.name, roles: claims.roles },
    hours,
  );
  (await cookies()).set(cookie.name, cookie.value, cookie.options);
  return Response.redirect(`${config.publicUrl}${next}`, 303);
}
