import { Type } from "@sinclair/typebox";
import { Nullable } from "@/schemas";

export const ChannelSchema = Type.Object({
	id: Type.Integer(),
	deviceId: Type.Integer(),
	localId: Type.Integer(),
	name: Type.String(),
	category: Type.String(),
	units: Type.String(),
	scale: Type.Number(),
	offset: Type.Number(),
	active: Type.Boolean(),
	displayIndex: Nullable(Type.Integer()),
});

export const MeasurementPointSchema = Type.Object({
	date: Type.String({ format: "date-time" }),
	value: Nullable(Type.Number()),
});

export const ChannelMeasurementsSchema = Type.Object({
	channel: ChannelSchema,
	measurements: Type.Array(MeasurementPointSchema),
});

// `truncated` is true when the server-side point cap cut the result short;
// callers should narrow the window (or filter channels) to get complete data.

// GET /v1/devices/:id/data
export const DeviceDataSchema = Type.Object({
	deviceId: Type.Integer(),
	from: Type.String({ format: "date-time" }),
	to: Type.String({ format: "date-time" }),
	truncated: Type.Boolean(),
	data: Type.Array(ChannelMeasurementsSchema),
});

// GET /v1/devices/data
export const BulkDeviceDataSchema = Type.Object({
	from: Type.String({ format: "date-time" }),
	to: Type.String({ format: "date-time" }),
	truncated: Type.Boolean(),
	devices: Type.Array(
		Type.Object({
			deviceId: Type.Integer(),
			data: Type.Array(ChannelMeasurementsSchema),
		}),
	),
});

// GET /v1/devices/:id/data/latest — served from measurement_record_latest,
export const ChannelLatestSchema = Type.Object({
	channel: ChannelSchema,
	date: Nullable(Type.String({ format: "date-time" })),
	value: Nullable(Type.Number()),
});

export const DeviceLatestDataSchema = Type.Object({
	deviceId: Type.Integer(),
	data: Type.Array(ChannelLatestSchema),
});

// GET /v1/devices/data/latest
export const BulkDeviceLatestDataSchema = Type.Object({
	devices: Type.Array(DeviceLatestDataSchema),
});

// --- Params / querystrings -------------------------------------------------

export const DeviceIdParamsSchema = Type.Object({
	id: Type.Integer({ minimum: 1 }),
});

// Window defaults resolved in the service: to = now, from = to - 24h.
// from < to is validated at runtime
export const DeviceDataQuerySchema = Type.Partial(
	Type.Object({
		from: Type.String({ format: "date-time" }),
		to: Type.String({ format: "date-time" }),
		channelId: Type.Integer({ minimum: 1 }),
		// channel_config.category is VARCHAR(32); 16 rejected valid values
		// like 'precipitation_increment' (23 chars).
		category: Type.String({ minLength: 1, maxLength: 32 }),
		includeInactiveChannels: Type.Boolean(),
	}),
);

// Repeated query param: ?deviceIds=1&deviceIds=2 (a single ?deviceIds=1 is
// coerced to a one-element array by Ajv).
export const BulkDeviceDataQuerySchema = Type.Composite([
	Type.Object({
		deviceIds: Type.Array(Type.Integer({ minimum: 1 }), { minItems: 1, maxItems: 100 }),
	}),
	DeviceDataQuerySchema,
]);

export const ChannelListQuerySchema = Type.Partial(
	Type.Object({
		category: Type.String({ minLength: 1, maxLength: 32 }),
		includeInactive: Type.Boolean(),
	}),
);

// Repeated query param: ?deviceIds=1&deviceIds=2 (a single ?deviceIds=1 is
// coerced to a one-element array by Ajv).
export const BulkDeviceLatestDataQuerySchema = Type.Composite([
	Type.Object({
		deviceIds: Type.Array(Type.Integer({ minimum: 1 }), { minItems: 1, maxItems: 100 }),
	}),
	ChannelListQuerySchema,
]);
