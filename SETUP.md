# Setup Guide — C24 Projects Tracker

Follow these steps once to activate all features. Takes ~15 minutes.

---

## Step 1 — Run Supabase Migration (2 min)

1. Go to https://supabase.com → your project (`fnvylizldarvqejsfkbn`)
2. Click **SQL Editor** in the left sidebar
3. Click **New Query**
4. Open `supabase-migration-v2.sql` from this repo and paste the entire contents
5. Click **Run**
6. You should see "Success" for each statement

**What this fixes:**
- Daily updates were failing silently (FK constraint on site_id was NOT NULL)
- Field edits were failing silently (no UNIQUE index on site_name for upsert)
- Missing RLS INSERT policies for site_updates table

---

## Step 2 — Disable Email Confirmation (1 min)

1. Supabase → **Authentication** → **Providers** → **Email**
2. Toggle **"Confirm email"** → **OFF**
3. Click **Save**

Without this, creating team accounts will send a confirmation email instead of activating immediately.

---

## Step 3 — Redeploy Cloudflare Worker (3 min)

The Worker needs to be updated to accept Supabase login tokens (Bearer JWT auth).

1. Go to https://dash.cloudflare.com → **Workers & Pages**
2. Click **c24-tracker**
3. Click **Edit Code**
4. Select all existing code and delete it
5. Open `worker.js` from this repo (https://github.com/vickybhardwaj-cars24/c24-tracker/blob/main/worker.js)
6. Copy the entire file and paste it into the Cloudflare editor
7. Click **Save and Deploy**

**How to verify it worked:**
- Go to the live site → log in → open **Admin** tab
- The **System Status** section will show **"Worker Auth: JWT accepted ✓"** in green

---

## Step 4 — Create First Team Member Account (2 min)

1. Open https://c24-projects.vercel.app/projects-tracker/
2. Log in with your admin credentials (vicky.bhardwaj@cars24.com)
3. Click the **⚙ Admin** tab in the top navigation
4. Under **"Add Team Member"**, fill in:
   - Full Name: (e.g. Kamal Saini)
   - Email: their work email
   - Password: a temporary password (min 6 characters)
   - Role: **pm**
5. Click **✅ Create Account**
6. You'll see a success message with login details to share

---

## Step 5 — Test Login and Edit Persistence (5 min)

1. Open a new **Incognito / Private** browser window
2. Go to https://c24-projects.vercel.app/projects-tracker/
3. Log in with the account you just created
4. You should only see your sites (filtered to that PM's name) and no Attendance or Admin tabs
5. Click any site row to open the modal
6. Edit a field (e.g. change Status or Vendor Rating)
7. Close the modal and **close the browser tab completely**
8. Reopen the site and log in again
9. Open the same site — the edit should still be there ✓

---

## Step 6 — Test Photo Upload (2 min)

1. Log in as admin
2. Open any site modal → click **📷 Photos** tab
3. Click **Upload Photo** → select any JPEG/PNG from your phone or computer
4. The photo is compressed client-side (max 1200px, 72% quality) before upload
5. After upload, it appears in the photo gallery for that site and date

---

## Step 7 — Test Snag Vendor Email (1 min)

1. Make sure snag data is loaded (upload snag CSV if not already done)
2. Go to the **Snag** tab
3. Find a site with open snags — click the **📧 Notice** button
4. A Gmail draft opens with all open snags listed for that vendor to action

---

## Step 8 — Add Drive Folder Links (2 min)

1. Log in as admin → **Admin** tab → scroll to **Drive Folder Map**
2. Find a site with "No folder set" badge
3. Paste the Google Drive folder URL for that site
4. Click **Save**
5. The 📂 Drive button in that site's modal now opens the correct folder

---

## Ongoing: Adding More Team Members

Repeat Step 4 for each PM. Their login filters the table to their sites automatically based on the **Owner** column matching their name in the profiles table.

To change a user's role later:
```sql
-- Run in Supabase SQL Editor
update profiles set role = 'admin' where email = 'user@cars24.com';
```

---

## GitHub Actions Auto-Deploy (optional, saves Step 3 in future)

To make Worker auto-deploy on every push:
1. Go to your GitHub repo → **Settings** → **Secrets and variables** → **Actions**
2. Add secret: `CLOUDFLARE_API_TOKEN` (get from Cloudflare → My Profile → API Tokens)
3. Add secret: `CLOUDFLARE_ACCOUNT_ID` (get from Cloudflare → right sidebar on Workers page)

After this, any push to `main` that changes `worker.js` automatically deploys to Cloudflare.
