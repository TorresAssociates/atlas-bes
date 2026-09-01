import type { FastifyReply, FastifyRequest } from "fastify";
import { getSession } from "@/modules/auth/service";
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

/**
 * preHandler factory: `requirePermission("R_CLIENTS")` on every route that
 * needs authorization. Routes wire this now so the auth phase only has to
 * fill in this one function, not edit every route.
 *
 * (auth phase): implement for real —
 *   1. resolve the session via better-auth (`getSession()` seam),
 *   2. load the user's role permissions (role_permission) plus individual
 *      grants (granted_permission),
 *   3. reply 401 with no session, 403 when none of `names` are held.
 */
export function requirePermission(...names: PermissionName[]) {
	return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
		const session = await getSession(request);

		if (!session) {
			throw request.server.httpErrors.unauthorized("authentication required");
		}

		if (!request.server.db) {
			throw request.server.httpErrors.serviceUnavailable("database is not configured");
		}

		const permissions = await listUserPermissionNames(
			request.server.db,
			session.user_id,
			session.role_id,
		);

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
	const session = await getSession(request);
	if (!session || !request.server.db) return false;

	const permissions = await listUserPermissionNames(
		request.server.db,
		session.user_id,
		session.role_id,
	);

	return permissions.includes(name);
}

/**
 * Every permission name held by the request's session (role permissions plus
 * individual grants). Empty when there is no session or no database.
 */
export async function listRequestPermissions(
	request: FastifyRequest,
): Promise<PermissionName[]> {
	const session = await getSession(request);
	if (!session || !request.server.db) return [];

	return listUserPermissionNames(
		request.server.db,
		session.user_id,
		session.role_id,
	);
}

export function requireSession() {
	return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
		const session = await getSession(request);

		if (!session) {
			throw request.server.httpErrors.unauthorized("authentication required");
		}
	};
}
