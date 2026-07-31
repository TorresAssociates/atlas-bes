import { betterAuth } from "better-auth";
import type { Kysely } from "kysely";
import type { AppConfig } from "@/config";
import type { DB } from "@/db/types";
import { sendEmail } from "./email";

// INTERNAL to src/modules/auth — nothing outside this module may import
// better-auth or this file. External consumers use getSession() from
// service.ts.

export type AuthConfig = Pick<
	AppConfig,
	"BETTER_AUTH_SECRET" | "BETTER_AUTH_URL" | "FRONTEND_ORIGIN"
>;

export function createAuth(config: AuthConfig, db: Kysely<DB>) {
	// Cookie attributes are derived from config, not hardcoded: production is
	// cross-origin (Amplify frontend → ALB API) over https, which requires
	// SameSite=None + Secure. Local dev is http://localhost↔localhost, where
	// SameSite=Lax works and Secure cookies would be dropped.
	const secure = new URL(config.BETTER_AUTH_URL).protocol === "https:";

	return betterAuth({
		// Shares our Kysely instance — and therefore the pg driver and pool —
		// with the query layer. better-auth issues its own SQL through it.
		database: { db, type: "postgres" },
		baseURL: config.BETTER_AUTH_URL,
		// Must match where routes.ts mounts the handler.
		basePath: "/v1/auth",
		secret: config.BETTER_AUTH_SECRET,
		trustedOrigins: [config.FRONTEND_ORIGIN],

		emailAndPassword: {
			enabled: true,
			// Invite-only: open signup is disabled. Account creation happens
			// exclusively through the invite flow (next phase).
			disableSignUp: false,
			sendResetPassword: async ({ user, url }) => {
				await sendEmail({
					to: user.email,
					subject: "Reset your ATLASRain password",
					text: `Reset your password: ${url}`,
				});
			},
			// TODO(auth0 migration): supply a custom `password.verify` accepting bcrypt hashes (Auth0) alongside scrypt, rehashing on successful login.
			// Not needed until real users are imported.
		},

		// Our schema is snake_case; better-auth defaults to camelCase.
		// Every model maps its camelCase fields to the columns in db/local/spec/schema-spec-users.md.
		// A missing mapping surfaces as better-auth querying a column that doesn't exist.
		user: {
			modelName: "user",
			fields: {
				emailVerified: "email_verified",
				createdAt: "created_at",
				updatedAt: "updated_at",
			},
			additionalFields: {
				client_id: { type: "number", required: true },
				role_id: { type: "number", required: true },
			},
		},
		session: {
			modelName: "session",
			fields: {
				userId: "user_id",
				expiresAt: "expires_at",
				ipAddress: "ip_address",
				userAgent: "user_agent",
				createdAt: "created_at",
				updatedAt: "updated_at",
			},
			// Cookie cache: session data rides in a short-lived signed cookie so most requests skip the session-table lookup.
			cookieCache: {
				enabled: true,
				maxAge: 5 * 60,
			},
		},
		account: {
			modelName: "account",
			fields: {
				userId: "user_id",
				accountId: "account_id",
				providerId: "provider_id",
				accessToken: "access_token",
				refreshToken: "refresh_token",
				accessTokenExpiresAt: "access_token_expires_at",
				refreshTokenExpiresAt: "refresh_token_expires_at",
				idToken: "id_token",
				createdAt: "created_at",
				updatedAt: "updated_at",
			},
		},
		verification: {
			modelName: "verification",
			fields: {
				expiresAt: "expires_at",
				createdAt: "created_at",
				updatedAt: "updated_at",
			},
		},

		advanced: {
			useSecureCookies: secure,
			defaultCookieAttributes: {
				sameSite: secure ? "none" : "lax",
				secure,
				httpOnly: true,
			},
		},
	});
}

export type Auth = ReturnType<typeof createAuth>;
