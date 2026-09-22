import type { Kysely, Selectable } from "kysely";
import type { DB } from "@/db/types";

export type CameraRow = Selectable<DB["camera"]>;
export type CameraConfigRow = Selectable<DB["camera_config"]>;
export type CameraConfigPresetRow = Selectable<DB["camera_config_preset"]>;
export type CameraConfigRotationRow = Selectable<DB["camera_config_rotation"]>;
export type CameraDataRecordRow = Selectable<DB["camera_data_record"]>;
export type CameraCaptureDataRow = Selectable<DB["camera_capture_data"]>;
export type CameraDetectionDataRow = Selectable<DB["camera_detection_data"]>;

export interface CameraDeviceRow extends CameraRow {
	device_serial_number: string;
	gauge_station_id: number;
	gauge_station_name: string | null;
	gauge_station_location: string | null;
	city_id: number | null;
	city_name: string | null;
	page_version: string | null;
	latitude: number | null;
	longitude: number | null;
	active: boolean | null;
}

export interface CameraCaptureEntryRow extends CameraCaptureDataRow {
	date: Date | string;
	camera_id: number;
	device_id: number;
	device_serial_number: string;
}

const cameraColumns = [
	"camera.id",
	"camera.device_id",
	"camera.local_id",
	"camera.introduced",
	"camera.archived",
] as const;

const cameraDeviceColumns = [
	...cameraColumns,
	"device.serial_number as device_serial_number",
	"device_info.gauge_station_id",
	"gauge_station.name as gauge_station_name",
	"gauge_station_info.location as gauge_station_location",
	"city.id as city_id",
	"city.name as city_name",
	"device_info.page_version",
	"device_info.latitude",
	"device_info.longitude",
	"device_info.active",
] as const;

const cameraConfigColumns = [
	"id",
	"camera_id",
	"pan",
	"tilt",
	"zoom",
	"selected_preset",
	"boot_time_delay",
	"check_in_time",
	"introduced",
	"archived",
] as const;
const presetColumns = [
	"id",
	"camera_id",
	"local_preset_id",
	"pan",
	"tilt",
	"zoom",
	"introduced",
	"archived",
] as const;
const rotationColumns = ["id", "camera_id", "rotation", "introduced", "archived"] as const;
const dataRecordColumns = ["id", "date", "camera_id"] as const;
const captureColumns = ["id", "camera_data_record_id", "path", "file_type", "is_tagged"] as const;
const detectionColumns = [
	"id",
	"camera_data_record_id",
	"object",
	"present_duration",
	"confidence",
	"stalled",
	"water_level",
] as const;

function cameraDeviceBase(db: Kysely<DB>) {
	return (
		db
			.selectFrom("camera")
			.innerJoin("device", "device.id", "camera.device_id")
			.innerJoin("device_info", "device_info.device_id", "device.id")
			.innerJoin("gauge_station", "gauge_station.id", "device_info.gauge_station_id")
			.leftJoin("gauge_station_info", (join) =>
				join
					.onRef("gauge_station_info.gauge_station_id", "=", "gauge_station.id")
					.on("gauge_station_info.archived", "is", null),
			)
			.leftJoin("city", "city.id", "gauge_station_info.city_id")
			.select(cameraDeviceColumns)
			.distinct()
			.where("camera.archived", "is", null)
			.where("device.archived", "is", null)
			.where("device_info.archived", "is", null)
			.where("device_info.type", "=", "camera")
			.where("gauge_station.archived", "is", null)
			// The camera table has no unique constraint on (device_id, local_id), and
			// production carries duplicate rows for the same physical camera. Treat the
			// newest active row as canonical so a device resolves to exactly one camera.
			.where(({ not, exists, selectFrom }) =>
				not(
					exists(
						selectFrom("camera as newer")
							.select("newer.id")
							.whereRef("newer.device_id", "=", "camera.device_id")
							.whereRef("newer.local_id", "=", "camera.local_id")
							.whereRef("newer.id", ">", "camera.id")
							.where("newer.archived", "is", null),
					),
				),
			)
	);
}

/**
 * Identifies one physical camera: config and data rows may hang off any of the
 * duplicate camera rows sharing this (device_id, local_id), so child queries
 * scope by it rather than by a single camera.id.
 */
export interface CameraScope {
	deviceId: number;
	localId: number;
}

function scopedCameraDeviceBase(db: Kysely<DB>, clientId: number) {
	return cameraDeviceBase(db)
		.innerJoin(
			"client_gauge_station",
			"client_gauge_station.gauge_station_id",
			"gauge_station.id",
		)
		.where("client_gauge_station.client_id", "=", clientId);
}

