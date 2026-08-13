import type { Kysely } from "kysely";
import type { DB } from "@/db/types";
import type { MqtxClient, MqtxResponse } from "@/lib/mqtx/MqtxClient";
import type { SessionSubject } from "../auth/service";
import type {
	CameraCaptureDataRow,
	CameraCaptureEntryRow,
	CameraConfigPresetRow,
	CameraConfigRotationRow,
	CameraConfigRow,
	CameraDataRecordRow,
	CameraDetectionDataRow,
	CameraDeviceRow,
	CameraRecordFilters,
} from "./queries";
import * as queries from "./queries";

export interface CameraReadAccess {
	canReadExternal: boolean;
}

export interface CameraWriteAccess {
	canWriteExternal: boolean;
}

export interface CameraListFilters {
	gaugeId?: number;
	clientId?: number;
}

export interface CameraQueryFilters {
	from?: string;
	to?: string;
	limit?: number | string;
	page?: number | string;
	taggedOnly?: boolean;
}

export interface CaptureRequestInput {
	annotate: number;
	format: {
		type: number;
		duration?: number;
	};
}

export type CameraConfigInput = Record<string, unknown>;

export interface CameraResponse {
	camera: SerializedTimelineRow<CameraDeviceRow>;
	camera_config: SerializedTimelineRow<CameraConfigRow> | null;
	camera_config_presets: Array<SerializedTimelineRow<CameraConfigPresetRow>>;
	camera_config_rotation: SerializedTimelineRow<CameraConfigRotationRow> | null;
}

export interface CameraDataRecordResponse {
	record: Omit<CameraDataRecordRow, "date"> & { date: string };
	captures: CameraCaptureResponse[];
	detections: CameraDetectionDataRow[];
}

export interface CameraCaptureResponse extends CameraCaptureDataRow {
	date: string;
	camera_id: number;
	device_id: number;
	device_serial_number: string;
}

export interface MqtxStatusResponse {
	message: string;
	status: number;
}

type SerializedTimelineRow<
	T extends { introduced: Date | string; archived: Date | string | null },
> = Omit<T, "introduced" | "archived"> & {
	introduced: string;
	archived: string | null;
};

export class CameraNotFoundError extends Error {
	constructor(deviceId: string) {
		super(
			`camera ${deviceId} does not exist or is not available to your client`,
		);
		this.name = "CameraNotFoundError";
	}
}

export class CameraBadRequestError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CameraBadRequestError";
	}
}

export class CameraCaptureNotFoundError extends Error {
	constructor() {
		super("capture does not exist or is not available to this camera");
		this.name = "CameraCaptureNotFoundError";
	}
}

export class CameraMqtxRequestFailedError extends Error {
	readonly statusCode: number;

	constructor(statusCode: number, message = "Upstream MQTX error") {
		super(message);
		this.name = "CameraMqtxRequestFailedError";
		this.statusCode = statusCode;
	}
}

function serializeDate(value: Date | string): string {
	return value instanceof Date
		? value.toISOString()
		: new Date(value).toISOString();
}

function withSerializedDates<
	T extends { introduced: Date | string; archived: Date | string | null },
>(row: T): SerializedTimelineRow<T> {
	return {
		...row,
		introduced: serializeDate(row.introduced),
		archived: row.archived === null ? null : serializeDate(row.archived),
	};
}

function normalizeMqtxDeviceId(deviceId: string): string {
	return deviceId.split("-")[0] ?? deviceId;
}

function ensureMqtxSuccess(response: MqtxResponse): MqtxStatusResponse {
	if (!response.success)
		throw new CameraMqtxRequestFailedError(
			response.status,
			response.body || "Upstream MQTX error",
		);
	return { message: response.body || "OK", status: response.status };
}

function parseDate(value: string | undefined, field: string): Date | undefined {
	if (value === undefined) return undefined;
	const numeric = Number(value);
	const date =
		Number.isFinite(numeric) && value.trim() !== ""
			? new Date(numeric)
			: new Date(value);
	if (Number.isNaN(date.getTime()))
		throw new CameraBadRequestError(
			`${field} must be a valid date or millisecond timestamp`,
		);
	return date;
}

function parsePositiveInteger(
	value: number | string | undefined,
	field: string,
): number | undefined {
	if (value === undefined) return undefined;
	const parsed = typeof value === "number" ? value : Number(value);
	if (!Number.isInteger(parsed) || parsed < 1)
		throw new CameraBadRequestError(`${field} must be a positive integer`);
	return parsed;
}

function toRecordFilters(input: CameraQueryFilters): CameraRecordFilters {
	return {
		from: parseDate(input.from, "from"),
		to: parseDate(input.to, "to"),
		limit: parsePositiveInteger(input.limit, "limit"),
		page: parsePositiveInteger(input.page, "page"),
		taggedOnly: input.taggedOnly,
	};
}

