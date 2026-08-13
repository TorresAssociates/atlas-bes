import { Type } from "@sinclair/typebox";
import { Nullable } from "@/schemas";

const TimestampSchema = Type.String({ format: "date-time" });
const ArchivedTimestampSchema = Nullable(TimestampSchema);

export const AlertMonitorSchema = Type.Object({
	id: Type.Integer(),
	device_id: Type.Integer(),
	local_id: Type.Integer(),
	type_id: Type.Integer(),
	introduced: TimestampSchema,
	archived: ArchivedTimestampSchema,
});

export const AlertMonitorConfigSchema = Type.Object({
	id: Type.Integer(),
	alert_monitor_id: Type.Integer(),
	alert_id: Type.Integer(),
	introduced: TimestampSchema,
	archived: ArchivedTimestampSchema,
});

export const AlertMonitorConfigActivitySchema = Type.Object({
	id: Type.Integer(),
	alert_monitor_id: Type.Integer(),
	active: Type.Boolean(),
	introduced: TimestampSchema,
	archived: ArchivedTimestampSchema,
});

export const AlertMonitorConfigActivityOverrideSchema = Type.Object({
	id: Type.Integer(),
	alert_monitor_id: Type.Integer(),
	override: Type.Union([Type.Null(), Type.Boolean()]),
	introduced: TimestampSchema,
	archived: ArchivedTimestampSchema,
});

export const ChannelAlertMonitorSchema = Type.Object({
	id: Type.Integer(),
	alert_monitor_id: Type.Integer(),
	channel_id: Type.Integer(),
	introduced: TimestampSchema,
	archived: ArchivedTimestampSchema,
});

export const AlertMonitorConfigRangeSchema = Type.Object({
	id: Type.Integer(),
	alert_monitor_id: Type.Integer(),
	min_value: Type.Number(),
	max_value: Type.Number(),
	introduced: TimestampSchema,
	archived: ArchivedTimestampSchema,
});

export const AlertMonitorRecordSchema = Type.Object({
	alert_monitor: AlertMonitorSchema,
	configs: Type.Array(AlertMonitorConfigSchema),
	activities: Type.Array(AlertMonitorConfigActivitySchema),
	activity_overrides: Type.Array(AlertMonitorConfigActivityOverrideSchema),
	channel_links: Type.Array(ChannelAlertMonitorSchema),
	ranges: Type.Array(AlertMonitorConfigRangeSchema),
});

export const AlertMonitorStatusSchema = Type.Object({
	alert_monitor_id: Type.Integer(),
	device_id: Type.Integer(),
	local_id: Type.Integer(),
	type_id: Type.Integer(),
	alert_id: Type.Integer(),
	active: Type.Boolean(),
	override: Type.Union([Type.Null(), Type.Boolean()]),
	channel_id: Type.Integer(),
	range: Type.Union([
		Type.Null(),
		Type.Object({
			id: Type.Integer(),
			min_value: Type.Number(),
			max_value: Type.Number(),
		}),
	]),
	latest_measurement_record: Type.Union([
		Type.Null(),
		Type.Object({
			id: Type.String(),
			date: TimestampSchema,
			value: Nullable(Type.Number()),
		}),
	]),
	gauge_station: Type.Object({
		id: Type.Integer(),
		name: Type.String(),
		location: Type.String(),
	}),
});

export const AlertMonitorListSchema = Type.Object({
	data: Type.Array(AlertMonitorRecordSchema),
});
export const AlertMonitorStatusListSchema = Type.Object({
	data: Type.Array(AlertMonitorStatusSchema),
});
export const AlertMonitorConfigListSchema = Type.Object({
	data: Type.Array(AlertMonitorConfigSchema),
});
export const AlertMonitorConfigActivityListSchema = Type.Object({
	data: Type.Array(AlertMonitorConfigActivitySchema),
});
export const AlertMonitorConfigActivityOverrideListSchema = Type.Object({
	data: Type.Array(AlertMonitorConfigActivityOverrideSchema),
});
export const ChannelAlertMonitorListSchema = Type.Object({
	data: Type.Array(ChannelAlertMonitorSchema),
});
export const AlertMonitorConfigRangeListSchema = Type.Object({
	data: Type.Array(AlertMonitorConfigRangeSchema),
});

export const CreateAlertMonitorBodySchema = Type.Object({
	device_id: Type.Integer({ minimum: 1 }),
	local_id: Type.Integer({ minimum: 0, maximum: 254 }),
	type_id: Type.Integer({ minimum: 1 }),
});

export const CreateAlertMonitorConfigBodySchema = Type.Object({
	alert_monitor_id: Type.Integer({ minimum: 1 }),
	alert_id: Type.Integer({ minimum: 1 }),
});

export const CreateAlertMonitorConfigActivityBodySchema = Type.Object({
	alert_monitor_id: Type.Integer({ minimum: 1 }),
	active: Type.Boolean(),
});

export const CreateAlertMonitorConfigActivityOverrideBodySchema = Type.Object({
	alert_monitor_id: Type.Integer({ minimum: 1 }),
	override: Type.Union([Type.Null(), Type.Boolean()]),
});

export const CreateChannelAlertMonitorBodySchema = Type.Object({
	alert_monitor_id: Type.Integer({ minimum: 1 }),
	channel_id: Type.Integer({ minimum: 1 }),
});

export const CreateAlertMonitorConfigRangeBodySchema = Type.Object({
	alert_monitor_id: Type.Integer({ minimum: 1 }),
	min_value: Type.Number(),
	max_value: Type.Number(),
});
