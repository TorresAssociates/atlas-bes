import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import {
	getRequestSession,
	hasPermission,
	listRequestPermissions,
	requirePermission,
	requireSession,
} from "@/plugins/authorization";
import { HttpErrorSchema } from "@/schemas";
import {
	ReplaceUserPermissionsBodySchema,
	UserIdParamsSchema,
	UserListSchema,
	UserMeSchema,
	UserPermissionsSchema,
	UserPhoneNumberBodySchema,
	UserRoleBodySchema,
	UserSchema,
} from "./schemas";
import {
	deleteUser,
	getMe,
	getUser,
	getUserPermissions,
	listUsers,
	replaceUserGrantedPermissions,
	UserAccessHierarchyError,
	UserAlreadyDeletedError,
	UserEmailNotFoundError,
	UserExternalPermissionNotAllowedError,
	UserNotFoundError,
	UserPermissionNotFoundError,
	UserRoleClientMismatchError,
	UserRoleNotFoundError,
	UserSelfAccessChangeError,
	updateOwnPhoneNumber,
	updateUserPhoneNumber,
	updateUserRole,
} from "./service";

const userRoutes: FastifyPluginAsyncTypebox = async (app) => {
	const getDb = () => {
		if (!app.db) {
			throw app.httpErrors.serviceUnavailable("database is not configured");
		}

		return app.db;
	};

	app.setErrorHandler((err, _request, reply) => {
		if (err instanceof UserNotFoundError) {
			return reply.notFound(err.message);
		}

		if (err instanceof UserEmailNotFoundError) {
			return reply.notFound(err.message);
		}

		if (err instanceof UserAlreadyDeletedError) {
			return reply.conflict(err.message);
		}

		if (err instanceof UserRoleNotFoundError || err instanceof UserRoleClientMismatchError) {
			return reply.badRequest(err.message);
		}

		if (
			err instanceof UserPermissionNotFoundError ||
			err instanceof UserExternalPermissionNotAllowedError
		) {
			return reply.badRequest(err.message);
		}

		if (err instanceof UserSelfAccessChangeError || err instanceof UserAccessHierarchyError) {
			return reply.forbidden(err.message);
		}

		return reply.send(err);
	});

	// GET /v1/users/me
	// The calling user's own profile + client/role names + permission names.
	// Session-only — every authenticated user may read their own context.
	app.get(
		"/me",
		{
			preHandler: requireSession(),
			schema: {
				tags: ["users"],
				response: {
					200: UserMeSchema,
					401: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getRequestSession(request);
			if (!session) {
				throw app.httpErrors.unauthorized("authentication required");
			}

			const permissions = await listRequestPermissions(request);

			return getMe(getDb(), app.config.ENCRYPTION_KEY, session, permissions);
		},
	);

	//PATCH /v1/users/me/phone-number
	app.patch(
		"/me/phone-number",
		{
			preHandler: requireSession(),
			schema: {
				tags: ["users"],
				body: UserPhoneNumberBodySchema,
				response: {
					200: UserSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getRequestSession(request);
			if (!session) {
				throw app.httpErrors.unauthorized("authentication required");
			}

			return updateOwnPhoneNumber(
				getDb(),
				app.config.ENCRYPTION_KEY,
				session,
				request.body.phone_number,
			);
		},
	);

	// GET /v1/users
	app.get(
		"/",
		{
			preHandler: requirePermission("R_CLIENT_USERS", "R_EXTERNAL_USERS"),
			schema: {
				tags: ["users"],
				response: {
					200: UserListSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getRequestSession(request);
			if (!session) {
				throw app.httpErrors.unauthorized("authentication required");
			}

			const canReadExternalUsers = await hasPermission(request, "R_EXTERNAL_USERS");

			return {
				data: await listUsers(getDb(), app.config.ENCRYPTION_KEY, session, {
					canReadExternalUsers,
					canReadClientUsers: true,
				}),
			};
		},
	);

	// GET /v1/users/:id
	app.get(
		"/:id",
		{
			preHandler: requirePermission("R_CLIENT_USERS", "R_EXTERNAL_USERS"),
			schema: {
				tags: ["users"],
				params: UserIdParamsSchema,
				response: {
					200: UserSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getRequestSession(request);
			if (!session) {
				throw app.httpErrors.unauthorized("authentication required");
			}

			const canReadExternalUsers = await hasPermission(request, "R_EXTERNAL_USERS");

			return getUser(getDb(), app.config.ENCRYPTION_KEY, request.params.id, session, {
				canReadExternalUsers,
				canReadClientUsers: true,
			});
		},
	);

	// PATCH /v1/users/delete/:id
	app.patch(
		"/delete/:id",
		{
			preHandler: requirePermission("W_CLIENT_USERS", "W_EXTERNAL_USERS"),
			schema: {
				tags: ["users"],
				params: UserIdParamsSchema,
				response: {
					200: UserSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
					409: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getRequestSession(request);
			if (!session) {
				throw app.httpErrors.unauthorized("authentication required");
			}

			const canWriteExternalUsers = await hasPermission(request, "W_EXTERNAL_USERS");

			return deleteUser(getDb(), app.config.ENCRYPTION_KEY, request.params.id, session, {
				canWriteExternalUsers,
				canWriteClientUsers: true,
			});
		},
	);

	// PATCH /v1/users/:id
	app.patch(
		"/:id",
		{
			preHandler: requirePermission("W_CLIENT_USERS", "W_EXTERNAL_USERS"),
			schema: {
				tags: ["users"],
				params: UserIdParamsSchema,
				body: UserPhoneNumberBodySchema,
				response: {
					200: UserSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getRequestSession(request);
			if (!session) {
				throw app.httpErrors.unauthorized("authentication required");
			}

			const canWriteExternalUsers = await hasPermission(request, "W_EXTERNAL_USERS");

			return updateUserPhoneNumber(
				getDb(),
				app.config.ENCRYPTION_KEY,
				request.params.id,
				request.body.phone_number,
				session,
				{
					canWriteExternalUsers,
					canWriteClientUsers: true,
				},
			);
		},
	);

	// PATCH /v1/users/:id/role
	// Moves a user to another role within their client. Client-scoped
	// managers must outrank both the current and the new role.
	app.patch(
		"/:id/role",
		{
			preHandler: requirePermission("W_CLIENT_USERS", "W_EXTERNAL_USERS"),
			schema: {
				tags: ["users"],
				params: UserIdParamsSchema,
				body: UserRoleBodySchema,
				response: {
					200: UserSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
					409: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getRequestSession(request);
			if (!session) {
				throw app.httpErrors.unauthorized("authentication required");
			}

			const canWriteExternalUsers = await hasPermission(request, "W_EXTERNAL_USERS");

			return updateUserRole(
				getDb(),
				app.config.ENCRYPTION_KEY,
				request.params.id,
				request.body.role_id,
				session,
				{
					canWriteExternalUsers,
					canWriteClientUsers: true,
				},
			);
		},
	);

	// GET /v1/users/:id/permissions
	// Role-inherited permissions, individual grants, and what the caller may grant.
	app.get(
		"/:id/permissions",
		{
			preHandler: requirePermission("R_CLIENT_USERS", "R_EXTERNAL_USERS"),
			schema: {
				tags: ["users"],
				params: UserIdParamsSchema,
				response: {
					200: UserPermissionsSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getRequestSession(request);
			if (!session) {
				throw app.httpErrors.unauthorized("authentication required");
			}

			const canReadExternalUsers = await hasPermission(request, "R_EXTERNAL_USERS");

			return getUserPermissions(
				getDb(),
				app.config.ENCRYPTION_KEY,
				request.params.id,
				session,
				{
					canReadExternalUsers,
					canReadClientUsers: true,
				},
			);
		},
	);

	// PUT /v1/users/:id/permissions
	// Replaces the user's individually granted permissions (granted_permission).
	app.put(
		"/:id/permissions",
		{
			preHandler: requirePermission("W_CLIENT_USERS", "W_EXTERNAL_USERS"),
			schema: {
				tags: ["users"],
				params: UserIdParamsSchema,
				body: ReplaceUserPermissionsBodySchema,
				response: {
					200: UserPermissionsSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
					409: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getRequestSession(request);
			if (!session) {
				throw app.httpErrors.unauthorized("authentication required");
			}

			const canWriteExternalUsers = await hasPermission(request, "W_EXTERNAL_USERS");

			return replaceUserGrantedPermissions(
				getDb(),
				app.config.ENCRYPTION_KEY,
				request.params.id,
				request.body.permission_ids,
				session,
				{
					canWriteExternalUsers,
					canWriteClientUsers: true,
				},
			);
		},
	);
};

export default userRoutes;
