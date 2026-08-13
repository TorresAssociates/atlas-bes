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

// GET /v1/devices/:id/data
export const DeviceDataSchema = Type.Object({
	deviceId: Type.Integer(),
	from: Type.String({ format: "date-time" }),
	to: Type.String({ format: "date-time" }),
	data: Type.Array(ChannelMeasurementsSchema),
});

// GET /v1/devices/:id/data/latest — served from latest_measurement_record,
export const ChannelLatestSchema = Type.Object({
	channel: ChannelSchema,
	date: Nullable(Type.String({ format: "date-time" })),
	value: Nullable(Type.Number()),
});

export const DeviceLatestDataSchema = Type.Object({
	deviceId: Type.Integer(),
	data: Type.Array(ChannelLatestSchema),
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
		category: Type.String({ minLength: 1, maxLength: 16 }),
		includeInactiveChannels: Type.Boolean(),
	}),
);

export const ChannelListQuerySchema = Type.Partial(
	Type.Object({
		category: Type.String({ minLength: 1, maxLength: 16 }),
		includeInactive: Type.Boolean(),
	}),
);
