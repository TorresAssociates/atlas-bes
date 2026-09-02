import { Type } from "@sinclair/typebox";
import { Nullable } from "@/schemas";

export const SimProviderSchema = Type.Union([Type.Literal("hologram"), Type.Literal("emnify")]);

export const DeviceTypeSchema = Type.Union([
	Type.Literal("gauge"),
	Type.Literal("flasher"),
	Type.Literal("barrier_arm"),
	Type.Literal("camera"),
]);

export const SimParamsSchema = Type.Object({
	iccid: Type.String({ minLength: 1 }),
});

export const CreateSimBodySchema = Type.Object({
	simType: SimProviderSchema,
	iccid: Type.String({ minLength: 1, maxLength: 20 }),
	deviceId: Type.Optional(
		Type.Union([Type.Integer({ minimum: 1 }), Type.String({ minLength: 1 })]),
	),
	bic: Type.Optional(Type.String({ minLength: 1, maxLength: 16 })),
});

export const UpdateSimImeiBodySchema = Type.Object({
	iccid: Type.String({ minLength: 1, maxLength: 20 }),
	imei: Type.String({ minLength: 15, maxLength: 15 }),
});

export const ActivateSimsBodySchema = Type.Object({
	imei: Type.String({ minLength: 15, maxLength: 15 }),
	boxType: DeviceTypeSchema,
	gaugeStationId: Type.String({ minLength: 1 }),
});

export const SimResponseSchema = Type.Object({
	id: Type.Integer(),
	iccid: Type.String(),
	imei: Nullable(Type.String()),
	imsi: Type.Null(),
	simProvider: Type.Object({
		name: Type.String(),
		apn: Nullable(Type.String()),
	}),
	isActivated: Type.Boolean(),
	isPaused: Type.Boolean(),
	boxSerialNumber: Nullable(Type.String()),
	gaugeStationName: Nullable(Type.String()),
	deviceId: Type.Optional(Type.Integer()),
	bic: Type.Optional(Type.String()),
});

export const SimListResponseSchema = Type.Object({
	data: Type.Array(SimResponseSchema),
});

export const CreateSimResponseSchema = Type.Object({
	message: Type.String(),
	usimId: Type.Integer(),
});

export const ActivateSimsResponseSchema = Type.Object({
	message: Type.String(),
	boxId: Type.Integer(),
});
