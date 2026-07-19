# Our Ledger

A private, two-person shared expense tracker with live sync, Splitwise-style
expense splitting, and a tamper-proof audit log — backed by Supabase.

There are two versions of this app in this repo:

| | Where | Requires |
|---|---|---|
| **Production app** (what's deployed) | `src/` + root `index.html` | Node.js, npm |
| **Standalone version** | [`standalone/`](./standalone) | Nothing — just a text editor |

The standalone version is a single self-contained `index.html` file you can
hand-edit and drop onto any static host, no build step. See
[`standalone/README.md`](./standalone/README.md).

Everything below is about the production (`src/`) version.

## Stack

- [Vite](https://vitejs.dev) + TypeScript, no framework
- [Supabase](https://supabase.com) (Postgres + Auth + Realtime) as the backend
- Deployed to GitHub Pages via GitHub Actions on every push to `main`

## Project layout

```
src/
  main.ts            entry point
  ui.ts               rendering + event wiring (the app's "controller")
  supabaseClient.ts   typed data access (auth, CRUD, realtime)
  split.ts            pure balance/split math (unit tested)
  format.ts           currency/date formatting helpers
  config.ts           people, categories, env-derived Supabase credentials
  types.ts            shared TypeScript types
  csv.ts               CSV export
  style.css
tests/
  split.test.ts        unit tests for split.ts
```

## Local development

```bash
npm install
cp .env.example .env   # fill in your Supabase project's URL + anon key
npm run dev             # starts a dev server with hot reload
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server |
| `npm run build` | Type-check and build to `dist/` |
| `npm run preview` | Serve the built `dist/` locally |
| `npm test` | Run unit tests (vitest) |
| `npm run lint` | ESLint |
| `npm run format` | Prettier — write |
| `npm run format:check` | Prettier — check only |

## Deployment

Push to `main` and GitHub Actions ([`.github/workflows/deploy.yml`](./.github/workflows/deploy.yml))
lints, tests, builds, and deploys to GitHub Pages automatically. The build
step reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from repository
secrets (Settings → Secrets and variables → Actions) — both are safe to
expose in a client bundle (see [`standalone/SETUP-GUIDE.md`](./standalone/SETUP-GUIDE.md)
for why).

## Database

The schema (`expenses`, `audit_log`, RLS policies, the audit trigger) lives
in [`setup.sql`](./setup.sql) at the repo root — run it once in the Supabase
SQL Editor. It's idempotent, safe to re-run any time you pull in a schema
change.
