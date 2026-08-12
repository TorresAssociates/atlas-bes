import { Type } from "@sinclair/typebox";

export const MqtxParamsSchema = Type.Object({
	deviceId: Type.String({ minLength: 1 }),
});

export const ControlBodySchema = Type.Object({
	controlType: Type.Union([
		Type.Literal("wifi"),
		Type.Literal("override"),
		Type.Literal("overtop"),
		Type.Literal("manualMeasurement"),
		Type.Literal("ping"),
	]),
	version: Type.Optional(Type.String({ minLength: 1 })),
	requestedState: Type.Optional(Type.Boolean()),
	measurementCodes: Type.Optional(Type.Array(Type.String())),
});

export const AlertsSettingsBodySchema = Type.Object({
	monitoredCodes: Type.Union([
		Type.Array(Type.Unknown()),
		Type.Record(Type.String(), Type.Unknown()),
	]),
	alertCodes: Type.Optional(Type.Array(Type.Unknown())),
	version: Type.Optional(Type.String({ minLength: 1 })),
});

export const DataSettingsChannelSchema = Type.Object({
	localChannelId: Type.Integer(),
	channelName: Type.String(),
	isActive: Type.Boolean(),
	channelCodeId: Type.String(),
	units: Type.String(),
	displayIndex: Type.Optional(Type.Integer()),
	channelTimestep: Type.Optional(Type.Integer()),
	channelTypeId: Type.Integer(),
});

export const DataSettingsBodySchema = Type.Object({
	timestep: Type.Optional(Type.Integer({ minimum: 1 })),
	minTimestep: Type.Optional(Type.Integer({ minimum: 1 })),
	channels: Type.Optional(Type.Array(DataSettingsChannelSchema)),
	version: Type.Optional(Type.String({ minLength: 1 })),
});

export const GeneralSettingsBodySchema = Type.Object({
	active: Type.Optional(Type.Boolean()),
	wifiEnabled: Type.Optional(Type.Boolean()),
	wifiPassword: Type.Optional(Type.String({ minLength: 1 })),
	version: Type.Optional(Type.String({ minLength: 1 })),
});

export const PowerSettingsBodySchema = Type.Object({
	min: Type.Optional(Type.Number()),
	max: Type.Optional(Type.Number()),
});

export const ControlResponseSchema = Type.Object({ success: Type.Boolean() });
export const MqtxSuccessResponseSchema = Type.Object({
	message: Type.String(),
	status: Type.Integer(),
});
