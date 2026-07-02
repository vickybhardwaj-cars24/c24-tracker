# CLAUDE.md — CARS24 Projects Tracker

This file guides Claude when working on this codebase via Claude Code or any agentic context. Read this fully before making any changes.

---

## Project Overview

Single-file HTML dashboard for CARS24 Expansion & Projects team. Tracks 57+ pan-India sites across civil construction, fit-out, NSO, and BD pipeline. Built and maintained by Vicky Bhardwaj, Head of Projects, CARS24 Gurgaon.

**Stack:** Vanilla HTML/CSS/JS — single file, no build step, no frameworks. **Hosting:** Cloudflare Workers (auth layer) \+ Vercel (static serving) \+ GitHub (source). **Auth helper:** External script `/shared/c24-uploader.js` — never remove or mock this.

---

## Architecture

```
index.html (single file)
├── <script src="/shared/c24-uploader.js">   ← Cloudflare Worker auth helper — NEVER REMOVE
├── <style>                                   ← All CSS inline
└── <script>                                  ← All JS inline
    ├── Constants (CSV_DATA=[], SNAG_DATA={}, TICKET_DATA=[], DRIVE_MAP)
    ├── Global helpers (pd, esc, toast, parseCSV, extractBlockers, getStaleDays...)
    ├── SAT/UAT helpers (getRevHistory, fmtRevHistory, committedDate, gmailDraft...)
    ├── Vendor mail (vendorDelayMail, satDelayMail, bdTeamMail)
    ├── Feature modules (renderTable, renderSatUat, renderSnagTab, renderBDTab...)
    ├── Ticket module (renderTicketTab, handleTicketUpload, parseTicketCSV...)
    └── (function init(){...})();              ← IIFE — always last
```

---

## Absolute Rules — Never Violate

1. **Never remove login modal** — `openLoginModal`, `doLogin`, `doLogout`, `login-modal` div  
2. **Never remove c24-uploader.js** — `<script src="/shared/c24-uploader.js">`  
3. **Never remove Worker functions** — `loadFromOrigin`, `loadSnagFromOrigin`, `handleLiveCSV`, `handleLiveSnagCSV`, `WORKER_URL`, `TOOL_PATH`  
4. **Never embed raw CSV or Snag data** — `CSV_DATA = []` and `SNAG_DATA = {}` must stay empty  
5. **Always increment version — no exceptions** — every single commit/change, however small, bumps the version number in `<title>` (`projects-tracker/index.html`) AND updates the `## Version History Summary` table \+ `## Current Version` line below in this file, in the same commit. A code change without a version bump is an incomplete change — never leave the two out of sync.  
6. **Always syntax-check JS** with `node --check` before saving  
7. **Never use regex with DOTALL on large JS strings** — it corrupts functions. Use positional replacement or brace-depth traversal  
8. **Never insert functions using `c.replace()` on full HTML** — always split `html_before + js + html_after` and reassemble

---

## Tab / View Structure

| vtab button | div id | render function |
| :---- | :---- | :---- |
| Table | `tv` | `renderTable()` |
| SAT→UAT | `suv` | `renderSatUat()` |
| Insights | `inv` | `renderInsights()` |
| Tasks | `taskv` | `renderTaskTab()` |
| PM Scorecard | `pmsv` | `renderPMScorecard()` |
| Tickets | `tickv` | `renderTicketTab()` |
| BD | `bdv` | `renderBDTab()` |

All non-`tv` divs are hidden by CSS: `#suv,#taskv,#pmsv,#tickv,#bdv{display:none}` Shown via `.show` class: `#suv.show,#taskv.show,...{display:block}` `setView(v, btn)` handles all tab switching — always update it when adding new tabs.

---

## Key Data Structures

### CSV (HOTP Tracker)

```
META_COLS = ['S.No.','s','BU','Site Name','Zone','Owner','Vendor','Vendor Rating',
             'Percentage Completion','Status','PO Date','Kickoff Date','Work Start Date',
             'SAT Date','UAT DATE','Planned Completion','Revised Completion','Reason for Delay']
DATE_COLS = ['7 Apr' ... '8 May']  // all remaining columns are daily update text
```

