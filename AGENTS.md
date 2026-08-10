# Project Instructions

## Supabase SQL

- Whenever a change requires Supabase SQL, include the complete, directly copyable SQL in the final response.
- Put the SQL in a fenced `sql` code block with no Git diff markers (`diff --git`, `---`, `+++`, `@@`, or leading `+` characters).
- Explain exactly where to run it in the Supabase Dashboard and whether it is safe to run more than once.
- Clearly state when a change does not require any Supabase SQL.
- Keep deployment instructions beginner-friendly and do not assume the reader knows Git or SQL.

## Version Bump

- Every change, including documentation-only changes, must increment the version in the `<title>` of `projects-tracker/index.html`.
- Add the same version to the `## Version History Summary` table in `CLAUDE.md` and update its `## Current Version` line in the same commit.
- Confirm all three version references match before committing.
