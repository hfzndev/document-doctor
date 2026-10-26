# Document Doctor

Fill in Word templates on the web, without opening Word. Upload a `.docx` that already has its
structure (header, title, headings, sub headings, body text, tables, footer), and everyone in your
workspace can create documents from it. They edit the text in simple fields, watch a live page
preview, and download the result as **DOCX** or **PDF**.

Sign-in goes through **[Norflabs Auth](https://auth.norflabs.com)** (app slug `docs`).

## How it works

1. **Upload a template.** Any `.docx` works; there are no special tags to add. Every paragraph of
   the headers, body (including table cells and text boxes) and footers becomes an editable block,
   labelled with its Word style (`Title`, `Heading 1`, `List Bullet`, `Footer`…).
2. **Use template → document.** The template file is never modified. Each document stores only the
   blocks you changed, so you can make as many documents from one template as you like.
3. **Edit and preview.** The left pane lists the blocks grouped by *Header / Body / Footer*. The
   right pane re-renders the real document as you type and highlights the paragraph you're editing.
   Changes autosave.
4. **Export.** DOCX is produced by patching the original file. PDF goes through headless
   LibreOffice, so headers, footers, page numbers and fonts come out as they do in Word.

### What is kept when you edit

- **Paragraphs you don't touch stay byte-for-byte identical**, with all their formatting.
- An edited paragraph keeps its paragraph style (heading level, alignment, numbering, spacing) and
  takes the character formatting (font, size, colour, bold…) of its **first** run. Mixed formatting
  inside one paragraph, such as a single bold word, is flattened only in paragraphs you edit.
- Things that aren't plain text show up as tokens: `Page [[PAGE]] of [[NUMPAGES]]`, `[[image]]`,
  `[[page break]]`, `[[footnote]]`… Leave a token where you want the item and it stays live. Delete
  it to remove the item.
- Line breaks (Enter) become Word line breaks and Tab becomes a tab.
- Paragraphs belonging to a field that spans several paragraphs, like a table of contents, are
  shown read-only.

## Workspaces & sharing

- Anyone with access to the `docs` app in Norflabs Auth can sign in and create workspaces.
- Owners and admins invite people by email. The app makes an invite link to copy and send, since
  Norflabs Auth doesn't send email. The invitee must sign in with that same email, and they also
  see the invite on their dashboard. Links expire after 14 days.
- Roles: **owner** (everything, including deleting the workspace and managing owners),
  **admin** (members, invites, any template or document), **member** (use and upload templates,
  edit all documents, and delete the templates and documents they created).
- A workspace always keeps at least one owner. Non-members get a 404 for its pages and files.

## Norflabs Auth integration

`src/lib/auth/norflabs.ts` is a TypeScript port of `norflabs-auth/sdk/nl_auth.py`:

```
/api/auth/start ─▶ auth.norflabs.com/login?app=docs&next=<APP_PUBLIC_URL>/api/auth/callback
                                   │ (password, 2FA when the role needs it)
/api/auth/callback?ticket=… ◀──────┘ one-time Ed25519 ticket, aud=docs, 60 s
   └─ POST /api/redeem (single use) ─▶ claims {sub, email, name, roles, session_hours}
   └─ sets our own `dd_session` cookie (HS256, aud=docs, HttpOnly, SameSite=Lax)
```

Sign-out clears the cookie and then calls `auth.norflabs.com/logout?next=…`, which ends the auth
session too.

**One-time setup in norflabs-auth:**

1. Register the app (the `add-docs-app` branch of norflabs-auth adds it to `scripts/bootstrap.py`):
   `("docs", "Document Doctor", "https://docs.norflabs.com", True, 12)`, then re-run `bootstrap.py`.
2. Grant people access from the console (`/console`), e.g. role `member` on app `docs`.
3. `APP_PUBLIC_URL` must be **exactly** the registered origin, or auth refuses to redirect back.

## Running locally

Requirements: Node 22+, and LibreOffice (`soffice`) for PDF export.

```bash
npm install
cp .env.example .env.local
# for quick local work without norflabs-auth:
#   APP_PUBLIC_URL=http://localhost:3000
#   AUTH_DEV_LOGIN=true          # adds an email-only sign-in form; never in production
npm run dev                     # http://localhost:3000
```

To test the real sign-in flow locally, run norflabs-auth on `:9140` with
`AUTH_BASE_URL=http://127.0.0.1:9140 AUTH_COOKIE_SECURE=0`, register the `docs` app with origin
`http://localhost:3000`, and set `NL_AUTH_BASE_URL=http://127.0.0.1:9140`.

`fixtures/sample-letter.docx` is a sample template with a header, a title, headings, lists, a
table, a hyperlink and a page-number footer (`npm run make-sample` regenerates it with
python-docx).

## Configuration

| Variable | Default | |
| --- | --- | --- |
| `APP_PUBLIC_URL` | `http://localhost:3000` | Public origin; must match the origin registered in norflabs-auth |
| `SESSION_SECRET` | (none) | **Required in production**, ≥ 32 chars (`openssl rand -hex 32`) |
| `NL_AUTH_BASE_URL` | `https://auth.norflabs.com` | |
| `NL_APP_SLUG` | `docs` | |
| `SESSION_HOURS` | `12` | Fallback; norflabs-auth's per-app `session_hours` wins |
| `DATA_DIR` | `./data` | SQLite database + uploaded templates |
| `SOFFICE_PATH` | `soffice` | LibreOffice binary |
| `MAX_UPLOAD_MB` | `20` | |
| `AUTH_DEV_LOGIN` | `false` | Local email-only sign-in. **Never enable on a server.** |

## Deploying

```bash
echo "SESSION_SECRET=$(openssl rand -hex 32)" > .env
docker compose up -d --build      # listens on 127.0.0.1:9150
```

The image contains the Next.js standalone server, LibreOffice Writer, and fonts that are
metric-compatible with Word's (Carlito = Calibri, Caladea = Cambria, Liberation = Arial / Times
New Roman). Put your reverse proxy for `docs.norflabs.com` in front of it with TLS. All state
lives in the `/data` volume, so back it up: `document-doctor.db` (SQLite, WAL) plus `templates/`.

