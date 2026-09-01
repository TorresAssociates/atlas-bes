import type { Kysely } from "kysely";
import type { DB, DeviceType, ProtocolType } from "@/db/types";
import { recordControlAuditLog } from "../audit-logs/service";
import type { SessionSubject } from "../auth/service";
import type { DeviceDetailRow, DeviceSummaryRow } from "./queries";
import * as queries from "./queries";

export interface DeviceListInput {
	gaugeStationId?: number;
	type?: DeviceType;
	active?: boolean;
	connected?: boolean;
	includeArchived?: boolean;
	at?: string;
}

export interface DeviceReadAccess {
	canReadExternal: boolean;
	canViewInactive: boolean;
}

export interface DeviceWriteAccess {
	canWriteExternal: boolean;
}

export interface UpdateDeviceInfoInput {
	gaugeStationId?: number;
	pageVersion?: string;
	activationDate?: string;
	warrantyEndDate?: string;
	latitude?: number;
	longitude?: number;
	active?: boolean;
	displayName?: string | null;
}

export interface UpdateDeviceInput {
	info?: UpdateDeviceInfoInput;
	power?: { minVoltage: number; maxVoltage: number };
	// A number sets a manual risk level override ("overtopping") that trumps the
	// computed monitor risk; null clears it.
	riskLevelOverride?: number | null;
}

export interface DeviceSummaryResponse {
	id: number;
	serialNumber: string;
	type: DeviceType;
	gaugeStationId: number | null;
	latitude: number | null;
	longitude: number | null;
	active: boolean | null;
	connected: boolean | null;
	riskLevel: number | null;
	riskLevelOverride: number | null;
	riskLevelConfigRanges: RiskLevelConfigRangeResponse[];
	displayName: string | null;
}

export interface RiskLevelConfigRangeResponse {
	minValue: number;
	maxValue: number;
	riskLevel: number;
}

export interface DeviceRiskLevelResponse {
	monitorId: number;
	channelId: number;
	priority: number;
	measurementDate: string | null;
	value: number | null;
	riskLevel: number | null;
}

export interface DeviceDetailResponse extends DeviceSummaryResponse {
	pageVersion: string | null;
	activationDate: string | null;
	warrantyEndDate: string | null;
	introduced: string;
	archived: string | null;
	networking: { protocol: ProtocolType; apiVersion: string } | null;
	wifiActive: boolean | null;
	power: { minVoltage: number; maxVoltage: number } | null;
	datalogging: { timestep: number } | null;
	connectionQuality: {
		minRssi: number | null;
		maxRssi: number | null;
		minRsrp: number | null;
		maxRsrp: number | null;
		minRsrq: number | null;
		maxRsrq: number | null;
	} | null;
	camera: { triggerOverride: boolean | null; triggered: boolean | null } | null;
	sims: {
		simId: number;
		iccid: string;
		provider: string;
		simIndex: number | null;
		isActive: boolean;
	}[];
	riskLevels: DeviceRiskLevelResponse[];
}

export class DeviceNotFoundError extends Error {
	constructor(deviceId: number | string) {
		super(`device ${deviceId} does not exist`);
		this.name = "DeviceNotFoundError";
	}
}

export class DeviceAccessDeniedError extends Error {
	constructor(message = "not allowed to manage devices for other clients") {
		super(message);
		this.name = "DeviceAccessDeniedError";
	}
}

export class DeviceGaugeStationNotFoundError extends Error {
	constructor(gaugeStationId: number) {
		super(`gauge station ${gaugeStationId} does not exist`);
		this.name = "DeviceGaugeStationNotFoundError";
	}
}

function toIso(value: Date | string): string {
	return new Date(value).toISOString();
}

function toIsoOrNull(value: Date | string | null): string | null {
	return value === null ? null : toIso(value);
}

function parseAt(at?: string): Date | undefined {
	return at === undefined ? undefined : new Date(at);
}

function toSummaryResponse(row: DeviceSummaryRow): DeviceSummaryResponse {
	return {
		id: row.id,
		serialNumber: row.serial_number,
		type: row.type,
		gaugeStationId: row.gauge_station_id,
		latitude: row.latitude,
		longitude: row.longitude,
		active: row.active,
		connected: row.connected,
		riskLevel: row.risk_level,
		riskLevelOverride: row.risk_level_override,
		riskLevelConfigRanges: row.risk_level_config_ranges.map((r) => ({
			minValue: r.min_value,
			maxValue: r.max_value,
			riskLevel: r.risk_level,
		})),
		displayName: row.display_name,
	};
}

