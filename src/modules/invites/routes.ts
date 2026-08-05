import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { hasPermission, requirePermission } from "@/plugins/authorization";
import { HttpErrorSchema } from "@/schemas";
import { getSession } from "../auth/service";
import {
	AcceptedInviteListSchema,
	AcceptedInviteUserSchema,
	AcceptInviteBodySchema,
	CreateInviteBodySchema,
	InviteIdParamsSchema,
	InviteListSchema,
	InvitePreviewSchema,
	InviteSchema,
	InviteTokenQuerySchema,
} from "./schemas";
import {
	acceptInvite,
	createInvite,
	deleteInvite,
	InviteAlreadyAcceptedError,
	InviteClientAccessDeniedError,
	InviteEmailAlreadyExistsError,
	InviteExpiredError,
	InviteNotFoundError,
	InviteRoleAccessDeniedError,
	InviteRoleClientMismatchError,
	InviteRoleNotFoundError,
	listAcceptedInvites,
	listInvites,
	validateInvite,
} from "./service";

const inviteRoutes: FastifyPluginAsyncTypebox = async (app) => {
	const getDb = () => {
		if (!app.db) {
			throw app.httpErrors.serviceUnavailable("database is not configured");
		}

		return app.db;
	};

	app.setErrorHandler((err, _request, reply) => {
		if (err instanceof InviteNotFoundError) {
			return reply.notFound(err.message);
		}

		if (err instanceof InviteExpiredError) {
			return reply.gone(err.message);
		}

		if (err instanceof InviteAlreadyAcceptedError) {
			return reply.conflict(err.message);
		}

		if (err instanceof InviteEmailAlreadyExistsError) {
			return reply.conflict(err.message);
		}

		if (err instanceof InviteClientAccessDeniedError) {
			return reply.forbidden(err.message);
		}

		if (err instanceof InviteRoleAccessDeniedError) {
			return reply.forbidden(err.message);
		}

		if (
			err instanceof InviteRoleNotFoundError ||
			err instanceof InviteRoleClientMismatchError
		) {
			return reply.badRequest(err.message);
		}

		return reply.send(err);
	});

	// GET /v1/invites
	app.get(
		"/",
		{
			preHandler: requirePermission("W_CLIENT_USERS", "W_EXTERNAL_USERS"),
			schema: {
				tags: ["invites"],
				response: {
					200: InviteListSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getSession(request);
			if (!session) {
				throw app.httpErrors.unauthorized("authentication required");
			}

			const canWriteExternalUsers = await hasPermission(request, "W_EXTERNAL_USERS");

			return {
				data: await listInvites(getDb(), session, {
					canWriteExternalUsers,
					canWriteClientUsers: true,
				}),
			};
		},
	);

	// POST /v1/invites
	app.post(
		"/",
		{
			preHandler: requirePermission("W_CLIENT_USERS", "W_EXTERNAL_USERS"),
			schema: {
				tags: ["invites"],
				body: CreateInviteBodySchema,
				response: {
					201: InviteSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const session = await getSession(request);
			if (!session) {
				throw app.httpErrors.unauthorized("authentication required");
			}

			const canWriteExternalUsers = await hasPermission(request, "W_EXTERNAL_USERS");

			const invite = await createInvite(
				getDb(),
				session,
				{
					canWriteExternalUsers,
					canWriteClientUsers: true,
				},
				request.body,
			);

			return reply.code(201).send(invite);
		},
	);

	// DELETE /v1/invites/:id
	app.delete(
		"/:id",
		{
			preHandler: requirePermission("W_CLIENT_USERS", "W_EXTERNAL_USERS"),
			schema: {
				tags: ["invites"],
				params: InviteIdParamsSchema,
				response: {
					200: InviteSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
					409: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getSession(request);
			if (!session) {
				throw app.httpErrors.unauthorized("authentication required");
			}

			const canWriteExternalUsers = await hasPermission(request, "W_EXTERNAL_USERS");

			return deleteInvite(getDb(), request.params.id, session, {
				canWriteExternalUsers,
				canWriteClientUsers: true,
			});
		},
	);

	// GET /v1/invites/accepted
	app.get(
		"/accepted",
		{
			preHandler: requirePermission("W_CLIENT_USERS", "W_EXTERNAL_USERS"),
			schema: {
				tags: ["invites"],
				response: {
					200: AcceptedInviteListSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getSession(request);
			if (!session) {
				throw app.httpErrors.unauthorized("authentication required");
			}

			const canWriteExternalUsers = await hasPermission(request, "W_EXTERNAL_USERS");

			return {
				data: await listAcceptedInvites(getDb(), session, {
					canWriteExternalUsers,
					canWriteClientUsers: true,
				}),
			};
		},
	);

	// GET /v1/invites/validate?token=...
	app.get(
		"/validate",
		{
			schema: {
				tags: ["invites"],
				querystring: InviteTokenQuerySchema,
				response: {
					200: InvitePreviewSchema,
					404: HttpErrorSchema,
					409: HttpErrorSchema,
					410: HttpErrorSchema,
				},
			},
		},
		async (request) => validateInvite(getDb(), request.query.token),
	);

	// POST /v1/invites/accept
	app.post(
		"/accept",
		{
			schema: {
				tags: ["invites"],
				body: AcceptInviteBodySchema,
				response: {
					201: AcceptedInviteUserSchema,
					400: HttpErrorSchema,
					404: HttpErrorSchema,
					409: HttpErrorSchema,
					410: HttpErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const user = await acceptInvite(getDb(), app.config.ENCRYPTION_KEY, request.body);
			return reply.code(201).send(user);
		},
	);
};

export default inviteRoutes;
