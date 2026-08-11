import { Type } from "@sinclair/typebox";
import { Nullable } from "@/schemas";

export const AlertSubscriptionUserParamsSchema = Type.Object({
	userId: Type.String({ minLength: 1 }),
});

export const DeleteGaugeAlertSubscriptionQuerySchema = Type.Object({
	gaugeSubscriptionId: Type.Optional(Type.Integer({ minimum: 1 })),
});

export const DeleteDeviceAlertSubscriptionQuerySchema = Type.Object({
	gaugeStationSubscriptionId: Type.Optional(Type.Integer({ minimum: 1 })),
});

export const AlertSubscriptionSchema = Type.Object({
	id: Type.Integer(),
	user_id: Type.String(),
	gauge_station_id: Type.Integer(),
	alert_id: Type.Integer(),
	notification_type: Type.Union([Type.Literal("sms"), Type.Literal("email")]),
	introduced: Type.String({ format: "date-time" }),
	archived: Nullable(Type.String({ format: "date-time" })),
});

export const AlertSubscriptionDetailSchema = Type.Intersect([
	AlertSubscriptionSchema,
	Type.Object({
		alert_type: Type.String(),
		alert_level: Type.Union([
			Type.Literal("gauge_station"),
			Type.Literal("device"),
		]),
		client_id: Type.Integer(),
		gauge_station_name: Type.String(),
	}),
]);

export const AlertSubscriptionListSchema = Type.Object({
	data: Type.Array(AlertSubscriptionDetailSchema),
});

export const AlertSubscriptionDeleteSchema = Type.Object({
	message: Type.String(),
	data: Type.Array(AlertSubscriptionSchema),
});

export const GaugeAlertSubscriptionBodySchema = Type.Object({
	gauge_station_id: Type.Optional(Type.Integer({ minimum: 1 })),
	gauge_station_name: Type.Optional(Type.String({ minLength: 1 })),
	alert_type: Type.String({ minLength: 1, maxLength: 16 }),
	notification_type: Type.Optional(
		Type.Union([Type.Literal("sms"), Type.Literal("email")]),
	),
});

export const DeviceAlertSubscriptionBodySchema = Type.Object({
	device_id: Type.Optional(Type.Integer({ minimum: 1 })),
	serial_number: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
	alert_type: Type.String({ minLength: 1, maxLength: 16 }),
	notification_type: Type.Optional(
		Type.Union([Type.Literal("sms"), Type.Literal("email")]),
	),
});

export const SendTestAlertMessageResponseSchema = Type.Object({
	message: Type.String(),
	topic: Type.String(),
	message_id: Nullable(Type.String()),
});

export const TestAlertSubscriptionBodySchema = Type.Object({
	phone_number: Type.String({ minLength: 1, maxLength: 32 }),
});

export const TestAlertSubscriptionResponseSchema = Type.Object({
	message: Type.String(),
	topic: Type.String(),
	phone_number: Type.String(),
});
