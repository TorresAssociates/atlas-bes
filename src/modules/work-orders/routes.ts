import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import type { FastifyRequest } from "fastify";
import { getRequestSession, hasPermission, requirePermission } from "@/plugins/authorization";
import { HttpErrorSchema } from "@/schemas";
import {
	CreateWorkOrderBodySchema,
	CreateWorkOrderUpdateBodySchema,
	CreateWorkOrderUpdateImageBodySchema,
	IncidentCategoryListSchema,
	IncidentTypeListSchema,
	UpdateWorkOrderBodySchema,
	WorkOrderIdParamsSchema,
	WorkOrderListSchema,
	WorkOrderSchema,
	WorkOrderStatusListSchema,
	WorkOrderUpdateImageListSchema,
	WorkOrderUpdateImageSchema,
	WorkOrderUpdateListSchema,
	WorkOrderUpdateSchema,
} from "./schemas";
import {
	type CreateWorkOrderInput,
	type CreateWorkOrderUpdateImageInput,
	type CreateWorkOrderUpdateInput,
	createWorkOrder,
	createWorkOrderUpdate,
	createWorkOrderUpdateImage,
	deleteWorkOrder,
	getWorkOrder,
	listIncidentCategories,
	listIncidentTypes,
	listWorkOrderStatuses,
	listWorkOrders,
	listWorkOrderUpdateImages,
	listWorkOrderUpdates,
	type UpdateWorkOrderInput,
	updateWorkOrder,
	WorkOrderDeviceNotFoundError,
	WorkOrderIncidentTypeNotFoundError,
	WorkOrderInUseError,
	WorkOrderNotFoundError,
	WorkOrderStatusNotFoundError,
	WorkOrderUpdateNotFoundError,
} from "./service";

