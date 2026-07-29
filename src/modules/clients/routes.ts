import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import { requirePermission } from "@/plugins/authorization";
import { HttpErrorSchema } from "@/schemas";
import {
	ClientIdParamsSchema,
	ClientListSchema,
	ClientNameBodySchema,
	ClientSchema,
} from "./schemas";
import {
	ClientInUseError,
	ClientNameTakenError,
	ClientNotFoundError,
	createClient,
	deleteClient,
	listClients,
	updateClient,
} from "./service";

// Registered by @fastify/autoload: dir name "clients" + the global /v1 prefix puts these routes at /v1/clients.
const clientRoutes: FastifyPluginAsyncTypebox = async (app) => {
	const getDb = () => {
		if (!app.db)
			throw app.httpErrors.serviceUnavailable(
				"database is not configured",
			);
		return app.db;
	};

	// Domain error → HTTP translation, scoped to this plugin. Anything not a
	// domain error falls through to the default handling.
	app.setErrorHandler((err, _request, reply) => {
		if (err instanceof ClientNotFoundError)
			return reply.notFound(err.message);
		if (err instanceof ClientNameTakenError)
			return reply.conflict(err.message);
		if (err instanceof ClientInUseError) return reply.conflict(err.message);
		return reply.send(err);
	});

	// GET /v1/clients
	app.get(
		"/",
		{
			preHandler: requirePermission("R_CLIENTS"),
			schema: {
				tags: ["clients"],
				response: {
					200: ClientListSchema,
				},
			},
		},
		async () => ({ data: await listClients(getDb()) }),
	);

	// POST /v1/clients
	app.post(
		"/",
		{
			preHandler: requirePermission("W_CLIENTS"),
			schema: {
				tags: ["clients"],
				body: ClientNameBodySchema,
				response: {
					201: ClientSchema,
					400: HttpErrorSchema,
					409: HttpErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const client = await createClient(getDb(), request.body.name);
			return reply.code(201).send(client);
		},
	);

	// PATCH /v1/clients/:id
	app.patch(
		"/:id",
		{
			preHandler: requirePermission("W_CLIENTS"),
			schema: {
				tags: ["clients"],
				params: ClientIdParamsSchema,
				body: ClientNameBodySchema,
				response: {
					200: ClientSchema,
					400: HttpErrorSchema,
					404: HttpErrorSchema,
					409: HttpErrorSchema,
				},
			},
		},
		async (request) =>
			updateClient(getDb(), request.params.id, request.body.name),
	);

	// DELETE /v1/clients/:id
	app.delete(
		"/:id",
		{
			preHandler: requirePermission("W_CLIENTS"),
			schema: {
				tags: ["clients"],
				params: ClientIdParamsSchema,
				response: {
					204: Type.Null(),
					400: HttpErrorSchema,
					404: HttpErrorSchema,
					409: HttpErrorSchema,
				},
			},
		},
		async (request, reply) => {
			await deleteClient(getDb(), request.params.id);
			return reply.code(204).send(null);
		},
	);
};

export default clientRoutes;
