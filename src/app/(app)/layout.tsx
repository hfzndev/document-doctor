import Link from "next/link";
import { currentUser } from "@/lib/access";
import { norflabsAccountUrl } from "@/lib/auth/norflabs";
import { Logo } from "@/components/logo";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await currentUser();
  return (
    <>
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-4 px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <Logo />
            <span className="hidden sm:inline">Document Doctor</span>
          </Link>
          <div className="flex-1" />
          {user && (
            <div className="flex items-center gap-2">
              <a href={norflabsAccountUrl()} className="hidden text-right text-xs leading-tight sm:block" title="Manage account">
                <div className="font-medium text-slate-800">{user.name}</div>
                <div className="text-slate-500">{user.email}</div>
              </a>
              <form action="/api/auth/logout" method="post">
                <button className="btn btn-ghost">Sign out</button>
              </form>
            </div>
          )}
        </div>
      </header>
      <div className="flex flex-1 flex-col">{children}</div>
    </>
  );
}
