# db/local — schema design scratchpad

**This directory is NOT the source of truth for the database schema.**
Schema DDL is versioned in a separate migrations repository owned by the
backend/data side of the team.

This is a dev-only scratchpad for iterating on schema design against the
local compose database:

- `schema.sql` is **DROP-and-CREATE**: it begins by dropping the entire
  `public` schema. Running `bun run db:reset` **destroys all local data**,
  every time, on purpose. Never point it at anything but the local compose
  database.
- `seed.sql` holds optional local seed data, applied by `bun run db:seed`.
- `spec/` holds the schema specs and generated artifacts destined for the
  migrations repo. `spec/better-auth-schema.sql` is better-auth's own DDL,
  regenerated with `bun run auth:schema` — hand it to the migrations repo,
  never apply it from here.
- `bun run db:sync` = reset + seed + regenerate `src/db/types.ts` via
  kysely-codegen, so queries typecheck against whatever you're sketching.

## Lifecycle of a table

1. Sketch it here, iterate with `bun run db:sync` until the design settles.
2. When a table stabilizes, hand its DDL to the migrations repo, where it
   becomes a real, versioned migration.
3. Delete it from `schema.sql` here. This file should only ever contain
   work-in-progress design, not a mirror of the real schema.