### Snag Data (SNAG\_DATA object)

Key \= site name (cleaned from Store column). Loaded via CSV upload from processflows.ai export. Format A (processflows): headers row, `Store` col \= site name, `Status`, `Title`, `Open Since Days` Format B (legacy flat): no headers, col\[1\] \= site name

### Ticket Data (TICKET\_DATA array)

Loaded from processflows.ai CSV export. Key columns: `ID`, `Title`, `Store` (site), `Status`, `Priority`, `Assigned To`, `Created At`, `Open Since Days` TAT \= auto-calculated as `Today − Created At`

---

## Business Logic — Critical

### Date Rules

- **Planned Completion** \= always the initial SAT target date (never UAT)  
- **Revised Completion** \= revised SAT target (pre-SAT) OR revised UAT target (post-SAT)  
- **UAT Target** \= SAT Date \+ 10 days  
- **committedDate(r)** \= `Revised Completion` → fallback `Planned Completion`  
- **SAT Delay trigger** \= Planned Completion passed ≥7 days, no SAT Date  
- **UAT Danger** \= \>10 days since SAT, no UAT Date  
- **UAT Warning** \= 7–10 days since SAT, no UAT Date  
- **UAT On Track** \= \<7 days since SAT, no UAT Date

### Revision History Parsing

Pattern: `Revised date : DD Mon` (case insensitive, ordinals supported: 15th May, 23rd January) Deduplication: same revised-to date \= one revision, keep first occurrence (earliest column). Format: `1. Logged on 23 Apr → Revised to 5 May`

### Temp Live Parsing (BD Tab)

Pattern: `Temp Live Date: DD Mon` in daily update columns. Backtrack chain from Temp Live: UAT −7d → SAT −17d → PO −77d → PR −91d → BOQ −93d → Layout −100d → BD handover −107d Temp setup track: PO \+ 15 days. Full construction track: PO \+ 60 days.

### BD Site Filter

Sites shown in BD tab: `Status = 'bd' | 'design' | 'boq'` Drop off automatically when status moves to WIP or beyond.

### Stale Site Detection

≥5 days no update \= ⏸ amber. ≥10 days \= 🔴 red. UAT Done sites are NEVER flagged as stale. Sites with UAT DATE filled are excluded from all pending/risk flags.

### Snag NA Exclusion

Status values excluded from open count: `closed`, `na`, `n/a`, `not applicable`

### Date Parsing (`pd()`)

`pd(s)` is the single global date parser used everywhere (SAT/UAT calcs, revision history, procurement, penalty notices…). It tries, in order: (1) a purely-numeric `dd-mm-yyyy` / `dd/mm/yyyy` string — parsed explicitly as **day-first** (matches the Indian-locale Excel/CSV export format most uploads use); (2) a month-name token match (`"7 Apr"`, `"23rd January"` style — see Revision History Parsing above); (3) a native `new Date(s)` fallback for long timestamps. Rule (1) exists because the native `Date` constructor either rejects numeric day-first dates outright or, worse, silently misreads them as US `mm-dd-yyyy` when day ≤ 12 (e.g. `"05-06-2026"` → wrongly parsed as May 6 instead of June 5) — this caused procurement delivery dates to silently fail their overdue check. **Never remove rule (1) or reorder it after the native-Date fallback.**

---

## Email / Mailer Rules

All Gmail drafts:

- **To:** blank (PM fills manually)  
- **CC:** built by `buildMailCC(r)` — always `vicky.bhardwaj@cars24.com, rajat.sharma3@cars24.com`, plus the site's assigned HEM email (looked up from `HEM_EMAIL_MAP[r['HEM Name']]`) when set. Every mailer function calls `buildMailCC(r)` for its `cc=` param instead of a hardcoded string — **always use it for any new mailer**, never hardcode the CC list again.  
- Never add "CC: Vicky Bhardwaj, Head of Projects" in body text  
- Mailer functions: `gmailDraft(r, 'SAT'|'UAT')`, `vendorDelayMail(r)` (UAT delay), `satDelayMail(r)`, `handoverUrgencyMail(r)`, `procureDelayMail(r, problemItems)`, `vendorPenaltyMail(r, problemItems)` (delayed-delivery penalty slabs — see below), `snagVendorMailUrl(site)`, `pendingDocReminderMail(r, missingDocs)`