function toCaptureResponse(row: CameraCaptureEntryRow): CameraCaptureResponse {
	return {
		...row,
		date: serializeDate(row.date),
	};
}

async function hydrateCamera(
	db: Kysely<DB>,
	camera: CameraDeviceRow,
): Promise<CameraResponse> {
	const [cameraConfig, presets, rotation] = await Promise.all([
		queries.findCurrentCameraConfig(db, camera.id),
		queries.listCameraConfigPresets(db, camera.id),
		queries.findCurrentCameraConfigRotation(db, camera.id),
	]);
	return {
		camera: withSerializedDates(camera),
		camera_config: cameraConfig ? withSerializedDates(cameraConfig) : null,
		camera_config_presets: presets.map(withSerializedDates),
		camera_config_rotation: rotation ? withSerializedDates(rotation) : null,
	};
}

async function findVisibleCamera(
	db: Kysely<DB>,
	deviceId: string,
	session: SessionSubject,
	access: CameraReadAccess | CameraWriteAccess,
): Promise<CameraDeviceRow> {
	const canAccessExternal =
		"canReadExternal" in access
			? access.canReadExternal
			: access.canWriteExternal;
	const camera = canAccessExternal
		? await queries.findCameraByDeviceSerialNumber(db, deviceId)
		: await queries.findCameraByDeviceSerialNumberForClient(
				db,
				deviceId,
				session.client_id,
			);
	if (!camera) throw new CameraNotFoundError(deviceId);
	return camera;
}

export async function listCameras(
	db: Kysely<DB>,
	session: SessionSubject,
	access: CameraReadAccess,
	filters: CameraListFilters = {},
): Promise<CameraResponse[]> {
	const rows = access.canReadExternal
		? await queries.listCameras(db, {
				gaugeId: filters.gaugeId,
				clientId: filters.clientId,
			})
		: await queries.listCamerasForClient(db, session.client_id, {
				gaugeId: filters.gaugeId,
			});
	return Promise.all(rows.map((camera) => hydrateCamera(db, camera)));
}

export async function getCamera(
	db: Kysely<DB>,
	deviceId: string,
	session: SessionSubject,
	access: CameraReadAccess,
): Promise<CameraResponse> {
	return hydrateCamera(
		db,
		await findVisibleCamera(db, deviceId, session, access),
	);
}

export async function listCameraDataRecords(
	db: Kysely<DB>,
	deviceId: string,
	session: SessionSubject,
	access: CameraReadAccess,
	filters: CameraQueryFilters = {},
): Promise<CameraDataRecordResponse[]> {
	const camera = await findVisibleCamera(db, deviceId, session, access);
	const records = await queries.listCameraDataRecords(
		db,
		camera.id,
		toRecordFilters(filters),
	);
	return Promise.all(
		records.map(async (record) => ({
			record: {
				...record,
				date: serializeDate(record.date),
			},
			captures: (
				await queries.listCapturesForDataRecord(db, record.id)
			).map((capture) => ({
				...capture,
				date: serializeDate(record.date),
				camera_id: record.camera_id,
				device_id: camera.device_id,
				device_serial_number: camera.device_serial_number,
			})),
			detections: await queries.listDetectionsForDataRecord(
				db,
				record.id,
			),
		})),
	);
}

export async function listCameraCaptures(
	db: Kysely<DB>,
	deviceId: string,
	session: SessionSubject,
	access: CameraReadAccess,
	filters: CameraQueryFilters = {},
): Promise<CameraCaptureResponse[]> {
	const camera = await findVisibleCamera(db, deviceId, session, access);
	const rows = await queries.listCameraCaptureEntries(
		db,
		camera.id,
		toRecordFilters(filters),
	);
	return rows.map(toCaptureResponse);
}

export async function getCameraCaptureByPath(
	db: Kysely<DB>,
	deviceId: string,
	path: string,
	session: SessionSubject,
	access: CameraReadAccess,
): Promise<CameraCaptureResponse> {
	const camera = await findVisibleCamera(db, deviceId, session, access);
	const capture = await queries.findCaptureEntryByPath(db, camera.id, path);
	if (!capture) throw new CameraCaptureNotFoundError();
	return toCaptureResponse(capture);
}

export async function requestLegacyCameraCapture(
	db: Kysely<DB>,
	mqtx: MqtxClient,
	deviceId: string,
	session: SessionSubject,
	access: CameraWriteAccess,
): Promise<MqtxStatusResponse> {
	await findVisibleCamera(db, deviceId, session, access);
	return ensureMqtxSuccess(
		await mqtx.sendLegacyCameraCapture(normalizeMqtxDeviceId(deviceId)),
	);
}

