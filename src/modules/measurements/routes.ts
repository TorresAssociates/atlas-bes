import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { FastifyRequest } from "fastify";
import {
	getRequestSession,
	listRequestPermissions,
	requirePermission,
} from "@/plugins/authorization";
import { HttpErrorSchema } from "@/schemas";
import {
	BulkDeviceDataQuerySchema,
	BulkDeviceDataSchema,
	BulkDeviceLatestDataQuerySchema,
	BulkDeviceLatestDataSchema,
	ChannelListQuerySchema,
	DeviceDataQuerySchema,
	DeviceDataSchema,
	DeviceIdParamsSchema,
	DeviceLatestDataSchema,
} from "./schemas";
import {
	getBulkDeviceData,
	getBulkDeviceLatestData,
	getDeviceData,
	getDeviceLatestData,
	InvalidTimeWindowError,
	MeasurementDeviceNotFoundError,
	MeasurementDevicesNotFoundError,
} from "./service";

export const autoPrefix = "/devices";

const measurementRoutes: FastifyPluginAsyncTypebox = async (app) => {
	const getDb = () => {
		if (!app.db) throw app.httpErrors.serviceUnavailable("database is not configured");
		return app.db;
	};

	const readAccess = async (request: FastifyRequest) => {
		const permissions = await listRequestPermissions(request);
		const canReadExternal = permissions.includes("R_EXTERNAL_DEVICES");
		const canViewInactive = permissions.includes(
			canReadExternal ? "W_EXTERNAL_DEVICES" : "W_CLIENT_DEVICES",
		);
		return { canReadExternal, canViewInactive };
	};

	app.setErrorHandler((err, _request, reply) => {
		if (err instanceof MeasurementDeviceNotFoundError) return reply.notFound(err.message);
		if (err instanceof MeasurementDevicesNotFoundError) return reply.notFound(err.message);
		if (err instanceof InvalidTimeWindowError) return reply.badRequest(err.message);
		return reply.send(err);
	});

	// GET /v1/devices/data — bulk variant of /:id/data: one set of queries for
	// every requested device instead of one round-trip per device.
	app.get(
		"/data",
		{
			preHandler: requirePermission("R_CLIENT_DEVICES", "R_EXTERNAL_DEVICES"),
			schema: {
				tags: ["measurements"],
				querystring: BulkDeviceDataQuerySchema,
				response: {
					200: BulkDeviceDataSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getRequestSession(request);
			if (!session) throw app.httpErrors.unauthorized("authentication required");

			const { deviceIds, ...query } = request.query;
			return getBulkDeviceData(getDb(), deviceIds, session, await readAccess(request), query);
		},
	);

	// GET /v1/devices/data/latest — bulk variant of /:id/data/latest: one query
	// for every requested device instead of one round-trip per device.
	app.get(
		"/data/latest",
		{
			preHandler: requirePermission("R_CLIENT_DEVICES", "R_EXTERNAL_DEVICES"),
			schema: {
				tags: ["measurements"],
				querystring: BulkDeviceLatestDataQuerySchema,
				response: {
					200: BulkDeviceLatestDataSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getRequestSession(request);
			if (!session) throw app.httpErrors.unauthorized("authentication required");

			const { deviceIds, ...query } = request.query;
			return getBulkDeviceLatestData(
				getDb(),
				deviceIds,
				session,
				await readAccess(request),
				query,
			);
		},
	);

	// GET /v1/devices/:id/data
	// total: 720 ms
	// preHandler: 575 ms (time it took without just the preHandler (commented out line 51))
	// getSession: 650 ms (time it took without just the getSession (commented out line 66 and 67))
	// readAccess: 430 ms (time it took without just the readAccess (changed line 73 and just set the values to true ))
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
			const session = await getRequestSession(request);
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
			const session = await getRequestSession(request);
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