### Vendor Penalty Notice (`vendorPenaltyMail`)

Formal penalty notice to the vendor for overdue procurement items, computed per-item from `PROCURE_DATA[siteName]` delivery dates via `pd()`. Slabs (fixed CARS24 policy, do not change without explicit instruction):
- 1–10 days overdue: grace period, 0% penalty
- 11–25 days: Margin + 2% penalty
- 26–30 days: Margin × 2% penalty
- Beyond 30 days: PO stands cancelled unless otherwise agreed to in writing by CARS24

Button lives in `renderProcureSection()` next to the existing "Delay Notice" button, gated on `overdue>0` (the same `overdue` count used by the stat tile).

### HEM Name Field

Per-site "HEM Name" — a dropdown in the site modal (`renderMetaField()`'s `l === 'HEM Name'` branch, saved via `saveHemName(idx,v)` → `saveSiteFieldToSupabase(siteName,'HEM Name',...)`, same `site_field_overrides` mechanism Cost Center uses). Options come from `HEM_EMAIL_MAP` (name → `@cars24.com` email, ~11 entries as of v5.9, sourced from the HEM roster CSV). Selecting a HEM auto-CCs their email on all mailers going forward via `buildMailCC(r)`.

---

## Drive Map

74 sites mapped to Google Drive folders in `DRIVE_MAP` constant. Root fallback: `https://drive.google.com/drive/folders/1Z70ck0p7mGe-DrmpYvP6JeF3SfmrFTcG` `getDriveLink(siteName)` — exact string match, falls back to root if not found.

---

## Google Sheets Integration

- **HOTP Sheet ID:** `1bhWxtVZZeTkwuoigb-cDRpfKQigDT32tQsJaWGdaOmc`  
- **Snag Sheet ID:** `1gkQnKl4z4sGd2Tq1K8gxftkOuouQ2tV1ausBAFLpT7o`  
- **Tickets Sheet ID:** `1cBA-fEulJUJO1bO2SCSEQQmljHv8qAZ5LHtXh66iG8M`  
- Live sync blocked by Google Workspace admin restriction (Anyone at Cars24 only — cannot change to Anyone)  
- Workaround: manual CSV upload via toolbar buttons

---

## Cross-User Data Sync (Procurement / Schedule / LL Scope)

`PROCURE_DATA`, `SCHED_DATA`, `LL_SCOPE_DATA` (procurement items, Cars24 schedule tasks, landlord scope tasks) persist immediately on every checkbox toggle via `POST /mappings` to the Worker's R2-backed key-value store (`saveProcureData()`/`saveSchedData()`/`saveLLScopeData()`) — this part was always correct. The gap (fixed in v5.9): these three were only ever *fetched* once, at page bootstrap (`loadFromOrigin()`), so one user's toggle never appeared for anyone else already on the page without a manual refresh.

Fix: `startDataSyncPolling()` (called once at bootstrap) re-fetches all three every 45s via `Promise.all([loadProcureData(), loadSchedData(), loadLLScopeData()])`. If a site's modal is open when new data lands, and no input/textarea/select/contenteditable inside the modal currently has focus (so an in-progress edit is never clobbered), it calls `openModal(openIdx)` again — the same "refresh everything for this site" pattern the codebase already uses after `addU()`. `window.__openModalIdx` tracks which site is open, set in `openModal()` and cleared in `closeModal()`.

Milestone Gates (`toggleGate()`) already write straight to a Supabase table (`milestone_gates`) and were not part of this fix — they're a separate, already-correctly-centralized data model, just still missing a realtime push (re-opening the site's Construction tab already re-fetches fresh).

---

## Slack Integration

Real Slack posting (not the deleted copy-paste "Slack" tab from v5.6) — no Slack token ever touches the browser. All sends go through the Worker. Two Slack identities are used, kept deliberately separate:

