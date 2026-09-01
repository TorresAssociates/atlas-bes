import { Type } from "@sinclair/typebox";
import { Nullable } from "@/schemas";

const TimestampSchema = Type.String({ format: "date-time" });
const ArchivedTimestampSchema = Nullable(TimestampSchema);
const BigIntIdSchema = Type.String();

export const CameraDeviceParamsSchema = Type.Object({
	deviceId: Type.String({ minLength: 1 }),
});

export const CameraImageMetadataQuerySchema = Type.Object({
	path: Type.String({ minLength: 1 }),
});

export const CameraSchema = Type.Object({
	id: Type.Integer(),
	device_id: Type.Integer(),
	local_id: Type.Integer(),
	introduced: TimestampSchema,
	archived: ArchivedTimestampSchema,
	device_serial_number: Type.String(),
	gauge_station_id: Type.Integer(),
	gauge_name: Nullable(Type.String()),
	gauge_location: Nullable(Type.String()),
	city_id: Nullable(Type.Integer()),
	city_name: Nullable(Type.String()),
	page_version: Nullable(Type.String()),
	latitude: Nullable(Type.Number()),
	longitude: Nullable(Type.Number()),
	active: Nullable(Type.Boolean()),
});

export const CameraConfigSchema = Type.Object({
	id: Type.Integer(),
	camera_id: Type.Integer(),
	pan: Nullable(Type.Number()),
	tilt: Nullable(Type.Number()),
	zoom: Nullable(Type.Number()),
	selected_preset: Type.Integer(),
	boot_time_delay: Type.Integer(),
	check_in_time: Nullable(Type.String()),
	introduced: TimestampSchema,
	archived: ArchivedTimestampSchema,
});

export const CameraConfigPresetSchema = Type.Object({
	id: Type.Integer(),
	camera_id: Type.Integer(),
	local_preset_id: Type.Integer(),
	pan: Type.Number(),
	tilt: Type.Number(),
	zoom: Type.Number(),
	introduced: TimestampSchema,
	archived: ArchivedTimestampSchema,
});

export const CameraConfigRotationSchema = Type.Object({
	id: Type.Integer(),
	camera_id: Type.Integer(),
	rotation: Type.Number(),
	introduced: TimestampSchema,
	archived: ArchivedTimestampSchema,
});

export const CameraResponseSchema = Type.Object({
	camera: CameraSchema,
	camera_config: Nullable(CameraConfigSchema),
	camera_config_presets: Type.Array(CameraConfigPresetSchema),
	camera_config_rotation: Nullable(CameraConfigRotationSchema),
});

export const CameraListResponseSchema = Type.Object({
	data: Type.Array(CameraResponseSchema),
});

export const CameraCaptureSchema = Type.Object({
	id: Type.Integer(),
	camera_data_record_id: BigIntIdSchema,
	path: Type.String(),
	file_type: Type.String(),
	is_tagged: Type.Boolean(),
	date: TimestampSchema,
	camera_id: Type.Integer(),
	device_id: Type.Integer(),
	device_serial_number: Type.String(),
});

export const CameraDetectionSchema = Type.Object({
	id: Type.Integer(),
	camera_data_record_id: BigIntIdSchema,
	object: Type.String(),
	present_duration: Type.Number(),
	confidence: Type.Number(),
	stalled: Type.Boolean(),
	water_level: Type.Number(),
});

export const CameraDataRecordSchema = Type.Object({
	id: BigIntIdSchema,
	date: TimestampSchema,
	camera_id: Type.Integer(),
});

export const CameraDataRecordResponseSchema = Type.Object({
	record: CameraDataRecordSchema,
	captures: Type.Array(CameraCaptureSchema),
	detections: Type.Array(CameraDetectionSchema),
});

export const CameraDataListResponseSchema = Type.Object({
	data: Type.Array(CameraDataRecordResponseSchema),
});

export const CameraCaptureListResponseSchema = Type.Object({
	data: Type.Array(CameraCaptureSchema),
});

export const CaptureFormatSchema = Type.Object({
	type: Type.Integer({ minimum: 0, maximum: 2 }),
	duration: Type.Optional(Type.Integer({ minimum: 1 })),
});

export const CameraCaptureRequestBodySchema = Type.Object({
	annotate: Type.Integer({ minimum: 0, maximum: 2 }),
	format: CaptureFormatSchema,
});

export const CameraConfigBodySchema = Type.Record(Type.String(), Type.Unknown());

export const MqtxStatusResponseSchema = Type.Object({
	message: Type.String(),
	status: Type.Integer(),
});
