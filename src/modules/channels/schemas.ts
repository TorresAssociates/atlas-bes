import { Type } from "@sinclair/typebox";
import { Nullable } from "@/schemas";

const TimestampSchema = Type.String({ format: "date-time" });
const ArchivedTimestampSchema = Nullable(TimestampSchema);

export const DeviceChannelsParamsSchema = Type.Object({
	deviceId: Type.Integer({ minimum: 1 }),
});

export const ChannelParamsSchema = Type.Object({
	id: Type.Integer({ minimum: 1 }),
});

export const ChannelSchema = Type.Object({
	id: Type.Integer(),
	device_id: Type.Integer(),
	local_id: Type.Integer(),
	channel_type_id: Type.Integer(),
	introduced: TimestampSchema,
	archived: ArchivedTimestampSchema,
});

export const ChannelConfigSchema = Type.Object({
	id: Type.Integer(),
	channel_id: Type.Integer(),
	name: Type.String(),
	active: Type.Boolean(),
	category: Type.String(),
	units: Type.String(),
	scale: Type.Number(),
	offset: Type.Number(),
	introduced: TimestampSchema,
	archived: ArchivedTimestampSchema,
});

export const ChannelConfigDisplaySchema = Type.Object({
	id: Type.Integer(),
	channel_id: Type.Integer(),
	display_index: Type.Integer(),
	introduced: TimestampSchema,
	archived: ArchivedTimestampSchema,
});

export const ChannelConfigInternalPowerSensorSchema = Type.Object({
	id: Type.Integer(),
	channel_id: Type.Integer(),
	measurement_type: Type.Union([
		Type.Literal("voltage"),
		Type.Literal("current"),
		Type.Literal("power"),
	]),
	introduced: TimestampSchema,
	archived: ArchivedTimestampSchema,
});

export const ChannelConfigSdi12Schema = Type.Object({
	id: Type.Integer(),
	channel_id: Type.Integer(),
	address: Type.String(),
	measurement_set: Type.Integer(),
	measurement_index: Type.Integer(),
	introduced: TimestampSchema,
	archived: ArchivedTimestampSchema,
});

export const ChannelConfigAccumulationSchema = Type.Object({
	id: Type.Integer(),
	channel_id: Type.Integer(),
	source_local_id: Type.Integer(),
	drain_const: Type.Number(),
	introduced: TimestampSchema,
	archived: ArchivedTimestampSchema,
});

export const ChannelConfigTiltSchema = Type.Object({
	id: Type.Integer(),
	channel_id: Type.Integer(),
	alignment_x: Nullable(Type.Number()),
	alignment_y: Nullable(Type.Number()),
	alignment_z: Nullable(Type.Number()),
	introduced: TimestampSchema,
	archived: ArchivedTimestampSchema,
});

export const ChannelRecordResponseSchema = Type.Object({
	channel: ChannelSchema,
	channel_config: Nullable(ChannelConfigSchema),
	channel_config_display: Nullable(ChannelConfigDisplaySchema),
	channel_config_internal_power_sensor: Nullable(ChannelConfigInternalPowerSensorSchema),
	channel_config_sdi12: Nullable(ChannelConfigSdi12Schema),
	channel_config_accumulation: Nullable(ChannelConfigAccumulationSchema),
	channel_config_tilt: Nullable(ChannelConfigTiltSchema),
});

export const ChannelListResponseSchema = Type.Object({
	data: Type.Array(ChannelRecordResponseSchema),
});
