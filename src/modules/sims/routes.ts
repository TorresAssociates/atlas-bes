import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { getRequestSession, hasPermission, requirePermission } from "@/plugins/authorization";
import {
	ActivateSimsBodySchema,
	ActivateSimsResponseSchema,
	CreateSimBodySchema,
	CreateSimResponseSchema,
	SimListResponseSchema,
	SimParamsSchema,
	SimResponseSchema,
	UpdateSimImeiBodySchema,
} from "./schemas";
import {
	type ActivateSimsInput,
	activateSims,
	type CreateSimInput,
	createSim,
	getSim,
	listSims,
	SimAccessDeniedError,
	SimBadRequestError,
	SimConflictError,
	SimDeviceNotFoundError,
	SimGaugeStationNotFoundError,
	SimNotFoundError,
	type UpdateSimImeiInput,
	updateSimImei,
} from "./service";

const simsRoutes: FastifyPluginAsyncTypebox = async (app) => {
	const getDb = () => {
		if (!app.db) throw app.httpErrors.serviceUnavailable("database is not configured");
		return app.db;
	};

	app.setErrorHandler((err, _request, reply) => {
		if (err instanceof SimNotFoundError) return reply.notFound(err.message);
		if (err instanceof SimBadRequestError) return reply.badRequest(err.message);
		if (err instanceof SimGaugeStationNotFoundError) return reply.notFound(err.message);
		if (err instanceof SimDeviceNotFoundError) return reply.notFound(err.message);
		if (err instanceof SimAccessDeniedError) return reply.forbidden(err.message);
		if (err instanceof SimConflictError) {
			return reply.code(409).send({ message: err.message, usimId: 0 });
		}
		return reply.send(err);
	});

	// GET /v1/sims
	app.get(
		"/",
		{
			preHandler: requirePermission("R_CLIENT_DEVICES", "R_EXTERNAL_DEVICES"),
			schema: {
				tags: ["sims"],
				response: { 200: SimListResponseSchema },
			},
		},
		async (request) => {
			const session = await getRequestSession(request);
			if (!session) throw app.httpErrors.unauthorized("authentication required");

			const canReadExternal = await hasPermission(request, "R_EXTERNAL_DEVICES");
			return { data: await listSims(getDb(), session, { canReadExternal }) };
		},
	);

	// GET /v1/sims/:iccid
	app.get(
		"/:iccid",
		{
			preHandler: requirePermission("R_CLIENT_DEVICES", "R_EXTERNAL_DEVICES"),
			schema: {
				tags: ["sims"],
				params: SimParamsSchema,
				response: { 200: SimResponseSchema },
			},
		},
		async (request) => {
			const session = await getRequestSession(request);
			if (!session) throw app.httpErrors.unauthorized("authentication required");

			const params = request.params as { iccid: string };
			const canReadExternal = await hasPermission(request, "R_EXTERNAL_DEVICES");
			return getSim(getDb(), params.iccid, session, { canReadExternal });
		},
	);

	// POST /v1/sims
	app.post(
		"/",
		{
			preHandler: requirePermission("W_CLIENT_DEVICES", "W_EXTERNAL_DEVICES"),
			schema: {
				tags: ["sims"],
				body: CreateSimBodySchema,
				response: { 201: CreateSimResponseSchema, 409: CreateSimResponseSchema },
			},
		},
		async (request, reply) => {
			const sim = await createSim(getDb(), request.body as CreateSimInput);
			return reply.code(201).send(sim);
		},
	);

	// PUT /v1/sims
	app.put(
		"/",
		{
			preHandler: requirePermission("W_CLIENT_DEVICES", "W_EXTERNAL_DEVICES"),
			schema: {
				tags: ["sims"],
				body: UpdateSimImeiBodySchema,
				response: { 200: CreateSimResponseSchema },
			},
		},
		async (request) => updateSimImei(getDb(), request.body as UpdateSimImeiInput),
	);

	// POST /v1/sims/activate
	app.post(
		"/activate",
		{
			preHandler: requirePermission("W_CLIENT_DEVICES", "W_EXTERNAL_DEVICES"),
			schema: {
				tags: ["sims"],
				body: ActivateSimsBodySchema,
				response: { 200: ActivateSimsResponseSchema },
			},
		},
		async (request) => {
			const session = await getRequestSession(request);
			if (!session) throw app.httpErrors.unauthorized("authentication required");

			const canWriteExternal = await hasPermission(request, "W_EXTERNAL_DEVICES");
			return activateSims(
				getDb(),
				session,
				{ canWriteExternal },
				{ hologram: app.hologram, emnify: app.emnify },
				request.body as ActivateSimsInput,
			);
		},
	);
};

export default simsRoutes;
