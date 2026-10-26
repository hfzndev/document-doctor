import Link from "next/link";
import { redirect } from "next/navigation";
import { acceptInvite } from "@/app/actions";
import { requireUser } from "@/lib/access";
import { getInviteByToken, getRole, inviteProblem } from "@/lib/data";
import { SubmitButton } from "@/components/ui";

export default async function InvitePage({ params }: PageProps<"/invite/[token]">) {
  const { token } = await params;
  const user = await requireUser(`/invite/${token}`);
  const invite = getInviteByToken(token);

  if (invite && getRole(invite.workspace_id, user.id)) redirect(`/w/${invite.workspace_id}`);

  const problem = inviteProblem(invite, user);

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="card w-full max-w-md p-6 text-center">
        {problem ? (
          <>
            <h1 className="text-lg font-semibold">Can&apos;t join workspace</h1>
            <p className="mt-2 text-sm text-slate-600">{problem}</p>
            <Link href="/" className="btn mt-5">Go to dashboard</Link>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold">Join {invite!.workspace_name}</h1>
            <p className="mt-2 text-sm text-slate-600">You&apos;ve been invited as {invite!.role}.</p>
            <form action={acceptInvite.bind(null, token)} className="mt-5">
              <SubmitButton>Join workspace</SubmitButton>
            </form>
          </>
        )}
      </div>
    </main>
  );
}
