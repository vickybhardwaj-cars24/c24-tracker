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
| PM Messages (Vicky-only) | `msgv` | `renderMsgTab()` |
| Attendance (admin-only) | `attv` | `renderAttendanceTab()` |
| Admin (admin-only) | `adminv` | `renderAdminTab()` |

All non-`tv` divs are hidden by CSS. Shown via `.show` class (or inline `display`); `setView(v, btn)` handles all tab switching — always update it when adding new tabs. **Note:** the BD Pipeline Tracker tab (`bdv`/`renderBDTab()`, added v3.46) has since been fully removed from the codebase — no `bdv` div, `renderBDTab()`, or BD-specific status filter exists anymore. The "Temp Live Parsing" and "BD Site Filter" business-logic notes below are kept for historical reference only; they don't correspond to any live code.

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
- **@mentions in channel posts (v5.18)** — `POST /slack/resolve-users` (Vicky-only, same auth gate) batch-resolves emails to Slack user IDs via `users.lookupByEmail`, same as the DM path but exposed for channel-mode messages. `resolveSlackUserIds(emails)` in `index.html` calls it; `sendTicketSummaryToSlack()` uses it to replace each PM's `*Bold Name*` header with a real `<@userId>` @mention (falls back to bold name if unmapped in `PM_EMAIL_MAP` or the lookup fails) so the PM actually gets pinged when their tickets post to the channel.
- **Channel picker (v5.12, extended v5.20)** — `GET /slack/channels` (Vicky-only, same auth gate as `/slack/send`) calls `conversations.list` with `SLACK_USER_TOKEN`, filters to channels that token has actually joined (`is_member:true`) so a pick can never fail with `not_in_channel`, and returns `{channels:[{id,name,isPrivate}], defaultChannelId}`. The shared `populateChannelSelect(sel, opts)` helper renders that list into any `<select>`; the compose modal's Channel `<select>` (`populateSlackChannelPicker()`) was the only caller through v5.19. v5.20 added a second picker — `#ticket-slack-channel` in the Tickets tab, next to the "📣 Slack"/"📨 Ticket Updates" buttons — because until then there was no channel-select UI reachable from the Tickets tab itself, only the disconnected compose modal. Both pickers write to the same `localStorage['slackChannelId']` via `getDefaultSlackChannel()`/`setDefaultSlackChannel()`, and every channel-mode send (PM digest summary, ticket summary, delay-alert 📣 buttons) still reuses that one stored default — there's still only one global default, just now two places to set it. `populateChannelSelect`'s `opts.pinned` (a channel-name array) sorts those names to the top of the list, or — combined with `opts.onlyPinned:true` — restricts the dropdown to *just* those names instead of listing every channel Vicky's joined. The Tickets tab passes both, with `TICKET_SLACK_CHANNELS` (`expansion-projects-team`, `expansion_core_india`, `projects-internal`) as `pinned` (v5.23 — Vicky wants only these three selectable there, not her full joined-channel list; the free-text compose modal's picker still shows everything since that one's for arbitrary messages). `opts.onMissing(missingNames)` fires with any pinned name absent from the fetched list — since `SLACK_USER_TOKEN` is a **user** token (xoxp-, posts as Vicky herself, not a bot), `conversations.list`'s `is_member` only returns channels *Vicky's own Slack account* has joined, so a missing pinned channel means Vicky needs to join that channel in Slack (not "invite an app") for it to show up here or be postable to. The Tickets tab picker surfaces that as a `#ticket-slack-channel-warn` note worded accordingly, so a missing channel is diagnosable instead of just silently absent. Only affects manual sends; the automatic cron digest still always posts to `SLACK_CHANNEL_ID` via `SLACK_BOT_TOKEN` (a real bot identity, unaffected by this) since it has no browser session to read `localStorage` from.
- **Manual buttons** (`data-slack-kind` + `data-slack-site` attributes, one delegated `click` listener bound once near the end of `index.html`, no per-render rebind needed): next to every existing Gmail-draft button (`vendorDelayMail`, `satDelayMail`, `handoverUrgencyMail`, `procureDelayMail`, `snagVendorMailUrl` ×2, `pendingDocReminderMail`) via `buildSlackDelayText(kind, siteName)`; plus standalone buttons for cross-functional blockers (Insights → Delay Analysis), PM digests (`sendPmDigestsToSlack()` in PM Scorecard), and Tickets tab has **three** Slack senders now: `sendTicketSummaryToSlack()` ("📣 Slack") posts the full breakdown to the channel — one header per PM (sorted alphabetically, `Unassigned` last; `<@userId>` @mention when resolvable via `PM_EMAIL_MAP` + `resolveSlackUserIds()`, else a plain `*Bold Name*`, see "@mentions in channel posts" below), each ticket under it as `• [Site] Title: Description - <link|#id>` sorted by site within that PM's list (v5.17 — originally just an aggregate count, changed on explicit request); `sendTicketDigestsToSlack()` ("📨 Ticket Updates", added v5.15) DMs each assignee (grouped from `TICKET_DATA`'s `Assigned To` field, excluding closed tickets) only their own list in the same per-ticket format via `PM_EMAIL_MAP`; `sendSingleTicketToSlack(id, btn)` (v5.20, per-row "📣" button in the ticket table, new "Slack" column) DMs just that one ticket's assignee — same per-ticket line format as the other two but scoped to one row instead of a batch, and disabled when the row has no assignee. All three link each ticket to `https://processflows.ai/tickets/{id}` (v5.16, same URL pattern already used by the ticket table's ID column and the ticket detail modal's "Open in ProcessFlows" button) via Slack's `<url|text>` mrkdwn link syntax. Keep the per-ticket line format identical across all three if any changes again — they're meant to be the same content, just different scope/destination.
- **Message tone (v5.12)** — every generated message (`buildSlackDelayText()`, the PM digest lines in `sendPmDigestsToSlack()`, `sendTicketSummaryToSlack()`, and their `worker.js` cron-digest counterparts `postCrossFunctionalBlockers`/`postPmDigests`/`postDelayReminders`/`postTicketSummary`) is written as a first-person message addressed to the PM by first name (`'Hey '+owner+' — …'`), not a bot-style `*Bold Header* — field: value` alert. No new template should reintroduce the emoji-header/field-label pattern — write it the way Vicky would actually type it to someone. The free-text compose box is unaffected since Vicky types that herself.
- **Free-text compose** — toolbar "📣 Slack Message" button (`openSlackComposeModal()`) opens `#slack-compose-modal`, letting Vicky type any message and send it to a channel (picked from the live channel `<select>`, see above) or DM any person (pick a PM from the datalist, sourced from `PM_EMAIL_MAP`, or type any email). `sendSlackComposeMessage()` validates and calls the same `sendToSlack()` relay as every other button — no separate code path, no new Worker endpoint for sending (only the read-only `/slack/channels` list endpoint is new).
- **Automatic cron** — `worker.js`'s `scheduled()` handler, second cron entry in `wrangler.toml` (`30 3 * * *` = 09:00 IST), reads `projects-tracker.csv`/`tickets.csv` directly from R2 (gunzipped via `DecompressionStream('gzip')`) and posts the same 4 categories. No-ops unless `SLACK_AUTOMATION_ENABLED=1`. Uses a small ported subset of business logic (`pdW`, `parseCSVRows`, `extractBlockersW`, `getStaleDaysW`, `committedDateW`, thresholds) — **keep these in sync with the real implementations in `index.html` and with the "Business Logic — Critical" section above**; this is the one place logic is intentionally duplicated in this codebase.
- **Restricted to Vicky** — all manual Slack buttons (including the free-text compose button and the channel picker) are hidden from every other logged-in user via `isVicky()` (`index.html`) checking `__sbUser.email === 'vicky.bhardwaj@cars24.com'`, either inline in the render functions or via `data-vicky-only="true"` + `applyRoleBasedView()`. This is UI-only, so `worker.js`'s `handleSlackSend()` and `handleSlackChannels()` both also reject any call whose Bearer JWT `email` claim isn't Vicky's (`SLACK_ALLOWED_EMAIL`) — Basic-auth requests carry no per-user identity and are rejected outright. The automatic cron digest is unaffected by this (it's system-triggered, not tied to a browser session).
- **`PM_EMAIL_MAP`** — a map from first name (the `Owner` field) to `@cars24.com`/`@cariotauto.com` email, used to resolve DMs. Exists **twice**, once in `index.html` (manual buttons) and once in `worker.js` (automatic cron) — the two runtimes share no module, so edits to this map must be applied in both files. Refreshed against the July 2026 department roster in v5.13 — several entries were stale (e.g. `Akhtar` pointed at `md.fasih.akhtar@cars24.com`, which no longer resolves; the exact `users_not_found` bug this fixed). `Gaurav` was disambiguated in v5.14 (`gaurav.jangir@cars24.com`, confirmed as Vicky's core team).
  - **Full-name keys for shared first names (v5.19)** — `Adarsh`, `Ashish` and `Tushar` each have 2-3 people sharing that first name, which a first-name-only key can't safely hold (whichever email went in would silently steal the other person's DMs). Resolved by looking these 7 people up directly in the connected Slack workspace (`slack_search_users`/`slack_read_user_profile`) rather than guessing from the raw roster email list — this is also how `ashish1.kumar@cars24.com` turned out to actually be **Ashish Pathak** (not another Ashish Kumar), and how the roster's `tushar.pathak@cariotauto.com` (no Slack account exists for that address) was corrected to the account that's actually registered, `tushar.pathak1@cars24.com`. These 7 are now keyed by **full name** (`'Adarsh Roy'`, `'Adarsh Jha'`, `'Ashish Arora'`, `'Ashish Kumar'`, `'Ashish Pathak'`, `'Tushar Garg'`, `'Tushar Pathak'`) instead of first name.
  - **`resolvePmEmail(name)`** — every lookup site (`index.html`'s delegated `data-slack-kind` click handler, `sendPmDigestsToSlack()`, `sendTicketSummaryToSlack()`, `sendTicketDigestsToSlack()`, and `worker.js`'s `postPmDigests()`) now goes through this helper instead of indexing `PM_EMAIL_MAP` directly. It tries an exact full-name match first, then falls back to first-name-only — so both keying styles coexist without breaking any existing first-name-only entry. Exists in both runtimes, kept in sync manually like `PM_EMAIL_MAP` itself. **Never index `PM_EMAIL_MAP[...]` directly in new code — always call `resolvePmEmail()`,** otherwise a new call site will silently miss the full-name disambiguation.
  - `Arun`/`Harshit`/`Karan` are old entries that didn't appear in the July 2026 roster and are unconfirmed.

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
| v5.14 | Disambiguated `Gaurav` in `PM_EMAIL_MAP` (`index.html` + `worker.js`) — Vicky confirmed `gaurav.jangir@cars24.com` (not `gaurav.pandey2@cars24.com`) is her core team, as part of a 9-person priority list she confirmed for mapping. `Adarsh`, `Ashish`, `Tushar` remain unmapped pending the same confirmation |
| v5.15 | New "📨 Ticket Updates" button in Tickets tab, next to the existing "📣 Slack" summary button — `sendTicketDigestsToSlack()` DMs every ticket assignee their own list of open tickets (grouped from `TICKET_DATA`, closed statuses excluded, resolved via `PM_EMAIL_MAP`), while `sendTicketSummaryToSlack()`'s aggregate channel message is untouched, per explicit instruction not to change its format |
| v5.16 | Each ticket line in `sendTicketDigestsToSlack()`'s per-PM DM now links straight to the ticket — `<https://processflows.ai/tickets/{id}|#{id}>`, the same URL pattern the ticket table and detail modal already use elsewhere, via Slack's `<url\|text>` mrkdwn link syntax |
| v5.17 | `sendTicketSummaryToSlack()` ("📣 Slack" channel button) rewritten from a one-line aggregate count into the full open-ticket breakdown — grouped by assignee (`*PM Name*` header, alphabetical, `Unassigned` last), tickets sorted by site within each PM's group, each line `• [Site] Title: Description - <link|#id>`, per explicit request. Shares its per-ticket line format and site-sort with `sendTicketDigestsToSlack()` (v5.15/v5.16) — the two now only differ in destination (channel vs. per-person DM) |
| v5.18 | New `POST /slack/resolve-users` (Vicky-only) batch-resolves emails → Slack user IDs so channel posts can @mention a PM instead of just printing their name. `sendTicketSummaryToSlack()`'s per-PM header is now `<@userId>` (falls back to the old `*Bold Name*` if the PM isn't in `PM_EMAIL_MAP` or has no Slack account) — the tagged PM gets a real Slack notification when their tickets post to the channel |
| v5.19 | Disambiguated `Adarsh`, `Ashish`, `Tushar` in `PM_EMAIL_MAP` (`index.html` + `worker.js`) by looking all 7 people up directly in the connected Slack workspace instead of guessing — found `ashish1.kumar@cars24.com` is actually Ashish Pathak (not another Ashish Kumar) and corrected the roster's dead `tushar.pathak@cariotauto.com` to the real registered account `tushar.pathak1@cars24.com`. These 7 are now keyed by full name instead of first name. New `resolvePmEmail(name)` helper (full-name match first, first-name fallback second) replaces every direct `PM_EMAIL_MAP[...]` lookup in both runtimes so the full-name entries actually get used |
| v5.20 | Tickets tab Slack usability pass — the channel picker previously only existed inside the separate free-text compose modal, so the "📣 Slack"/"📨 Ticket Updates" buttons sent to whatever channel happened to be stored in `localStorage['slackChannelId']` with no visible/reachable picker on the Tickets tab itself. Added an inline `<select id="ticket-slack-channel">` directly next to those two buttons in `renderTicketTab()`, populated via a new shared `populateChannelSelect(sel, opts)` helper (factored out of `populateSlackChannelPicker`) that both the compose modal and this new picker now call; `opts.pinned` sorts a given channel-name list to the top and `opts.onMissing` reports back any pinned name the fetched list doesn't contain. New `TICKET_SLACK_CHANNELS` constant (`expansion-projects-team`, `expansion_core_india`, `projects-internal`) is passed as `pinned` — if `SLACK_USER_TOKEN`'s identity hasn't joined one of those three yet, a `#ticket-slack-channel-warn` note under the picker names exactly which one, instead of it just silently not appearing. Also added a per-row "📣" button (new "Slack" column, Vicky-only) via new `sendSingleTicketToSlack(id, btn)` — DMs just that one ticket's assignee (same per-ticket line/link format as the two existing batch senders) instead of only being able to message everyone at once; disabled when a ticket has no assignee |
| v5.21 | Two fixes: (1) `sendTicketDigestsToSlack()` ("📨 Ticket Updates" DM digest) was missing the `[Site]` prefix that the other two ticket-Slack senders (`sendTicketSummaryToSlack`, `sendSingleTicketToSlack`) already include — each line now reads `• [Site] <link> — Title (Priority)`, matching the other two; (2) the `#ticket-slack-channel-warn` copy was misleading — it said "invite it there" as if a bot needed adding, but `SLACK_USER_TOKEN` is a **user** token that posts as Vicky's own identity, so a channel missing from the picker means Vicky herself hasn't joined that channel in Slack, not that an app needs inviting. Reworded to say that plainly; CLAUDE.md's "Channel picker" note updated to match |
| v5.22 | Fixed `handleSlackChannels()` (`worker.js`, `GET /slack/channels`) silently missing channels Vicky is actually a member of — it only ever fetched `conversations.list`'s first page (`limit:200`), with no cursor pagination, so on a workspace with more than ~200 channels (or just an unlucky sort order — Slack's default isn't alphabetical) a joined channel could land past page 1 and never appear, which is exactly what she reported for `expansion-projects-team`/`expansion_core_india`/`projects-internal` despite being a member of all three. Now walks `response_metadata.next_cursor` until exhausted (capped at 20 pages / ~4000 channels) before filtering to `is_member` |
| v5.23 | Tickets tab channel picker (`#ticket-slack-channel`) was listing every channel Vicky's joined with the three team channels merely sorted to the top — she wants only those three selectable there, not her full channel list. New `opts.onlyPinned:true` on `populateChannelSelect()` filters the rendered dropdown down to just the `opts.pinned` names (still reports any of the three that aren't joined via `opts.onMissing`, and falls back to "None of the required channels are joined yet" if all three are missing); the free-text compose modal's picker is unaffected and still shows every joined channel, since that one's for arbitrary messages to anywhere |
| v5.24 | After v5.22's pagination fix still didn't surface `expansion-projects-team`/`expansion_core_india`/`projects-internal`, investigated directly against the connected Slack workspace and confirmed all three channel names are exact matches (two private, one public) that Vicky is genuinely a member of — she created two of them herself. A direct channel read (`conversations.history`-equivalent) on `expansion-projects-team` returned `channel_not_found: may be in a different workspace than your app is installed on`, which is the real root cause: **Cars24's Slack is a multi-workspace (Enterprise Grid) org, and the Slack app behind `SLACK_USER_TOKEN` isn't installed on the workspace these three channels live in** — org-wide search can still surface them (shared search index), but `conversations.list` can't, no matter how much pagination it does. This isn't fixable in `worker.js`/`index.html`; it needs a Slack admin to install/authorize the app on that workspace, or a token re-issued from an app installed org-wide. `opts.onMissing(missingNames, totalFetched)` on `populateChannelSelect()` now also reports how many *other* channels loaded fine, and the `#ticket-slack-channel-warn` copy uses that to distinguish "some channels loaded, just not these three (likely a workspace-install issue)" from "nothing loaded at all (check Slack app access)" — so this failure mode is diagnosable from the UI without needing to repeat this investigation |
| v5.25 | Tickets tab: replaced the `#ticket-slack-channel` `<select>` + single "📣 Slack" button with three one-click "📣 #channel-name" buttons, one per `TICKET_SLACK_CHANNELS` entry (`expansion-projects-team`, `expansion_core_india`, `projects-internal`) — Vicky wanted to post the ticket summary straight to a known channel without picking it from a dropdown first. New `postTicketSummaryToChannel(channelName, btn)` resolves the channel name to an ID via the existing cached `loadSlackChannels()` list and calls `sendTicketSummaryToSlack(btn, channelId)`, which now takes an explicit `channelId` param and passes it straight to `sendToSlack(...,channelId)` instead of relying on the stored `localStorage['slackChannelId']` default (still the fallback for any caller that omits it, e.g. the free-text compose modal, unaffected by this change). If the identity behind `SLACK_USER_TOKEN` hasn't joined one of the three channels, the click fails with a toast naming exactly which one instead of silently posting to the wrong place. The `#ticket-slack-channel-warn` proactive diagnostic from v5.24 (surfaces a workspace-install issue before any click) is preserved, now driven directly by `loadSlackChannels()` on tab render instead of through the removed `<select>`'s `populateChannelSelect()` call. `populateChannelSelect()`/`populateSlackChannelPicker()` themselves are unchanged and still back the compose modal's picker |

