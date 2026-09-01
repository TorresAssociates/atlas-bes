import type { Kysely } from "kysely";
import type { DB } from "@/db/types";
import type { MqtxClient, MqtxResponse } from "@/lib/mqtx/MqtxClient";
import type { SessionSubject } from "../auth/service";
import * as queries from "./queries";

export type ControlType = "wifi" | "override" | "overtop" | "manualMeasurement" | "ping";

export interface MqtxWriteAccess {
	canWriteExternal: boolean;
}

export interface ControlInput {
	controlType: ControlType;
	version?: string;
	requestedState?: boolean;
	measurementCodes?: string[];
}

export interface AlertsSettingsInput {
	monitoredCodes: unknown[] | Record<string, unknown>;
	alertCodes?: unknown[];
	version?: string;
}

export interface DataSettingsInput {
	timestep?: number;
	minTimestep?: number;
	channels?: DataSettingsChannelInput[];
	version?: string;
}

export interface DataSettingsChannelInput {
	localChannelId: number;
	channelName: string;
	isActive: boolean;
	channelCodeId: string;
	units: string;
	displayIndex?: number;
	channelTimestep?: number;
	channelTypeId: number;
}

export interface GeneralSettingsInput {
	active?: boolean;
	wifiEnabled?: boolean;
	wifiPassword?: string;
	version?: string;
}

export interface PowerSettingsInput {
	min?: number;
	max?: number;
}

export interface MqtxSuccessResponse {
	message: string;
	status: number;
}

export class MqtxDeviceNotFoundError extends Error {
	constructor(deviceId: string) {
		super(`device ${deviceId} does not exist or is not available to your client`);
		this.name = "MqtxDeviceNotFoundError";
	}
}

export class MqtxBadRequestError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MqtxBadRequestError";
	}
}

export class MqtxUnsupportedOperationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "MqtxUnsupportedOperationError";
	}
}

export class MqtxRequestFailedError extends Error {
	readonly statusCode: number;

	constructor(statusCode: number, message = "Upstream MQTX error") {
		super(message);
		this.name = "MqtxRequestFailedError";
		this.statusCode = statusCode;
	}
}

function normalizeMqtxDeviceId(deviceId: string): string {
	return deviceId.split("-")[0] ?? deviceId;
}

function versionOrDefault(version?: string): string {
	return version ?? "v2";
}

async function ensureDeviceAccess(
	db: Kysely<DB>,
	deviceId: string,
	session: SessionSubject,
	access: MqtxWriteAccess,
) {
	const device = access.canWriteExternal
		? await queries.findDeviceBySerialNumber(db, deviceId)
		: await queries.findDeviceBySerialNumberForClient(db, deviceId, session.client_id);
	if (!device) throw new MqtxDeviceNotFoundError(deviceId);
	return device;
}

function ensureMqtxSuccess(response: MqtxResponse): void {
	if (!response.success) throw new MqtxRequestFailedError(response.status);
}

export async function sendMqtxControl(
	db: Kysely<DB>,
	mqtx: MqtxClient,
	deviceId: string,
	session: SessionSubject,
	access: MqtxWriteAccess,
	input: ControlInput,
): Promise<{ success: boolean }> {
	await ensureDeviceAccess(db, deviceId, session, access);
	const version = versionOrDefault(input.version);
	const mqtxDeviceId = normalizeMqtxDeviceId(deviceId);
	let response: MqtxResponse;

	switch (input.controlType) {
		case "wifi":
			if (input.requestedState === undefined)
				throw new MqtxBadRequestError("requestedState is required for wifi control");
			response = await mqtx.sendStateUpdate(mqtxDeviceId, version, {
				wifiInterface: { enabled: input.requestedState },
			});
			break;
		case "override":
			if (input.requestedState === undefined)
				throw new MqtxBadRequestError("requestedState is required for override control");
			response =
				version === "v1"
					? await mqtx.sendV1LightsCommand(
							mqtxDeviceId,
							input.requestedState ? "ON" : "OFF",
						)
					: await mqtx.sendStateUpdate(mqtxDeviceId, version, {
							auxOutput: {
								output: {
									enabled: input.requestedState,
									source: "frontend",
								},
							},
						});
			break;
		case "manualMeasurement":
			if (!input.measurementCodes)
				throw new MqtxBadRequestError(
					"measurementCodes is required for manual measurement",
				);
			response = await mqtx.sendDataGet(mqtxDeviceId, version, ["**"]);
			break;
		case "ping":
			response = await mqtx.sendPing(mqtxDeviceId, version);
			break;
		case "overtop":
			throw new MqtxUnsupportedOperationError(
				"overtop control is not implemented in the current device schema",
			);
	}

	ensureMqtxSuccess(response);
	return { success: response.success };
}

