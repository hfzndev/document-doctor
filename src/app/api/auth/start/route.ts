import type { NextRequest } from "next/server";
import { norflabsLoginUrl } from "@/lib/auth/norflabs";
import { safeNext } from "@/lib/auth/session";
import { config } from "@/lib/config";

// Send the user to auth.norflabs.com; it comes back to /api/auth/callback with ?ticket=.
export function GET(request: NextRequest) {
  const next = safeNext(request.nextUrl.searchParams.get("next"));
  const callback = `${config.publicUrl}/api/auth/callback?${new URLSearchParams({ next })}`;
  return Response.redirect(norflabsLoginUrl(callback), 303);
}