export function listCameras(
	db: Kysely<DB>,
	filters: { gaugeStationId?: number; clientId?: number } = {},
): Promise<CameraDeviceRow[]> {
	let query = cameraDeviceBase(db);
	if (filters.gaugeStationId !== undefined)
		query = query.where("device_info.gauge_station_id", "=", filters.gaugeStationId);
	if (filters.clientId !== undefined) {
		query = query
			.innerJoin(
				"client_gauge_station",
				"client_gauge_station.gauge_station_id",
				"gauge_station.id",
			)
			.where("client_gauge_station.client_id", "=", filters.clientId);
	}
	return query
		.orderBy("device.serial_number", "asc")
		.orderBy("camera.local_id", "asc")
		.execute() as Promise<CameraDeviceRow[]>;
}

export function listCamerasForClient(
	db: Kysely<DB>,
	clientId: number,
	filters: { gaugeStationId?: number } = {},
): Promise<CameraDeviceRow[]> {
	let query = scopedCameraDeviceBase(db, clientId);
	if (filters.gaugeStationId !== undefined)
		query = query.where("device_info.gauge_station_id", "=", filters.gaugeStationId);
	return query
		.orderBy("device.serial_number", "asc")
		.orderBy("camera.local_id", "asc")
		.execute() as Promise<CameraDeviceRow[]>;
}

export function findCameraByDeviceSerialNumber(
	db: Kysely<DB>,
	deviceId: string,
): Promise<CameraDeviceRow | undefined> {
	return cameraDeviceBase(db)
		.where("device.serial_number", "=", deviceId)
		.executeTakeFirst() as Promise<CameraDeviceRow | undefined>;
}

export function findCameraByDeviceSerialNumberForClient(
	db: Kysely<DB>,
	deviceId: string,
	clientId: number,
): Promise<CameraDeviceRow | undefined> {
	return scopedCameraDeviceBase(db, clientId)
		.where("device.serial_number", "=", deviceId)
		.executeTakeFirst() as Promise<CameraDeviceRow | undefined>;
}

export function findCurrentCameraConfig(
	db: Kysely<DB>,
	scope: CameraScope,
): Promise<CameraConfigRow | undefined> {
	return db
		.selectFrom("camera_config")
		.innerJoin("camera", "camera.id", "camera_config.camera_id")
		.select(cameraConfigColumns.map((column) => `camera_config.${column}` as const))
		.where("camera.device_id", "=", scope.deviceId)
		.where("camera.local_id", "=", scope.localId)
		.where("camera_config.archived", "is", null)
		.orderBy("camera_config.introduced", "desc")
		.orderBy("camera_config.id", "desc")
		.executeTakeFirst();
}

export function listCameraConfigPresets(
	db: Kysely<DB>,
	scope: CameraScope,
): Promise<CameraConfigPresetRow[]> {
	return db
		.selectFrom("camera_config_preset")
		.innerJoin("camera", "camera.id", "camera_config_preset.camera_id")
		.select(presetColumns.map((column) => `camera_config_preset.${column}` as const))
		.where("camera.device_id", "=", scope.deviceId)
		.where("camera.local_id", "=", scope.localId)
		.where("camera_config_preset.archived", "is", null)
		.orderBy("camera_config_preset.local_preset_id", "asc")
		.execute();
}

export function findCurrentCameraConfigRotation(
	db: Kysely<DB>,
	scope: CameraScope,
): Promise<CameraConfigRotationRow | undefined> {
	return db
		.selectFrom("camera_config_rotation")
		.innerJoin("camera", "camera.id", "camera_config_rotation.camera_id")
		.select(rotationColumns.map((column) => `camera_config_rotation.${column}` as const))
		.where("camera.device_id", "=", scope.deviceId)
		.where("camera.local_id", "=", scope.localId)
		.where("camera_config_rotation.archived", "is", null)
		.orderBy("camera_config_rotation.introduced", "desc")
		.orderBy("camera_config_rotation.id", "desc")
		.executeTakeFirst();
}

export interface CameraRecordFilters {
	from?: Date;
	to?: Date;
	limit?: number;
	page?: number;
	taggedOnly?: boolean;
}

