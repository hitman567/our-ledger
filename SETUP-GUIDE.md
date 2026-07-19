# Private Expense Tracker — Setup Guide

Everything here is free. You'll set up three things: a free database with login (Supabase), your app file, and free hosting (Netlify). Total time: about 20–30 minutes. Easiest on a computer.

## Part 1 — Create the database (Supabase)

1. Go to **supabase.com** → Sign up (free) → **New project**.
2. Give it any name (e.g. `our-ledger`), set a strong database password (save it somewhere), pick the region closest to you → **Create project**. Wait ~2 minutes.
3. In the left sidebar open **SQL Editor** → **New query**. Open the `setup.sql` file, copy everything, paste it in, and press **Run**. You should see "Success".

## Part 2 — Create your two logins

1. Left sidebar → **Authentication** → **Users** → **Add user** → **Create new user**.
2. Enter YOUR email + a password → tick **Auto confirm user** → create.
3. Repeat for HER email + password.
4. Now lock the door: go to **Authentication** → **Sign In / Providers** (or Settings) → turn **OFF** "Allow new users to sign up" → Save.
   This is the key step — with signups off, no one else can ever create an account. Only your two logins exist.

## Part 3 — Connect the app file

1. In Supabase, left sidebar → **Project Settings** → **API** (or "Data API").
2. Copy two things: the **Project URL** and the **anon public** key.
3. Open `index.html` in any text editor (Notepad works). Near the top of the `<script>` section you'll see a block that says **EDIT THESE 4 THINGS**:
   - Paste the Project URL into `SUPABASE_URL`
   - Paste the anon key into `SUPABASE_ANON_KEY`
   - Put your real names and the exact login emails into `PEOPLE`
   - Set `CURRENCY` if you don't want ₹
4. Save the file.

Note: the anon key is safe to have in the app — it's designed to be public. Your data stays locked because the database only answers to someone who is signed in, and only your two accounts exist.

## Part 4 — Put it online (Netlify, free)

1. Put `index.html` inside a folder by itself (e.g. a folder named `ledger`).
2. Go to **app.netlify.com/drop** (sign up free if asked).
3. Drag the folder onto the page. In a few seconds you get a live link like `https://something.netlify.app`.
4. Optional: in Netlify → Site settings → change the site name to something you like.

## Part 5 — Use it

1. Open the link on both phones, sign in with your own email + password.
2. **Add to home screen** in your phone browser so it feels like an app.
3. When one of you adds an expense, it appears on the other phone automatically (live sync). The ⟳ button refreshes manually, CSV downloads all your data anytime.
4. The **Log** tab shows the full audit trail — every add, edit and delete, who did it, when, and exactly what changed (e.g. "Amount: ₹199 → ₹649"). The log is written by the database itself and is read-only, so it can't be edited or erased from the app, even by the two of you.

## If something doesn't work

- "Wrong email or password" → check the user exists in Supabase → Authentication → Users, and that it was auto-confirmed.
- Blank screen after login → re-check that the URL and anon key were pasted correctly (no extra spaces or quotes removed).
- "Could not load expenses" → make sure the SQL in Part 1 ran successfully.
- Free-tier note: Supabase pauses projects after ~1 week of no activity; opening the app regularly keeps it awake. If it ever pauses, one click in the Supabase dashboard restores it — no data is lost.
