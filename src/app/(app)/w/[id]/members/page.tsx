import Link from "next/link";
import { changeRole, deleteWorkspace, inviteMember, removeMember, renameWorkspace, revokeInvite } from "@/app/actions";
import { atLeast, requireUser, requireWorkspace } from "@/lib/access";
import { config } from "@/lib/config";
import { listMembers, listOpenInvites } from "@/lib/data";
import { timeAgo } from "@/lib/format";
import { AutoSubmitSelect, ConfirmButton, CopyButton, SubmitButton } from "@/components/ui";

const ERRORS: Record<string, string> = {
  email: "Enter a valid email address.",
  member: "That person is already a member.",
  last_owner: "A workspace needs at least one owner. Make someone else owner first.",
};

export default async function MembersPage({ params, searchParams }: PageProps<"/w/[id]/members">) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser(`/w/${id}/members`);
  const { workspace, role } = requireWorkspace(id, user);
  const canManage = atLeast(role, "admin");
  const members = listMembers(id);
  const invites = canManage ? listOpenInvites(id) : [];
  const error = typeof sp.error === "string" ? ERRORS[sp.error] : null;

  return (
    <main className="mx-auto w-full max-w-4xl px-4 py-8">
      <nav className="text-sm text-slate-500">
        <Link href="/" className="hover:text-slate-800">Workspaces</Link> /{" "}
        <Link href={`/w/${id}`} className="hover:text-slate-800">{workspace.name}</Link> /
      </nav>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Members</h1>
      {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

      {canManage && (
        <section className="card mt-6 p-5">
          <h2 className="font-semibold">Invite someone</h2>
          <p className="mt-1 text-sm text-slate-500">
            They sign in with their Norflabs account (it needs access to Document Doctor), then open the link or
            accept the invite on their dashboard. Links expire after 14 days.
          </p>
          <form action={inviteMember.bind(null, id)} className="mt-4 flex flex-wrap gap-2">
            <input name="email" type="email" required placeholder="colleague@company.com" className="input max-w-xs flex-1" />
            <select name="role" className="input w-32" defaultValue="member">
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
            <SubmitButton>Create invite</SubmitButton>
          </form>
          {invites.length > 0 && (
            <ul className="mt-5 divide-y divide-slate-100 rounded-lg border border-slate-200">
              {invites.map((inv) => {
                const link = `${config.publicUrl}/invite/${inv.token}`;
                return (
                  <li
                    key={inv.id}
                    className={`flex flex-wrap items-center gap-2 px-3 py-2 text-sm ${sp.invited === inv.id ? "bg-brand-50" : ""}`}
                  >
                    <span className="flex-1 truncate">
                      <b>{inv.email}</b> <span className="text-slate-500">· {inv.role} · sent {timeAgo(inv.created_at)}</span>
                    </span>
                    <CopyButton text={link} />
                    <form action={revokeInvite.bind(null, id, inv.id)}>
                      <button className="btn btn-ghost text-red-700">Revoke</button>
                    </form>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      <section className="card mt-6 overflow-hidden">
        <ul className="divide-y divide-slate-100">
          {members.map((m) => {
            const editable = canManage && m.id !== user.id && (m.role !== "owner" || role === "owner");
            return (
              <li key={m.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
                  {(m.name || m.email).slice(0, 1).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">
                    {m.name} {m.id === user.id && <span className="text-slate-400">(you)</span>}
                  </div>
                  <div className="truncate text-sm text-slate-500">{m.email}</div>
                </div>
                {editable ? (
                  <>
                    <form action={changeRole.bind(null, id, m.id)}>
                      <AutoSubmitSelect name="role" defaultValue={m.role} className="input w-28 py-1.5" aria-label="Role">
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                        {role === "owner" && <option value="owner">Owner</option>}
                      </AutoSubmitSelect>
                    </form>
                    <form action={removeMember.bind(null, id, m.id)}>
                      <ConfirmButton message={`Remove ${m.email} from ${workspace.name}?`} className="btn btn-ghost text-red-700">
                        Remove
                      </ConfirmButton>
                    </form>
                  </>
                ) : (
                  <span className="chip capitalize">{m.role}</span>
                )}
                {m.id === user.id && (
                  <form action={removeMember.bind(null, id, m.id)}>
                    <ConfirmButton message={`Leave ${workspace.name}?`} className="btn btn-ghost text-slate-600">
                      Leave
                    </ConfirmButton>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      </section>

      {canManage && (
        <section className="card mt-6 p-5">
          <h2 className="font-semibold">Workspace settings</h2>
          <form action={renameWorkspace.bind(null, id)} className="mt-3 flex gap-2">
            <input name="name" defaultValue={workspace.name} required maxLength={100} className="input max-w-sm" />
            <SubmitButton className="btn">Rename</SubmitButton>
          </form>
          {role === "owner" && (
            <form action={deleteWorkspace.bind(null, id)} className="mt-6 border-t border-slate-100 pt-4">
              <ConfirmButton message={`Delete ${workspace.name} with all its templates and documents? This cannot be undone.`}>
                Delete workspace
              </ConfirmButton>
            </form>
          )}
        </section>
      )}
    </main>
  );
}
