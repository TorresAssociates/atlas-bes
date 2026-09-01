import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { FastifyRequest } from "fastify";
import { getRequestSession, hasPermission, requirePermission } from "@/plugins/authorization";
import { HttpErrorSchema } from "@/schemas";
import {
	AlertMonitorConfigActivityListSchema,
	AlertMonitorConfigActivityOverrideListSchema,
	AlertMonitorConfigActivityOverrideSchema,
	AlertMonitorConfigActivitySchema,
	AlertMonitorConfigListSchema,
	AlertMonitorConfigRangeListSchema,
	AlertMonitorConfigRangeSchema,
	AlertMonitorConfigSchema,
	AlertMonitorListSchema,
	AlertMonitorSchema,
	AlertMonitorStatusListSchema,
	ChannelAlertMonitorListSchema,
	ChannelAlertMonitorSchema,
	CreateAlertMonitorBodySchema,
	CreateAlertMonitorConfigActivityBodySchema,
	CreateAlertMonitorConfigActivityOverrideBodySchema,
	CreateAlertMonitorConfigBodySchema,
	CreateAlertMonitorConfigRangeBodySchema,
	CreateChannelAlertMonitorBodySchema,
} from "./schemas";
import {
	AlertMonitorAlertNotFoundError,
	AlertMonitorChannelNotFoundError,
	AlertMonitorDeviceNotFoundError,
	AlertMonitorNotFoundError,
	AlertMonitorRelationshipError,
	createActivity,
	createActivityOverride,
	createAlertMonitor,
	createChannelLink,
	createConfig,
	createRange,
	listActivities,
	listActivityOverrides,
	listAlertMonitorStatuses,
	listAlertMonitors,
	listChannelLinks,
	listConfigs,
	listRanges,
} from "./service";

