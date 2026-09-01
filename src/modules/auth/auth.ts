import { expo } from "@better-auth/expo";
import { APIError, betterAuth } from "better-auth";
import { createAuthMiddleware } from "better-auth/api";
import type { Kysely } from "kysely";
import type { AppConfig } from "@/config";
import type { DB } from "@/db/types";
import * as inviteQueries from "../invites/queries";
import { sendEmail } from "./email";

// INTERNAL to src/modules/auth — nothing outside this module may import
// better-auth or this file. External consumers use getSession() from
// service.ts.

export type AuthConfig = Pick<
	AppConfig,
	| "BETTER_AUTH_SECRET"
	| "BETTER_AUTH_URL"
	| "FRONTEND_ORIGIN"
	| "MICROSOFT_CLIENT_ID"
	| "MICROSOFT_CLIENT_SECRET"
	| "MICROSOFT_TENANT_ID"
>;

interface AuthRequestContext {
	body?: unknown;
	query?: unknown;
	context: {
		returned?: unknown;
	};
}

interface PendingInviteSignup {
	id: number;
	client_id: number;
	role_id: number;
	expires_at: number;
}

const OAUTH_INVITE_STATE_TTL_MS = 10 * 60 * 1000;
const pendingInviteSignups = new Map<string, PendingInviteSignup>();
const pendingInviteSignupByContext = new WeakMap<AuthRequestContext, PendingInviteSignup>();

function hasInviteAssignedRole(user: Record<string, unknown>): boolean {
	return typeof user.client_id === "number" && typeof user.role_id === "number";
}

function getOAuthStateFromContext(context: AuthRequestContext | null): string | null {
	const query = context?.query as { state?: unknown } | undefined;
	const body = context?.body as { state?: unknown } | undefined;
	const state = query?.state ?? body?.state;

	return typeof state === "string" && state.length > 0 ? state : null;
}

function getInviteTokenFromSocialSignInBody(body: unknown): string | null {
	const value = body as { additionalData?: { inviteToken?: unknown } } | undefined;
	const inviteToken = value?.additionalData?.inviteToken;

	return typeof inviteToken === "string" && inviteToken.length > 0 ? inviteToken : null;
}

function getOAuthStateFromAuthorizationURL(url: string): string | null {
	const parsedUrl = new URL(url);
	const authorizationUrl = parsedUrl.searchParams.get("authorizationURL");
	const oauthUrl = authorizationUrl ? new URL(authorizationUrl) : parsedUrl;
	const state = oauthUrl.searchParams.get("state");

	return state && state.length > 0 ? state : null;
}

function cachePendingInviteSignup(state: string, invite: PendingInviteSignup): void {
	pendingInviteSignups.set(state, invite);
	setTimeout(() => {
		const cached = pendingInviteSignups.get(state);
		if (cached?.expires_at === invite.expires_at) pendingInviteSignups.delete(state);
	}, OAUTH_INVITE_STATE_TTL_MS).unref();
}

function getPendingInviteSignup(state: string | null): PendingInviteSignup | null {
	if (!state) return null;

	const invite = pendingInviteSignups.get(state);
	if (!invite) return null;

	if (invite.expires_at <= Date.now()) {
		pendingInviteSignups.delete(state);
		return null;
	}

	return invite;
}

async function getValidInviteForMicrosoftSignup(db: Kysely<DB>, inviteToken: string) {
	const invite = await inviteQueries.findInviteByToken(db, inviteToken);
	if (!invite || invite.client_id === null || invite.role_id === null) {
		throw new APIError("BAD_REQUEST", {
			code: "INVALID_INVITE_TOKEN",
			message: "invite does not exist",
		});
	}

	const clientId = invite.client_id;
	const roleId = invite.role_id;

	if (invite.expires_at !== null && new Date(invite.expires_at).getTime() <= Date.now()) {
		throw new APIError("BAD_REQUEST", {
			code: "INVITE_EXPIRED",
			message: "invite has expired",
		});
	}

	return {
		...invite,
		client_id: clientId,
		role_id: roleId,
	};
}

