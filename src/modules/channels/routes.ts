import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { FastifyRequest } from "fastify";
import { hasPermission, requirePermission } from "@/plugins/authorization";
import { getSession } from "../auth/service";
import {
	ChannelListResponseSchema,
	ChannelParamsSchema,
	ChannelRecordResponseSchema,
	DeviceChannelsParamsSchema,
} from "./schemas";
import {
	ChannelDeviceNotFoundError,
	ChannelNotFoundError,
	getChannel,
	listChannels,
	listChannelsForDevice,
} from "./service";

const channelRoutes: FastifyPluginAsyncTypebox = async (app) => {
	const getDb = () => {
		if (!app.db)
			throw app.httpErrors.serviceUnavailable(
				"database is not configured",
			);
		return app.db;
	};

	app.setErrorHandler((err, _request, reply) => {
		if (err instanceof ChannelDeviceNotFoundError)
			return reply.notFound(err.message);
		if (err instanceof ChannelNotFoundError)
			return reply.notFound(err.message);
		return reply.send(err);
	});

	async function sessionFor(request: FastifyRequest) {
		const session = await getSession(request);
		if (!session)
			throw app.httpErrors.unauthorized("authentication required");
		return session;
	}

	// GET /v1/channels
	app.get(
		"/",
		{
			preHandler: requirePermission(
				"R_CLIENT_DEVICES",
				"R_EXTERNAL_DEVICES",
			),
			schema: {
				tags: ["channels"],
				response: { 200: ChannelListResponseSchema },
			},
		},
		async (request) => {
			const session = await sessionFor(request);
			const canReadExternal = await hasPermission(
				request,
				"R_EXTERNAL_DEVICES",
			);
			return {
				data: await listChannels(getDb(), session, { canReadExternal }),
			};
		},
	);
	
	// GET /v1/channels/device/:deviceId
	app.get(
		"/device/:deviceId",
		{
			preHandler: requirePermission(
				"R_CLIENT_DEVICES",
				"R_EXTERNAL_DEVICES",
			),
			schema: {
				tags: ["channels"],
				params: DeviceChannelsParamsSchema,
				response: { 200: ChannelListResponseSchema },
			},
		},
		async (request) => {
			const session = await sessionFor(request);
			const params = request.params as { deviceId: number | string };
			const canReadExternal = await hasPermission(
				request,
				"R_EXTERNAL_DEVICES",
			);
			return {
				data: await listChannelsForDevice(
					getDb(),
					Number(params.deviceId),
					session,
					{
						canReadExternal,
					},
				),
			};
		},
	);

	// GET /v1/channels/:id
	app.get(
		"/:id",
		{
			preHandler: requirePermission(
				"R_CLIENT_DEVICES",
				"R_EXTERNAL_DEVICES",
			),
			schema: {
				tags: ["channels"],
				params: ChannelParamsSchema,
				response: { 200: ChannelRecordResponseSchema },
			},
		},
		async (request) => {
			const session = await sessionFor(request);
			const params = request.params as { id: number | string };
			const canReadExternal = await hasPermission(
				request,
				"R_EXTERNAL_DEVICES",
			);
			return getChannel(getDb(), Number(params.id), session, {
				canReadExternal,
			});
		},
	);
};

export default channelRoutes;

