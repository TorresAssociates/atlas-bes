import fastifyEnv from "@fastify/env";
import { type Static, Type } from "@sinclair/typebox";
import fp from "fastify-plugin";

// Every variable in .env.example is validated here. PORT, LOG_LEVEL, and
// AWS_REGION have defaults; everything else is required so the process
// refuses to boot half-configured.
//
// ajv-formats is deliberately NOT used: env-schema constructs ajv in strict
// mode, and an unknown format throws at boot rather than surfacing as a
// validation error. URL-shaped variables are checked with new URL() below.
const configSchema = Type.Object({
	DATABASE_URL: Type.String({ minLength: 1 }),
	AWS_SECRET_ID_DB_CREDENTIALS: Type.Optional(Type.String({ minLength: 1 })),
	AWS_REGION_OVERRIDE: Type.Optional(Type.String({ minLength: 1 })),
	AWS_ACCESS_KEY_ID_OVERRIDE: Type.Optional(Type.String({ minLength: 1 })),
	AWS_SECRET_ACCESS_KEY_OVERRIDE: Type.Optional(Type.String({ minLength: 1 })),
	PORT: Type.Number({ default: 8000 }),
	LOG_LEVEL: Type.Union(
		[
			Type.Literal("fatal"),
			Type.Literal("error"),
			Type.Literal("warn"),
			Type.Literal("info"),
			Type.Literal("debug"),
			Type.Literal("trace"),
			Type.Literal("silent"),
		],
		{ default: "info" },
	),
	// Local development only — Fargate injects AWS_REGION at runtime.
	AWS_REGION: Type.String({ default: "us-east-1" }),
	S3_ASSETS_BUCKET: Type.String({ minLength: 1 }),
	BETTER_AUTH_SECRET: Type.String({ minLength: 1 }),
	ENCRYPTION_KEY: Type.String({ minLength: 1 }),
	BETTER_AUTH_URL: Type.String({ minLength: 1 }),
	// Origin of the separately-hosted frontend (AWS Amplify). Used for the CORS
	// allowlist and better-auth's trustedOrigins — cross-origin cookies depend
	// on this being exact.
	FRONTEND_ORIGIN: Type.String({ minLength: 1 }),
	HOLOGRAM_ORG_ID: Type.Optional(Type.String({ minLength: 1 })),
	HOLOGRAM_API_KEY: Type.Optional(Type.String({ minLength: 1 })),
	EMNIFY_APPLICATION_TOKEN: Type.Optional(Type.String({ minLength: 1 })),
	EMNIFY_ORG_ID: Type.Optional(Type.String({ minLength: 1 })),
	EMNIFY_SERVICE_PROFILE_ID: Type.Optional(Type.Number()),
	EMNIFY_TARIFF_PROFILE_ID: Type.Optional(Type.Number()),
	MQTX_HOSTNAME: Type.Optional(Type.String({ minLength: 1 })),
});

export type AppConfig = Static<typeof configSchema>;

declare module "fastify" {
	interface FastifyInstance {
		config: AppConfig;
	}
}

const URL_VARIABLES = ["BETTER_AUTH_URL", "FRONTEND_ORIGIN"] as const;

export const configPlugin = fp(
	async (app) => {
		await app.register(fastifyEnv, {
			confKey: "config",
			schema: configSchema,
			dotenv: true,
		});

		for (const name of URL_VARIABLES) {
			try {
				new URL(app.config[name]);
			} catch {
				throw new Error(
					`${name} must be a valid URL, got ${JSON.stringify(app.config[name])}`,
				);
			}
		}
	},
	{ name: "config" },
);
