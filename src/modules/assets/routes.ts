import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { getRequestSession, hasPermission, requirePermission } from "@/plugins/authorization";
import {
	AssetAccessDeniedError,
	AssetGaugeStationNotFoundError,
	AssetNotFoundError,
	AssetSerialNumberConflictError,
	AssetTypeNotFoundError,
	type CreateAssetInput,
	createAsset,
	deleteAsset,
	getAsset,
	listAssets,
	type UpdateAssetInput,
	updateAsset,
} from "./service";

const assetRoutes: FastifyPluginAsyncTypebox = async (app) => {
	const getDb = () => {
		if (!app.db) throw app.httpErrors.serviceUnavailable("database is not configured");
		return app.db;
	};

	app.setErrorHandler((err, _request, reply) => {
		if (err instanceof AssetNotFoundError) return reply.notFound(err.message);
		if (err instanceof AssetTypeNotFoundError) return reply.badRequest(err.message);
		if (err instanceof AssetGaugeStationNotFoundError) return reply.badRequest(err.message);
		if (err instanceof AssetAccessDeniedError) return reply.forbidden(err.message);
		if (err instanceof AssetSerialNumberConflictError) return reply.conflict(err.message);
		return reply.send(err);
	});

	// GET /v1/assets
	app.get(
		"/",
		{
			preHandler: requirePermission("R_CLIENT_REPORTS", "R_EXTERNAL_REPORTS"),
			schema: { tags: ["assets"] },
		},
		async (request) => {
			const session = await getRequestSession(request);
			if (!session) throw app.httpErrors.unauthorized("authentication required");

			const canReadExternal = await hasPermission(request, "R_EXTERNAL_REPORTS");
			return { data: await listAssets(getDb(), session, { canReadExternal }) };
		},
	);

	// GET /v1/assets/:id
	app.get(
		"/:id",
		{
			preHandler: requirePermission("R_CLIENT_REPORTS", "R_EXTERNAL_REPORTS"),
			schema: { tags: ["assets"] },
		},
		async (request) => {
			const session = await getRequestSession(request);
			if (!session) throw app.httpErrors.unauthorized("authentication required");

			const params = request.params as { id: number | string };
			const canReadExternal = await hasPermission(request, "R_EXTERNAL_REPORTS");
			return getAsset(getDb(), Number(params.id), session, { canReadExternal });
		},
	);

	// POST /v1/assets
	app.post(
		"/",
		{
			preHandler: requirePermission("W_CLIENT_REPORTS", "W_EXTERNAL_REPORTS"),
			schema: { tags: ["assets"] },
		},
		async (request, reply) => {
			const session = await getRequestSession(request);
			if (!session) throw app.httpErrors.unauthorized("authentication required");

			const canWriteExternal = await hasPermission(request, "W_EXTERNAL_REPORTS");
			const asset = await createAsset(
				getDb(),
				session,
				{ canWriteExternal },
				request.body as CreateAssetInput,
			);
			return reply.code(201).send(asset);
		},
	);

	// PATCH /v1/assets/:id
	app.patch(
		"/:id",
		{
			preHandler: requirePermission("W_CLIENT_REPORTS", "W_EXTERNAL_REPORTS"),
			schema: { tags: ["assets"] },
		},
		async (request) => {
			const session = await getRequestSession(request);
			if (!session) throw app.httpErrors.unauthorized("authentication required");

			const params = request.params as { id: number | string };
			const canWriteExternal = await hasPermission(request, "W_EXTERNAL_REPORTS");
			return updateAsset(
				getDb(),
				Number(params.id),
				session,
				{ canWriteExternal },
				request.body as UpdateAssetInput,
			);
		},
	);

	// DELETE /v1/assets/:id
	app.delete(
		"/:id",
		{
			preHandler: requirePermission("W_CLIENT_REPORTS", "W_EXTERNAL_REPORTS"),
			schema: { tags: ["assets"] },
		},
		async (request, reply) => {
			const session = await getRequestSession(request);
			if (!session) throw app.httpErrors.unauthorized("authentication required");

			const params = request.params as { id: number | string };
			const canWriteExternal = await hasPermission(request, "W_EXTERNAL_REPORTS");
			await deleteAsset(getDb(), Number(params.id), session, { canWriteExternal });
			return reply.code(204).send(null);
		},
	);
};

export default assetRoutes;
