import { Type } from "@sinclair/typebox";

export const HologramSimStateSchema = Type.Union([
	Type.Literal("pause"),
	Type.Literal("resume"),
	Type.Literal("deactivate"),
]);

export const HologramStateParamsSchema = Type.Object({
	deviceId: Type.String({ minLength: 1 }),
	state: HologramSimStateSchema,
});

export const ActivateSimBodySchema = Type.Object({
	iccid: Type.String({ minLength: 1 }),
	boxId: Type.String({ minLength: 1 }),
});

export const ActivateSimResponseSchema = Type.Object({
	status: Type.Integer(),
	message: Type.String(),
	deviceId: Type.Union([Type.Integer(), Type.Null()]),
});

export const HologramPlanResponseSchema = Type.Object({
	status: Type.Integer(),
	planId: Type.Integer(),
});

export const HologramCostsQuerySchema = Type.Object({
	startDate: Type.Optional(Type.String({ format: "date-time" })),
	endDate: Type.Optional(Type.String({ format: "date-time" })),
	limit: Type.Optional(Type.Integer({ minimum: 1 })),
});

export const HologramCostsResponseSchema = Type.Object({
	totalCost: Type.Number(),
	costByDate: Type.Array(
		Type.Object({
			date: Type.String(),
			amount: Type.Number(),
		}),
	),
	service: Type.Object({
		service: Type.String(),
		amount: Type.Number(),
		percentage: Type.Number(),
		color: Type.String(),
		provider: Type.Literal("hologram"),
	}),
});