const workOrderRoutes: FastifyPluginAsyncTypebox = async (app) => {
	const getDb = () => {
		if (!app.db) throw app.httpErrors.serviceUnavailable("database is not configured");
		return app.db;
	};

	app.setErrorHandler((err, _request, reply) => {
		if (err instanceof WorkOrderNotFoundError) return reply.notFound(err.message);
		if (err instanceof WorkOrderUpdateNotFoundError) return reply.notFound(err.message);
		if (err instanceof WorkOrderDeviceNotFoundError) return reply.badRequest(err.message);
		if (err instanceof WorkOrderIncidentTypeNotFoundError) return reply.badRequest(err.message);
		if (err instanceof WorkOrderStatusNotFoundError) return reply.badRequest(err.message);
		if (err instanceof WorkOrderInUseError) return reply.conflict(err.message);
		return reply.send(err);
	});

	async function sessionFor(request: FastifyRequest) {
		const session = await getRequestSession(request);
		if (!session) throw app.httpErrors.unauthorized("authentication required");
		return session;
	}

	// GET /v1/work-orders/statuses
	app.get(
		"/statuses",
		{
			preHandler: requirePermission("R_CLIENT_REPORTS", "R_EXTERNAL_REPORTS"),
			schema: {
				tags: ["work-orders"],
				response: {
					200: WorkOrderStatusListSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		async () => ({ data: await listWorkOrderStatuses(getDb()) }),
	);

	// GET /v1/work-orders/incident-categories
	app.get(
		"/incident-categories",
		{
			preHandler: requirePermission("R_CLIENT_REPORTS", "R_EXTERNAL_REPORTS"),
			schema: {
				tags: ["work-orders"],
				response: {
					200: IncidentCategoryListSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		async () => ({ data: await listIncidentCategories(getDb()) }),
	);

	// GET /v1/work-orders/incident-types
	app.get(
		"/incident-types",
		{
			preHandler: requirePermission("R_CLIENT_REPORTS", "R_EXTERNAL_REPORTS"),
			schema: {
				tags: ["work-orders"],
				response: {
					200: IncidentTypeListSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		async () => ({ data: await listIncidentTypes(getDb()) }),
	);

	// GET /v1/work-orders
	app.get(
		"/",
		{
			preHandler: requirePermission("R_CLIENT_REPORTS", "R_EXTERNAL_REPORTS"),
			schema: {
				tags: ["work-orders"],
				response: {
					200: WorkOrderListSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await sessionFor(request);
			const canReadExternal = await hasPermission(request, "R_EXTERNAL_REPORTS");
			return {
				data: await listWorkOrders(getDb(), session, {
					canReadExternal,
				}),
			};
		},
	);

	// POST /v1/work-orders
	app.post(
		"/",
		{
			preHandler: requirePermission("W_CLIENT_REPORTS", "W_EXTERNAL_REPORTS"),
			schema: {
				tags: ["work-orders"],
				body: CreateWorkOrderBodySchema,
				response: {
					201: WorkOrderSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const session = await sessionFor(request);
			const canWriteExternal = await hasPermission(request, "W_EXTERNAL_REPORTS");
			const workOrder = await createWorkOrder(
				getDb(),
				session,
				{ canWriteExternal },
				request.body as CreateWorkOrderInput,
			);
			return reply.code(201).send(workOrder);
		},
	);

	// GET /v1/work-orders/:id/updates
	app.get(
		"/:id/updates",
		{
			preHandler: requirePermission("R_CLIENT_REPORTS", "R_EXTERNAL_REPORTS"),
			schema: {
				tags: ["work-orders"],
				params: WorkOrderIdParamsSchema,
				response: {
					200: WorkOrderUpdateListSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await sessionFor(request);
			const params = request.params;
			const canReadExternal = await hasPermission(request, "R_EXTERNAL_REPORTS");
			return {
				data: await listWorkOrderUpdates(getDb(), Number(params.id), session, {
					canReadExternal,
				}),
			};
		},
	);

	// POST /v1/work-orders/:id/updates
	app.post(
		"/:id/updates",
		{
			preHandler: requirePermission("W_CLIENT_REPORTS", "W_EXTERNAL_REPORTS"),
			schema: {
				tags: ["work-orders"],
				params: WorkOrderIdParamsSchema,
				body: CreateWorkOrderUpdateBodySchema,
				response: {
					201: WorkOrderUpdateSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const session = await sessionFor(request);
			const params = request.params;
			const canWriteExternal = await hasPermission(request, "W_EXTERNAL_REPORTS");
			const update = await createWorkOrderUpdate(
				getDb(),
				Number(params.id),
				session,
				{ canWriteExternal },
				request.body as CreateWorkOrderUpdateInput,
			);
			return reply.code(201).send(update);
		},
	);

	// GET /v1/work-orders/:id/images
	app.get(
		"/:id/images",
		{
			preHandler: requirePermission("R_CLIENT_REPORTS", "R_EXTERNAL_REPORTS"),
			schema: {
				tags: ["work-orders"],
				params: WorkOrderIdParamsSchema,
				response: {
					200: WorkOrderUpdateImageListSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await sessionFor(request);
			const params = request.params;
			const canReadExternal = await hasPermission(request, "R_EXTERNAL_REPORTS");
			return listWorkOrderUpdateImages(getDb(), Number(params.id), session, {
				canReadExternal,
			});
		},
	);

	// POST /v1/work-orders/:id/images
	app.post(
		"/:id/images",
		{
			preHandler: requirePermission("W_CLIENT_REPORTS", "W_EXTERNAL_REPORTS"),
			schema: {
				tags: ["work-orders"],
				params: WorkOrderIdParamsSchema,
				body: CreateWorkOrderUpdateImageBodySchema,
				response: {
					201: WorkOrderUpdateImageSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const session = await sessionFor(request);
			const params = request.params;
			const canWriteExternal = await hasPermission(request, "W_EXTERNAL_REPORTS");
			const image = await createWorkOrderUpdateImage(
				getDb(),
				Number(params.id),
				session,
				{ canWriteExternal },
				request.body as CreateWorkOrderUpdateImageInput,
			);
			return reply.code(201).send(image);
		},
	);

	// GET /v1/work-orders/:id
	app.get(
		"/:id",
		{
			preHandler: requirePermission("R_CLIENT_REPORTS", "R_EXTERNAL_REPORTS"),
			schema: {
				tags: ["work-orders"],
				params: WorkOrderIdParamsSchema,
				response: {
					200: WorkOrderSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await sessionFor(request);
			const params = request.params;
			const canReadExternal = await hasPermission(request, "R_EXTERNAL_REPORTS");
			return getWorkOrder(getDb(), Number(params.id), session, {
				canReadExternal,
			});
		},
	);

	// PATCH /v1/work-orders/:id
	app.patch(
		"/:id",
		{
			preHandler: requirePermission("W_CLIENT_REPORTS", "W_EXTERNAL_REPORTS"),
			schema: {
				tags: ["work-orders"],
				params: WorkOrderIdParamsSchema,
				body: UpdateWorkOrderBodySchema,
				response: {
					200: WorkOrderSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await sessionFor(request);
			const params = request.params;
			const canWriteExternal = await hasPermission(request, "W_EXTERNAL_REPORTS");
			return updateWorkOrder(
				getDb(),
				Number(params.id),
				session,
				{ canWriteExternal },
				request.body as UpdateWorkOrderInput,
			);
		},
	);

	// DELETE /v1/work-orders/:id
	app.delete(
		"/:id",
		{
			preHandler: requirePermission("W_CLIENT_REPORTS", "W_EXTERNAL_REPORTS"),
			schema: {
				tags: ["work-orders"],
				params: WorkOrderIdParamsSchema,
				response: {
					204: Type.Null(),
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
					409: HttpErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const session = await sessionFor(request);
			const params = request.params;
			const canWriteExternal = await hasPermission(request, "W_EXTERNAL_REPORTS");
			await deleteWorkOrder(getDb(), Number(params.id), session, {
				canWriteExternal,
			});
			return reply.code(204).send(null);
		},
	);
};

export default workOrderRoutes;