async function registerPendingInviteSignup(
	db: Kysely<DB>,
	context: AuthRequestContext,
): Promise<void> {
	const inviteToken = getInviteTokenFromSocialSignInBody(context.body);
	if (!inviteToken) return;

	const response = context.context.returned as { url?: unknown } | undefined;
	if (typeof response?.url !== "string") return;

	const state = getOAuthStateFromAuthorizationURL(response.url);
	if (!state) return;

	const invite = await getValidInviteForMicrosoftSignup(db, inviteToken);
	cachePendingInviteSignup(state, {
		id: invite.id,
		client_id: invite.client_id,
		role_id: invite.role_id,
		expires_at: Date.now() + OAUTH_INVITE_STATE_TTL_MS,
	});
}

export function createAuth(config: AuthConfig, db: Kysely<DB>) {
	// Cookie attributes are derived from config, not hardcoded: production is
	// cross-origin (Amplify frontend → ALB API) over https, which requires
	// SameSite=None + Secure. Local dev is http://localhost↔localhost, where
	// SameSite=Lax works and Secure cookies would be dropped.
	const secure = new URL(config.BETTER_AUTH_URL).protocol === "https:";
	const microsoftClientId = config.MICROSOFT_CLIENT_ID;
	const microsoftClientSecret = config.MICROSOFT_CLIENT_SECRET;
	const microsoftTenantId = config.MICROSOFT_TENANT_ID ?? "common";
	const socialProviders =
		microsoftClientId && microsoftClientSecret
			? {
					microsoft: {
						clientId: microsoftClientId,
						clientSecret: microsoftClientSecret,
						tenantId: microsoftTenantId,
						authority: "https://login.microsoftonline.com",
						prompt: "select_account" as const,
					},
				}
			: undefined;

	return betterAuth({
		// Shares our Kysely instance — and therefore the pg driver and pool —
		// with the query layer. better-auth issues its own SQL through it.
		database: { db, type: "postgres" },
		baseURL: config.BETTER_AUTH_URL,
		// Must match where routes.ts mounts the handler.
		basePath: "/v1/auth",
		secret: config.BETTER_AUTH_SECRET,
		trustedOrigins: [
			config.FRONTEND_ORIGIN,
			"atlas-mobile-app:///",
			"atlas-mobile-app://",
			"atlas-mobile-app://*",
			...(process.env.NODE_ENV === "development"
				? ["exp://", "exp://**", "exp://192.168.*.*:*/**"]
				: []),
		],
		plugins: [expo()],

		socialProviders,
		hooks: {
			after: createAuthMiddleware(async (context) => {
				if (context.path !== "/sign-in/social") return;
				await registerPendingInviteSignup(db, context);
			}),
		},

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
				client_id: { type: "number", required: false },
				role_id: { type: "number", required: false },
				phone_number_verified: {
					type: "boolean",
					required: false,
					defaultValue: false,
				},
			},
		},
		databaseHooks: {
			user: {
				create: {
					before: async (user, context) => {
						if (hasInviteAssignedRole(user)) return;

						const authContext = context as AuthRequestContext | null;
						const state = getOAuthStateFromContext(authContext);
						const invite = getPendingInviteSignup(state);
						if (!invite) {
							throw new APIError("BAD_REQUEST", {
								code: "INVITE_TOKEN_REQUIRED",
								message: "invite token is required",
							});
						}

						if (authContext) pendingInviteSignupByContext.set(authContext, invite);

						return {
							data: {
								client_id: invite.client_id,
								role_id: invite.role_id,
							},
						};
					},
					after: async (user, context) => {
						const authContext = context as AuthRequestContext | null;
						const invite = authContext
							? pendingInviteSignupByContext.get(authContext)
							: null;
						if (!invite) return;

						await inviteQueries.insertAcceptedInvite(db, invite.id, user.id);
						const state = getOAuthStateFromContext(authContext);
						if (state) pendingInviteSignups.delete(state);
					},
				},
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
