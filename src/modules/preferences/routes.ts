import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { Json } from "@/db/types";
import { requireSession } from "@/plugins/authorization";
import { HttpErrorSchema } from "@/schemas";
import { getSession } from "../auth/service";
import { PreferenceSchema, UpdatePreferenceBodySchema } from "./schemas";
import {
	getOwnPreferences,
	PreferenceNotFoundError,
	updateOwnPreferences,
	type UpdatePreferenceInput,
} from "./service";

const preferenceRoutes: FastifyPluginAsyncTypebox = async (app) => {
	const getDb = () => {
		if (!app.db) {
			throw app.httpErrors.serviceUnavailable(
				"database is not configured",
			);
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
			const session = await getSession(request);
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
			const session = await getSession(request);
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
			if (Object.hasOwn(rawBody, "data_vis_preset")) {
				body.data_vis_preset = rawBody.data_vis_preset as Json | null;
			}

			return updateOwnPreferences(getDb(), session, body);
		},
	);
};

export default preferenceRoutes;
