"use server";
// Every action re-checks the session and the caller's workspace role.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { atLeast, requireDocument, requireTemplate, requireUser, requireWorkspace } from "@/lib/access";
import * as data from "@/lib/data";
import * as fieldsData from "@/lib/data-fields";
import { setContext } from "@/lib/render";
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
  redirect(document.set_id ? `/s/${document.set_id}` : `/w/${document.workspace_id}`);
}

// ----------------------------------------------------------------- shared fields
export async function createFieldAction(workspaceId: string, form: FormData) {
  const user = await requireUser();
  requireWorkspace(workspaceId, user);
  const input = fieldsData.parseFieldInput(Object.fromEntries(form));
  const res = typeof input === "string" ? input : fieldsData.createField(workspaceId, input, user.id);
  if (typeof res === "string") redirect(`/w/${workspaceId}/fields?error=${encodeURIComponent(res)}`);
  revalidatePath(`/w/${workspaceId}/fields`);
}

function requireFieldEditor(field: fieldsData.FieldRow | null, user: data.User) {
  if (!field) return null;
  const { role } = requireWorkspace(field.workspace_id, user);
  // Admins can change any field; members only the ones they created.
  return atLeast(role, "admin") || field.created_by === user.id ? field : null;
}

export async function updateFieldAction(fieldId: string, form: FormData) {
  const user = await requireUser();
  const field = requireFieldEditor(fieldsData.getField(fieldId), user);
  if (!field) return;
  const input = fieldsData.parseFieldInput(Object.fromEntries(form));
  const err = typeof input === "string" ? input : fieldsData.updateField(field, input);
  if (err) redirect(`/w/${field.workspace_id}/fields?error=${encodeURIComponent(err)}`);
  revalidatePath(`/w/${field.workspace_id}/fields`);
}

export async function deleteFieldAction(fieldId: string) {
  const user = await requireUser();
  const field = requireFieldEditor(fieldsData.getField(fieldId), user);
  if (!field) return;
  fieldsData.deleteField(fieldId);
  revalidatePath(`/w/${field.workspace_id}/fields`);
}

// ----------------------------------------------------------------- document sets
export async function createSetAction(workspaceId: string, form: FormData) {
  const user = await requireUser();
  requireWorkspace(workspaceId, user);
  const name = str(form, "name") || `Set ${new Date().toISOString().slice(0, 10)}`;
  const templateIds = form.getAll("templates").map(String);
  const templates = templateIds
    .map((id) => data.getTemplate(id))
    .filter((t): t is data.Template => !!t && t.workspace_id === workspaceId);
  const setId = fieldsData.createSet(workspaceId, name, user.id);
  for (const t of templates) data.createDocument(workspaceId, t.id, `${t.name} – ${name}`, user.id, setId);
  // Assign the set's numbers and dates right away.
  await setContext(setId, data.listDocuments(workspaceId, { setId }), fieldsData.listFields(workspaceId));
  redirect(`/s/${setId}`);
}

function requireSet(setId: string, user: data.User, min: data.Role = "member") {
  const set = fieldsData.getSet(setId);
  if (!set) redirect("/");
  return { set, ...requireWorkspace(set.workspace_id, user, min) };
}

export async function renameSetAction(setId: string, form: FormData) {
  const user = await requireUser();
  requireSet(setId, user);
  const name = str(form, "name");
  if (name) fieldsData.renameSet(setId, name);
  revalidatePath(`/s/${setId}`);
}

export async function addDocumentToSet(setId: string, form: FormData) {
  const user = await requireUser();
  const { set } = requireSet(setId, user);
  const template = data.getTemplate(str(form, "template"));
  if (!template || template.workspace_id !== set.workspace_id) return;
  data.createDocument(set.workspace_id, template.id, `${template.name} – ${set.name}`, user.id, set.id);
  fieldsData.touchSet(set.id);
  await setContext(set.id, data.listDocuments(set.workspace_id, { setId }), fieldsData.listFields(set.workspace_id));
  revalidatePath(`/s/${setId}`);
}

export async function deleteSetAction(setId: string) {
  const user = await requireUser();
  const { set, role } = requireSet(setId, user);
  if (set.created_by !== user.id && role === "member") return;
  fieldsData.deleteSet(setId);
  redirect(`/w/${set.workspace_id}`);
}