function toDetailResponse(row: DeviceDetailRow): DeviceDetailResponse {
	return {
		...toSummaryResponse(row),
		pageVersion: row.page_version,
		activationDate: toIsoOrNull(row.activation_date),
		warrantyEndDate: toIsoOrNull(row.warranty_end_date),
		introduced: toIso(row.introduced),
		archived: toIsoOrNull(row.archived),
		networking:
			row.protocol === null || row.api_version === null
				? null
				: { protocol: row.protocol, apiVersion: row.api_version },
		wifiActive: row.wifi_active,
		power:
			row.min_voltage === null || row.max_voltage === null
				? null
				: { minVoltage: row.min_voltage, maxVoltage: row.max_voltage },
		datalogging: row.timestep === null ? null : { timestep: row.timestep },
		connectionQuality:
			row.connection_quality_id === null
				? null
				: {
						minRssi: row.min_rssi,
						maxRssi: row.max_rssi,
						minRsrp: row.min_rsrp,
						maxRsrp: row.max_rsrp,
						minRsrq: row.min_rsrq,
						maxRsrq: row.max_rsrq,
					},
		camera:
			row.camera_info_id === null && row.triggered === null
				? null
				: { triggerOverride: row.trigger_override, triggered: row.triggered },
		sims: row.sims.map((s) => ({
			simId: s.sim_id,
			iccid: s.iccid,
			provider: s.provider,
			simIndex: s.sim_index,
			isActive: s.is_active,
		})),
		riskLevels: row.risk_levels.map((r) => ({
			monitorId: r.monitor_id,
			channelId: r.channel_id,
			priority: r.priority,
			measurementDate: toIsoOrNull(r.date),
			value: r.value,
			riskLevel: r.risk_level,
		})),
	};
}

export async function listDevices(
	db: Kysely<DB>,
	session: SessionSubject,
	access: DeviceReadAccess,
	input: DeviceListInput = {},
): Promise<DeviceSummaryResponse[]> {
	let active = input.active;
	if (!access.canViewInactive) {
		if (active === false)
			throw new DeviceAccessDeniedError("not allowed to view inactive devices");
		active = true;
	}

	const at = parseAt(input.at);
	const filters = { ...input, active };
	const rows = access.canReadExternal
		? await queries.listDevices(db, filters, at)
		: await queries.listDevicesForClient(db, session.client_id, filters, at);
	return rows.map(toSummaryResponse);
}

export async function getDevice(
	db: Kysely<DB>,
	id: number,
	session: SessionSubject,
	access: DeviceReadAccess,
	at?: string,
): Promise<DeviceDetailResponse> {
	const parsedAt = parseAt(at);
	const row = access.canReadExternal
		? await queries.findDeviceById(db, id, parsedAt)
		: await queries.findDeviceByIdForClient(db, id, session.client_id, parsedAt);
	if (!row || (row.active !== true && !access.canViewInactive)) throw new DeviceNotFoundError(id);
	return toDetailResponse(row);
}

export async function updateDevice(
	db: Kysely<DB>,
	id: number,
	session: SessionSubject,
	access: DeviceWriteAccess,
	input: UpdateDeviceInput,
): Promise<DeviceDetailResponse> {
	const current = access.canWriteExternal
		? await queries.findDeviceById(db, id)
		: await queries.findDeviceByIdForClient(db, id, session.client_id);
	if (!current) throw new DeviceNotFoundError(id);

	const info = input.info;
	if (info?.gaugeStationId !== undefined && info.gaugeStationId !== current.gauge_station_id) {
		const station = await queries.findGaugeStationById(db, info.gaugeStationId);
		if (!station) throw new DeviceGaugeStationNotFoundError(info.gaugeStationId);
		if (!access.canWriteExternal) {
			const link = await queries.isGaugeStationLinkedToClient(
				db,
				info.gaugeStationId,
				session.client_id,
			);
			if (!link)
				throw new DeviceAccessDeniedError(
					"not allowed to move devices to gauge stations of other clients",
				);
		}
	}

	const infoChanged = info !== undefined && Object.values(info).some((v) => v !== undefined);

	await db.transaction().execute(async (trx) => {
		if (infoChanged && info !== undefined) {
			await queries.archiveDeviceInfo(trx, id);
			await queries.insertDeviceInfo(trx, {
				device_id: id,
				gauge_station_id: info.gaugeStationId ?? current.gauge_station_id,
				type: current.type,
				page_version: info.pageVersion ?? current.page_version,
				activation_date: info.activationDate ?? current.activation_date,
				warranty_end_date: info.warrantyEndDate ?? current.warranty_end_date,
				latitude: info.latitude ?? current.latitude,
				longitude: info.longitude ?? current.longitude,
				active: info.active ?? current.active,
				display_name:
					info.displayName !== undefined ? info.displayName : current.display_name,
			});
		}

		if (input.power !== undefined) {
			await queries.archiveDevicePower(trx, id);
			await queries.insertDevicePower(trx, {
				device_id: id,
				min_voltage: input.power.minVoltage,
				max_voltage: input.power.maxVoltage,
			});
		}

		if (input.riskLevelOverride === null) {
			// Clearing when nothing is set is a no-op — no SCD churn, no audit entry.
			const existing = await queries.findCurrentRiskLevelOverride(trx, id);
			if (existing) {
				await queries.archiveRiskLevelOverride(trx, id);
				await recordControlAuditLog(trx, session.user_id, "MAN_OVERTOP_OFF", id);
			}
		} else if (input.riskLevelOverride !== undefined) {
			await queries.archiveRiskLevelOverride(trx, id);
			await queries.insertRiskLevelOverride(trx, id, input.riskLevelOverride);
			await recordControlAuditLog(trx, session.user_id, "MAN_OVERTOP_ON", id);
		}
	});

	const row = access.canWriteExternal
		? await queries.findDeviceById(db, id)
		: await queries.findDeviceByIdForClient(db, id, session.client_id);
	if (!row) throw new DeviceNotFoundError(id);
	return toDetailResponse(row);
}
