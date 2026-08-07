import { join } from "node:path";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import pg from "pg";
import { Wait } from "testcontainers";

const REPO_ROOT = join(import.meta.dir, "../..");
const DEFAULT_WINDOWS_TEST_DATABASE_URL =
	"postgres://postgres:dev@localhost:5432/atlas_test";
let localDatabaseCounter = 0;

export interface TestDatabase {
	pool: pg.Pool;
	connectionUri: string;
	stop(): Promise<void>;
}

function databaseNameFrom(connectionUri: string): string {
	const url = new URL(connectionUri);
	const databaseName = url.pathname.replace(/^\//, "");
	if (!/^[a-zA-Z0-9_]+$/.test(databaseName)) {
		throw new Error(
			`test database name ${JSON.stringify(databaseName)} is not safe to create`,
		);
	}
	return databaseName;
}

function maintenanceDatabaseUrl(connectionUri: string): string {
	const url = new URL(connectionUri);
	url.pathname = "/template1";
	return url.toString();
}

function uniqueDatabaseUrl(connectionUri: string): string {
	const url = new URL(connectionUri);
	const baseName = databaseNameFrom(connectionUri);
	localDatabaseCounter += 1;
	url.pathname = `/${baseName}_${process.pid}_${Date.now()}_${localDatabaseCounter}`;
	return url.toString();
}

async function ensureDatabaseExists(connectionUri: string): Promise<void> {
	const databaseName = databaseNameFrom(connectionUri);
	const adminPool = new pg.Pool({
		connectionString: maintenanceDatabaseUrl(connectionUri),
		max: 1,
	});

	try {
		const existing = await adminPool.query(
			"SELECT 1 FROM pg_database WHERE datname = $1",
			[databaseName],
		);
		if (existing.rowCount === 0) {
			await adminPool.query(`CREATE DATABASE ${databaseName}`);
		}
	} finally {
		await adminPool.end();
	}
}

async function dropDatabase(connectionUri: string): Promise<void> {
	const databaseName = databaseNameFrom(connectionUri);
	const adminPool = new pg.Pool({
		connectionString: maintenanceDatabaseUrl(connectionUri),
		max: 1,
	});

	try {
		await adminPool.query(
			`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
			[databaseName],
		);
		await adminPool.query(`DROP DATABASE IF EXISTS ${databaseName}`);
	} finally {
		await adminPool.end();
	}
}

async function applySchemaAndSeed(pool: pg.Pool): Promise<void> {
	// pg runs multi-statement strings via the simple query protocol, so each
	// file can be applied in one call.
	await pool.query(
		await Bun.file(join(REPO_ROOT, "db/local/schema.sql")).text(),
	);
	await pool.query(
		await Bun.file(join(REPO_ROOT, "db/local/seed.sql")).text(),
	);
}

function getLocalTestDatabaseUrl(): string | undefined {
	if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;

	// Bun + Testcontainers can fail Docker Desktop named-pipe discovery on Windows.
	// Use the local compose Postgres instead, isolated in per-test databases.
	if (process.platform === "win32")
		return uniqueDatabaseUrl(DEFAULT_WINDOWS_TEST_DATABASE_URL);

	return undefined;
}

async function startLocalTestDatabase(
	connectionUri: string,
): Promise<TestDatabase> {
	await ensureDatabaseExists(connectionUri);

	const pool = new pg.Pool({ connectionString: connectionUri, max: 10 });
	await applySchemaAndSeed(pool);

	return {
		pool,
		connectionUri,
		stop: async () => {
			await pool.end();
			if (!process.env.TEST_DATABASE_URL)
				await dropDatabase(connectionUri);
		},
	};
}

async function startContainerTestDatabase(): Promise<TestDatabase> {
	// Wait on the log message, NOT PostgreSqlContainer's default health-check
	// wait strategy: under Bun the health check completes but its docker event
	// stream never closes, so start() hangs forever. The message appears twice
	// (initdb restart, then the real boot) - wait for the second.
	const container = await new PostgreSqlContainer("postgres:16")
		.withWaitStrategy(
			Wait.forLogMessage(
				/database system is ready to accept connections/,
				2,
			),
		)
		.start();
	const connectionUri = container.getConnectionUri();
	const pool = new pg.Pool({ connectionString: connectionUri, max: 10 });

	await applySchemaAndSeed(pool);

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
 * Starts a database with db/local/schema.sql + seed.sql applied and returns a
 * pool wired to it. On Windows this uses local compose Postgres because
 * Bun/Testcontainers can fail Docker Desktop pipe discovery.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
	const localConnectionUri = getLocalTestDatabaseUrl();
	if (localConnectionUri) return startLocalTestDatabase(localConnectionUri);

	return startContainerTestDatabase();
}

/**
 * buildApp validates the full env schema at boot; tests that never touch the
 * real config still need every required variable present.
 */
export function stubConfigEnv(): void {
	process.env.DATABASE_URL ??=
		"postgres://unused:unused@localhost:5432/unused";
	process.env.S3_ASSETS_BUCKET ??= "test-bucket";
	process.env.BETTER_AUTH_SECRET ??= "test-secret";
	process.env.ENCRYPTION_KEY ??= "test-encryption-key";
	process.env.BETTER_AUTH_URL ??= "http://localhost:8000";
	process.env.FRONTEND_ORIGIN ??= "http://localhost:5173";
	process.env.HOLOGRAM_ORG_ID ??= "123";
	process.env.HOLOGRAM_API_KEY ??= "test-hologram-key";
	process.env.EMNIFY_APPLICATION_TOKEN ??= "test-emnify-token";
	process.env.EMNIFY_ORG_ID ??= "27343";
}
