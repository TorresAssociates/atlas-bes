import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { hasPermission, requirePermission } from "@/plugins/authorization";
import { HttpErrorSchema } from "@/schemas";
import { getSession } from "../auth/service";
import {
	CreateRoleBodySchema,
	PermissionListSchema,
	ReplaceRolePermissionsBodySchema,
	RoleIdParamsSchema,
	RoleListSchema,
	RoleSchema,
	UpdateRoleBodySchema,
} from "./schemas";
import {
	createRole,
	deleteRole,
	getRole,
	listPermissions,
	listRoles,
	replaceRolePermissions,
	RoleAccessDeniedError,
	RoleInUseError,
	RoleNotFoundError,
	RolePermissionAccessDeniedError,
	RolePermissionNotAssignableError,
	updateRole,
} from "./service";

const roleRoutes: FastifyPluginAsyncTypebox = async (app) => {
	const getDb = () => {
		if (!app.db)
			throw app.httpErrors.serviceUnavailable(
				"database is not configured",
			);
		return app.db;
	};

	app.setErrorHandler((err, _request, reply) => {
		if (err instanceof RoleNotFoundError)
			return reply.notFound(err.message);
		if (err instanceof RoleAccessDeniedError)
			return reply.forbidden(err.message);
		if (err instanceof RolePermissionAccessDeniedError)
			return reply.forbidden(err.message);
		if (err instanceof RolePermissionNotAssignableError)
			return reply.badRequest(err.message);
		if (err instanceof RoleInUseError) return reply.conflict(err.message);
		return reply.send(err);
	});

	// GET /v1/roles
	app.get(
		"/",
		{
			preHandler: requirePermission("R_CLIENT_USERS", "R_EXTERNAL_USERS"),
			schema: {
				tags: ["roles"],
				response: {
					200: RoleListSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getSession(request);
			if (!session)
				throw app.httpErrors.unauthorized("authentication required");

			const canAccessExternalUsers = await hasPermission(
				request,
				"R_EXTERNAL_USERS",
			);
			return {
				data: await listRoles(getDb(), session, {
					canAccessExternalUsers,
					canAccessClientUsers: true,
				}),
			};
		},
	);

	// GET /v1/roles/permissions
	app.get(
		"/permissions",
		{
			preHandler: requirePermission("R_CLIENT_USERS", "R_EXTERNAL_USERS"),
			schema: {
				tags: ["roles"],
				response: {
					200: PermissionListSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getSession(request);
			if (!session)
				throw app.httpErrors.unauthorized("authentication required");

			const canAccessExternalUsers = await hasPermission(
				request,
				"R_EXTERNAL_USERS",
			);
			return {
				data: await listPermissions(getDb(), session, {
					canAccessExternalUsers,
					canAccessClientUsers: true,
				}),
			};
		},
	);

	// GET /v1/roles/:id
	app.get(
		"/:id",
		{
			preHandler: requirePermission("R_CLIENT_USERS", "R_EXTERNAL_USERS"),
			schema: {
				tags: ["roles"],
				params: RoleIdParamsSchema,
				response: {
					200: RoleSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getSession(request);
			if (!session)
				throw app.httpErrors.unauthorized("authentication required");

			const canAccessExternalUsers = await hasPermission(
				request,
				"R_EXTERNAL_USERS",
			);
			return getRole(getDb(), request.params.id, session, {
				canAccessExternalUsers,
				canAccessClientUsers: true,
			});
		},
	);

	// POST /v1/roles
	app.post(
		"/",
		{
			preHandler: requirePermission("W_CLIENT_USERS", "W_EXTERNAL_USERS"),
			schema: {
				tags: ["roles"],
				body: CreateRoleBodySchema,
				response: {
					201: RoleSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const session = await getSession(request);
			if (!session)
				throw app.httpErrors.unauthorized("authentication required");

			const canAccessExternalUsers = await hasPermission(
				request,
				"W_EXTERNAL_USERS",
			);
			const role = await createRole(
				getDb(),
				session,
				{
					canAccessExternalUsers,
					canAccessClientUsers: true,
				},
				request.body,
			);
			return reply.code(201).send(role);
		},
	);

	// PATCH /v1/roles/:id
	app.patch(
		"/:id",
		{
			preHandler: requirePermission("W_CLIENT_USERS", "W_EXTERNAL_USERS"),
			schema: {
				tags: ["roles"],
				params: RoleIdParamsSchema,
				body: UpdateRoleBodySchema,
				response: {
					200: RoleSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getSession(request);
			if (!session)
				throw app.httpErrors.unauthorized("authentication required");

			const canAccessExternalUsers = await hasPermission(
				request,
				"W_EXTERNAL_USERS",
			);
			return updateRole(
				getDb(),
				request.params.id,
				session,
				{
					canAccessExternalUsers,
					canAccessClientUsers: true,
				},
				request.body,
			);
		},
	);

	// PUT /v1/roles/:id/permissions
	app.put(
		"/:id/permissions",
		{
			preHandler: requirePermission("W_CLIENT_USERS", "W_EXTERNAL_USERS"),
			schema: {
				tags: ["roles"],
				params: RoleIdParamsSchema,
				body: ReplaceRolePermissionsBodySchema,
				response: {
					200: RoleSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getSession(request);
			if (!session)
				throw app.httpErrors.unauthorized("authentication required");

			const canAccessExternalUsers = await hasPermission(
				request,
				"W_EXTERNAL_USERS",
			);
			return replaceRolePermissions(
				getDb(),
				request.params.id,
				session,
				{
					canAccessExternalUsers,
					canAccessClientUsers: true,
				},
				request.body,
			);
		},
	);

	// DELETE /v1/roles/:id
	app.delete(
		"/:id",
		{
			preHandler: requirePermission("W_CLIENT_USERS", "W_EXTERNAL_USERS"),
			schema: {
				tags: ["roles"],
				params: RoleIdParamsSchema,
				response: {
					204: Type.Null(),
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
					409: HttpErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const session = await getSession(request);
			if (!session)
				throw app.httpErrors.unauthorized("authentication required");

			const canAccessExternalUsers = await hasPermission(
				request,
				"W_EXTERNAL_USERS",
			);
			await deleteRole(getDb(), request.params.id, session, {
				canAccessExternalUsers,
				canAccessClientUsers: true,
			});
			return reply.code(204).send(null);
		},
	);
};

export default roleRoutes;