Without Docker: `npm ci && npm run build && npm start`, with LibreOffice installed.

## Development

```bash
npm test          # template engine tests (extract / edit / fields / tokens / safety)
npm run lint
npm run typecheck
```

```
src/lib/docx/        template engine, runs in both the browser (preview) and the server (export)
  paragraph.ts       one <w:p> ⇄ editable text with [[tokens]]
  template.ts        parts, block ids, styles, extractBlocks() / applyEdits()
src/lib/auth/        norflabs ticket redeem + our session cookie
src/lib/data.ts      all SQL (better-sqlite3, migrations in db.ts)
src/lib/access.ts    authorization helpers used by every page / action / route
src/lib/pdf.ts       LibreOffice conversion (serialized, throwaway profile per run)
src/app/actions.ts   server actions (workspaces, members, invites, templates, documents)
src/app/api/…        auth, template upload/download, autosave, export
src/components/      editor, live preview (docx-preview), upload
```

## Known limitations

- **Plain-text editing.** Edited paragraphs take one formatting (that of their first run). Rich
  formatting such as bold/italic toolbars isn't supported yet.
- **The preview is an approximation.** It's rendered in the browser with `docx-preview`, and
  details like bullet glyphs and exact line breaks can differ. The PDF (LibreOffice) is the
  faithful version.
- **Last write wins** when two people edit the same document at the same moment. There's no
  real-time co-editing.
- Block ids are tied to the template file. To change a template's layout, upload it as a new
  template; existing documents keep using the old one.
- Templates with linked (external) images: LibreOffice may try to fetch them during PDF export.
  Run the container without outbound network access if that matters to you.
