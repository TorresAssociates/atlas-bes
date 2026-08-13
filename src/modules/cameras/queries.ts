import type { DB } from "@/db/types";
import type { Kysely, Selectable } from "kysely";

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
	gauge_name: string | null;
	gauge_location: string | null;
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
	"gauge_station.name as gauge_name",
	"gauge_station_info.location as gauge_location",
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
const rotationColumns = [
	"id",
	"camera_id",
	"rotation",
	"introduced",
	"archived",
] as const;
const dataRecordColumns = ["id", "date", "camera_id"] as const;
const captureColumns = [
	"id",
	"camera_data_record_id",
	"path",
	"file_type",
	"is_tagged",
] as const;
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
	return db
		.selectFrom("camera")
		.innerJoin("device", "device.id", "camera.device_id")
		.innerJoin("device_info", "device_info.device_id", "device.id")
		.innerJoin(
			"gauge_station",
			"gauge_station.id",
			"device_info.gauge_station_id",
		)
		.leftJoin("gauge_station_info", (join) =>
			join
				.onRef(
					"gauge_station_info.gauge_station_id",
					"=",
					"gauge_station.id",
				)
				.on("gauge_station_info.archived", "is", null),
		)
		.leftJoin("city", "city.id", "gauge_station_info.city_id")
		.select(cameraDeviceColumns as any)
		.distinct()
		.where("camera.archived", "is", null)
		.where("device.archived", "is", null)
		.where("device_info.archived", "is", null)
		.where("device_info.type", "=", "camera")
		.where("gauge_station.archived", "is", null);
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
	filters: { gaugeId?: number; clientId?: number } = {},
): Promise<CameraDeviceRow[]> {
	let query = cameraDeviceBase(db);
	if (filters.gaugeId !== undefined)
		query = query.where(
			"device_info.gauge_station_id",
			"=",
			filters.gaugeId,
		);
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
	filters: { gaugeId?: number } = {},
): Promise<CameraDeviceRow[]> {
	let query = scopedCameraDeviceBase(db, clientId);
	if (filters.gaugeId !== undefined)
		query = query.where(
			"device_info.gauge_station_id",
			"=",
			filters.gaugeId,
		);
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
	cameraId: number,
): Promise<CameraConfigRow | undefined> {
	return db
		.selectFrom("camera_config")
		.select(cameraConfigColumns)
		.where("camera_id", "=", cameraId)
		.where("archived", "is", null)
		.orderBy("introduced", "desc")
		.orderBy("id", "desc")
		.executeTakeFirst();
}

export function listCameraConfigPresets(
	db: Kysely<DB>,
	cameraId: number,
): Promise<CameraConfigPresetRow[]> {
	return db
		.selectFrom("camera_config_preset")
		.select(presetColumns)
		.where("camera_id", "=", cameraId)
		.where("archived", "is", null)
		.orderBy("local_preset_id", "asc")
		.execute();
}

export function findCurrentCameraConfigRotation(
	db: Kysely<DB>,
	cameraId: number,
): Promise<CameraConfigRotationRow | undefined> {
	return db
		.selectFrom("camera_config_rotation")
		.select(rotationColumns)
		.where("camera_id", "=", cameraId)
		.where("archived", "is", null)
		.orderBy("introduced", "desc")
		.orderBy("id", "desc")
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
	cameraId: number,
	filters: CameraRecordFilters = {},
) {
	let query = db
		.selectFrom("camera_data_record")
		.select(dataRecordColumns)
		.where("camera_id", "=", cameraId);
	if (filters.from) query = query.where("date", ">=", filters.from);
	if (filters.to) query = query.where("date", "<=", filters.to);
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
	return query.orderBy("date", "desc").orderBy("id", "desc");
}

export function listCameraDataRecords(
	db: Kysely<DB>,
	cameraId: number,
	filters: CameraRecordFilters = {},
): Promise<CameraDataRecordRow[]> {
	let query = cameraDataRecordBase(db, cameraId, filters);
	if (filters.limit !== undefined) {
		query = query
			.limit(filters.limit)
			.offset(((filters.page ?? 1) - 1) * filters.limit);
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
	cameraId: number,
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
			...captureColumns.map(
				(column) => `camera_capture_data.${column}` as const,
			),
			"camera_data_record.date",
			"camera_data_record.camera_id",
			"camera.device_id",
			"device.serial_number as device_serial_number",
		])
		.where("camera_data_record.camera_id", "=", cameraId)
		.where("camera.archived", "is", null)
		.where("device.archived", "is", null);
	if (filters.from)
		query = query.where("camera_data_record.date", ">=", filters.from);
	if (filters.to)
		query = query.where("camera_data_record.date", "<=", filters.to);
	if (filters.taggedOnly)
		query = query.where("camera_capture_data.is_tagged", "=", true);
	query = query
		.orderBy("camera_data_record.date", "desc")
		.orderBy("camera_capture_data.id", "desc");
	if (filters.limit !== undefined)
		query = query
			.limit(filters.limit)
			.offset(((filters.page ?? 1) - 1) * filters.limit);
	return query.execute();
}

export function findCaptureEntryByPath(
	db: Kysely<DB>,
	cameraId: number,
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
			...captureColumns.map(
				(column) => `camera_capture_data.${column}` as const,
			),
			"camera_data_record.date",
			"camera_data_record.camera_id",
			"camera.device_id",
			"device.serial_number as device_serial_number",
		])
		.where("camera_data_record.camera_id", "=", cameraId)
		.where("camera_capture_data.path", "=", path)
		.executeTakeFirst();
}