const alertMonitorRoutes: FastifyPluginAsyncTypebox = async (app) => {
	const getDb = () => {
		if (!app.db) throw app.httpErrors.serviceUnavailable("database is not configured");
		return app.db;
	};

	app.setErrorHandler((err, _request, reply) => {
		if (err instanceof AlertMonitorNotFoundError) return reply.notFound(err.message);
		if (err instanceof AlertMonitorDeviceNotFoundError) return reply.notFound(err.message);
		if (err instanceof AlertMonitorChannelNotFoundError) return reply.notFound(err.message);
		if (err instanceof AlertMonitorAlertNotFoundError) return reply.badRequest(err.message);
		if (err instanceof AlertMonitorRelationshipError) return reply.badRequest(err.message);
		return reply.send(err);
	});

	async function contextFor(
		request: FastifyRequest,
		externalPermission: "R_EXTERNAL_DEVICES" | "W_EXTERNAL_DEVICES",
	) {
		const session = await getRequestSession(request);
		if (!session) throw app.httpErrors.unauthorized("authentication required");
		return {
			session,
			canAccessExternal: await hasPermission(request, externalPermission),
		};
	}

	// GET /v1/alert-monitors
	app.get(
		"/",
		{
			preHandler: requirePermission("R_CLIENT_DEVICES", "R_EXTERNAL_DEVICES"),
			schema: {
				tags: ["alert-monitors"],
				response: {
					200: AlertMonitorListSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const { session, canAccessExternal } = await contextFor(request, "R_EXTERNAL_DEVICES");
			return {
				data: await listAlertMonitors(getDb(), session, {
					canReadExternal: canAccessExternal,
				}),
			};
		},
	);

	// GET /v1/alert-monitors/status
	app.get(
		"/status",
		{
			preHandler: requirePermission("R_CLIENT_DEVICES", "R_EXTERNAL_DEVICES"),
			schema: {
				tags: ["alert-monitors"],
				response: {
					200: AlertMonitorStatusListSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const { session, canAccessExternal } = await contextFor(request, "R_EXTERNAL_DEVICES");
			return {
				data: await listAlertMonitorStatuses(getDb(), session, {
					canReadExternal: canAccessExternal,
				}),
			};
		},
	);

	// POST /v1/alert-monitors
	app.post(
		"/",
		{
			preHandler: requirePermission("W_CLIENT_DEVICES", "W_EXTERNAL_DEVICES"),
			schema: {
				tags: ["alert-monitors"],
				body: CreateAlertMonitorBodySchema,
				response: {
					201: AlertMonitorSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const { session, canAccessExternal } = await contextFor(request, "W_EXTERNAL_DEVICES");
			const created = await createAlertMonitor(
				getDb(),
				session,
				{ canWriteExternal: canAccessExternal },
				request.body,
			);
			return reply.code(201).send(created);
		},
	);

	// GET /v1/alert-monitors/configs
	app.get(
		"/configs",
		{
			preHandler: requirePermission("R_CLIENT_DEVICES", "R_EXTERNAL_DEVICES"),
			schema: {
				tags: ["alert-monitors"],
				response: {
					200: AlertMonitorConfigListSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const { session, canAccessExternal } = await contextFor(request, "R_EXTERNAL_DEVICES");
			return {
				data: await listConfigs(getDb(), session, {
					canReadExternal: canAccessExternal,
				}),
			};
		},
	);

	// POST /v1/alert-monitors/configs
	app.post(
		"/configs",
		{
			preHandler: requirePermission("W_CLIENT_DEVICES", "W_EXTERNAL_DEVICES"),
			schema: {
				tags: ["alert-monitors"],
				body: CreateAlertMonitorConfigBodySchema,
				response: {
					201: AlertMonitorConfigSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const { session, canAccessExternal } = await contextFor(request, "W_EXTERNAL_DEVICES");
			const created = await createConfig(
				getDb(),
				session,
				{ canWriteExternal: canAccessExternal },
				request.body,
			);
			return reply.code(201).send(created);
		},
	);

	// GET /v1/alert-monitors/activities
	app.get(
		"/activities",
		{
			preHandler: requirePermission("R_CLIENT_DEVICES", "R_EXTERNAL_DEVICES"),
			schema: {
				tags: ["alert-monitors"],
				response: {
					200: AlertMonitorConfigActivityListSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const { session, canAccessExternal } = await contextFor(request, "R_EXTERNAL_DEVICES");
			return {
				data: await listActivities(getDb(), session, {
					canReadExternal: canAccessExternal,
				}),
			};
		},
	);

	// POST /v1/alert-monitors/activities
	app.post(
		"/activities",
		{
			preHandler: requirePermission("W_CLIENT_DEVICES", "W_EXTERNAL_DEVICES"),
			schema: {
				tags: ["alert-monitors"],
				body: CreateAlertMonitorConfigActivityBodySchema,
				response: {
					201: AlertMonitorConfigActivitySchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const { session, canAccessExternal } = await contextFor(request, "W_EXTERNAL_DEVICES");
			const created = await createActivity(
				getDb(),
				session,
				{ canWriteExternal: canAccessExternal },
				request.body,
			);
			return reply.code(201).send(created);
		},
	);

	// GET /v1/alert-monitors/activity-overrides
	app.get(
		"/activity-overrides",
		{
			preHandler: requirePermission("R_CLIENT_DEVICES", "R_EXTERNAL_DEVICES"),
			schema: {
				tags: ["alert-monitors"],
				response: {
					200: AlertMonitorConfigActivityOverrideListSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const { session, canAccessExternal } = await contextFor(request, "R_EXTERNAL_DEVICES");
			return {
				data: await listActivityOverrides(getDb(), session, {
					canReadExternal: canAccessExternal,
				}),
			};
		},
	);

	// POST /v1/alert-monitors/activity-overrides
	app.post(
		"/activity-overrides",
		{
			preHandler: requirePermission("W_CLIENT_DEVICES", "W_EXTERNAL_DEVICES"),
			schema: {
				tags: ["alert-monitors"],
				body: CreateAlertMonitorConfigActivityOverrideBodySchema,
				response: {
					201: AlertMonitorConfigActivityOverrideSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const { session, canAccessExternal } = await contextFor(request, "W_EXTERNAL_DEVICES");
			const created = await createActivityOverride(
				getDb(),
				session,
				{ canWriteExternal: canAccessExternal },
				request.body,
			);
			return reply.code(201).send(created);
		},
	);

	// GET /v1/alert-monitors/channel-links
	app.get(
		"/channel-links",
		{
			preHandler: requirePermission("R_CLIENT_DEVICES", "R_EXTERNAL_DEVICES"),
			schema: {
				tags: ["alert-monitors"],
				response: {
					200: ChannelAlertMonitorListSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const { session, canAccessExternal } = await contextFor(request, "R_EXTERNAL_DEVICES");
			return {
				data: await listChannelLinks(getDb(), session, {
					canReadExternal: canAccessExternal,
				}),
			};
		},
	);

	// POST /v1/alert-monitors/channel-links
	app.post(
		"/channel-links",
		{
			preHandler: requirePermission("W_CLIENT_DEVICES", "W_EXTERNAL_DEVICES"),
			schema: {
				tags: ["alert-monitors"],
				body: CreateChannelAlertMonitorBodySchema,
				response: {
					201: ChannelAlertMonitorSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const { session, canAccessExternal } = await contextFor(request, "W_EXTERNAL_DEVICES");
			const created = await createChannelLink(
				getDb(),
				session,
				{ canWriteExternal: canAccessExternal },
				request.body,
			);
			return reply.code(201).send(created);
		},
	);

	// GET /v1/alert-monitors/ranges
	app.get(
		"/ranges",
		{
			preHandler: requirePermission("R_CLIENT_DEVICES", "R_EXTERNAL_DEVICES"),
			schema: {
				tags: ["alert-monitors"],
				response: {
					200: AlertMonitorConfigRangeListSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const { session, canAccessExternal } = await contextFor(request, "R_EXTERNAL_DEVICES");
			return {
				data: await listRanges(getDb(), session, {
					canReadExternal: canAccessExternal,
				}),
			};
		},
	);

	// POST /v1/alert-monitors/ranges
	app.post(
		"/ranges",
		{
			preHandler: requirePermission("W_CLIENT_DEVICES", "W_EXTERNAL_DEVICES"),
			schema: {
				tags: ["alert-monitors"],
				body: CreateAlertMonitorConfigRangeBodySchema,
				response: {
					201: AlertMonitorConfigRangeSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const { session, canAccessExternal } = await contextFor(request, "W_EXTERNAL_DEVICES");
			const created = await createRange(
				getDb(),
				session,
				{ canWriteExternal: canAccessExternal },
				request.body,
			);
			return reply.code(201).send(created);
		},
	);
};

export default alertMonitorRoutes;
