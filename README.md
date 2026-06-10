# Sentinel — Compliance Command Center (cloud build)

Static dashboard + Supabase (storage & synced edits) + a Vercel serverless email
function. Login `iaijaz` / `5052`, tab code `5052`.

## Deploy in 5 steps

### 1. Supabase
1. Create a project at https://supabase.com (free).
2. **Storage → New bucket** → name **`uploads`** → **Public** → Save.
3. **SQL Editor → New query** → paste **`supabase-setup.sql`** → **Run**.
4. **Project Settings → API** → copy the **Project URL** and the **anon public** key.
5. Paste both into **`supabase-config.js`** (the `url` and `anon` fields). Save.

### 2. GitHub (push the code)
From this folder:
```
git add -A
git commit -m "Sentinel cloud"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

### 3. Vercel
1. https://vercel.com → **Add New → Project → Import** your GitHub repo.
2. **Root Directory:** leave as the repo root (this folder). Framework preset: **Other**.
3. **Deploy.**

### 4. Vercel env vars (for the email button)
Project → **Settings → Environment Variables**, add:
- `GMAIL_USER` = `imadaijaz2000@gmail.com`
- `GMAIL_APP_PASSWORD` = your 16-char Gmail app password
- (optional) `MAIL_TO` = where digests go (defaults to GMAIL_USER)
Then **Redeploy**.

### 5. (Recommended) protect the URL
Vercel → Project → **Settings → Deployment Protection → Password Protection**.

## What works in the cloud
- ✅ Whole dashboard, all tabs, analytics, calendar, search, KPIs.
- ✅ **QR scan-to-upload from any phone, anywhere** → file stored in Supabase, shown on the item.
- ✅ **Email digest** (per-tab codes) via the serverless function.
- ✅ Add/edit/delete + notes **sync across devices** (Supabase `app_state`).
- ⚠️ "Open original document" links only work on the local version (the 24k source files
  live on your PC, not in the repo). Uploaded files (via QR) DO open in the cloud.

## Local version
The full local app (with source-document links, folder uploads, Excel export, scheduled
email) is in the sibling `_Sentinel_Compliance` folder — run `Start-Sentinel.bat`.
