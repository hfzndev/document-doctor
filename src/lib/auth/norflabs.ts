// TypeScript port of norflabs-auth's sdk/nl_auth.py (app side).
//
// Flow: /login?app=<slug>&next=<our callback> on auth.norflabs.com -> the user signs in ->
// auth redirects to the callback with ?ticket=<one-time Ed25519 JWT, aud=<slug>, 60s> ->
// we POST it to /api/redeem (single use) -> we get the claims and set our OWN session cookie.
import "server-only";
import { config } from "../config";

export type NorflabsClaims = {
  sub: string;
  email: string;
  name: string;
  app: string;
  roles: string[];
  session_hours?: number;
};

export class TicketError extends Error {}

export function norflabsLoginUrl(callbackUrl: string): string {
  const params = new URLSearchParams({ app: config.norflabs.appSlug, next: callbackUrl });
  return `${config.norflabs.baseUrl}/login?${params}`;
}

export function norflabsLogoutUrl(nextUrl: string): string {
  return `${config.norflabs.baseUrl}/logout?${new URLSearchParams({ next: nextUrl })}`;
}

export function norflabsAccountUrl(): string {
  return `${config.norflabs.baseUrl}/account`;
}

/** Exchange a one-time ticket for claims. Throws TicketError when rejected. */
export async function redeemTicket(ticket: string): Promise<NorflabsClaims> {
  let res: Response;
  try {
    res = await fetch(`${config.norflabs.baseUrl}/api/redeem`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: ticket, app_slug: config.norflabs.appSlug }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    throw new TicketError(`auth server unreachable: ${(e as Error).message}`);
  }
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw new TicketError(`redeem rejected (${res.status}): ${detail}`);
  }
  const claims = (await res.json()) as NorflabsClaims;
  // Defense in depth: the ticket must be for this app.
  if (!claims?.sub || claims.app !== config.norflabs.appSlug) {
    throw new TicketError("ticket was issued for another app");
  }
  return { ...claims, roles: Array.isArray(claims.roles) ? claims.roles : [] };
}
