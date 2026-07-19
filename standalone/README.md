# Our Ledger — standalone version

A single self-contained `index.html` file. No Node.js, no build step, no
dependencies to install — open it in a text editor, fill in a few constants,
and host it anywhere that can serve a static file.

This is the same app as the one at the repository root, just not built with
Vite/TypeScript. Use this folder if you want to:

- Hand-edit the app directly (e.g. in Notepad/TextEdit) without installing
  anything
- Copy it out of this repo entirely and run it on its own
- Deploy it by dragging the file onto a static host (Netlify Drop, etc.)

## Setup

Follow [SETUP-GUIDE.md](./SETUP-GUIDE.md) — it walks through creating the
Supabase project, running the database schema, creating your two logins, and
filling in `index.html`'s config block.

The database schema is [`setup.sql`](./setup.sql) here, kept in sync with the
one at the repository root — both versions use the same Supabase project and
table structure, so you can even switch between the two frontends against the
same backend.

## Keeping this in sync

If you change app behavior in `../src/`, consider whether the same change
should be ported here. This folder does not update automatically — it's a
snapshot, not a build output.
