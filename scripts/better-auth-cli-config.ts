// Used ONLY by the better-auth CLI to generate DDL for the migrations repo:
//
//   bun run auth:schema
//
// Not imported by application code. The CLI introspects the connected
// database and emits only what's missing, so auth:schema points it at a
// scratch EMPTY database (better_auth_ddl, created by the script) to get the
// full DDL. Relative imports on purpose: the CLI's config loader does not
// resolve the @/* tsconfig alias.
import { createDb, createPool } from "../src/db";
import { createAuth } from "../src/modules/auth/auth";

export const auth = createAuth(
  {
    BETTER_AUTH_SECRET: "cli-schema-generation-only-not-a-real-secret",
    BETTER_AUTH_URL: "http://localhost:8000",
    FRONTEND_ORIGIN: "http://localhost:5173",
  },
  createDb(createPool("postgres://postgres:dev@localhost:5432/better_auth_ddl")),
);