function cameraDataRecordBase(
	db: Kysely<DB>,
	scope: CameraScope,
	filters: CameraRecordFilters = {},
) {
	let query = db
		.selectFrom("camera_data_record")
		.innerJoin("camera", "camera.id", "camera_data_record.camera_id")
		.select(dataRecordColumns.map((column) => `camera_data_record.${column}` as const))
		.where("camera.device_id", "=", scope.deviceId)
		.where("camera.local_id", "=", scope.localId);
	if (filters.from) query = query.where("camera_data_record.date", ">=", filters.from);
	if (filters.to) query = query.where("camera_data_record.date", "<=", filters.to);
	if (filters.taggedOnly) {
		query = query.where((eb) =>
			eb.exists(
				eb
					.selectFrom("camera_detection_data")
					.select("camera_detection_data.id")
					.whereRef(
						"camera_detection_data.camera_data_record_id",
						"=",
						"camera_data_record.id",
					),
			),
		);
	}
	return query
		.orderBy("camera_data_record.date", "desc")
		.orderBy("camera_data_record.id", "desc");
}

export function listCameraDataRecords(
	db: Kysely<DB>,
	scope: CameraScope,
	filters: CameraRecordFilters = {},
): Promise<CameraDataRecordRow[]> {
	let query = cameraDataRecordBase(db, scope, filters);
	if (filters.limit !== undefined) {
		query = query.limit(filters.limit).offset(((filters.page ?? 1) - 1) * filters.limit);
	}
	return query.execute();
}

export function listCapturesForDataRecord(
	db: Kysely<DB>,
	cameraDataRecordId: string,
): Promise<CameraCaptureDataRow[]> {
	return db
		.selectFrom("camera_capture_data")
		.select(captureColumns)
		.where("camera_data_record_id", "=", cameraDataRecordId)
		.orderBy("id", "asc")
		.execute();
}

export function listDetectionsForDataRecord(
	db: Kysely<DB>,
	cameraDataRecordId: string,
): Promise<CameraDetectionDataRow[]> {
	return db
		.selectFrom("camera_detection_data")
		.select(detectionColumns)
		.where("camera_data_record_id", "=", cameraDataRecordId)
		.orderBy("id", "asc")
		.execute();
}

export function listCameraCaptureEntries(
	db: Kysely<DB>,
	scope: CameraScope,
	filters: CameraRecordFilters = {},
): Promise<CameraCaptureEntryRow[]> {
	let query = db
		.selectFrom("camera_capture_data")
		.innerJoin(
			"camera_data_record",
			"camera_data_record.id",
			"camera_capture_data.camera_data_record_id",
		)
		.innerJoin("camera", "camera.id", "camera_data_record.camera_id")
		.innerJoin("device", "device.id", "camera.device_id")
		.select([
			...captureColumns.map((column) => `camera_capture_data.${column}` as const),
			"camera_data_record.date",
			"camera_data_record.camera_id",
			"camera.device_id",
			"device.serial_number as device_serial_number",
		])
		.where("camera.device_id", "=", scope.deviceId)
		.where("camera.local_id", "=", scope.localId)
		.where("camera.archived", "is", null)
		.where("device.archived", "is", null);
	if (filters.from) query = query.where("camera_data_record.date", ">=", filters.from);
	if (filters.to) query = query.where("camera_data_record.date", "<=", filters.to);
	if (filters.taggedOnly) query = query.where("camera_capture_data.is_tagged", "=", true);
	query = query
		.orderBy("camera_data_record.date", "desc")
		.orderBy("camera_capture_data.id", "desc");
	if (filters.limit !== undefined)
		query = query.limit(filters.limit).offset(((filters.page ?? 1) - 1) * filters.limit);
	return query.execute();
}

export function findCaptureEntryByPath(
	db: Kysely<DB>,
	scope: CameraScope,
	path: string,
): Promise<CameraCaptureEntryRow | undefined> {
	return db
		.selectFrom("camera_capture_data")
		.innerJoin(
			"camera_data_record",
			"camera_data_record.id",
			"camera_capture_data.camera_data_record_id",
		)
		.innerJoin("camera", "camera.id", "camera_data_record.camera_id")
		.innerJoin("device", "device.id", "camera.device_id")
		.select([
			...captureColumns.map((column) => `camera_capture_data.${column}` as const),
			"camera_data_record.date",
			"camera_data_record.camera_id",
			"camera.device_id",
			"device.serial_number as device_serial_number",
		])
		.where("camera.device_id", "=", scope.deviceId)
		.where("camera.local_id", "=", scope.localId)
		.where("camera_capture_data.path", "=", path)
		.executeTakeFirst();
}
