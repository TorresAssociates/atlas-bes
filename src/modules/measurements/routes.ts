import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { FastifyRequest } from "fastify";
import { hasPermission, requirePermission } from "@/plugins/authorization";
import { HttpErrorSchema } from "@/schemas";
import { getSession } from "../auth/service";
import {
	ChannelListQuerySchema,
	DeviceDataQuerySchema,
	DeviceDataSchema,
	DeviceIdParamsSchema,
	DeviceLatestDataSchema,
} from "./schemas";
import {
	getDeviceData,
	getDeviceLatestData,
	InvalidTimeWindowError,
	MeasurementDeviceNotFoundError,
} from "./service";

export const autoPrefix = "/devices";

const measurementRoutes: FastifyPluginAsyncTypebox = async (app) => {
	const getDb = () => {
		if (!app.db) throw app.httpErrors.serviceUnavailable("database is not configured");
		return app.db;
	};

	const readAccess = async (request: FastifyRequest) => {
		const canReadExternal = await hasPermission(request, "R_EXTERNAL_DEVICES");
		const canViewInactive = await hasPermission(
			request,
			canReadExternal ? "W_EXTERNAL_DEVICES" : "W_CLIENT_DEVICES",
		);
		return { canReadExternal, canViewInactive };
	};

	app.setErrorHandler((err, _request, reply) => {
		if (err instanceof MeasurementDeviceNotFoundError) return reply.notFound(err.message);
		if (err instanceof InvalidTimeWindowError) return reply.badRequest(err.message);
		return reply.send(err);
	});

	// GET /v1/devices/:id/data
	// total: 720 ms
	// preHandler: 575 ms
	// getSession: 650 ms
	// readAccess: 430 ms
	app.get(
		"/:id/data",
		{
			preHandler: requirePermission("R_CLIENT_DEVICES", "R_EXTERNAL_DEVICES"),
			schema: {
				tags: ["measurements"],
				params: DeviceIdParamsSchema,
				querystring: DeviceDataQuerySchema,
				response: {
					200: DeviceDataSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getSession(request);
			if (!session) throw app.httpErrors.unauthorized("authentication required");

			return getDeviceData(
				getDb(),
				request.params.id,
				session,
				await readAccess(request),
				request.query,
			);
		},
	);

	// GET /v1/devices/:id/data/latest
	app.get(
		"/:id/data/latest",
		{
			preHandler: requirePermission("R_CLIENT_DEVICES", "R_EXTERNAL_DEVICES"),
			schema: {
				tags: ["measurements"],
				params: DeviceIdParamsSchema,
				querystring: ChannelListQuerySchema,
				response: {
					200: DeviceLatestDataSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getSession(request);
			if (!session) throw app.httpErrors.unauthorized("authentication required");

			return getDeviceLatestData(
				getDb(),
				request.params.id,
				session,
				await readAccess(request),
				request.query,
			);
		},
	);
};

export default measurementRoutes;
