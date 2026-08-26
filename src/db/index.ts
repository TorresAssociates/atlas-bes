import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ConnectionOptions } from "node:tls";
import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import type { DB } from "@/db/types";
import { AwsSecretRetriever } from "@/db/util/AwsSecretRetriever";
import { type DatabaseCredentials, DBClient } from "@/db/util/DBClient";

export interface DatabasePool {
	connect(): Promise<pg.PoolClient>;
	end(): Promise<void>;
	query<R extends pg.QueryResultRow = pg.QueryResultRow>(
		query: string | pg.QueryConfig<unknown[]>,
		parameters?: unknown[],
	): Promise<pg.QueryResult<R>>;
}

class DBClientPoolAdapter implements DatabasePool {
	constructor(private readonly client: DBClient) {}

	connect(): Promise<pg.PoolClient> {
		return (
			this.client as unknown as {
				getPoolClient(): Promise<pg.PoolClient>;
			}
		).getPoolClient();
	}

	end(): Promise<void> {
		return this.client.end();
	}

	query<R extends pg.QueryResultRow = pg.QueryResultRow>(
		query: string | pg.QueryConfig<unknown[]>,
		parameters?: unknown[],
	): Promise<pg.QueryResult<R>> {
		return this.client.query(
			query as string | pg.QueryConfig<unknown[]>,
			parameters,
		) as Promise<pg.QueryResult<R>>;
	}
}

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

export interface DatabaseClientConfig {
	connectionString: string;
	awsSecretIdDbCredentials?: string;
	awsRegionOverride?: string;
	awsAccessKeyIdOverride?: string;
	awsSecretAccessKeyOverride?: string;
}

interface AwsDatabaseCredentialsSecret {
	engine: string;
	host: string;
	port: number;
	dbname: string;
	username: string;
	password: string;
	dbInstanceIdentifier: string;
	masterarn: string;
}

const SSL_CA_PATH = join(tmpdir(), "atlas-rds-global-bundle.pem");
const RDS_GLOBAL_CA_URL = "https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem";

function createConnectionStringClient(
	connectionString: string,
	logger?: ConstructorParameters<typeof DBClient>[1],
): DBClient {
	const dbClient = new DBClient(
		{
			defaultConfig: {
				poolConfig: {
					connectionString,
					max: 10,
					idleTimeoutMillis: 30_000,
					connectionTimeoutMillis: 5_000,
					ssl: undefined,
				},
			},
		} as ConstructorParameters<typeof DBClient>[0],
		logger,
	);
	return dbClient;
}

function createAwsSecretClient(
	config: DatabaseClientConfig,
	logger?: ConstructorParameters<typeof DBClient>[1],
): DBClient {
	if (!config.awsSecretIdDbCredentials) {
		throw new Error("AWS_SECRET_ID_DB_CREDENTIALS is required for AWS secret database mode");
	}

	const awsSecretIdDbCredentials = config.awsSecretIdDbCredentials;
	const secretRetriever = new AwsSecretRetriever({
		awsRegionOverride: config.awsRegionOverride,
		awsAccessKeyIdOverride: config.awsAccessKeyIdOverride,
		awsSecretAccessKeyOverride: config.awsSecretAccessKeyOverride,
	});

	const getDatabaseSecret = async (): Promise<DatabaseCredentials> => {
		const secretString = await secretRetriever.retrieveSecret(
			awsSecretIdDbCredentials,
			"AWSCURRENT",
		);
		if (secretString === undefined) throw new Error("Unable to get database credentials");

		const dbData = JSON.parse(secretString) as AwsDatabaseCredentialsSecret;
		return {
			host: dbData.host,
			port: dbData.port,
			database: dbData.dbname,
			user: dbData.username,
			password: dbData.password,
		};
	};

	const getDatabaseSslCa = async (): Promise<ConnectionOptions> => {
		const response = await fetch(RDS_GLOBAL_CA_URL);
		if (!response.ok) {
			throw new Error(`Unable to retrieve database SSL CA: ${response.statusText}`);
		}

		const sslCaText = await response.text();
		writeFileSync(SSL_CA_PATH, sslCaText);
		return { ca: sslCaText };
	};

	const getCurrentDatabaseSslCa = async (
		previousSslConfig: boolean | ConnectionOptions | undefined,
	): Promise<boolean | ConnectionOptions> => {
		if (!existsSync(SSL_CA_PATH)) {
			return previousSslConfig ?? getDatabaseSslCa();
		}

		return { ca: readFileSync(SSL_CA_PATH).toString() };
	};

	return new DBClient(
		{
			defaultConfig: {
				poolConfig: {
					max: 10,
					idleTimeoutMillis: 30_000,
					connectionTimeoutMillis: 5_000,
					maxLifetimeSeconds: 604_800,
				},
				onSwitchSsl: getCurrentDatabaseSslCa,
				onSslInvalid: getDatabaseSslCa,
				onSwitchCredentials: getDatabaseSecret,
				onCredentialUnauthorized: getDatabaseSecret,
			},
		} as ConstructorParameters<typeof DBClient>[0],
		logger,
	);
}

export async function createDatabaseClient(
	config: DatabaseClientConfig,
	logger?: ConstructorParameters<typeof DBClient>[1],
): Promise<DatabasePool> {
	const dbClient = config.awsSecretIdDbCredentials
		? createAwsSecretClient(config, logger)
		: createConnectionStringClient(config.connectionString, logger);
	await dbClient.init();
	return new DBClientPoolAdapter(dbClient);
}

// Kysely is the only database access path for application code — the sole
// bare pool.query() allowed is the readiness probe in server.ts, which is
// infrastructure, not a domain query.
//
// Deliberately NO CamelCasePlugin: the schema is snake_case and so is the
// API. There is no case conversion layer anywhere.
export function createDb(pool: DatabasePool): Kysely<DB> {
	return new Kysely<DB>({ dialect: new PostgresDialect({ pool: pool as pg.Pool }) });
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
