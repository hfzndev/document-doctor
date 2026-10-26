// Authorization helpers. Every page, server action and route handler goes through these.
import "server-only";
import { notFound, redirect } from "next/navigation";
import { getSession } from "./auth/session";
import { config } from "./config";
import { getDocument, getRole, getTemplate, getUser, getWorkspace, type Role, type User } from "./data";

const RANK: Record<Role, number> = { member: 0, admin: 1, owner: 2 };

export const atLeast = (role: Role, min: Role) => RANK[role] >= RANK[min];

export async function currentUser(): Promise<User | null> {
  const session = await getSession();
  return session ? getUser(session.userId) : null;
}

/** For pages and server actions: redirect to /login when signed out. */
export async function requireUser(next = "/"): Promise<User> {
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}

/** Membership check; non-members get a 404 so workspace ids don't leak. */
export function requireWorkspace(workspaceId: string, user: User, min: Role = "member") {
  const workspace = getWorkspace(workspaceId);
  const role = workspace ? getRole(workspaceId, user.id) : null;
  if (!workspace || !role) notFound();
  if (!atLeast(role, min)) notFound();
  return { workspace, role };
}

export function requireTemplate(templateId: string, user: User, min: Role = "member") {
  const template = getTemplate(templateId);
  if (!template) notFound();
  return { template, ...requireWorkspace(template.workspace_id, user, min) };
}

export function requireDocument(documentId: string, user: User, min: Role = "member") {
  const document = getDocument(documentId);
  if (!document) notFound();
  return { document, ...requireWorkspace(document.workspace_id, user, min) };
}

// ----------------------------------------------------------------- route handlers
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Route-handler variants: throw HttpError instead of redirecting. */
export async function apiUser(): Promise<User> {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Not signed in");
  return user;
}

export function apiRole(workspaceId: string, user: User, min: Role = "member"): Role {
  const role = getRole(workspaceId, user.id);
  if (!role || !atLeast(role, min)) throw new HttpError(404, "Not found");
  return role;
}

/** CSRF guard for mutating route handlers (on top of SameSite=Lax cookies). */
export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== config.publicUrl && origin !== new URL(request.url).origin) {
    throw new HttpError(403, "Cross-origin request refused");
  }
}

export function apiError(e: unknown): Response {
  if (e instanceof HttpError) return Response.json({ error: e.message }, { status: e.status });
  console.error(e);
  return Response.json({ error: "Internal error" }, { status: 500 });
}
