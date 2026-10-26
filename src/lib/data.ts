// All SQL lives here. Callers are responsible for authorization (see access.ts).
import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { db, now } from "./db";

export type Role = "owner" | "admin" | "member";

export type User = { id: string; email: string; name: string };
export type Workspace = { id: string; name: string; created_at: number };
export type WorkspaceSummary = Workspace & { role: Role; templates: number; documents: number; members: number };
export type Member = User & { role: Role; joined_at: number };
export type Invite = {
  id: string;
  workspace_id: string;
  email: string;
  role: "admin" | "member";
  token: string;
  created_at: number;
  expires_at: number;
  accepted_at: number | null;
};
export type Template = {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  file_name: string;
  file_size: number;
  block_count: number;
  created_by: string;
  created_at: number;
  creator_name?: string;
};
export type DocumentRow = {
  id: string;
  workspace_id: string;
  template_id: string;
  set_id: string | null;
  title: string;
  values_json: string;
  created_by: string;
  updated_by: string;
  created_at: number;
  updated_at: number;
  template_name?: string;
  updater_name?: string;
  set_name?: string | null;
};

const INVITE_DAYS = 14;

// ----------------------------------------------------------------- users
export function upsertUser(authSub: string, email: string, name: string): User {
  const existing = db().prepare("SELECT id FROM users WHERE auth_sub = ?").get(authSub) as { id: string } | undefined;
  const t = now();
  if (existing) {
    db().prepare("UPDATE users SET email = ?, name = ?, last_login_at = ? WHERE id = ?").run(email, name, t, existing.id);
    return { id: existing.id, email, name };
  }
  const id = randomUUID();
  db()
    .prepare("INSERT INTO users (id, auth_sub, email, name, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(id, authSub, email, name, t, t);
  return { id, email, name };
}

export function getUser(id: string): User | null {
  return (db().prepare("SELECT id, email, name FROM users WHERE id = ?").get(id) as User | undefined) ?? null;
}

// ----------------------------------------------------------------- workspaces
export function listWorkspaces(userId: string): WorkspaceSummary[] {
  return db()
    .prepare(
      `SELECT w.id, w.name, w.created_at, m.role,
         (SELECT COUNT(*) FROM templates t WHERE t.workspace_id = w.id) AS templates,
         (SELECT COUNT(*) FROM documents d WHERE d.workspace_id = w.id) AS documents,
         (SELECT COUNT(*) FROM memberships x WHERE x.workspace_id = w.id) AS members
       FROM workspaces w JOIN memberships m ON m.workspace_id = w.id
       WHERE m.user_id = ? ORDER BY w.name COLLATE NOCASE`,
    )
    .all(userId) as WorkspaceSummary[];
}

export function createWorkspace(userId: string, name: string): string {
  const id = randomUUID();
  const t = now();
  db().transaction(() => {
    db().prepare("INSERT INTO workspaces (id, name, created_by, created_at) VALUES (?, ?, ?, ?)").run(id, name, userId, t);
    db()
      .prepare("INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)")
      .run(id, userId, t);
  })();
  return id;
}

export function getWorkspace(id: string): Workspace | null {
  return (db().prepare("SELECT id, name, created_at FROM workspaces WHERE id = ?").get(id) as Workspace | undefined) ?? null;
}

export function renameWorkspace(id: string, name: string) {
  db().prepare("UPDATE workspaces SET name = ? WHERE id = ?").run(name, id);
}

export function deleteWorkspace(id: string): string[] {
  const templateIds = (db().prepare("SELECT id FROM templates WHERE workspace_id = ?").all(id) as { id: string }[]).map(
    (r) => r.id,
  );
  db().prepare("DELETE FROM workspaces WHERE id = ?").run(id);
  return templateIds;
}

// ----------------------------------------------------------------- members
export function getRole(workspaceId: string, userId: string): Role | null {
  const row = db()
    .prepare("SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?")
    .get(workspaceId, userId) as { role: Role } | undefined;
  return row?.role ?? null;
}

export function listMembers(workspaceId: string): Member[] {
  return db()
    .prepare(
      `SELECT u.id, u.email, u.name, m.role, m.created_at AS joined_at
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = ?
       ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.email COLLATE NOCASE`,
    )
    .all(workspaceId) as Member[];
}

export function countOwners(workspaceId: string): number {
  return (
    db().prepare("SELECT COUNT(*) AS n FROM memberships WHERE workspace_id = ? AND role = 'owner'").get(workspaceId) as {
      n: number;
    }
  ).n;
}

export function setRole(workspaceId: string, userId: string, role: Role) {
  db().prepare("UPDATE memberships SET role = ? WHERE workspace_id = ? AND user_id = ?").run(role, workspaceId, userId);
}

export function removeMember(workspaceId: string, userId: string) {
  db().prepare("DELETE FROM memberships WHERE workspace_id = ? AND user_id = ?").run(workspaceId, userId);
}

// ----------------------------------------------------------------- invites
export function createInvite(workspaceId: string, email: string, role: "admin" | "member", invitedBy: string): Invite {
  const t = now();
  const invite: Invite = {
    id: randomUUID(),
    workspace_id: workspaceId,
    email: email.toLowerCase(),
    role,
    token: randomBytes(24).toString("base64url"),
    created_at: t,
    expires_at: t + INVITE_DAYS * 86400_000,
    accepted_at: null,
  };
  db().transaction(() => {
    // One open invite per email per workspace: re-inviting replaces the old link.
    db()
      .prepare("DELETE FROM invites WHERE workspace_id = ? AND email = ? COLLATE NOCASE AND accepted_at IS NULL")
      .run(workspaceId, invite.email);
    db()
      .prepare(
        `INSERT INTO invites (id, workspace_id, email, role, token, invited_by, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(invite.id, workspaceId, invite.email, role, invite.token, invitedBy, invite.created_at, invite.expires_at);
  })();
  return invite;
}

export function listOpenInvites(workspaceId: string): Invite[] {
  return db()
    .prepare(
      `SELECT id, workspace_id, email, role, token, created_at, expires_at, accepted_at FROM invites
       WHERE workspace_id = ? AND accepted_at IS NULL AND expires_at > ? ORDER BY created_at DESC`,
    )
    .all(workspaceId, now()) as Invite[];
}

export function pendingInvitesFor(email: string, userId: string): (Invite & { workspace_name: string })[] {
  return db()
    .prepare(
      `SELECT i.id, i.workspace_id, i.email, i.role, i.token, i.created_at, i.expires_at, i.accepted_at,
              w.name AS workspace_name
       FROM invites i JOIN workspaces w ON w.id = i.workspace_id
       WHERE i.email = ? COLLATE NOCASE AND i.accepted_at IS NULL AND i.expires_at > ?
         AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.workspace_id = i.workspace_id AND m.user_id = ?)
       ORDER BY i.created_at DESC`,
    )
    .all(email, now(), userId) as (Invite & { workspace_name: string })[];
}

export function getInviteByToken(token: string): (Invite & { workspace_name: string }) | null {
  return (
    (db()
      .prepare(
        `SELECT i.id, i.workspace_id, i.email, i.role, i.token, i.created_at, i.expires_at, i.accepted_at,
                w.name AS workspace_name
         FROM invites i JOIN workspaces w ON w.id = i.workspace_id WHERE i.token = ?`,
      )
      .get(token) as (Invite & { workspace_name: string }) | undefined) ?? null
  );
}

/** Why `user` can't use this invite, or null when they can. */
export function inviteProblem(invite: Invite | null, user: User): string | null {
  if (!invite) return "This invite link is not valid. It may have been revoked.";
  if (invite.accepted_at) return "This invite has already been used.";
  if (invite.expires_at < now()) return "This invite has expired. Ask for a new one.";
  if (invite.email.toLowerCase() !== user.email.toLowerCase())
    return `This invite is for ${invite.email}, but you are signed in as ${user.email}.`;
  return null;
}

export function acceptInvite(invite: Invite, userId: string) {
  const t = now();
  db().transaction(() => {
    db()
      .prepare(
        `INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (workspace_id, user_id) DO NOTHING`,
      )
      .run(invite.workspace_id, userId, invite.role, t);
    db().prepare("UPDATE invites SET accepted_at = ?, accepted_by = ? WHERE id = ?").run(t, userId, invite.id);
  })();
}

export function revokeInvite(workspaceId: string, inviteId: string) {
  db().prepare("DELETE FROM invites WHERE id = ? AND workspace_id = ? AND accepted_at IS NULL").run(inviteId, workspaceId);
}

// ----------------------------------------------------------------- templates
export function createTemplate(t: Omit<Template, "created_at" | "creator_name">) {
  db()
    .prepare(
      `INSERT INTO templates (id, workspace_id, name, description, file_name, file_size, block_count, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(t.id, t.workspace_id, t.name, t.description, t.file_name, t.file_size, t.block_count, t.created_by, now());
}

export function listTemplates(workspaceId: string): Template[] {
  return db()
    .prepare(
      `SELECT t.*, u.name AS creator_name FROM templates t JOIN users u ON u.id = t.created_by
       WHERE t.workspace_id = ? ORDER BY t.created_at DESC`,
    )
    .all(workspaceId) as Template[];
}

export function getTemplate(id: string): Template | null {
  return (
    (db()
      .prepare("SELECT t.*, u.name AS creator_name FROM templates t JOIN users u ON u.id = t.created_by WHERE t.id = ?")
      .get(id) as Template | undefined) ?? null
  );
}

export function updateTemplate(id: string, name: string, description: string) {
  db().prepare("UPDATE templates SET name = ?, description = ? WHERE id = ?").run(name, description, id);
}

export function deleteTemplate(id: string) {
  db().transaction(() => {
    db()
      .prepare("DELETE FROM field_values WHERE owner_id IN (SELECT id FROM documents WHERE template_id = ?)")
      .run(id);
    db().prepare("DELETE FROM templates WHERE id = ?").run(id);
  })();
}

// ----------------------------------------------------------------- documents
export function createDocument(
  workspaceId: string,
  templateId: string,
  title: string,
  userId: string,
  setId: string | null = null,
): string {
  const id = randomUUID();
  const t = now();
  db()
    .prepare(
      `INSERT INTO documents (id, workspace_id, template_id, set_id, title, values_json, created_by, updated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '{}', ?, ?, ?, ?)`,
    )
    .run(id, workspaceId, templateId, setId, title, userId, userId, t, t);
  return id;
}

export function listDocuments(workspaceId: string, filter: { templateId?: string; setId?: string } = {}): DocumentRow[] {
  const templateId = filter.templateId ?? null;
  const setId = filter.setId ?? null;
  return db()
    .prepare(
      `SELECT d.*, t.name AS template_name, u.name AS updater_name, s.name AS set_name
       FROM documents d JOIN templates t ON t.id = d.template_id JOIN users u ON u.id = d.updated_by
       LEFT JOIN sets s ON s.id = d.set_id
       WHERE d.workspace_id = ? AND (? IS NULL OR d.template_id = ?) AND (? IS NULL OR d.set_id = ?)
       ORDER BY d.updated_at DESC`,
    )
    .all(workspaceId, templateId, templateId, setId, setId) as DocumentRow[];
}

export function getDocument(id: string): DocumentRow | null {
  return (
    (db()
      .prepare(
        `SELECT d.*, t.name AS template_name, u.name AS updater_name, s.name AS set_name
         FROM documents d JOIN templates t ON t.id = d.template_id JOIN users u ON u.id = d.updated_by
         LEFT JOIN sets s ON s.id = d.set_id
         WHERE d.id = ?`,
      )
      .get(id) as DocumentRow | undefined) ?? null
  );
}

export function updateDocument(id: string, fields: { title?: string; values?: Record<string, string> }, userId: string) {
  const doc = getDocument(id);
  if (!doc) return null;
  const title = fields.title ?? doc.title;
  const values = fields.values ? JSON.stringify(fields.values) : doc.values_json;
  const t = now();
  db()
    .prepare("UPDATE documents SET title = ?, values_json = ?, updated_by = ?, updated_at = ? WHERE id = ?")
    .run(title, values, userId, t, id);
  return t;
}

export function duplicateDocument(doc: DocumentRow, userId: string): string {
  const id = createDocument(doc.workspace_id, doc.template_id, `${doc.title} (copy)`, userId, doc.set_id);
  db().transaction(() => {
    db().prepare("UPDATE documents SET values_json = ? WHERE id = ?").run(doc.values_json, id);
    if (!doc.set_id) {
      // Standalone documents own their field values; copy them too.
      db()
        .prepare(
          `INSERT INTO field_values (owner_id, field_id, value, updated_at)
           SELECT ?, field_id, value, updated_at FROM field_values WHERE owner_id = ?`,
        )
        .run(id, doc.id);
    }
  })();
  return id;
}

export function deleteDocument(id: string) {
  db().transaction(() => {
    db().prepare("DELETE FROM field_values WHERE owner_id = ?").run(id);
    db().prepare("DELETE FROM documents WHERE id = ?").run(id);
  })();
}
