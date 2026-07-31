import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { DB } from "@/db/types";

// Pool max stays at 10 — a larger pool
// hides backpressure rather than adding throughput.
export function createPool(connectionString: string): pg.Pool {
	return new pg.Pool({
		connectionString,
		max: 10,
		idleTimeoutMillis: 30_000,
		connectionTimeoutMillis: 5_000,
	});
}

// Kysely is the only database access path for application code — the sole
// bare pool.query() allowed is the readiness probe in server.ts, which is
// infrastructure, not a domain query.
//
// Deliberately NO CamelCasePlugin: the schema is snake_case and so is the
// API. There is no case conversion layer anywhere.
export function createDb(pool: pg.Pool): Kysely<DB> {
	return new Kysely<DB>({ dialect: new PostgresDialect({ pool }) });
}

function pgErrorCode(err: unknown): string | undefined {
	if (typeof err === "object" && err !== null && "code" in err) {
		const code = (err as { code: unknown }).code;
		if (typeof code === "string") return code;
	}
	return undefined;
}

/** Postgres error 23505: a UNIQUE constraint was violated. */
export function isUniqueViolation(err: unknown): boolean {
	return pgErrorCode(err) === "23505";
}

/** Postgres error 23503: a FOREIGN KEY constraint was violated. */
export function isForeignKeyViolation(err: unknown): boolean {
	return pgErrorCode(err) === "23503";
}
