import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { Type } from "@sinclair/typebox";
import type { Json } from "@/db/types";
import { getRequestSession, requireSession } from "@/plugins/authorization";
import { HttpErrorSchema } from "@/schemas";
import {
	CreateDataVisPresetBodySchema,
	DataVisPresetIdParamsSchema,
	DataVisPresetSchema,
	PreferenceSchema,
	UpdateDataVisPresetBodySchema,
	UpdatePreferenceBodySchema,
} from "./schemas";
import {
	createOwnDataVisPreset,
	DataVisPresetNotFoundError,
	deleteOwnDataVisPreset,
	getOwnPreferences,
	PreferenceNotFoundError,
	type UpdatePreferenceInput,
	updateOwnDataVisPreset,
	updateOwnPreferences,
} from "./service";

const preferenceRoutes: FastifyPluginAsyncTypebox = async (app) => {
	const getDb = () => {
		if (!app.db) {
			throw app.httpErrors.serviceUnavailable("database is not configured");
		}

		return app.db;
	};

	const optionalString = (value: unknown, field: string): string | null => {
		if (value === null || typeof value === "string") return value;
		throw app.httpErrors.badRequest(`${field} must be a string or null`);
	};

	app.setErrorHandler((err, _request, reply) => {
		if (err instanceof PreferenceNotFoundError) {
			return reply.notFound(err.message);
		}

		if (err instanceof DataVisPresetNotFoundError) {
			return reply.notFound(err.message);
		}

		return reply.send(err);
	});

	// GET /v1/preferences/me
	app.get(
		"/me",
		{
			preHandler: requireSession(),
			schema: {
				tags: ["preferences"],
				response: {
					200: PreferenceSchema,
					401: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getRequestSession(request);
			if (!session) {
				throw app.httpErrors.unauthorized("authentication required");
			}

			return getOwnPreferences(getDb(), session);
		},
	);

	// PATCH /v1/preferences/me
	app.patch(
		"/me",
		{
			preHandler: requireSession(),
			schema: {
				tags: ["preferences"],
				body: UpdatePreferenceBodySchema,
				response: {
					200: PreferenceSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getRequestSession(request);
			if (!session) {
				throw app.httpErrors.unauthorized("authentication required");
			}

			const rawBody = request.body as Record<string, unknown>;
			const body: UpdatePreferenceInput = {};
			if (Object.hasOwn(rawBody, "map_style")) {
				body.map_style = optionalString(rawBody.map_style, "map_style");
			}
			if (Object.hasOwn(rawBody, "layers_on_load")) {
				body.layers_on_load = rawBody.layers_on_load as Json | null;
			}
			if (Object.hasOwn(rawBody, "favorite")) {
				body.favorite = rawBody.favorite as Json | null;
			}
			if (Object.hasOwn(rawBody, "theme")) {
				body.theme = optionalString(rawBody.theme, "theme");
			}

			return updateOwnPreferences(getDb(), session, body);
		},
	);

	// POST /v1/preferences/me/data-vis-presets
	app.post(
		"/me/data-vis-presets",
		{
			preHandler: requireSession(),
			schema: {
				tags: ["preferences"],
				body: CreateDataVisPresetBodySchema,
				response: {
					201: DataVisPresetSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const session = await getRequestSession(request);
			if (!session) {
				throw app.httpErrors.unauthorized("authentication required");
			}

			const preset = await createOwnDataVisPreset(getDb(), session, {
				data: request.body.data as Json,
			});
			return reply.code(201).send(preset);
		},
	);

	// PATCH /v1/preferences/me/data-vis-presets/:id
	app.patch(
		"/me/data-vis-presets/:id",
		{
			preHandler: requireSession(),
			schema: {
				tags: ["preferences"],
				params: DataVisPresetIdParamsSchema,
				body: UpdateDataVisPresetBodySchema,
				response: {
					200: DataVisPresetSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request) => {
			const session = await getRequestSession(request);
			if (!session) {
				throw app.httpErrors.unauthorized("authentication required");
			}

			return updateOwnDataVisPreset(getDb(), session, request.params.id, {
				data: request.body.data as Json,
			});
		},
	);

	// DELETE /v1/preferences/me/data-vis-presets/:id
	app.delete(
		"/me/data-vis-presets/:id",
		{
			preHandler: requireSession(),
			schema: {
				tags: ["preferences"],
				params: DataVisPresetIdParamsSchema,
				response: {
					204: Type.Null(),
					401: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		async (request, reply) => {
			const session = await getRequestSession(request);
			if (!session) {
				throw app.httpErrors.unauthorized("authentication required");
			}

			await deleteOwnDataVisPreset(getDb(), session, request.params.id);
			return reply.code(204).send(null);
		},
	);
};

export default preferenceRoutes;