export async function updateAlertSettings(
	db: Kysely<DB>,
	mqtx: MqtxClient,
	deviceId: string,
	session: SessionSubject,
	access: MqtxWriteAccess,
	input: AlertsSettingsInput,
): Promise<void> {
	await ensureDeviceAccess(db, deviceId, session, access);
	if (!Array.isArray(input.monitoredCodes) && typeof input.monitoredCodes !== "object") {
		throw new MqtxBadRequestError("Invalid alerts payload");
	}

	const monitoredCodes = Array.isArray(input.monitoredCodes)
		? input.monitoredCodes.map((code) => normalizeMonitoredCode(code))
		: Object.entries(input.monitoredCodes).map(([code, data]) => ({
				code,
				...(isRecord(data) ? data : {}),
			}));
	const response = await mqtx.sendConfigUpdate(deviceId, versionOrDefault(input.version), {
		config: { monitoredCodes },
	});
	ensureMqtxSuccess(response);
}

export async function updateDataSettings(
	db: Kysely<DB>,
	mqtx: MqtxClient,
	deviceId: string,
	session: SessionSubject,
	access: MqtxWriteAccess,
	input: DataSettingsInput,
): Promise<MqtxSuccessResponse> {
	const device = await ensureDeviceAccess(db, deviceId, session, access);
	const config: Record<string, unknown> = {};
	if (input.timestep !== undefined) config.timestep = input.timestep;
	if (input.minTimestep !== undefined) config.minTimestep = input.minTimestep;
	if (input.channels !== undefined) {
		config.channels = input.channels.map((channel) => ({
			id: channel.localChannelId,
			name: channel.channelName,
			active: channel.isActive,
			code: channel.channelCodeId,
			units: channel.units,
			displayIndex: channel.displayIndex,
			timestep: channel.channelTimestep,
			channelTypeData: { id: channel.channelTypeId },
		}));
	}

	const response = await mqtx.sendConfigUpdate(deviceId, versionOrDefault(input.version), {
		config,
	});
	ensureMqtxSuccess(response);

	if (input.timestep !== undefined) {
		await db.transaction().execute(async (trx) => {
			await queries.archiveCurrentDeviceDatalogging(trx, device.id);
			await queries.insertDeviceDatalogging(trx, device.id, input.timestep!);
		});
	}
	return { message: "Settings updated successfully", status: 200 };
}

export async function updateGeneralSettings(
	db: Kysely<DB>,
	mqtx: MqtxClient,
	deviceId: string,
	session: SessionSubject,
	access: MqtxWriteAccess,
	encryptionKey: string,
	input: GeneralSettingsInput,
): Promise<MqtxSuccessResponse> {
	const device = await ensureDeviceAccess(db, deviceId, session, access);
	const version = versionOrDefault(input.version);

	if (input.active !== undefined) {
		const current = await queries.findCurrentDeviceInfo(db, device.id);
		if (!current) throw new MqtxDeviceNotFoundError(deviceId);
		await db.transaction().execute(async (trx) => {
			await queries.archiveCurrentDeviceInfo(trx, device.id);
			await queries.insertDeviceInfo(trx, {
				device_id: device.id,
				gauge_station_id: current.gauge_station_id,
				type: current.type,
				page_version: current.page_version,
				activation_date: current.activation_date,
				warranty_end_date: current.warranty_end_date,
				latitude: current.latitude,
				longitude: current.longitude,
				active: input.active,
			});
		});
	}

	if (input.wifiEnabled !== undefined) {
		const response = await mqtx.sendStateUpdate(deviceId, version, {
			wifiInterface: { enabled: input.wifiEnabled },
		});
		ensureMqtxSuccess(response);
		await db.transaction().execute(async (trx) => {
			await queries.archiveCurrentWifiActive(trx, device.id);
			await queries.insertWifiActive(trx, device.id, input.wifiEnabled!);
		});
	}

	if (input.wifiPassword !== undefined) {
		const response = await mqtx.sendConfigUpdate(deviceId, version, {
			wifiInterface: { password: input.wifiPassword },
		});
		ensureMqtxSuccess(response);
		await db.transaction().execute(async (trx) => {
			await queries.archiveCurrentWifiConfig(trx, device.id);
			await queries.insertEncryptedWifiPassword(
				trx,
				device.id,
				input.wifiPassword!,
				encryptionKey,
			);
		});
	}

	return { message: "Update successful", status: 201 };
}

export async function updatePowerSettings(
	db: Kysely<DB>,
	deviceId: string,
	session: SessionSubject,
	access: MqtxWriteAccess,
	input: PowerSettingsInput,
): Promise<MqtxSuccessResponse> {
	const device = await ensureDeviceAccess(db, deviceId, session, access);
	const current = await queries.findCurrentDevicePower(db, device.id);
	const minVoltage = input.min === undefined ? current?.min_voltage : roundPower(input.min);
	const maxVoltage = input.max === undefined ? current?.max_voltage : roundPower(input.max);
	if (minVoltage === undefined || maxVoltage === undefined) {
		throw new MqtxBadRequestError(
			"min and max are required when no power settings exist for the device",
		);
	}

	await db.transaction().execute(async (trx) => {
		await queries.archiveCurrentDevicePower(trx, device.id);
		await queries.insertDevicePower(trx, device.id, minVoltage, maxVoltage);
	});
	return { message: "Update successful", status: 201 };
}

function roundPower(value: number): number {
	return Number.parseFloat(value.toFixed(2));
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeMonitoredCode(value: unknown): Record<string, unknown> {
	if (!isRecord(value)) return { code: value };
	const { channelCodeId, ...rest } = value;
	return { code: channelCodeId, ...rest };
}