- **Manual sends** (buttons clicked on the dashboard) post as **Vicky** via a **User OAuth Token** (`SLACK_USER_TOKEN`, `xoxp-…`) — since v5.10.
- **The automatic cron digest** posts as the **bot** via `SLACK_BOT_TOKEN` (`xoxb-…`) — unchanged since v5.7.

`slackApi()`/`resolveSlackUserId()`/`postSlackMessage()` in `worker.js` all take the token as an explicit first argument (no implicit `env.SLACK_BOT_TOKEN` read inside the helpers) — every call site passes the token appropriate to its identity. Never merge the two tokens back into one implicit read; that's what keeps a manual send from silently posting as the bot (or vice versa) if one token is left unconfigured.

- **Frontend → Worker:** `sendToSlack(mode, email, text, btn, channel)` in `projects-tracker/index.html` POSTs to `WORKER_URL + 'slack/send'` with the same auth header used for uploads. `mode:'channel'` posts to `channel` (falling back to `getDefaultSlackChannel()`, then to the Worker's `SLACK_CHANNEL_ID`); `mode:'dm'` resolves `email` via Slack's `users.lookupByEmail` server-side, falling back to the same channel-resolution chain if that person has no Slack account.
- **Worker → Slack:** `POST /slack/send` in `worker.js`, gated by `checkAnyAuth` + the Vicky-only JWT check. Retries once (network blip or `ratelimited`, honoring `Retry-After`) before failing. Every error path returns a plain-English string from `friendlySlackError()` — **never** a raw Slack API error (`users_not_found`, `channel_not_found`, etc.) — so a failed send never surfaces API-speak in a toast; see the `SLACK_FRIENDLY_ERRORS` map for the full list of codes covered. Required env (Cloudflare dashboard → Worker → Settings → Variables and Secrets, never in `wrangler.toml`):
  - `SLACK_USER_TOKEN` (xoxp-…, needs User Token Scopes `chat:write`, `users:read`, `users:read.email`, `channels:read`, `groups:read`) — used by the manual `/slack/send` relay and by `GET /slack/channels` (the channel picker's `conversations.list` call).
  - `SLACK_BOT_TOKEN` (xoxb-…, needs Bot Token Scopes `chat:write`, `users:read`, `users:read.email`) — used only by the automatic cron digest.
  - `SLACK_CHANNEL_ID` — fallback channel only now (see "Channel picker" below), `SLACK_AUTOMATION_ENABLED` (set to `1` to arm the daily cron).
- **Channel picker (v5.12)** — `GET /slack/channels` (Vicky-only, same auth gate as `/slack/send`) calls `conversations.list` with `SLACK_USER_TOKEN`, filters to channels that token has actually joined (`is_member:true`) so a pick can never fail with `not_in_channel`, and returns `{channels:[{id,name,isPrivate}], defaultChannelId}`. The compose modal's Channel `<select>` (`populateSlackChannelPicker()`) is the only place Vicky explicitly picks a channel; the choice persists in `localStorage['slackChannelId']` via `getDefaultSlackChannel()`/`setDefaultSlackChannel()` and every other channel-mode send (PM digest summary, ticket summary, delay-alert 📣 buttons) reuses that stored default automatically — there's no per-button channel picker, one global default covers the whole dashboard. Only affects manual sends; the automatic cron digest still always posts to `SLACK_CHANNEL_ID` since it has no browser session to read `localStorage` from.
- **Manual buttons** (`data-slack-kind` + `data-slack-site` attributes, one delegated `click` listener bound once near the end of `index.html`, no per-render rebind needed): next to every existing Gmail-draft button (`vendorDelayMail`, `satDelayMail`, `handoverUrgencyMail`, `procureDelayMail`, `snagVendorMailUrl` ×2, `pendingDocReminderMail`) via `buildSlackDelayText(kind, siteName)`; plus standalone buttons for cross-functional blockers (Insights → Delay Analysis), PM digests (`sendPmDigestsToSlack()` in PM Scorecard), and ticket summary (`sendTicketSummaryToSlack()` in Tickets tab).
- **Message tone (v5.12)** — every generated message (`buildSlackDelayText()`, the PM digest lines in `sendPmDigestsToSlack()`, `sendTicketSummaryToSlack()`, and their `worker.js` cron-digest counterparts `postCrossFunctionalBlockers`/`postPmDigests`/`postDelayReminders`/`postTicketSummary`) is written as a first-person message addressed to the PM by first name (`'Hey '+owner+' — …'`), not a bot-style `*Bold Header* — field: value` alert. No new template should reintroduce the emoji-header/field-label pattern — write it the way Vicky would actually type it to someone. The free-text compose box is unaffected since Vicky types that herself.
- **Free-text compose** — toolbar "📣 Slack Message" button (`openSlackComposeModal()`) opens `#slack-compose-modal`, letting Vicky type any message and send it to a channel (picked from the live channel `<select>`, see above) or DM any person (pick a PM from the datalist, sourced from `PM_EMAIL_MAP`, or type any email). `sendSlackComposeMessage()` validates and calls the same `sendToSlack()` relay as every other button — no separate code path, no new Worker endpoint for sending (only the read-only `/slack/channels` list endpoint is new).
- **Automatic cron** — `worker.js`'s `scheduled()` handler, second cron entry in `wrangler.toml` (`30 3 * * *` = 09:00 IST), reads `projects-tracker.csv`/`tickets.csv` directly from R2 (gunzipped via `DecompressionStream('gzip')`) and posts the same 4 categories. No-ops unless `SLACK_AUTOMATION_ENABLED=1`. Uses a small ported subset of business logic (`pdW`, `parseCSVRows`, `extractBlockersW`, `getStaleDaysW`, `committedDateW`, thresholds) — **keep these in sync with the real implementations in `index.html` and with the "Business Logic — Critical" section above**; this is the one place logic is intentionally duplicated in this codebase.
- **Restricted to Vicky** — all manual Slack buttons (including the free-text compose button and the channel picker) are hidden from every other logged-in user via `isVicky()` (`index.html`) checking `__sbUser.email === 'vicky.bhardwaj@cars24.com'`, either inline in the render functions or via `data-vicky-only="true"` + `applyRoleBasedView()`. This is UI-only, so `worker.js`'s `handleSlackSend()` and `handleSlackChannels()` both also reject any call whose Bearer JWT `email` claim isn't Vicky's (`SLACK_ALLOWED_EMAIL`) — Basic-auth requests carry no per-user identity and are rejected outright. The automatic cron digest is unaffected by this (it's system-triggered, not tied to a browser session).
- **`PM_EMAIL_MAP`** — a 51-name map from first name (the `Owner` field) to `@cars24.com`/`@cariotauto.com` email, used to resolve DMs. Exists **twice**, once in `index.html` (manual buttons) and once in `worker.js` (automatic cron) — the two runtimes share no module, so edits to this map must be applied in both files. Refreshed against the July 2026 department roster in v5.13 — several entries were stale (e.g. `Akhtar` pointed at `md.fasih.akhtar@cars24.com`, which no longer resolves; the exact `users_not_found` bug this fixed). **Known gap:** the map is keyed by first name only, so any name shared by two+ people in the roster (currently `Adarsh`, `Ashish`, `Gaurav`, `Tushar`) can't be safely added — whichever email went in would silently steal the other person's DMs. Those four are deliberately left out of the map (their `sendToSlack('dm', ...)` calls fall back to channel, per the existing fallback behavior) until each is disambiguated with their full name; `Arun`/`Harshit`/`Karan` are old entries that didn't appear in the July 2026 list and are unconfirmed. If this collision keeps recurring, key the map by full `Owner` string instead of first name.

---

## Known Pending Bugs (as of v3.46)

| \# | Area | Issue |
| :---- | :---- | :---- |
| 5 | Tickets | Drive links on ticket summary incorrect |
| 24 | Snag Tab | Add embed link to Snag Google Sheet |
| 25 | Tickets Tab | Add embed link to Tickets Google Sheet |
| 26 | Table | Empty sites still loading despite Site Name filter fix |
| 27 | UAT Warnings | Replace Mark Warning button with Gmail draft to PM |
| 29 | SAT Delay Section | Show both initial planned date AND revised date |
| 30 | Tickets | Mark as Closed per ticket (session only \+ Show Closed toggle) |
| 31 | SAT Delay | Threshold `>7d` → `>=7d` |

---

## Safe Patching Pattern

```py
# Always use this pattern — never c.replace() on full HTML
html_before = c[:c.rfind('<script>')+8]
html_after  = c[c.rfind('</script>'):]
js = c[c.rfind('<script>')+8:c.rfind('</script>')]

# Find function boundaries using brace depth
fn_idx = js.find('function myFunction(')
depth=0; fn_end=fn_idx; i=fn_idx
while i<len(js):
    if js[i]=='{': depth+=1
    elif js[i]=='}':
        depth-=1
        if depth==0: fn_end=i+1; break
    i+=1

# Replace
js = js[:fn_idx] + NEW_FUNCTION + js[fn_end:]

# Reassemble
c_out = html_before + js + html_after

# Always verify
subprocess.run(['node','--check','/tmp/check.js'])  # write js to tmp first
```

---

## Version History Summary

| Version | Key Changes |
| :---- | :---- |
| v3.21 | New base — login \+ c24-uploader \+ empty data |
| v3.22 | Modal updates reversed (latest first), UAT badge |
| v3.23 | PM Scorecard, Stale detector, Slack generator, Drive links (74 sites) |
| v3.26 | Tickets tab — processflows CSV, TAT, KPIs |
| v3.29 | Sticky table header |
| v3.30 | Modal reopen bug fixed |
| v3.31 | UAT warning wrong site bug fixed |
| v3.33 | Slack @handles, vendor delay mail, SAT/UAT comm sub-tab, renderSlackTab |
| v3.35 | All nested helpers extracted to global scope, snag CSV parser for processflows |
| v3.37 | Revision history dedup, TAT auto-calc, action items by PM, drive map fixes |
| v3.38 | Revision history visible in modal |
| v3.39 | SAT Delay section, Danger/Warning/OnTrack thresholds, days since SAT |
| v3.40 | No Revised Date flag (section \+ table badge), UAT target \= Revised/Planned |
| v3.42 | SAT Delay uses Planned date not committed date, SAT Delay notice mailer |
| v3.43 | CC updated — Rajat added ([rajat.sharma3@cars24.com](mailto:rajat.sharma3@cars24.com)), Vicky body text removed |
| v3.44 | UAT target \= SAT+10, thresholds \>10d/\>7d, UAT Date Missing flag |
| v3.45 | Empty row filter fix (57 sites not 65\) |
| v3.46 | BD Pipeline Tracker tab — temp live parsing, timeline backtrack, team triggers |
| v3.47–v4.98 | *(bridging range — versions shipped without this log being updated; see `git log --oneline` for the full commit-by-commit detail)* Major themes: full Supabase migration for persistence (site fields, revision history, procurement, HEM delays), PWA/service worker + offline shell, HEM Delay Tracker sub-tab, procurement delay mailer, toolbar filters rebuilt as pill-style multi-checkbox dropdowns, Tasks tab rewrites (latest-date/PM-grouped logic iterated many times), inline modal editing (status, revised date, owner, vendor rating) with role-based permissions, photo upload/compression + delete, Drive editor, Priority sites, Milestone Proximity Alerts, WoW progress |
| v5.0 | Version-tracking discipline restored — doc brought back in sync with shipped `<title>` version; rule 5 hardened to require version bump + this table update on every change |
| v5.1 | Fix raw `Date.toString()` display in UAT Warning cards (Critical/High/Exempted) — SAT/Planned dates now go through `fmtRaw()` instead of the raw field value |
| v5.2 | Fix raw `Date.toString()` display in UAT/SAT delay mail bodies — SAT/PO/Kickoff/Work Start/Planned/Revised dates in `renderWarnings()`, `markNotifiedByIdx()`, `gmailDraft()`, `vendorDelayMail()`, `satDelayMail()` and `snagVendorMailUrl()` now go through `fmtRaw()` instead of the raw field value |
| v5.3 | Fix Cost Center admin panel not persisting for missing sites — `saveCCRow()` was writing to the `sites.cost_center` column (unawaited, no error check) which nothing else in the app reads; switched it to `saveSiteFieldToSupabase()` writing `site_field_overrides` (field_name='Cost Center'), the same table `loadSupabaseSiteFields()` reads into `CC_MAP` on every page load. `loadCCMapInAdmin()` now reads from `site_field_overrides` too, and `doAddNewProject()` also persists its Cost Center field there |
| v5.4 | Fix UAT Warning count/list mismatch — `getUatWarnings()` flags sites at `gap>=15` days since SAT (matching `UAT_WARN_DAYS`), but `renderWarnings()`'s `high` bucket only matched `gap>15`, so a site at exactly 15 days was counted in the header badge/active total but never rendered in the Critical or High section. `high` bucket now uses `gap>=15&&gap<=30` to match the inclusion threshold |
| v5.5 | Fix wrong tab highlighted when jumping to UAT Warnings — the `warn-badge` (header) and `__warn__` KPI tile both used stale `querySelectorAll('.vtab')`/`.inv-tab` indices (3/4 and 3) computed without accounting for the first button in each row carrying an extra `active` class (`class="vtab active"` / `class="inv-tab active"`), which shifted every subsequent index. Corrected to `.vtab[2]` (Insights) and `.inv-tab[6]` (UAT Warnings) — the Insights sub-tab bar reads `ov,kpis,vr,reg,snag,delay,warn,hem`, and `.inv-tab[3]` was landing on `reg` (Regional), matching the reported "highlights Regional" bug |
| v5.6 | Removed Slack option entirely — `renderSlackTab()` and its Cross-Functional/PM Update/Tickets sub-tabs, the `slackv` vtab button/div, `SLACK_HANDLES`/`slackHandle()`, `copyTasksForSlack()` (Tasks tab), `generateTicketSlack()`/`buildTicketSlackLines()` (Tickets tab), `copyToClipboard()`, and the `#slack-modal` markup/CSS all removed |
| v5.7 | Real Slack API integration (replacing the copy-paste feature removed in v5.6) — new Worker `POST /slack/send` relay (`slackApi`/`resolveSlackUserId`/`postSlackMessage` in `worker.js`, bot token never reaches the browser) plus `sendToSlack()` in `index.html`; manual "📣" buttons next to every delay-mailer button, PM Scorecard, Tickets tab, and Insights → Delay Analysis; automatic daily digest via a second Worker cron (`30 3 * * *`, gated on `SLACK_AUTOMATION_ENABLED`) that reads `projects-tracker.csv`/`tickets.csv` straight from R2. See "Slack Integration" section above |
| v5.8 | Restricted all manual Slack buttons to Vicky only — `isVicky()` (checks `__sbUser.email`) gates every inline button plus a new `data-vicky-only="true"` + `applyRoleBasedView()` toggle for the static PM Scorecard button; `worker.js`'s `handleSlackSend()` now also rejects `/slack/send` server-side unless the Bearer JWT's `email` claim matches, so the restriction can't be bypassed by calling the API directly |
| v5.9 | Four fixes/features: (1) `pd()` now parses purely-numeric `dd-mm-yyyy`/`dd/mm/yyyy` dates day-first before any fallback — root cause of procurement delivery dates silently not flagging as overdue (previously either `Invalid Date` or, worse, misread as US `mm-dd-yyyy`); (2) new `vendorPenaltyMail()` + "⚠ Penalty Notice" button in `renderProcureSection()` applying the standard CARS24 delayed-delivery penalty slabs; (3) new per-site "HEM Name" dropdown in the site modal (`HEM_EMAIL_MAP`, `saveHemName()`, reuses the `site_field_overrides` mechanism) whose email is now auto-CC'd on every mailer via the new `buildMailCC(r)` helper (replaces the hardcoded CC string in all 8 mailer functions); (4) `startDataSyncPolling()` re-fetches `PROCURE_DATA`/`SCHED_DATA`/`LL_SCOPE_DATA` every 45s and refreshes an open site modal (focus-guarded) so checkbox changes become visible to other users without a manual page reload — see "Cross-User Data Sync" section above |
| v5.10 | Manual Slack sends (the 📣 buttons throughout the dashboard) now post as Vicky via a Slack User OAuth Token (`SLACK_USER_TOKEN`, xoxp-…) instead of the bot token — `slackApi()`/`resolveSlackUserId()`/`postSlackMessage()` in `worker.js` now take the token as an explicit argument instead of reading `env.SLACK_BOT_TOKEN` implicitly, so `handleSlackSend()` passes `SLACK_USER_TOKEN` while the four automatic cron-digest functions (`postCrossFunctionalBlockers`, `postPmDigests`, `postDelayReminders`, `postTicketSummary`) still pass `SLACK_BOT_TOKEN`, unchanged. No frontend changes — `sendToSlack()` already only ever calls the Worker relay, never Slack directly. Requires `SLACK_USER_TOKEN` to be set in Cloudflare (Worker → Settings → Variables and Secrets) before manual sends will work again |
| v5.11 | New "📣 Slack Message" toolbar button (Vicky-only, `data-vicky-only`) opens `#slack-compose-modal` — a free-text compose box to post an arbitrary message to the team channel or DM any person (pick a PM from a datalist sourced from `PM_EMAIL_MAP`, or type any email). `openSlackComposeModal()`/`closeSlackComposeModal()`/`onSlackComposeTargetChange()`/`sendSlackComposeMessage()` added; `sendSlackComposeMessage()` reuses the existing `sendToSlack()` relay, no new Worker endpoint or auth path |
| v5.12 | Slack infra hardening — three fixes: (1) **channel picker** — new `GET /slack/channels` (Vicky-only) lists channels `SLACK_USER_TOKEN` has joined via `conversations.list`; the compose modal's new Channel `<select>` (`populateSlackChannelPicker()`) lets Vicky pick one, persisted in `localStorage['slackChannelId']` and reused as the default target by every other channel-mode send (PM digest, ticket summary, delay-alert buttons) via `getDefaultSlackChannel()` — no more hardcoded single `SLACK_CHANNEL_ID` for manual sends; (2) **bulletproof error handling** — root-caused the raw `users.lookupByEmail failed for X: users_not_found` toast (DM→channel fallback in `handleSlackSend` was silently skipped whenever no target channel was resolvable) by having `channel` participate in the fallback chain too, adding a one-shot retry on network failures/`ratelimited` in `slackApi()`/`resolveSlackUserId()`, and routing every failure through a new `friendlySlackError()`/`SLACK_FRIENDLY_ERRORS` map so the frontend never shows raw Slack API error text again; (3) **message tone** — rewrote every generated Slack message (`buildSlackDelayText()`, PM digest, ticket summary, and their `worker.js` cron-digest counterparts) from bot-style `*Header* — field: value` alerts into first-person messages addressed to the PM by name (`'Hey '+owner+' — …'`), so they read like Vicky actually typed them |
| v5.13 | Refreshed `PM_EMAIL_MAP` (`index.html` + `worker.js`) against the July 2026 department roster — this is the actual root cause of the `users.lookupByEmail ... users_not_found` failure from v5.12's bug report: `Akhtar` was mapped to `md.fasih.akhtar@cars24.com`, a defunct address, now corrected to `md.akhtar1@cars24.com`. ~10 other entries had similarly stale usernames (`Nitesh`, `Rahul`, `Rajat`, `Raman`, `Sachin`, `Shivam`, `Sumit`, `Danish`, `Indranil`); ~25 new names added. Four names shared by 2-3 people in the roster (`Adarsh`, `Ashish`, `Gaurav`, `Tushar`) were deliberately left unmapped rather than guessed, since the map's first-name-only key can't disambiguate them — see the "Slack Integration" section's `PM_EMAIL_MAP` note |

---

## Current Version: v5.13

