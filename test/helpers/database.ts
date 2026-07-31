import { join } from "node:path";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { Wait } from "testcontainers";

const REPO_ROOT = join(import.meta.dir, "../..");

export interface TestDatabase {
	pool: pg.Pool;
	connectionUri: string;
	stop(): Promise<void>;
}

/**
 * Starts a throwaway Postgres container at the local scratchpad schema
 * (db/local/schema.sql + seed.sql) and returns a pool wired to it. Pass the
 * pool to buildApp({ pool }) — buildApp does not close injected pools, so
 * always call stop() in afterAll.
 *
 * Shared by every module's integration tests; container startup is the slow
 * part, so start one per test file, not per test.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
	// Wait on the log message, NOT PostgreSqlContainer's default health-check
	// wait strategy: under Bun the health check completes but its docker event
	// stream never closes, so start() hangs forever. The message appears twice
	// (initdb restart, then the real boot) — wait for the second.
	const container = await new PostgreSqlContainer("postgres:16")
		.withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
		.start();
	const connectionUri = container.getConnectionUri();
	const pool = new pg.Pool({ connectionString: connectionUri, max: 10 });

	// pg runs multi-statement strings via the simple query protocol, so each
	// file can be applied in one call.
	await pool.query(await Bun.file(join(REPO_ROOT, "db/local/schema.sql")).text());
	await pool.query(await Bun.file(join(REPO_ROOT, "db/local/seed.sql")).text());

	return {
		pool,
		connectionUri,
		stop: async () => {
			await pool.end();
			await container.stop();
		},
	};
}

/**
 * buildApp validates the full env schema at boot; tests that never touch the
 * real config still need every required variable present.
 */
export function stubConfigEnv(): void {
	process.env.DATABASE_URL ??= "postgres://unused:unused@localhost:5432/unused";
	process.env.S3_ASSETS_BUCKET ??= "test-bucket";
	process.env.BETTER_AUTH_SECRET ??= "test-secret";
	process.env.ENCRYPTION_KEY ??= "test-encryption-key";
	process.env.BETTER_AUTH_URL ??= "http://localhost:8000";
	process.env.FRONTEND_ORIGIN ??= "http://localhost:5173";
}
