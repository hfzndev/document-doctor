import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/access";
import { safeNext } from "@/lib/auth/session";
import { config } from "@/lib/config";
import { Logo } from "@/components/logo";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  missing_ticket: "Sign-in was cancelled. Please try again.",
  ticket_rejected: "Your sign-in link expired or was already used. Please sign in again.",
  auth_unreachable: "Norflabs Auth is not reachable right now. Please try again in a moment.",
  invalid_email: "Enter a valid email address.",
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeNext(typeof params.next === "string" ? params.next : "/");
  if (await currentUser()) redirect(next);
  const error = typeof params.error === "string" ? ERRORS[params.error] ?? "Sign-in failed." : null;

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center text-center">
          <Logo className="h-11 w-11" />
          <h1 className="mt-4 text-2xl font-semibold tracking-tight">Document Doctor</h1>
          <p className="mt-2 text-sm text-slate-500">
            Fill in your team&apos;s Word templates on the web, preview them live, and export DOCX or PDF.
          </p>
        </div>
        <div className="card space-y-4 p-6">
          {params.signed_out && !error && (
            <p className="rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-600">You have been signed out.</p>
          )}
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
          <a href={`/api/auth/start?${new URLSearchParams({ next })}`} className="btn btn-primary w-full py-2.5">
            Sign in with Norflabs
          </a>
          <p className="text-center text-xs text-slate-500">
            Accounts are managed by Norflabs Auth. Ask your administrator for access to <b>Document Doctor</b>.
          </p>
          {config.devLogin && (
            <form action="/api/auth/dev" method="post" className="space-y-3 border-t border-dashed border-amber-300 pt-4">
              <p className="text-xs font-medium text-amber-700">Development sign-in (AUTH_DEV_LOGIN=true)</p>
              <input type="hidden" name="next" value={next} />
              <input name="email" type="email" required placeholder="you@example.com" className="input" />
              <input name="name" placeholder="Display name (optional)" className="input" />
              <button className="btn w-full">Continue as this user</button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
