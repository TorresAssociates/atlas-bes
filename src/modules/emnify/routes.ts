import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { EmnifySimState } from "@/lib/emnify/EmnifyClient";
import { requirePermission } from "@/plugins/authorization";
import { ActivateSimBodySchema, EmnifyCostsQuerySchema, EmnifyStateParamsSchema } from "./schemas";
import {
	type ActivateSimInput,
	activateEmnifySim,
	type EmnifyCostsInput,
	EmnifyRequestFailedError,
	getEmnifyCosts,
	updateEmnifySimState,
} from "./service";

const emnifyRoutes: FastifyPluginAsyncTypebox = async (app) => {
	app.setErrorHandler((err, _request, reply) => {
		if (err instanceof EmnifyRequestFailedError) {
			return reply.code(err.statusCode).send({
				error: err.message,
				message: err.message,
				currentState: err.currentState,
				requestedState: err.requestedState,
			});
		}
		return reply.send(err);
	});

	// PATCH /v1/emnify/:iccid/:state
	app.patch(
		"/:iccid/:state",
		{
			preHandler: requirePermission("W_EXTERNAL_DEVICES"),
			schema: { tags: ["emnify"], params: EmnifyStateParamsSchema },
		},
		async (request, reply) => {
			const params = request.params as { iccid: string; state: string };
			await updateEmnifySimState(
				app.emnify,
				params.iccid,
				Number(params.state) as EmnifySimState,
			);
			return reply.code(204).send(null);
		},
	);

	// POST /v1/emnify/activate
	app.post(
		"/activate",
		{
			preHandler: requirePermission("W_EXTERNAL_DEVICES"),
			schema: { tags: ["emnify"], body: ActivateSimBodySchema },
		},
		async (request, reply) => {
			const result = await activateEmnifySim(app.emnify, request.body as ActivateSimInput);
			return reply.code(200).send(result);
		},
	);

	// GET /v1/emnify/costs
	app.get(
		"/costs",
		{
			preHandler: requirePermission("R_EXTERNAL_DEVICES"),
			schema: { tags: ["emnify"], querystring: EmnifyCostsQuerySchema },
		},
		async (request) => getEmnifyCosts(app.emnify, request.query as EmnifyCostsInput),
	);
};

export default emnifyRoutes;
