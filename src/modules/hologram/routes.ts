import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { requirePermission } from "@/plugins/authorization";
import {
	ActivateSimBodySchema,
	HologramCostsQuerySchema,
	HologramStateParamsSchema,
} from "./schemas";
import {
	HologramRequestFailedError,
	activateHologramSim,
	getHologramCosts,
	getHologramPlan,
	updateHologramDeviceState,
	type ActivateSimInput,
	type HologramCostsInput,
} from "./service";
import type { HologramSimState } from "@/lib/hologram/HologramClient";

const hologramRoutes: FastifyPluginAsyncTypebox = async (app) => {
	app.setErrorHandler((err, _request, reply) => {
		if (err instanceof HologramRequestFailedError) {
			return reply.code(err.statusCode).send({
				error: err.message,
				message: err.message,
			});
		}
		return reply.send(err);
	});

	// PATCH /v1/hologram/:deviceId/:state
	app.patch(
		"/:deviceId/:state",
		{
			preHandler: requirePermission("W_EXTERNAL_DEVICES"),
			schema: { tags: ["hologram"], params: HologramStateParamsSchema },
		},
		async (request, reply) => {
			const params = request.params as { deviceId: string; state: HologramSimState };
			await updateHologramDeviceState(app.hologram, params.deviceId, params.state);
			return reply.code(204).send(null);
		},
	);

	// POST /v1/hologram/activate
	app.post(
		"/activate",
		{
			preHandler: requirePermission("W_EXTERNAL_DEVICES"),
			schema: { tags: ["hologram"], body: ActivateSimBodySchema },
		},
		async (request, reply) => {
			const result = await activateHologramSim(app.hologram, request.body as ActivateSimInput);
			return reply.code(200).send(result);
		},
	);

	// GET /v1/hologram/costs
	app.get(
		"/costs",
		{
			preHandler: requirePermission("R_EXTERNAL_DEVICES"),
			schema: { tags: ["hologram"], querystring: HologramCostsQuerySchema },
		},
		async (request) => getHologramCosts(app.hologram, request.query as HologramCostsInput),
	);

	// GET /v1/hologram/plans
	app.get(
		"/plans",
		{
			preHandler: requirePermission("R_EXTERNAL_DEVICES"),
			schema: { tags: ["hologram"] },
		},
		async () => getHologramPlan(app.hologram),
	);
};

export default hologramRoutes;