| v5.26 | Replaced the 📣 emoji with the real Slack logo mark on every clickable Slack button — same SVG path data as the icon already used in the hub page's footer contact nav (root `index.html`), so branding matches across the two files. New shared `SLACK_ICON_SVG` constant (defined right after `isVicky()`) is used via string concatenation in every JS-built button (`data-slack-kind` buttons in SAT/UAT delay, handover, procurement, vendor penalty, snag, pending-docs sections; the Tickets tab's three channel-post buttons and per-row DM button); the three static-HTML buttons (compose modal header, toolbar "Slack Message", PM Scorecard "Send PM Updates to Slack") got the SVG inlined directly since they're not JS-generated. Scope was deliberately narrowed to just the icon on clickable Slack buttons — toast/status text (e.g. "📣 Sent to Slack") and code comments that mention Slack still use the emoji, and no email-icon buttons (📧/📨 Delay Notice, SAT Delay Notice, Snag Notice) were touched |

| v5.27 | `handleSlackChannels()` (`worker.js`, `GET /slack/channels`) switched from `conversations.list` to `users.conversations` (scoped to the token owner's own `user_id`, resolved via `auth.test`) — confirmed against the live workspace that `conversations.list` was silently missing `expansion-projects-team`/`expansion_core_india`/`projects-internal` because it scopes to channels the *app* is installed on (an Enterprise Grid multi-workspace gap, root-caused in v5.24), whereas `users.conversations` returns every conversation the *user* actually belongs to and does include those three. Same cursor-pagination walk as before, just against the user-scoped endpoint, and the `is_member` post-filter was dropped since `users.conversations` only ever returns channels the user is already in. No frontend change needed — `postTicketSummaryToChannel()`/`populateChannelSelect()` etc. already just consume whatever `/slack/channels` returns |
| v5.28 | v5.27 still didn't surface the 3 team channels in production — `users.conversations` apparently doesn't reliably enumerate them either, despite the same `SLACK_USER_TOKEN` successfully posting straight to their channel IDs via `chat.postMessage` when called directly (confirmed by Vicky posting through a separate tool holding an identical copy of the token). Since the token itself clearly has send access, the remaining gap is discovery-only: `handleSlackChannels()` now merges a hardcoded `KNOWN_CHANNEL_IDS` map (`expansion-projects-team`→`C0AR159F19A`, `expansion_core_india`→`C02HA1M9J94`, `projects-internal`→`C0AQYTQ70CV`) into the channel list for any of the 3 not returned by the live `users.conversations` walk, so they always appear in the picker/one-click buttons regardless of what discovery finds. Live API results still take priority — the fallback only fills names discovery didn't return. No security change: `chat.postMessage` still runs the real Slack-side authorization check on send, this only fixes the picker being unable to find the ID in the first place |
| v5.29 | Two fixes: (1) removed the `#ticket-slack-channel-warn` "⚠ Not postable: ..." diagnostic from the Tickets tab (the div and its `loadSlackChannels().then(...)` check in `renderTicketTab()`) — v5.28's `KNOWN_CHANNEL_IDS` fallback already guarantees the three team channels always appear in the picker/one-click buttons, so the warning was stale noise rather than a live diagnostic; (2) Admin panel's "📋 Pending Docs Tracker" (`renderPendingDocsTracker()`) was matching `WIP_STATUSES=['wip','hold','tbs','sat done']`, pulling in On Hold/To Be Started/SAT Done sites despite its own subtitle already saying "WIP sites" — narrowed to just `Status` containing `wip` (matches `WIP` and `Additional WIP`, the same substring convention used by every other "WIP" tile/filter in the codebase, e.g. the WIP KPI tiles around lines 2367/3389/5094) |
| v5.30 | `buildSlackDelayText()` (`index.html`) rewritten from the v5.12 first-person-English tone into light Hinglish, per explicit Vicky request that the manual 📣 delay-alert messages (UAT delay, SAT delay, handover, procurement delay, vendor penalty, pending docs, snags) read less "AI-like" — e.g. UAT delay went from `'Hey '+owner+' — '+site+' is now '+od+'d past the UAT target...'` to `site+' ka UAT ab '+od+'d se pending hai (target tha '+uatTgt+'). Kya chal raha hai bhai, aaj thoda update bhej do.'`. The `'Hey '+owner+' — '` greeting was dropped from all seven templates per follow-up request — messages now open directly with the site name, and the now-unused `owner` variable was removed from the function. Scope deliberately limited to `index.html`'s manual-send templates; `worker.js`'s cron-digest counterparts (`postCrossFunctionalBlockers`/`postPmDigests`/`postDelayReminders`/`postTicketSummary`) were intentionally left in English pending a separate decision on whether the automated daily digest should match |
| v5.31 | Removed the duplicate "Communication" sub-tab from SAT→UAT (`renderSatUat()`) — its button (`renderSatUat._sub='comm'`) and dedicated view rendered the exact same `satCommHtml`/`uatCommHtml` "📧 Communication Required" block that the default Pipeline sub-tab already shows inline, so the same HEM+Design communication list appeared in two places in the same tab. The Pipeline sub-tab's inline section (unchanged) is now the only place it renders; the sub-nav is Pipeline / HEM Delays |
| v5.32 | Deep-debug pass, critical-severity fixes: (1) `openRevEdit()`/`openInlineRevEdit()` pre-filled the Revised Date picker via `pd(date).toISOString().split('T')[0]`, which shifts to the previous day in IST (UTC+5:30) — switched to the same local Y/M/D string construction `_meDatePick()` already used correctly, so saving without touching the calendar no longer silently records the wrong date; (2) `esc()` never escaped `"`/`'`, so CSV/API-derived strings (site/vendor/ticket names) could break out of double-quoted HTML attributes built via string concatenation throughout the file — `esc()` now also escapes both quote characters to HTML entities; (3) added `escJsAttr()` for the separate case of a raw value spliced into a *single-quoted JS argument* inside a double-quoted `onclick=`/`onchange=` attribute (HTML-entity-escaping alone doesn't protect this nested context — the browser decodes entities before handing the string to the JS parser) and switched `siteNameEsc`/`_llSN`/`_lsSN`/`safesite` and the Insights tab's status/owner/vendor click handlers (whose existing `s.replace(/'/g,"\'")` was a no-op — the replacement string was just `'`) to use it; also fixed four `saveCCRow`/`saveDriveRow`/`deleteHemDelay`/`submitHemDelay` call sites that were calling `esc(x).replace(/'/g,"\\'")` in the wrong order (now a no-op since `esc()` already turns `'` into `&#39;`, leaving no raw quote for the following `.replace()` to catch); (4) `showTicketDetail()` interpolated the raw ticket `ID` into `innerHTML` unescaped in three places while every other field went through `esc()` — now consistently escaped; `buildChkBox()`'s filter-dropdown `value=`/label text (Status/Owner/Vendor/Zone/BU, rendered on every page load) was also missing `esc()` entirely — added; (5) `saveMeta()`'s `fieldMap` had no entry for `'% Completion (HOTP)'` (the site modal's actual field label), so edits wrote to a dead `field_name` in `site_field_overrides` instead of `'Percentage Completion'` (the key `pct()` and every reader actually use) — looked correct for the rest of the session via a separate special-case branch, but was silently lost on reload/for other users; `fieldMap` now maps it (and `'% Completion'`/`'Percentage Completion'`) to the real column, and the Supabase write uses the same normalized (%-stripped) value that's stored in memory; (6) Admin → "Add Team Member" (`doCreateUser()`) called `__sbClient.auth.signUp()` directly on the same client instance holding the admin's own active session — Supabase JS v2 replaces the current session with the newly-created user's session when signup returns one, which this flow's own success path assumes it will, so creating a PM account would silently log the admin out and into the new account. Now uses a throwaway `persistSession:false` client for the signup call only, leaving `__sbClient`'s admin session untouched |

| v5.33 | Deep-debug pass, medium-severity fixes: (1) UAT target was computed as SAT+15d in `buildSlackDelayText('uat_delay')` and `vendorDelayMail()` while every other place (the in-app UAT warning banner, `handoverUrgencyMail`, etc.) uses the documented SAT+10d — both mailers now say SAT+10d too, so the manual Slack nudge and Gmail delay notice quote the same target/overdue-days as the rest of the app; (2) SAT→UAT's Danger/Warning/On-Track buckets (`renderSatUat()`) used `>15`/`>=10` day cutoffs that matched neither CLAUDE.md's documented `>10`/`7-10`/`<7` thresholds nor their own section headers (which already said "Danger — >10 Days") — a site at 12 days since SAT showed under "Warning" while also carrying the `>10`-triggered "🚨 UAT Date Missing" badge, a contradictory signal; bucket cutoffs and header text now agree; (3) the "⚠ Overdue" KPI tile, its click-through filter, and the table's own red-flag/⚠ badge each defined "overdue" differently (Planned-only vs Planned-with-inconsistent-`.trim()` vs Revised-falls-back-to-Planned) — the tile and filter now both call `committedDate(r)` (Revised → Planned fallback), matching the table's existing logic, so the KPI count and what a user sees when they click through it now agree; (4) the snag "open" exclusion list was missing `not applicable` (only checked `closed`/`na`/`n/a`) in the manual "Snag >70" KPI, PM Scorecard's snag score, and `showSnag70List()` — aligned to the full 6-status exclusion list (`completed`/`done`/`closed`/`na`/`n/a`/`not applicable`) already used by `buildSlackDelayText('snag')` and `snagVendorMailUrl()`; (5) `parseLLScheduleCSV` used a naive `split(',')` with no quote-awareness, unlike every other CSV parser in the file — a comma inside a Task/Vendor Name value silently shifted every later column; (6) all four CSV parsers in the file (`parseLLScheduleCSV`, `parseLLScopeCSV`, the Snag CSV upload path, `parseTicketCSV`) pre-split the raw text on `\n` before doing any quote-aware parsing, so a quoted field containing an embedded newline (a multi-line snag/ticket description) tore one record into two and misaligned every column after it — replaced all four with a single new full-text tokenizer, `parseCSVRows(text, delim)`, that walks the whole text respecting quotes (including embedded commas, embedded newlines, and doubled `""` escaping) before ever splitting into rows; the old per-line `_parseCSVLine` helper is now unused and removed; (7) the snag average-closure-days calc (`renderSnagTab`) and the Tickets tab's `getTAT()` both parsed CSV/API date strings via native `new Date()` instead of `pd()`, reintroducing the exact day-first misparse class of bug `pd()` exists to prevent (see the Date Parsing note above) — both now go through `pd()`; (8) `getStaleDays()` checked `Status` with exact equality (`st==='uat done'`) instead of the `.includes()` substring convention used everywhere else in the file, so a compound status like "Additional UAT Done" wouldn't be exempted from the stale flag, contradicting the documented rule that UAT-done sites are never flagged stale — switched to `.includes()` |

| v5.34 | Deep-debug pass, cleanup: (1) `markNotifiedByIdx()`'s Gmail draft had no `cc=` param at all (not even a hardcoded one) — now calls `buildMailCC(r)` like every other mailer, in case this dead-code path (superseded by `wCard()`'s inline notify button) is ever reconnected; (2) `handleLLBulkUpload`'s file-preview PO-number regex (`/Schedule_PO([A-Z0-9]+)\.csv/i`, no underscore) didn't match `parseLLScheduleCSV`'s actual parsing regex (`[A-Z0-9_]+`, underscore allowed) — a filename like `Schedule_POAB_12.csv` showed PO "AB" in the preview but saved as PO "AB_12"; aligned; (3) `processSnagXlsx`'s loader reassigned `SNAG_DATA=newData` instead of clearing keys + `Object.assign`, the pattern every other snag loader (CSV/JSON/ZIP) uses — aligned for consistency; (4) the three ticket-Slack senders (`sendTicketSummaryToSlack`, `sendTicketDigestsToSlack`, `sendSingleTicketToSlack`) had drifted to three different per-ticket line formats despite CLAUDE.md's v5.21 entry claiming they're identical — unified all three to `• [Site] Title: Description (Priority) - <link|#id>`; (5) corrected the "Tab / View Structure" table, which still listed a BD tab (`bdv`/`renderBDTab()`) that was fully removed from the codebase at some undocumented point — replaced with the actual current tab list (added Attendance/Admin) and flagged the BD-specific business-logic notes below it as historical-only |

| v5.35 | New "💬 PM Messages" tab (`msgv`/`renderMsgTab()`) — a Vicky-only page for maintaining a reusable library of Slack message templates, separate from the per-site `buildSlackDelayText()` "kinds" and the free-text Slack Compose modal. Gated exactly like the existing Slack buttons (`data-vicky-only="true"` tab button + `isVicky()` guard inside `renderMsgTab()`), not the `data-admin-only` admin-role gate — visible only to `vicky.bhardwaj@cars24.com`, per her explicit request. Templates persist in a new dedicated Supabase table, `message_templates` (`id, name, body, created_by, created_at, updated_at` — create-table SQL documented inline above `loadMessageTemplates()`, same style as the `uat_warning_exceptions` table; **must be created once in the Supabase SQL Editor before this tab will load/save anything**), following the "one dedicated table per feature" precedent rather than overloading the per-site `site_field_overrides` table. Each template renders as a card with Send/Edit/Delete: "+ New Template" and "Edit" open `#template-modal` (`openTemplateModal(id)`/`closeTemplateModal()`/`saveTemplateModal(btn)`, upserts to `message_templates`); "Delete" (`deleteTemplateRow(id)`) confirms then deletes the row; "Send" opens `#send-template-modal` (`openSendTemplateModal(id)`/`closeSendTemplateModal()`/`sendTemplateModal(btn)`) with a PM picker `<datalist>` sourced from `PM_EMAIL_MAP` (same idiom as the Slack Compose modal's person picker) and an editable preview of the template body, calling the existing generic `sendToSlack('dm', email, text, btn)` on send — no `worker.js` changes needed, `/slack/send` was already Vicky-gated server-side. Templates are fully static text per explicit request (no `{name}`/placeholder substitution) |

| v5.36 | Fixed a pre-existing bug that silently broke all `data-vicky-only` UI (the "Slack Message" toolbar button, and the new v5.35 "PM Messages" tab) regardless of who was logged in: `onSbLoginSuccess()`, `doLegacyLogin()`'s success handler, and `doLogout()` each referenced `document.getElementById('ticket-live-lbl')`, but no element with that id exists anywhere in the page — it was removed from the markup in a prior refactor (ticket syncing moved from a manual "Live CSV" upload input to the "🔄 Sync Tickets" button/`syncTicketsFromPF()`) without cleaning up the JS that toggled its visibility. Since `.style` on `null` throws, all three functions aborted at that line every time — for `onSbLoginSuccess()` and `doLogout()`, that meant `applyRoleBasedView()` (the very next line) never ran, so `data-vicky-only` elements — which start as `display:none` in the raw HTML and depend on that function to reveal them — stayed hidden forever even for `vicky.bhardwaj@cars24.com`'s own account, while `data-admin-only` elements (Attendance, Admin) were unaffected since they're visible by default in the raw HTML and only get *hidden* by JS for non-admins. Removed the 3 dangling `ticket-live-lbl` toggle lines and the now fully-unreachable `handleLiveTicketCSV()` function (confirmed via grep no caller references it — it was the file-input handler for the same removed "Live ticket CSV" upload). No changes to `isVicky()`/`applyRoleBasedView()`/gating logic itself — those were always correct, they just never got a chance to execute |

| v5.37 | PM Messages "Send Template" modal (`#send-template-modal`) switched from a single-pick `<input list>`/`<datalist>` PM picker to a scrollable checkbox list, per Vicky's request to send one template to multiple PMs in one click instead of reopening the modal per person. `openSendTemplateModal(id)` now fills `#send-template-person-list` (repurposed from a `<datalist>` to a plain scrollable `<div>`) with one checkbox per `PM_EMAIL_MAP` entry; `sendTemplateModal(btn)` reads all `:checked` boxes and fires one `sendToSlack('dm', email, text, null)` per selection, reusing the exact button-disable + `Promise.all(...).then(...)` + single aggregate toast sequencing `sendPmDigestsToSlack()` already established for multi-recipient sends. The old free-typed-email fallback is dropped — this field is PM-checkbox-only now, matching the request |

| v5.38 | PM Messages "Send Template" checkbox list narrowed from all ~60 `PM_EMAIL_MAP` entries down to Vicky's actual core team of 7 (Ajeet Sharma, Kiran W, Kamal Saini, Md Akhtar, Nitesh Kumar, Gaurav Jangir, Shivam Shukla), per her explicit request — the full roster includes many stale/inactive names still needed elsewhere (ticket-assignee resolution, PM digests), so a new `PM_MESSAGES_TEAM` constant (`[displayName, PM_EMAIL_MAP key]` pairs, placed right after `PM_EMAIL_MAP`) scopes just this one picker instead of touching the shared map — same "restrict one picker, leave the map alone" pattern as the Tickets tab's `TICKET_SLACK_CHANNELS`. Each pair's second element is resolved through `resolvePmEmail()` rather than indexing `PM_EMAIL_MAP` directly, and is *not* always the display name's first word — Akhtar's map key is his last name, so passing "Md Akhtar" through `resolvePmEmail()` verbatim would've silently failed to resolve (its first-word fallback would look up "Md", not "Akhtar") |

| v5.39 | Added a "Select All" checkbox above the PM Messages "Send Template" checkbox list (`toggleSendTemplateSelectAll(cb)`) — one click checks/unchecks every `PM_MESSAGES_TEAM` entry instead of ticking all 7 by hand. Resets to unchecked each time `openSendTemplateModal()` opens; one-way only (toggling it sets every box, but manually unchecking an individual PM doesn't un-tick "Select All" — kept simple per the ask) |

| v5.40 | Two new proactive risk triggers, both with Slack (📣, Vicky-only manual send) + Gmail (`buildMailCC(r)`) alerts, per explicit request: (1) **Branding/Signage risk** — new `getHandoverDate(r)` helper (UAT target SAT+10d once SAT is done, else `committedDate(r)`; same date `handoverUrgencyMail`/`buildSlackDelayText('handover')` already use) backs `getBrandingRiskSites()`, which queries the `milestone_gates` table for every site's `'Branding / Signage Complete'` gate (one of the `DEFAULT_GATES`) and flags sites where that gate isn't done and handover is ≤10 days out (a site with no `milestone_gates` row yet — never opened in Construction tab — defaults to "not done", the safe direction). Renders as a new "🎨 Branding/Signage Risk" card in SAT→UAT (`renderBrandingRiskSection()`, async — populates a `#branding-risk-sec` placeholder after the tab's normal synchronous render, same deferred-fill pattern `renderMilestoneGates` already uses), each row with a `brandingDelayMail(r)` Gmail draft and a `data-slack-kind="branding_delay"` button (Hinglish tone, matching v5.30); (2) **Furniture dispatch risk** — procurement items (`PROCURE_DATA`) whose `item` name contains "Furniture" get two new per-row controls, visible only on furniture rows: a "Dispatched" checkbox (reuses the existing generic `toggleProcureStatus(...,'dispatched',...)`) and a "Dispatch Date" date input (`setProcureDispatchDate()`, new field `dispatchDate`, manually entered — procurement dates otherwise only ever come from CSV upload, but there's no CSV column for this new field). `getFurnitureRiskItems(siteName)` flags any not-yet-dispatched furniture item when either the site handover is ≤10 days out or the item's own `dispatchDate` is ≤7 days out; `renderProcureSection()` shows a "🪑 Furniture Alert (n)" button (next to the existing Delay/Penalty Notice buttons) when any items are flagged, linking `furnitureDispatchMail(r,items)` + a `data-slack-kind="furniture_dispatch"` button. Both new Slack kinds added to `buildSlackDelayText()`, both mailers follow the existing mailer pattern exactly (`buildMailCC(r)`, `mail.google.com/mail/?view=cm` URL) — no new Worker/Slack-relay code needed |

| v5.41 | `buildSlackDelayText()`'s `vendor_penalty` template (the 📣 button next to "⚠ Penalty Notice" in the Procurement section) reworded per explicit request — was `'{site} ke liye vendor ko penalty notice bhej rahe hain, {n} items delivery mein overdue hai. Bas pehle flag kar raha hoon, agar koi context miss ho raha ho toh batana.'` (an FYI-style note to self), now `'Bhai {site} mai {n} items mai procurement delay dikh raha h mujhe, iska followup lelo vendor se aur jaldi mangwao jo pending hai.'` — a direct ask to the PM to chase the vendor, matching the Hinglish tone convention set in v5.30 |

---

## Current Version: v5.41

