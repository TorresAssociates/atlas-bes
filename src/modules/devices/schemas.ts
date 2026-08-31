import { Type } from "@sinclair/typebox";
import { Nullable } from "@/schemas";

export const DeviceTypeSchema = Type.Union([
	Type.Literal("barrier_arm"),
	Type.Literal("camera"),
	Type.Literal("datalogger"),
	Type.Literal("flasher"),
]);

export const ProtocolTypeSchema = Type.Union([Type.Literal("mqtt"), Type.Literal("coap")]);

export const DeviceSummarySchema = Type.Object({
	id: Type.Integer(),
	serialNumber: Type.String(),
	type: DeviceTypeSchema,
	gaugeStationId: Nullable(Type.Integer()),
	latitude: Nullable(Type.Number()),
	longitude: Nullable(Type.Number()),
	active: Nullable(Type.Boolean()),
	connected: Nullable(Type.Boolean()),
	riskLevel: Nullable(Type.Number()),
	displayName: Nullable(Type.String()),
});

export const DeviceNetworkingSchema = Type.Object({
	protocol: ProtocolTypeSchema,
	apiVersion: Type.String(),
});

export const DevicePowerSchema = Type.Object({
	minVoltage: Type.Number(),
	maxVoltage: Type.Number(),
});

export const DeviceConnectionQualitySchema = Type.Object({
	minRssi: Nullable(Type.Number()),
	maxRssi: Nullable(Type.Number()),
	minRsrp: Nullable(Type.Number()),
	maxRsrp: Nullable(Type.Number()),
	minRsrq: Nullable(Type.Number()),
	maxRsrq: Nullable(Type.Number()),
});

export const DeviceDataloggingSchema = Type.Object({
	timestep: Type.Integer(),
});

// Only present when type === "camera".
export const DeviceCameraSchema = Type.Object({
	triggerOverride: Nullable(Type.Boolean()),
	triggered: Nullable(Type.Boolean()),
});

// device_sim joined with sim
export const DeviceSimAssignmentSchema = Type.Object({
	simId: Type.Integer(),
	iccid: Type.String(),
	provider: Type.String(),
	simIndex: Nullable(Type.Integer()),
	isActive: Type.Boolean(),
});

// Per-monitor breakdown for the detail view: the monitored channel's latest
// value evaluated against the monitor's current range/gradient config.
export const DeviceRiskLevelSchema = Type.Object({
	monitorId: Type.Integer(),
	channelId: Type.Integer(),
	priority: Type.Integer(),
	measurementDate: Nullable(Type.String({ format: "date-time" })),
	value: Nullable(Type.Number()),
	riskLevel: Nullable(Type.Number()),
});

// --- Detail view -----------------------------------------------------------

export const DeviceDetailSchema = Type.Object({
	...DeviceSummarySchema.properties,
	pageVersion: Nullable(Type.String()),
	activationDate: Nullable(Type.String({ format: "date-time" })),
	warrantyEndDate: Nullable(Type.String({ format: "date-time" })),
	introduced: Type.String({ format: "date-time" }),
	archived: Nullable(Type.String({ format: "date-time" })),
	networking: Nullable(DeviceNetworkingSchema),
	wifiActive: Nullable(Type.Boolean()),
	power: Nullable(DevicePowerSchema),
	datalogging: Nullable(DeviceDataloggingSchema),
	connectionQuality: Nullable(DeviceConnectionQualitySchema),
	camera: Nullable(DeviceCameraSchema),
	sims: Type.Array(DeviceSimAssignmentSchema),
	riskLevels: Type.Array(DeviceRiskLevelSchema),
});

export const DeviceListSchema = Type.Object({
	data: Type.Array(DeviceSummarySchema),
});

// --- Params / querystrings -------------------------------------------------

export const DeviceIdParamsSchema = Type.Object({
	id: Type.Integer({ minimum: 1 }),
});

export const DeviceListQuerySchema = Type.Partial(
	Type.Object({
		gaugeStationId: Type.Integer({ minimum: 1 }),
		type: DeviceTypeSchema,
		active: Type.Boolean(),
		connected: Type.Boolean(),
		includeArchived: Type.Boolean(),
		at: Type.String({ format: "date-time" }),
	}),
);

export const DeviceDetailQuerySchema = Type.Partial(
	Type.Object({
		at: Type.String({ format: "date-time" }),
	}),
);

// --- Write bodies ----------------------------------------------------------

export const UpdateDeviceInfoSchema = Type.Partial(
	Type.Object({
		gaugeStationId: Type.Integer({ minimum: 1 }),
		pageVersion: Type.String({ minLength: 1, maxLength: 16 }),
		activationDate: Type.String({ format: "date-time" }),
		warrantyEndDate: Type.String({ format: "date-time" }),
		latitude: Type.Number({ minimum: -90, maximum: 90 }),
		longitude: Type.Number({ minimum: -180, maximum: 180 }),
		active: Type.Boolean(),
		displayName: Type.Union([Type.Null(), Type.String({ maxLength: 32 })]),
	}),
);

export const UpdateDeviceBodySchema = Type.Partial(
	Type.Object({
		info: UpdateDeviceInfoSchema,
		power: DevicePowerSchema,
	}),
);
