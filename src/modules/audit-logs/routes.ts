import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { FastifyRequest } from "fastify";
import {
	getRequestSession,
	hasPermission,
	requirePermission,
	requireSession,
} from "@/plugins/authorization";
import { HttpErrorSchema } from "@/schemas";
import {
	AuditLogActionListSchema,
	ControlAuditLogListQuerySchema,
	ControlAuditLogListSchema,
	ControlAuditLogSchema,
	CreateControlAuditLogBodySchema,
	CreateRolesPermsAuditLogBodySchema,
	CreateUserAuditLogBodySchema,
	RolesPermsAuditLogListQuerySchema,
	RolesPermsAuditLogListSchema,
	RolesPermsAuditLogSchema,
	UserAuditLogListQuerySchema,
	UserAuditLogListSchema,
	UserAuditLogSchema,
} from "./schemas";
import {
	AuditLogAccessDeniedError,
	AuditLogActionNotFoundError,
	AuditLogDeviceNotFoundError,
	AuditLogPermissionNotFoundError,
	AuditLogRoleNotFoundError,
	AuditLogTargetUserNotFoundError,
	createControlAuditLog,
	createRolesPermsAuditLog,
	createUserAuditLog,
	listAuditLogActions,
	listControlAuditLogs,
	listRolesPermsAuditLogs,
	listUserAuditLogs,
} from "./service";

// Audit logs are append-only. This module deliberately registers only GET and
// POST routes — there is no update or delete, and none should be added.
const auditLogRoutes: FastifyPluginAsyncTypebox = async (app) => {
	const getDb = () => {
		if (!app.db) {
			throw app.httpErrors.serviceUnavailable("database is not configured");
		}

		return app.db;
	};

	const getSessionOrThrow = async (request: FastifyRequest) => {
		const session = await getRequestSession(request);
		if (!session) {
			throw app.httpErrors.unauthorized("authentication required");
		}

		return session;
	};

	app.setErrorHandler((err, _request, reply) => {
		if (err instanceof AuditLogAccessDeniedError) {
			return reply.forbidden(err.message);
		}

		if (
			err instanceof AuditLogActionNotFoundError ||
			err instanceof AuditLogDeviceNotFoundError ||
			err instanceof AuditLogTargetUserNotFoundError ||
			err instanceof AuditLogRoleNotFoundError ||
			err instanceof AuditLogPermissionNotFoundError
		) {
			return reply.badRequest(err.message);
		}

		return reply.send(err);
	});

	// GET /v1/audit-logs/actions — the action registry (reference data).
	app.get(
		"/actions",
		{
			preHandler: requireSession(),
			schema: {
				tags: ["audit-logs"],
				response: {
					200: AuditLogActionListSchema,
					401: HttpErrorSchema,
				},
			},
		},
		async () => ({ data: await listAuditLogActions(getDb()) }),
	);

	// GET /v1/audit-logs/control
	app.get(
		"/control",
		{
			preHandler: requirePermission("R_CLIENT_CONTROL_PANEL", "R_EXTERNAL_CONTROL_PANEL"),
			schema: {
				tags: ["audit-logs"],
				querystring: ControlAuditLogListQuerySchema,
				response: {
					200: ControlAuditLogListSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getSessionOrThrow(request);
			const canReadExternal = await hasPermission(request, "R_EXTERNAL_CONTROL_PANEL");

			return {
				data: await listControlAuditLogs(
					getDb(),
					session,
					{ canReadExternal, canReadClient: true },
					request.query,
				),
			};
		},
	);

	// POST /v1/audit-logs/control
	app.post(
		"/control",
		{
			preHandler: requirePermission("W_CLIENT_CONTROL_PANEL", "W_EXTERNAL_CONTROL_PANEL"),
			schema: {
				tags: ["audit-logs"],
				body: CreateControlAuditLogBodySchema,
				response: {
					201: ControlAuditLogSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const session = await getSessionOrThrow(request);
			const canWriteExternal = await hasPermission(request, "W_EXTERNAL_CONTROL_PANEL");

			const log = await createControlAuditLog(
				getDb(),
				session,
				{ canWriteExternal, canWriteClient: true },
				request.body,
			);

			return reply.code(201).send(log);
		},
	);

	// GET /v1/audit-logs/users
	app.get(
		"/users",
		{
			preHandler: requirePermission("R_CLIENT_USERS", "R_EXTERNAL_USERS"),
			schema: {
				tags: ["audit-logs"],
				querystring: UserAuditLogListQuerySchema,
				response: {
					200: UserAuditLogListSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getSessionOrThrow(request);
			const canReadExternal = await hasPermission(request, "R_EXTERNAL_USERS");

			return {
				data: await listUserAuditLogs(
					getDb(),
					session,
					{ canReadExternal, canReadClient: true },
					request.query,
				),
			};
		},
	);

	// POST /v1/audit-logs/users
	app.post(
		"/users",
		{
			preHandler: requirePermission("W_CLIENT_USERS", "W_EXTERNAL_USERS"),
			schema: {
				tags: ["audit-logs"],
				body: CreateUserAuditLogBodySchema,
				response: {
					201: UserAuditLogSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const session = await getSessionOrThrow(request);
			const canWriteExternal = await hasPermission(request, "W_EXTERNAL_USERS");

			const log = await createUserAuditLog(
				getDb(),
				session,
				{ canWriteExternal, canWriteClient: true },
				request.body,
			);

			return reply.code(201).send(log);
		},
	);

	// GET /v1/audit-logs/roles-perms — role/permission changes are part of the
	// user-management domain, so they share the users permissions.
	app.get(
		"/roles-perms",
		{
			preHandler: requirePermission("R_CLIENT_USERS", "R_EXTERNAL_USERS"),
			schema: {
				tags: ["audit-logs"],
				querystring: RolesPermsAuditLogListQuerySchema,
				response: {
					200: RolesPermsAuditLogListSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getSessionOrThrow(request);
			const canReadExternal = await hasPermission(request, "R_EXTERNAL_USERS");

			return {
				data: await listRolesPermsAuditLogs(
					getDb(),
					session,
					{ canReadExternal, canReadClient: true },
					request.query,
				),
			};
		},
	);

	// POST /v1/audit-logs/roles-perms
	app.post(
		"/roles-perms",
		{
			preHandler: requirePermission("W_CLIENT_USERS", "W_EXTERNAL_USERS"),
			schema: {
				tags: ["audit-logs"],
				body: CreateRolesPermsAuditLogBodySchema,
				response: {
					201: RolesPermsAuditLogSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const session = await getSessionOrThrow(request);
			const canWriteExternal = await hasPermission(request, "W_EXTERNAL_USERS");

			const log = await createRolesPermsAuditLog(
				getDb(),
				session,
				{ canWriteExternal, canWriteClient: true },
				request.body,
			);

			return reply.code(201).send(log);
		},
	);
};

export default auditLogRoutes;
