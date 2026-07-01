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
    ├── Constants (CSV_DATA=[], SNAG_DATA={}, TICKET_DATA=[], DRIVE_MAP, SLACK_HANDLES)
    ├── Global helpers (pd, esc, toast, parseCSV, extractBlockers, getStaleDays...)
    ├── SAT/UAT helpers (getRevHistory, fmtRevHistory, committedDate, gmailDraft...)
    ├── Vendor mail (vendorDelayMail, satDelayMail, bdTeamMail)
    ├── Feature modules (renderTable, renderSatUat, renderSnagTab, renderBDTab...)
    ├── Slack module (renderSlackTab, generateBDSlack, copyTasksForSlack...)
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
| Slack | `slackv` | `renderSlackTab()` |
| Tickets | `tickv` | `renderTicketTab()` |
| BD | `bdv` | `renderBDTab()` |

All non-`tv` divs are hidden by CSS: `#suv,#taskv,#pmsv,#tickv,#slackv,#bdv{display:none}` Shown via `.show` class: `#suv.show,#taskv.show,...{display:block}` `setView(v, btn)` handles all tab switching — always update it when adding new tabs.

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

---

## Slack Handles Map

All 26 PM handles are hardcoded in `SLACK_HANDLES` constant. Key mappings: `Akhtar → @md.fasih.akhtar`, `Kamal → @kamal.saini`, `Karan → @karan.dhar.singh.bharti`

---

## Email / Mailer Rules

All Gmail drafts:

- **To:** blank (PM fills manually)  
- **CC:** `vicky.bhardwaj@cars24.com, rajat.sharma3@cars24.com`  
- Never add "CC: Vicky Bhardwaj, Head of Projects" in body text  
- 3 mailer types: `gmailDraft(r, 'SAT'|'UAT')`, `vendorDelayMail(r)`, `satDelayMail(r)`  
- 4 team triggers per BD site: `bdTeamMail(r, 'IT'|'NSO'|'Admin'|'HEM', tempLiveD, finalLiveD)`

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

## Known Pending Bugs (as of v3.46)

| \# | Area | Issue |
| :---- | :---- | :---- |
| 5 | Tickets | Drive links on ticket summary incorrect |
| 24 | Snag Tab | Add embed link to Snag Google Sheet |
| 25 | Tickets Tab | Add embed link to Tickets Google Sheet |
| 26 | Table | Empty sites still loading despite Site Name filter fix |
| 27 | UAT Warnings | Replace Mark Warning button with Gmail draft to PM |
| 28 | Slack Cross-Functional | Fix blocker type grouping \+ Slack format |
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

---

## Current Version: v5.4

