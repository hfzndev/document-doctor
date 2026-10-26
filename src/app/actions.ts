"use server";
// Every action re-checks the session and the caller's workspace role.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireDocument, requireTemplate, requireUser, requireWorkspace } from "@/lib/access";
import * as data from "@/lib/data";
import { deleteTemplateFile } from "@/lib/storage";

const str = (form: FormData, key: string, max = 200) => String(form.get(key) ?? "").trim().slice(0, max);

// ----------------------------------------------------------------- workspaces
export async function createWorkspace(form: FormData) {
  const user = await requireUser();
  const name = str(form, "name", 100);
  if (!name) return;
  const id = data.createWorkspace(user.id, name);
  redirect(`/w/${id}`);
}

export async function renameWorkspace(workspaceId: string, form: FormData) {
  const user = await requireUser();
  requireWorkspace(workspaceId, user, "admin");
  const name = str(form, "name", 100);
  if (name) data.renameWorkspace(workspaceId, name);
  revalidatePath(`/w/${workspaceId}`, "layout");
}

export async function deleteWorkspace(workspaceId: string) {
  const user = await requireUser();
  requireWorkspace(workspaceId, user, "owner");
  const templateIds = data.deleteWorkspace(workspaceId);
  await Promise.all(templateIds.map(deleteTemplateFile));
  redirect("/");
}

// ----------------------------------------------------------------- members & invites
export async function inviteMember(workspaceId: string, form: FormData) {
  const user = await requireUser();
  requireWorkspace(workspaceId, user, "admin");
  const email = str(form, "email", 254).toLowerCase();
  const role = form.get("role") === "admin" ? "admin" : "member";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) redirect(`/w/${workspaceId}/members?error=email`);
  if (data.listMembers(workspaceId).some((m) => m.email.toLowerCase() === email)) {
    redirect(`/w/${workspaceId}/members?error=member`);
  }
  const invite = data.createInvite(workspaceId, email, role, user.id);
  redirect(`/w/${workspaceId}/members?invited=${invite.id}`);
}

export async function revokeInvite(workspaceId: string, inviteId: string) {
  const user = await requireUser();
  requireWorkspace(workspaceId, user, "admin");
  data.revokeInvite(workspaceId, inviteId);
  revalidatePath(`/w/${workspaceId}/members`);
}

export async function acceptInvite(token: string) {
  const user = await requireUser(`/invite/${token}`);
  const invite = data.getInviteByToken(token);
  if (!invite || data.inviteProblem(invite, user)) redirect(`/invite/${token}`);
  data.acceptInvite(invite, user.id);
  redirect(`/w/${invite.workspace_id}`);
}

export async function changeRole(workspaceId: string, memberId: string, form: FormData) {
  const user = await requireUser();
  const { role: myRole } = requireWorkspace(workspaceId, user, "admin");
  const role = String(form.get("role")) as data.Role;
  if (!["owner", "admin", "member"].includes(role)) return;
  const current = data.getRole(workspaceId, memberId);
  if (!current) return;
  // Only owners can create or demote owners; never leave a workspace without an owner.
  if ((role === "owner" || current === "owner") && myRole !== "owner") return;
  if (current === "owner" && role !== "owner" && data.countOwners(workspaceId) <= 1) {
    redirect(`/w/${workspaceId}/members?error=last_owner`);
  }
  data.setRole(workspaceId, memberId, role);
  revalidatePath(`/w/${workspaceId}/members`);
}

export async function removeMember(workspaceId: string, memberId: string) {
  const user = await requireUser();
  const isSelf = memberId === user.id;
  const { role: myRole } = requireWorkspace(workspaceId, user, isSelf ? "member" : "admin");
  const target = data.getRole(workspaceId, memberId);
  if (!target) return;
  if (target === "owner" && !isSelf && myRole !== "owner") return;
  if (target === "owner" && data.countOwners(workspaceId) <= 1) redirect(`/w/${workspaceId}/members?error=last_owner`);
  data.removeMember(workspaceId, memberId);
  if (isSelf) redirect("/");
  revalidatePath(`/w/${workspaceId}/members`);
}

// ----------------------------------------------------------------- templates
export async function updateTemplate(templateId: string, form: FormData) {
  const user = await requireUser();
  requireTemplate(templateId, user);
  const name = str(form, "name");
  if (name) data.updateTemplate(templateId, name, str(form, "description", 1000));
  revalidatePath(`/t/${templateId}`);
}

export async function deleteTemplate(templateId: string) {
  const user = await requireUser();
  const { template, role } = requireTemplate(templateId, user);
  // Uploaders can remove their own templates; admins and owners can remove any.
  if (template.created_by !== user.id && role === "member") return;
  data.deleteTemplate(templateId);
  await deleteTemplateFile(templateId);
  redirect(`/w/${template.workspace_id}`);
}

// ----------------------------------------------------------------- documents
export async function createDocument(templateId: string, form?: FormData) {
  const user = await requireUser();
  const { template } = requireTemplate(templateId, user);
  const title = (form && str(form, "title")) || `${template.name} – ${new Date().toISOString().slice(0, 10)}`;
  const id = data.createDocument(template.workspace_id, template.id, title, user.id);
  redirect(`/d/${id}`);
}

export async function duplicateDocument(documentId: string) {
  const user = await requireUser();
  const { document } = requireDocument(documentId, user);
  redirect(`/d/${data.duplicateDocument(document, user.id)}`);
}

export async function deleteDocument(documentId: string) {
  const user = await requireUser();
  const { document, role } = requireDocument(documentId, user);
  if (document.created_by !== user.id && role === "member") return;
  data.deleteDocument(documentId);
  redirect(`/w/${document.workspace_id}`);
}
