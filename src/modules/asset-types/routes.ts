import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { hasPermission, requirePermission } from "@/plugins/authorization";
import { getSession } from "../auth/service";
import {
	AssetTypeAccessDeniedError,
	AssetTypeClientNotFoundError,
	AssetTypeInUseError,
	AssetTypeNotFoundError,
	createAssetType,
	deleteAssetType,
	listAssetTypes,
	updateAssetType,
	type CreateAssetTypeInput,
	type UpdateAssetTypeInput,
} from "./service";

const assetTypeRoutes: FastifyPluginAsyncTypebox = async (app) => {
	const getDb = () => {
		if (!app.db) throw app.httpErrors.serviceUnavailable("database is not configured");
		return app.db;
	};

	app.setErrorHandler((err, _request, reply) => {
		if (err instanceof AssetTypeNotFoundError) return reply.notFound(err.message);
		if (err instanceof AssetTypeAccessDeniedError) return reply.forbidden(err.message);
		if (err instanceof AssetTypeClientNotFoundError) return reply.badRequest(err.message);
		if (err instanceof AssetTypeInUseError) return reply.conflict(err.message);
		return reply.send(err);
	});

	// GET /v1/asset-types
	app.get(
		"/",
		{
			preHandler: requirePermission("R_CLIENT_REPORTS", "R_EXTERNAL_REPORTS"),
			schema: { tags: ["asset-types"] },
		},
		async (request) => {
			const session = await getSession(request);
			if (!session) throw app.httpErrors.unauthorized("authentication required");

			const canReadExternal = await hasPermission(request, "R_EXTERNAL_REPORTS");
			return { data: await listAssetTypes(getDb(), session, { canReadExternal }) };
		},
	);

	// POST /v1/asset-types
	app.post(
		"/",
		{
			preHandler: requirePermission("W_CLIENT_REPORTS", "W_EXTERNAL_REPORTS"),
			schema: { tags: ["asset-types"] },
		},
		async (request, reply) => {
			const session = await getSession(request);
			if (!session) throw app.httpErrors.unauthorized("authentication required");

			const canWriteExternal = await hasPermission(request, "W_EXTERNAL_REPORTS");
			const assetType = await createAssetType(
				getDb(),
				session,
				{ canWriteExternal },
				request.body as CreateAssetTypeInput,
			);
			return reply.code(201).send(assetType);
		},
	);

	// PATCH /v1/asset-types/:id
	app.patch(
		"/:id",
		{
			preHandler: requirePermission("W_CLIENT_REPORTS", "W_EXTERNAL_REPORTS"),
			schema: { tags: ["asset-types"] },
		},
		async (request) => {
			const session = await getSession(request);
			if (!session) throw app.httpErrors.unauthorized("authentication required");

			const params = request.params as { id: number | string };
			const canWriteExternal = await hasPermission(request, "W_EXTERNAL_REPORTS");
			return updateAssetType(
				getDb(),
				Number(params.id),
				session,
				{ canWriteExternal },
				request.body as UpdateAssetTypeInput,
			);
		},
	);

	// DELETE /v1/asset-types/:id
	app.delete(
		"/:id",
		{
			preHandler: requirePermission("W_CLIENT_REPORTS", "W_EXTERNAL_REPORTS"),
			schema: { tags: ["asset-types"] },
		},
		async (request, reply) => {
			const session = await getSession(request);
			if (!session) throw app.httpErrors.unauthorized("authentication required");

			const params = request.params as { id: number | string };
			const canWriteExternal = await hasPermission(request, "W_EXTERNAL_REPORTS");
			await deleteAssetType(getDb(), Number(params.id), session, { canWriteExternal });
			return reply.code(204).send(null);
		},
	);
};

export default assetTypeRoutes;

