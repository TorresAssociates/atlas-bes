import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { FastifyRequest } from "fastify";
import {
	getRequestSession,
	hasPermission,
	type PermissionName,
	requirePermission,
} from "@/plugins/authorization";
import {
	AlertsSettingsBodySchema,
	ControlBodySchema,
	ControlResponseSchema,
	DataSettingsBodySchema,
	GeneralSettingsBodySchema,
	MqtxParamsSchema,
	MqtxSuccessResponseSchema,
	PowerSettingsBodySchema,
} from "./schemas";
import {
	type AlertsSettingsInput,
	type ControlInput,
	type DataSettingsInput,
	type GeneralSettingsInput,
	MqtxBadRequestError,
	MqtxDeviceNotFoundError,
	MqtxRequestFailedError,
	MqtxUnsupportedOperationError,
	type PowerSettingsInput,
	sendMqtxControl,
	updateAlertSettings,
	updateDataSettings,
	updateGeneralSettings,
	updatePowerSettings,
} from "./service";

const mqtxRoutes: FastifyPluginAsyncTypebox = async (app) => {
	const getDb = () => {
		if (!app.db) throw app.httpErrors.serviceUnavailable("database is not configured");
		return app.db;
	};

	app.setErrorHandler((err, _request, reply) => {
		if (err instanceof MqtxDeviceNotFoundError) return reply.notFound(err.message);
		if (err instanceof MqtxBadRequestError) return reply.badRequest(err.message);
		if (err instanceof MqtxUnsupportedOperationError)
			return reply.code(501).send({
				statusCode: 501,
				error: "Not Implemented",
				message: err.message,
			});
		if (err instanceof MqtxRequestFailedError)
			return reply.code(err.statusCode).send({
				statusCode: err.statusCode,
				error: "MQTX Request Failed",
				message: err.message,
			});
		return reply.send(err);
	});

	async function contextFor(request: FastifyRequest, externalWritePermission: PermissionName) {
		const session = await getRequestSession(request);
		if (!session) throw app.httpErrors.unauthorized("authentication required");
		return {
			session,
			access: {
				canWriteExternal: await hasPermission(request, externalWritePermission),
			},
		};
	}

	// POST /v1/mqtx/:deviceId/control
	app.post(
		"/:deviceId/control",
		{
			preHandler: requirePermission("W_CLIENT_CONTROL_PANEL", "W_EXTERNAL_CONTROL_PANEL"),
			schema: {
				tags: ["mqtx"],
				params: MqtxParamsSchema,
				body: ControlBodySchema,
				response: { 200: ControlResponseSchema },
			},
		},
		async (request) => {
			const { session, access } = await contextFor(request, "W_EXTERNAL_CONTROL_PANEL");
			const params = request.params as { deviceId: string };
			return sendMqtxControl(
				getDb(),
				app.mqtx,
				params.deviceId,
				session,
				access,
				request.body as ControlInput,
			);
		},
	);

	// PUT /v1/mqtx/:deviceId/settings/alerts
	app.put(
		"/:deviceId/settings/alerts",
		{
			preHandler: requirePermission("W_CLIENT_DEVICES", "W_EXTERNAL_DEVICES"),
			schema: {
				tags: ["mqtx"],
				params: MqtxParamsSchema,
				body: AlertsSettingsBodySchema,
			},
		},
		async (request, reply) => {
			const { session, access } = await contextFor(request, "W_EXTERNAL_DEVICES");
			const params = request.params as { deviceId: string };
			await updateAlertSettings(
				getDb(),
				app.mqtx,
				params.deviceId,
				session,
				access,
				request.body as AlertsSettingsInput,
			);
			return reply.code(204).send(null);
		},
	);

	// POST /v1/mqtx/:deviceId/settings/data
	app.post(
		"/:deviceId/settings/data",
		{
			preHandler: requirePermission("W_CLIENT_DEVICES", "W_EXTERNAL_DEVICES"),
			schema: {
				tags: ["mqtx"],
				params: MqtxParamsSchema,
				body: DataSettingsBodySchema,
				response: { 200: MqtxSuccessResponseSchema },
			},
		},
		async (request) => {
			const { session, access } = await contextFor(request, "W_EXTERNAL_DEVICES");
			const params = request.params as { deviceId: string };
			return updateDataSettings(
				getDb(),
				app.mqtx,
				params.deviceId,
				session,
				access,
				request.body as DataSettingsInput,
			);
		},
	);

	// POST /v1/mqtx/:deviceId/settings/general
	app.post(
		"/:deviceId/settings/general",
		{
			preHandler: requirePermission("W_CLIENT_DEVICES", "W_EXTERNAL_DEVICES"),
			schema: {
				tags: ["mqtx"],
				params: MqtxParamsSchema,
				body: GeneralSettingsBodySchema,
				response: { 200: MqtxSuccessResponseSchema },
			},
		},
		async (request) => {
			const { session, access } = await contextFor(request, "W_EXTERNAL_DEVICES");
			const params = request.params as { deviceId: string };
			return updateGeneralSettings(
				getDb(),
				app.mqtx,
				params.deviceId,
				session,
				access,
				app.config.ENCRYPTION_KEY,
				request.body as GeneralSettingsInput,
			);
		},
	);

	// POST /v1/mqtx/:deviceId/settings/power
	app.post(
		"/:deviceId/settings/power",
		{
			preHandler: requirePermission("W_CLIENT_DEVICES", "W_EXTERNAL_DEVICES"),
			schema: {
				tags: ["mqtx"],
				params: MqtxParamsSchema,
				body: PowerSettingsBodySchema,
				response: { 200: MqtxSuccessResponseSchema },
			},
		},
		async (request) => {
			const { session, access } = await contextFor(request, "W_EXTERNAL_DEVICES");
			const params = request.params as { deviceId: string };
			return updatePowerSettings(
				getDb(),
				params.deviceId,
				session,
				access,
				request.body as PowerSettingsInput,
			);
		},
	);
};

export default mqtxRoutes;
