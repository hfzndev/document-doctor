import "server-only";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { config } from "./config";

// Each entry upgrades the schema by one version (PRAGMA user_version). Append, never edit.
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id            TEXT PRIMARY KEY,
    auth_sub      TEXT NOT NULL UNIQUE,
    email         TEXT NOT NULL,
    name          TEXT NOT NULL DEFAULT '',
    created_at    INTEGER NOT NULL,
    last_login_at INTEGER NOT NULL
  );
  CREATE INDEX users_email ON users (email COLLATE NOCASE);

  CREATE TABLE workspaces (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES users (id),
    created_at INTEGER NOT NULL
  );

  CREATE TABLE memberships (
    workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    user_id      TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    role         TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
    created_at   INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, user_id)
  );
  CREATE INDEX memberships_user ON memberships (user_id);

  CREATE TABLE invites (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    email        TEXT NOT NULL,
    role         TEXT NOT NULL CHECK (role IN ('admin', 'member')),
    token        TEXT NOT NULL UNIQUE,
    invited_by   TEXT NOT NULL REFERENCES users (id),
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL,
    accepted_at  INTEGER,
    accepted_by  TEXT REFERENCES users (id)
  );
  CREATE INDEX invites_email ON invites (email COLLATE NOCASE);

  CREATE TABLE templates (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    description  TEXT NOT NULL DEFAULT '',
    file_name    TEXT NOT NULL,
    file_size    INTEGER NOT NULL,
    block_count  INTEGER NOT NULL,
    created_by   TEXT NOT NULL REFERENCES users (id),
    created_at   INTEGER NOT NULL
  );
  CREATE INDEX templates_workspace ON templates (workspace_id);

  CREATE TABLE documents (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    template_id  TEXT NOT NULL REFERENCES templates (id) ON DELETE CASCADE,
    title        TEXT NOT NULL,
    values_json  TEXT NOT NULL DEFAULT '{}',
    created_by   TEXT NOT NULL REFERENCES users (id),
    updated_by   TEXT NOT NULL REFERENCES users (id),
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );
  CREATE INDEX documents_workspace ON documents (workspace_id, updated_at DESC);
  `,
  // v2: shared fields, template marks, document sets
  `
  CREATE TABLE fields (
    id             TEXT PRIMARY KEY,
    workspace_id   TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    name           TEXT NOT NULL,
    type           TEXT NOT NULL CHECK (type IN ('text', 'date', 'number')),
    date_format    TEXT NOT NULL DEFAULT 'id_long' CHECK (date_format IN ('id_long', 'dmy', 'iso')),
    number_pattern TEXT NOT NULL DEFAULT '{seq:3}',
    number_reset   TEXT NOT NULL DEFAULT 'yearly' CHECK (number_reset IN ('yearly', 'monthly', 'never')),
    default_value  TEXT NOT NULL DEFAULT '',
    created_by     TEXT NOT NULL REFERENCES users (id),
    created_at     INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX fields_name ON fields (workspace_id, name COLLATE NOCASE);

  CREATE TABLE field_counters (
    field_id   TEXT NOT NULL REFERENCES fields (id) ON DELETE CASCADE,
    period     TEXT NOT NULL,
    last_value INTEGER NOT NULL,
    PRIMARY KEY (field_id, period)
  );

  CREATE TABLE template_marks (
    id          TEXT PRIMARY KEY,
    template_id TEXT NOT NULL REFERENCES templates (id) ON DELETE CASCADE,
    block_id    TEXT NOT NULL,
    start       INTEGER NOT NULL,
    "end"       INTEGER NOT NULL,
    field_id    TEXT NOT NULL REFERENCES fields (id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL
  );
  CREATE INDEX template_marks_template ON template_marks (template_id);

  CREATE TABLE sets (
    id           TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    created_by   TEXT NOT NULL REFERENCES users (id),
    created_at   INTEGER NOT NULL,
    updated_at   INTEGER NOT NULL
  );
  CREATE INDEX sets_workspace ON sets (workspace_id, updated_at DESC);

  -- owner_id is a set id, or a document id for documents that are not in a set
  CREATE TABLE field_values (
    owner_id   TEXT NOT NULL,
    field_id   TEXT NOT NULL REFERENCES fields (id) ON DELETE CASCADE,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (owner_id, field_id)
  );

  ALTER TABLE documents ADD COLUMN set_id TEXT REFERENCES sets (id) ON DELETE CASCADE;
  CREATE INDEX documents_set ON documents (set_id);
  `,
];

function open(): Database.Database {
  mkdirSync(config.dataDir, { recursive: true });
  const db = new Database(path.join(config.dataDir, "document-doctor.db"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  const version = db.pragma("user_version", { simple: true }) as number;
  for (let v = version; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
  return db;
}

// One connection per server process (kept across hot reloads in dev).
const g = globalThis as unknown as { __ddDb?: Database.Database };
export function db(): Database.Database {
  return (g.__ddDb ??= open());
}

export const now = () => Date.now();
