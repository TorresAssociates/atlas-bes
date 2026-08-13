import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { FastifyRequest } from "fastify";
import { hasPermission, requirePermission } from "@/plugins/authorization";
import { HttpErrorSchema } from "@/schemas";
import { getSession } from "../auth/service";
import {
	DeviceDetailQuerySchema,
	DeviceDetailSchema,
	DeviceIdParamsSchema,
	DeviceListQuerySchema,
	DeviceListSchema,
	UpdateDeviceBodySchema,
} from "./schemas";
import {
	DeviceAccessDeniedError,
	DeviceGaugeStationNotFoundError,
	DeviceNotFoundError,
	getDevice,
	listDevices,
	updateDevice,
} from "./service";

const deviceRoutes: FastifyPluginAsyncTypebox = async (app) => {
	const getDb = () => {
		if (!app.db) throw app.httpErrors.serviceUnavailable("database is not configured");
		return app.db;
	};

	// Viewing inactive devices requires the write permission matching the read
	// scope (W_EXTERNAL_DEVICES for external readers, W_CLIENT_DEVICES otherwise).
	const readAccess = async (request: FastifyRequest) => {
		const canReadExternal = await hasPermission(request, "R_EXTERNAL_DEVICES");
		const canViewInactive = await hasPermission(
			request,
			canReadExternal ? "W_EXTERNAL_DEVICES" : "W_CLIENT_DEVICES",
		);
		return { canReadExternal, canViewInactive };
	};

	app.setErrorHandler((err, _request, reply) => {
		if (err instanceof DeviceNotFoundError) return reply.notFound(err.message);
		if (err instanceof DeviceAccessDeniedError) return reply.forbidden(err.message);
		if (err instanceof DeviceGaugeStationNotFoundError) return reply.badRequest(err.message);
		return reply.send(err);
	});

	// GET /v1/devices
	app.get(
		"/",
		{
			preHandler: requirePermission("R_CLIENT_DEVICES", "R_EXTERNAL_DEVICES"),
			schema: {
				tags: ["devices"],
				querystring: DeviceListQuerySchema,
				response: {
					200: DeviceListSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getSession(request);
			if (!session) throw app.httpErrors.unauthorized("authentication required");

			return {
				data: await listDevices(getDb(), session, await readAccess(request), request.query),
			};
		},
	);

	// GET /v1/devices/:id
	app.get(
		"/:id",
		{
			preHandler: requirePermission("R_CLIENT_DEVICES", "R_EXTERNAL_DEVICES"),
			schema: {
				tags: ["devices"],
				params: DeviceIdParamsSchema,
				querystring: DeviceDetailQuerySchema,
				response: {
					200: DeviceDetailSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getSession(request);
			if (!session) throw app.httpErrors.unauthorized("authentication required");

			return getDevice(
				getDb(),
				request.params.id,
				session,
				await readAccess(request),
				request.query.at,
			);
		},
	);

	// PATCH /v1/devices/:id — info and power only; everything else is reported
	// by the device itself. Creation lives in the (future) register module.
	app.patch(
		"/:id",
		{
			preHandler: requirePermission("W_CLIENT_DEVICES", "W_EXTERNAL_DEVICES"),
			schema: {
				tags: ["devices"],
				params: DeviceIdParamsSchema,
				body: UpdateDeviceBodySchema,
				response: {
					200: DeviceDetailSchema,
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

			const canWriteExternal = await hasPermission(request, "W_EXTERNAL_DEVICES");
			return updateDevice(
				getDb(),
				request.params.id,
				session,
				{ canWriteExternal },
				request.body,
			);
		},
	);
};

export default deviceRoutes;
