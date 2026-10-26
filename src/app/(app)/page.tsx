import Link from "next/link";
import { acceptInvite, createWorkspace } from "@/app/actions";
import { requireUser } from "@/lib/access";
import { listWorkspaces, pendingInvitesFor } from "@/lib/data";
import { SubmitButton } from "@/components/ui";

export default async function Dashboard() {
  const user = await requireUser("/");
  const workspaces = listWorkspaces(user.id);
  const invites = pendingInvitesFor(user.email, user.id);

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Workspaces</h1>
      <p className="mt-1 text-sm text-slate-500">
        Everyone in a workspace shares its templates and documents.
      </p>

      {invites.length > 0 && (
        <section className="mt-6 space-y-2">
          {invites.map((inv) => (
            <div key={inv.id} className="card flex flex-wrap items-center gap-3 border-brand-100 bg-brand-50 p-4">
              <div className="flex-1 text-sm">
                You were invited to <b>{inv.workspace_name}</b> as {inv.role}.
              </div>
              <form action={acceptInvite.bind(null, inv.token)}>
                <SubmitButton>Join workspace</SubmitButton>
              </form>
            </div>
          ))}
        </section>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {workspaces.map((w) => (
          <Link key={w.id} href={`/w/${w.id}`} className="card group p-5 transition hover:border-brand-500">
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-semibold group-hover:text-brand-700">{w.name}</h2>
              <span className="chip capitalize">{w.role}</span>
            </div>
            <p className="mt-3 text-sm text-slate-500">
              {w.templates} template{w.templates === 1 ? "" : "s"} · {w.documents} document
              {w.documents === 1 ? "" : "s"} · {w.members} member{w.members === 1 ? "" : "s"}
            </p>
          </Link>
        ))}
        <form action={createWorkspace} className="card flex flex-col gap-3 border-dashed p-5">
          <label className="label" htmlFor="ws-name">
            {workspaces.length ? "New workspace" : "Create your first workspace"}
          </label>
          <input id="ws-name" name="name" required maxLength={100} placeholder="e.g. Norflabs Legal" className="input" />
          <SubmitButton>Create workspace</SubmitButton>
        </form>
      </div>
    </main>
  );
}
