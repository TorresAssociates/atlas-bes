import { Type } from "@sinclair/typebox";

export const EmnifySimStateSchema = Type.Union([
	Type.Literal("0"),
	Type.Literal("1"),
	Type.Literal("2"),
	Type.Literal("4"),
]);

export const EmnifyStateParamsSchema = Type.Object({
	iccid: Type.String({ minLength: 1 }),
	state: EmnifySimStateSchema,
});

export const ActivateSimBodySchema = Type.Object({
	iccid: Type.String({ minLength: 1 }),
	bic: Type.String({ minLength: 1 }),
	box: Type.Object({
		serialNumber: Type.String({ minLength: 1 }),
		boxTypeId: Type.String({ minLength: 1 }),
	}),
});

export const ActivateSimResponseSchema = Type.Object({
	status: Type.Literal(200),
	message: Type.String(),
});

export const EmnifyCostsQuerySchema = Type.Object({
	startDate: Type.Optional(Type.String({ format: "date-time" })),
	endDate: Type.Optional(Type.String({ format: "date-time" })),
});

export const EmnifyCostsResponseSchema = Type.Object({
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
		provider: Type.Literal("emnify"),
	}),
});