export async function requestCameraCapture(
	db: Kysely<DB>,
	mqtx: MqtxClient,
	deviceId: string,
	session: SessionSubject,
	access: CameraWriteAccess,
	input: CaptureRequestInput,
): Promise<MqtxStatusResponse> {
	await findVisibleCamera(db, deviceId, session, access);
	validateCaptureRequest(input);
	const response = await mqtx.sendCameraCaptureGet(
		normalizeMqtxDeviceId(deviceId),
		"3.1",
		{
			capture: { annotate: input.annotate, format: input.format },
		},
	);
	return ensureMqtxSuccess(response);
}

export async function updateCameraConfig(
	db: Kysely<DB>,
	mqtx: MqtxClient,
	deviceId: string,
	session: SessionSubject,
	access: CameraWriteAccess,
	input: CameraConfigInput,
): Promise<MqtxStatusResponse> {
	await findVisibleCamera(db, deviceId, session, access);
	validateCameraConfig(input);
	return ensureMqtxSuccess(
		await mqtx.sendConfigUpdate(
			normalizeMqtxDeviceId(deviceId),
			"3.1",
			input,
		),
	);
}

function validateCaptureRequest(input: CaptureRequestInput): void {
	if (![0, 1, 2].includes(input.annotate)) {
		throw new CameraBadRequestError(
			"annotate is required and must be 0, 1, or 2",
		);
	}
	if (!input.format || ![0, 1, 2].includes(input.format.type)) {
		throw new CameraBadRequestError("format.type must be 0, 1, or 2");
	}
	if (input.format.type === 2) {
		const maxDuration = input.annotate === 0 ? 60 : 30;
		if (
			!Number.isInteger(input.format.duration) ||
			input.format.duration! < 1 ||
			input.format.duration! > maxDuration
		) {
			throw new CameraBadRequestError(
				`video requires an integer duration between 1 and ${maxDuration}`,
			);
		}
	}
}

const CHECKIN_REGEX =
	/^((sat|sun|mon|tue|wed|thu|fri)?(([01][0-9])|(2[0-3])):[0-5][0-9])?$/;

function validateCameraConfig(input: CameraConfigInput): void {
	if (!input || typeof input !== "object" || Array.isArray(input)) {
		throw new CameraBadRequestError("expected a config object");
	}
	const camera = input.camera;
	if (camera === undefined) return;
	if (!camera || typeof camera !== "object" || Array.isArray(camera)) {
		throw new CameraBadRequestError("camera must be an object");
	}
	const values = camera as Record<string, unknown>;
	if (values.triggered !== undefined && typeof values.triggered !== "boolean")
		throw new CameraBadRequestError("camera.triggered must be a boolean");
	for (const key of ["pan", "tilt", "zoom"] as const) {
		if (
			values[key] !== undefined &&
			(typeof values[key] !== "number" || !Number.isFinite(values[key]))
		) {
			throw new CameraBadRequestError(
				`camera.${key} must be a finite number`,
			);
		}
	}
	for (const key of ["selectedPreset", "cameraBootTimeDelay"] as const) {
		if (
			values[key] !== undefined &&
			(!Number.isInteger(values[key]) ||
				(values[key] as number) < 0 ||
				(values[key] as number) > 255)
		) {
			throw new CameraBadRequestError(
				`camera.${key} must be an integer between 0 and 255`,
			);
		}
	}
	if (
		values.checkInTime !== undefined &&
		(typeof values.checkInTime !== "string" ||
			!CHECKIN_REGEX.test(values.checkInTime))
	) {
		throw new CameraBadRequestError(
			'camera.checkInTime must be empty or match [day]HH:MM, e.g. "14:30" or "mon14:30"',
		);
	}
	if (values.presets !== undefined) {
		if (!Array.isArray(values.presets) || values.presets.length < 1)
			throw new CameraBadRequestError(
				"camera.presets must be a non-empty array",
			);
		for (const preset of values.presets) {
			if (!preset || typeof preset !== "object" || Array.isArray(preset))
				throw new CameraBadRequestError(
					"each camera preset must be an object",
				);
			const p = preset as Record<string, unknown>;
			if (
				!Number.isInteger(p.id) ||
				(p.id as number) < 1 ||
				(p.id as number) > 254
			)
				throw new CameraBadRequestError(
					"each camera preset requires an integer id between 1 and 254",
				);
			for (const key of ["pan", "tilt", "zoom"] as const) {
				if (typeof p[key] !== "number" || !Number.isFinite(p[key]))
					throw new CameraBadRequestError(
						`each camera preset requires a finite ${key}`,
					);
			}
		}
	}
}
