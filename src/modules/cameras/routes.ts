import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { FastifyRequest } from "fastify";
import { hasPermission, requirePermission } from "@/plugins/authorization";
import { getSession } from "../auth/service";
import {
	CameraCaptureListResponseSchema,
	CameraCaptureRequestBodySchema,
	CameraDataListResponseSchema,
	CameraDeviceParamsSchema,
	CameraListResponseSchema,
	CameraResponseSchema,
	CameraImageMetadataQuerySchema,
	CameraConfigBodySchema,
	MqtxStatusResponseSchema,
} from "./schemas";
import {
	CameraBadRequestError,
	CameraCaptureNotFoundError,
	CameraMqtxRequestFailedError,
	CameraNotFoundError,
	getCamera,
	getCameraCaptureByPath,
	listCameraCaptures,
	listCameraDataRecords,
	listCameras,
	requestCameraCapture,
	requestLegacyCameraCapture,
	updateCameraConfig,
	type CameraConfigInput,
	type CameraQueryFilters,
	type CaptureRequestInput,
} from "./service";

const cameraRoutes: FastifyPluginAsyncTypebox = async (app) => {
	const getDb = () => {
		if (!app.db)
			throw app.httpErrors.serviceUnavailable(
				"database is not configured",
			);
		return app.db;
	};

	app.setErrorHandler((err, _request, reply) => {
		if (err instanceof CameraNotFoundError)
			return reply.notFound(err.message);
		if (err instanceof CameraCaptureNotFoundError)
			return reply.forbidden(err.message);
		if (err instanceof CameraBadRequestError)
			return reply.badRequest(err.message);
		if (err instanceof CameraMqtxRequestFailedError) {
			return reply.code(err.statusCode).send({
				statusCode: err.statusCode,
				error: "MQTX Request Failed",
				message: err.message,
			});
		}
		return reply.send(err);
	});

	async function sessionFor(request: FastifyRequest) {
		const session = await getSession(request);
		if (!session)
			throw app.httpErrors.unauthorized("authentication required");
		return session;
	}

	function cameraFilters(query: unknown): CameraQueryFilters {
		const q = query as Record<string, unknown>;
		return {
			from: typeof q.from === "string" ? q.from : undefined,
			to: typeof q.to === "string" ? q.to : undefined,
			limit:
				typeof q.limit === "string" || typeof q.limit === "number"
					? q.limit
					: undefined,
			page:
				typeof q.page === "string" || typeof q.page === "number"
					? q.page
					: undefined,
			taggedOnly: q.taggedOnly !== undefined,
		};
	}

	// GET /v1/cameras?gaugeId=1&clientId=2
	app.get(
		"/",
		{
			preHandler: requirePermission(
				"R_CLIENT_CONTROL_PANEL",
				"R_EXTERNAL_CONTROL_PANEL",
			),
			schema: {
				tags: ["cameras"],
				response: { 200: CameraListResponseSchema },
			},
		},
		async (request) => {
			const session = await sessionFor(request);
			const query = request.query as Record<string, string | undefined>;
			const canReadExternal = await hasPermission(
				request,
				"R_EXTERNAL_CONTROL_PANEL",
			);
			return {
				data: await listCameras(
					getDb(),
					session,
					{ canReadExternal },
					{
						gaugeId:
							query.gaugeId === undefined
								? undefined
								: Number(query.gaugeId),
						clientId:
							canReadExternal && query.clientId !== undefined
								? Number(query.clientId)
								: undefined,
					},
				),
			};
		},
	);

	// GET /v1/cameras/:deviceId
	app.get(
		"/:deviceId",
		{
			preHandler: requirePermission(
				"R_CLIENT_CONTROL_PANEL",
				"R_EXTERNAL_CONTROL_PANEL",
			),
			schema: {
				tags: ["cameras"],
				params: CameraDeviceParamsSchema,
				response: { 200: CameraResponseSchema },
			},
		},
		async (request) => {
			const session = await sessionFor(request);
			const params = request.params as { deviceId: string };
			const canReadExternal = await hasPermission(
				request,
				"R_EXTERNAL_CONTROL_PANEL",
			);
			return getCamera(getDb(), params.deviceId, session, {
				canReadExternal,
			});
		},
	);

	// GET /v1/cameras/:deviceId/data?from=&to=&limit=&page=&taggedOnly
	app.get(
		"/:deviceId/data",
		{
			preHandler: requirePermission(
				"R_CLIENT_DEVICES",
				"R_EXTERNAL_DEVICES",
			),
			schema: {
				tags: ["cameras"],
				params: CameraDeviceParamsSchema,
				response: { 200: CameraDataListResponseSchema },
			},
		},
		async (request) => {
			const session = await sessionFor(request);
			const params = request.params as { deviceId: string };
			const canReadExternal = await hasPermission(
				request,
				"R_EXTERNAL_DEVICES",
			);
			return {
				data: await listCameraDataRecords(
					getDb(),
					params.deviceId,
					session,
					{ canReadExternal },
					cameraFilters(request.query),
				),
			};
		},
	);

	async function listImages(request: FastifyRequest) {
		const session = await sessionFor(request);
		const params = request.params as { deviceId: string };
		const canReadExternal = await hasPermission(
			request,
			"R_EXTERNAL_DEVICES",
		);
		return {
			data: await listCameraCaptures(
				getDb(),
				params.deviceId,
				session,
				{ canReadExternal },
				cameraFilters(request.query),
			),
		};
	}

	// GET /v1/cameras/:deviceId/images
	app.get(
		"/:deviceId/images",
		{
			preHandler: requirePermission(
				"R_CLIENT_DEVICES",
				"R_EXTERNAL_DEVICES",
			),
			schema: {
				tags: ["cameras"],
				params: CameraDeviceParamsSchema,
				response: { 200: CameraCaptureListResponseSchema },
			},
		},
		listImages,
	);

	// GET /v1/cameras/:deviceId/3.1/images
	app.get(
		"/:deviceId/3.1/images",
		{
			preHandler: requirePermission(
				"R_CLIENT_DEVICES",
				"R_EXTERNAL_DEVICES",
			),
			schema: {
				tags: ["cameras"],
				params: CameraDeviceParamsSchema,
				response: { 200: CameraCaptureListResponseSchema },
			},
		},
		listImages,
	);

	async function getImageMetadata(request: FastifyRequest) {
		const session = await sessionFor(request);
		const params = request.params as { deviceId: string };
		const query = request.query as { path?: string };
		if (!query.path)
			throw app.httpErrors.badRequest(
				"Missing required 'path' query param",
			);
		const canReadExternal = await hasPermission(
			request,
			"R_EXTERNAL_DEVICES",
		);
		return getCameraCaptureByPath(
			getDb(),
			params.deviceId,
			query.path,
			session,
			{ canReadExternal },
		);
	}

	// GET /v1/cameras/:deviceId/images/signed?path=stored/path.jpg
	app.get(
		"/:deviceId/images/signed",
		{
			preHandler: requirePermission(
				"R_CLIENT_DEVICES",
				"R_EXTERNAL_DEVICES",
			),
			schema: {
				tags: ["cameras"],
				params: CameraDeviceParamsSchema,
				querystring: CameraImageMetadataQuerySchema,
				response: {
					200: CameraCaptureListResponseSchema.properties.data.items,
				},
			},
		},
		getImageMetadata,
	);

	// GET /v1/cameras/:deviceId/3.1/images/signed?path=stored/path.jpg
	app.get(
		"/:deviceId/3.1/images/signed",
		{
			preHandler: requirePermission(
				"R_CLIENT_DEVICES",
				"R_EXTERNAL_DEVICES",
			),
			schema: {
				tags: ["cameras"],
				params: CameraDeviceParamsSchema,
				querystring: CameraImageMetadataQuerySchema,
				response: {
					200: CameraCaptureListResponseSchema.properties.data.items,
				},
			},
		},
		getImageMetadata,
	);

	// POST /v1/cameras/:deviceId/images
	app.post(
		"/:deviceId/images",
		{
			preHandler: requirePermission(
				"W_CLIENT_CONTROL_PANEL",
				"W_EXTERNAL_CONTROL_PANEL",
			),
			schema: {
				tags: ["cameras"],
				params: CameraDeviceParamsSchema,
				response: { 200: MqtxStatusResponseSchema },
			},
		},
		async (request) => {
			const session = await sessionFor(request);
			const params = request.params as { deviceId: string };
			const canWriteExternal = await hasPermission(
				request,
				"W_EXTERNAL_CONTROL_PANEL",
			);
			return requestLegacyCameraCapture(
				getDb(),
				app.mqtx,
				params.deviceId,
				session,
				{ canWriteExternal },
			);
		},
	);

	// POST /v1/cameras/:deviceId/3.1/capture
	app.post(
		"/:deviceId/3.1/capture",
		{
			preHandler: requirePermission(
				"W_CLIENT_CONTROL_PANEL",
				"W_EXTERNAL_CONTROL_PANEL",
			),
			schema: {
				tags: ["cameras"],
				params: CameraDeviceParamsSchema,
				body: CameraCaptureRequestBodySchema,
				response: { 200: MqtxStatusResponseSchema },
			},
		},
		async (request) => {
			const session = await sessionFor(request);
			const params = request.params as { deviceId: string };
			const canWriteExternal = await hasPermission(
				request,
				"W_EXTERNAL_CONTROL_PANEL",
			);
			return requestCameraCapture(
				getDb(),
				app.mqtx,
				params.deviceId,
				session,
				{ canWriteExternal },
				request.body as CaptureRequestInput,
			);
		},
	);

	// POST /v1/cameras/:deviceId/3.1/config
	app.post(
		"/:deviceId/3.1/config",
		{
			preHandler: requirePermission(
				"W_CLIENT_CONTROL_PANEL",
				"W_EXTERNAL_CONTROL_PANEL",
				"W_CLIENT_DEVICES",
				"W_EXTERNAL_DEVICES",
			),
			schema: {
				tags: ["cameras"],
				params: CameraDeviceParamsSchema,
				body: CameraConfigBodySchema,
				response: { 200: MqtxStatusResponseSchema },
			},
		},
		async (request) => {
			const session = await sessionFor(request);
			const params = request.params as { deviceId: string };
			const canWriteExternal =
				(await hasPermission(request, "W_EXTERNAL_CONTROL_PANEL")) ||
				(await hasPermission(request, "W_EXTERNAL_DEVICES"));
			return updateCameraConfig(
				getDb(),
				app.mqtx,
				params.deviceId,
				session,
				{ canWriteExternal },
				request.body as CameraConfigInput,
			);
		},
	);
};

export default cameraRoutes;
