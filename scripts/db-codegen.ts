import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AwsSecretRetriever } from "../src/db/util/AwsSecretRetriever";

interface AwsDatabaseCredentialsSecret {
	host: string;
	port: number;
	dbname: string;
	username: string;
	password: string;
}

const RDS_GLOBAL_CA_URL = "https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem";
const SSL_CA_DIR = ".tmp";
const SSL_CA_PATH = resolve(SSL_CA_DIR, "atlas-rds-global-bundle.pem");

interface CodegenDatabaseConfig {
	url: string;
	env: NodeJS.ProcessEnv;
}

function log(message: string): void {
	process.stderr.write(`${message}\n`);
}

async function getDatabaseSslCaPath(): Promise<string> {
	const response = await fetch(RDS_GLOBAL_CA_URL);
	if (!response.ok) {
		throw new Error(`Unable to retrieve database SSL CA: ${response.statusText}`);
	}

	mkdirSync(SSL_CA_DIR, { recursive: true });
	writeFileSync(SSL_CA_PATH, await response.text());
	return SSL_CA_PATH;
}

async function getDatabaseConfig(): Promise<CodegenDatabaseConfig> {
	const secretId = process.env.AWS_SECRET_ID_DB_CREDENTIALS;
	if (!secretId) {
		const databaseUrl = process.env.DATABASE_URL;
		if (!databaseUrl) throw new Error("DATABASE_URL is required for local database codegen");
		log("db:codegen using DATABASE_URL");
		return { url: databaseUrl, env: process.env };
	}

	log(`db:codegen using AWS secret ${secretId}`);
	const secretRetriever = new AwsSecretRetriever({
		awsRegionOverride: process.env.AWS_REGION_OVERRIDE,
		awsAccessKeyIdOverride: process.env.AWS_ACCESS_KEY_ID_OVERRIDE,
		awsSecretAccessKeyOverride: process.env.AWS_SECRET_ACCESS_KEY_OVERRIDE,
	});
	const secretString = await secretRetriever.retrieveSecret(secretId, "AWSCURRENT");
	if (secretString === undefined) throw new Error("Unable to get database credentials");

	const credentials = JSON.parse(secretString) as AwsDatabaseCredentialsSecret;
	log(
		`db:codegen connecting to ${credentials.username}@${credentials.host}:${credentials.port}/${credentials.dbname}`,
	);
	return {
		url: `postgres://${encodeURIComponent(credentials.username)}:${encodeURIComponent(
			credentials.password,
		)}@${credentials.host}:${credentials.port}/${encodeURIComponent(credentials.dbname)}`,
		env: {
			...process.env,
			NODE_EXTRA_CA_CERTS: await getDatabaseSslCaPath(),
			PGSSLMODE: "verify-full",
		},
	};
}

const passthroughArgs = Bun.argv.slice(2);
const databaseConfig = await getDatabaseConfig();
const child = Bun.spawn(
	[
		"bunx",
		"kysely-codegen",
		"--dialect",
		"postgres",
		"--out-file",
		"src/db/types.ts",
		"--url",
		databaseConfig.url,
		...passthroughArgs,
	],
	{
		env: databaseConfig.env,
		stdout: "inherit",
		stderr: "inherit",
		stdin: "inherit",
	},
);

const exitCode = await child.exited;
process.exit(exitCode);
