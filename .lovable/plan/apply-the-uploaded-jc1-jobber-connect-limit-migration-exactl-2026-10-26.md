Apply the uploaded JC1 Jobber connect-limit migration exactly as written.

- Create one new migration (expected as 0057, Jobber connect limit) holding the SQL between BEGIN and END byte-for-byte.
- Apply it to the database.
- No other edits, deploys, secrets, settings, data reads, policies or grants. Build/type errors are left alone.
- Report back: migration file name, whether it applied (or the exact error), and every file touched (the migration tool also writes its journal/snapshot entry; generated types may refresh).
