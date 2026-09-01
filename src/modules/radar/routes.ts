import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { requireSession } from "@/plugins/authorization";
import { HttpErrorSchema } from "@/schemas";
import { RadarSnapshotResponseSchema } from "./schemas";
import { getRadarSnapshot, RadarRequestFailedError } from "./service";

const radarRoutes: FastifyPluginAsyncTypebox = async (app) => {
	app.setErrorHandler((err, _request, reply) => {
		if (err instanceof RadarRequestFailedError) {
			return reply.code(err.statusCode).send({
				statusCode: err.statusCode,
				error: "Radar Request Failed",
				message: err.message,
			});
		}
		return reply.send(err);
	});

	// GET /v1/radar/snapshot
	app.get(
		"/snapshot",
		{
			preHandler: requireSession(),
			schema: {
				tags: ["radar"],
				response: {
					200: RadarSnapshotResponseSchema,
					401: HttpErrorSchema,
					500: HttpErrorSchema,
					502: HttpErrorSchema,
				},
			},
		},
		async (_request, reply) => {
			const result = await getRadarSnapshot(app.rainbow);
			// Per-browser cache aligned with the server-side TTL; "private"
			// because responses ride an authenticated CORS request.
			reply.header("cache-control", "private, max-age=30");
			return result;
		},
	);
};

export default radarRoutes;
