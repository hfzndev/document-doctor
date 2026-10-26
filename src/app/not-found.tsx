import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-3 px-4 py-24 text-center">
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="text-sm text-slate-500">This page doesn&apos;t exist, or you don&apos;t have access to it.</p>
      <Link href="/" className="btn">Back to dashboard</Link>
    </main>
  );
}
