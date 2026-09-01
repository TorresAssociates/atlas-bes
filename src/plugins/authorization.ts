import type { FastifyReply, FastifyRequest } from "fastify";
import { getSession, type SessionSubject } from "@/modules/auth/service";
import { listUserPermissionNames } from "@/plugins/authorization.queries";

// Permission names from db/local/spec/schema-spec-users.md's permission seed table. Typed as a
// union so a typo'd name is a compile error instead of a permanently-passing
// no-op check.
export type PermissionName =
	| "R_CLIENT_DEVICES"
	| "W_CLIENT_DEVICES"
	| "R_EXTERNAL_DEVICES"
	| "W_EXTERNAL_DEVICES"
	| "R_CLIENT_CONTROL_PANEL"
	| "W_CLIENT_CONTROL_PANEL"
	| "R_EXTERNAL_CONTROL_PANEL"
	| "W_EXTERNAL_CONTROL_PANEL"
	| "R_CLIENT_USERS"
	| "W_CLIENT_USERS"
	| "R_EXTERNAL_USERS"
	| "W_EXTERNAL_USERS"
	| "R_CLIENTS"
	| "W_CLIENTS"
	| "EX_CLIENT_ALERT"
	| "EX_EXTERNAL_ALERT"
	| "EX_EMAIL_SUB"
	| "EX_TEXT_SUB"
	| "R_CLIENT_REPORTS"
	| "W_CLIENT_REPORTS"
	| "R_EXTERNAL_REPORTS"
	| "W_EXTERNAL_REPORTS"
	| "R_CLIENT_LIFT_STATIONS"
	| "W_CLIENT_LIFT_STATIONS"
	| "R_EXTERNAL_LIFT_STATIONS"
	| "W_EXTERNAL_LIFT_STATIONS"
	| "R_CLIENT_VOTES"
	| "W_CLIENT_VOTES"
	| "EX_CLIENT_VOTES";

// Session and permission set are each resolved at most once per request, no
// matter how many of the helpers below run. Keyed on the request object itself
// so entries vanish with the request. Two caches instead of one so that
// session-only routes (requireSession, no permission use) never pay the
// permission query.
const sessionCache = new WeakMap<FastifyRequest, Promise<SessionSubject | null>>();
const permissionsCache = new WeakMap<FastifyRequest, Promise<PermissionName[]>>();

/**
 * Per-request-cached session resolution. The first call per request hits
 * better-auth; every later call is free. Pass `reply` when available (the
 * preHandlers do) so better-auth's refreshed cookie-cache cookie is forwarded
 * to the client — handlers can omit it because the preHandler already resolved
 * (and forwarded) on the same request.
 */
export function getRequestSession(
	request: FastifyRequest,
	reply?: FastifyReply,
): Promise<SessionSubject | null> {
	let cached = sessionCache.get(request);
	if (!cached) {
		cached = getSession(request, reply);
		sessionCache.set(request, cached);
	}
	return cached;
}

// Cross-request permission cache. Permission sets change rarely, so entries
// are reused for a short TTL, taking the per-request permission query to ~0.
// Mutations invalidate via the exported invalidate* helpers, but that only
// covers the process that handled the mutation — other ECS tasks converge
// within the TTL, which is the accepted staleness bound.
const PERMISSION_CACHE_TTL_MS = 30_000;
const PERMISSION_CACHE_MAX_ENTRIES = 10_000;
const permissionTtlCache = new Map<string, { permissions: PermissionName[]; expiresAt: number }>();

function permissionCacheKey(userId: string, roleId: number): string {
	return `${userId}:${roleId}`;
}

/** Call after granted_permission mutations for the user. */
export function invalidateUserPermissions(userId: string): void {
	const prefix = `${userId}:`;
	for (const key of permissionTtlCache.keys()) {
		if (key.startsWith(prefix)) permissionTtlCache.delete(key);
	}
}

/** Call after role_permission mutations for the role. */
export function invalidateRolePermissions(roleId: number): void {
	const suffix = `:${roleId}`;
	for (const key of permissionTtlCache.keys()) {
		if (key.endsWith(suffix)) permissionTtlCache.delete(key);
	}
}

function getRequestPermissions(request: FastifyRequest): Promise<PermissionName[]> {
	let cached = permissionsCache.get(request);
	if (!cached) {
		cached = (async () => {
			const session = await getRequestSession(request);
			if (!session || !request.server.db) return [];

			const key = permissionCacheKey(session.user_id, session.role_id);
			const hit = permissionTtlCache.get(key);
			if (hit && hit.expiresAt > Date.now()) return hit.permissions;

			const permissions = await listUserPermissionNames(
				request.server.db,
				session.user_id,
				session.role_id,
			);
			// Crude growth bound; entries are tiny, so clearing on overflow is
			// cheaper than tracking recency.
			if (permissionTtlCache.size >= PERMISSION_CACHE_MAX_ENTRIES) permissionTtlCache.clear();
			permissionTtlCache.set(key, {
				permissions,
				expiresAt: Date.now() + PERMISSION_CACHE_TTL_MS,
			});
			return permissions;
		})();
		permissionsCache.set(request, cached);
	}
	return cached;
}

/**
 * preHandler factory: `requirePermission("R_CLIENTS")` on every route that
 * needs authorization. Replies 401 with no session, 403 when none of `names`
 * are held.
 */
export function requirePermission(...names: PermissionName[]) {
	return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
		const session = await getRequestSession(request, reply);

		if (!session) {
			throw request.server.httpErrors.unauthorized("authentication required");
		}

		if (!request.server.db) {
			throw request.server.httpErrors.serviceUnavailable("database is not configured");
		}

		const permissions = await getRequestPermissions(request);
		const allowed = names.some((name) => permissions.includes(name));

		if (!allowed) {
			throw request.server.httpErrors.forbidden("permission denied");
		}
	};
}

export async function hasPermission(
	request: FastifyRequest,
	name: PermissionName,
): Promise<boolean> {
	const permissions = await getRequestPermissions(request);
	return permissions.includes(name);
}

/**
 * Every permission name held by the request's session (role permissions plus
 * individual grants). Empty when there is no session or no database.
 */
export function listRequestPermissions(request: FastifyRequest): Promise<PermissionName[]> {
	return getRequestPermissions(request);
}

export function requireSession() {
	return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
		const session = await getRequestSession(request, reply);

		if (!session) {
			throw request.server.httpErrors.unauthorized("authentication required");
		}
	};
}
