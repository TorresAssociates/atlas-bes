import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { FastifyRequest } from "fastify";
import {
	getRequestSession,
	hasPermission,
	listRequestPermissions,
	requirePermission,
} from "@/plugins/authorization";
import { HttpErrorSchema } from "@/schemas";
import {
	CreateGaugeStationBodySchema,
	GaugeStationFeatureCollectionSchema,
	GaugeStationIdParamsSchema,
	GaugeStationListQuerySchema,
	GaugeStationListSchema,
	GaugeStationSchema,
	UpdateGaugeStationBodySchema,
} from "./schemas";
import {
	createGaugeStation,
	GaugeStationAccessDeniedError,
	GaugeStationCityNotFoundError,
	GaugeStationClientNotFoundError,
	GaugeStationNameConflictError,
	GaugeStationNotFoundError,
	getGaugeStation,
	listGaugeStations,
	listGaugeStationsGeoJson,
	updateGaugeStation,
} from "./service";

const gaugeStationRoutes: FastifyPluginAsyncTypebox = async (app) => {
	const getDb = () => {
		if (!app.db) throw app.httpErrors.serviceUnavailable("database is not configured");
		return app.db;
	};

	// Viewing inactive gauge stations requires the write permission matching the read
	// scope (W_EXTERNAL_DEVICES for external readers, W_CLIENT_DEVICES otherwise).
	const readAccess = async (request: FastifyRequest) => {
		const permissions = await listRequestPermissions(request);
		const canReadExternal = permissions.includes("R_EXTERNAL_DEVICES");
		const canViewInactive = permissions.includes(
			canReadExternal ? "W_EXTERNAL_DEVICES" : "W_CLIENT_DEVICES",
		);
		return { canReadExternal, canViewInactive };
	};

	app.setErrorHandler((err, _request, reply) => {
		if (err instanceof GaugeStationNotFoundError) return reply.notFound(err.message);
		if (err instanceof GaugeStationNameConflictError) return reply.conflict(err.message);
		if (err instanceof GaugeStationAccessDeniedError) return reply.forbidden(err.message);
		if (err instanceof GaugeStationCityNotFoundError || err instanceof GaugeStationClientNotFoundError)
			return reply.badRequest(err.message);
		return reply.send(err);
	});

	// GET /v1/gauge-stations
	app.get(
		"/",
		{
			preHandler: requirePermission("R_CLIENT_DEVICES", "R_EXTERNAL_DEVICES"),
			schema: {
				tags: ["gauge-stations"],
				querystring: GaugeStationListQuerySchema,
				response: {
					200: GaugeStationListSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getRequestSession(request);
			if (!session) throw app.httpErrors.unauthorized("authentication required");

			return {
				data: await listGaugeStations(getDb(), session, await readAccess(request), request.query),
			};
		},
	);

	// GET /v1/gauge-stations/geojson — the same authorized row set as GET /v1/gauge-stations,
	// projected as a GeoJSON FeatureCollection with each gauge station's highest
	// effective device risk level. (The static segment outranks /:id in
	// find-my-way, so there is no routing conflict.)
	app.get(
		"/geojson",
		{
			preHandler: requirePermission("R_CLIENT_DEVICES", "R_EXTERNAL_DEVICES"),
			schema: {
				tags: ["gauge-stations"],
				querystring: GaugeStationListQuerySchema,
				response: {
					200: GaugeStationFeatureCollectionSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getRequestSession(request);
			if (!session) throw app.httpErrors.unauthorized("authentication required");

			return listGaugeStationsGeoJson(getDb(), session, await readAccess(request), request.query);
		},
	);

	// GET /v1/gauge-stations/:id
	app.get(
		"/:id",
		{
			preHandler: requirePermission("R_CLIENT_DEVICES", "R_EXTERNAL_DEVICES"),
			schema: {
				tags: ["gauge-stations"],
				params: GaugeStationIdParamsSchema,
				response: {
					200: GaugeStationSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getRequestSession(request);
			if (!session) throw app.httpErrors.unauthorized("authentication required");

			return getGaugeStation(getDb(), request.params.id, session, await readAccess(request));
		},
	);

	// POST /v1/gauge-stations
	app.post(
		"/",
		{
			preHandler: requirePermission("W_CLIENT_DEVICES", "W_EXTERNAL_DEVICES"),
			schema: {
				tags: ["gauge-stations"],
				body: CreateGaugeStationBodySchema,
				response: {
					201: GaugeStationSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					409: HttpErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const session = await getRequestSession(request);
			if (!session) throw app.httpErrors.unauthorized("authentication required");

			const canWriteExternal = await hasPermission(request, "W_EXTERNAL_DEVICES");
			const gaugeStation = await createGaugeStation(getDb(), session, { canWriteExternal }, request.body);
			return reply.code(201).send(gaugeStation);
		},
	);

	// PATCH /v1/gauge-stations/:id
	app.patch(
		"/:id",
		{
			preHandler: requirePermission("W_CLIENT_DEVICES", "W_EXTERNAL_DEVICES"),
			schema: {
				tags: ["gauge-stations"],
				params: GaugeStationIdParamsSchema,
				body: UpdateGaugeStationBodySchema,
				response: {
					200: GaugeStationSchema,
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
			if (!session) throw app.httpErrors.unauthorized("authentication required");

			const canWriteExternal = await hasPermission(request, "W_EXTERNAL_DEVICES");
			return updateGaugeStation(
				getDb(),
				request.params.id,
				session,
				{ canWriteExternal },
				request.body,
			);
		},
	);
};

export default gaugeStationRoutes;
