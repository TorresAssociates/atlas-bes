import type { Kysely } from "kysely";
import type { DB } from "@/db/types";
import type { SessionSubject } from "../auth/service";
import type {
	AlertMonitorConfigActivityOverrideRow,
	AlertMonitorConfigActivityRow,
	AlertMonitorConfigRangeRow,
	AlertMonitorConfigRow,
	AlertMonitorRow,
	AlertMonitorStatusRow,
	ChannelAlertMonitorRow,
} from "./queries";
import * as queries from "./queries";

export interface AlertMonitorReadAccess {
	canReadExternal: boolean;
}

export interface AlertMonitorWriteAccess {
	canWriteExternal: boolean;
}

export interface CreateAlertMonitorInput {
	device_id: number;
	local_id: number;
	type_id: number;
}

export interface CreateAlertMonitorConfigInput {
	alert_monitor_id: number;
	alert_id: number;
}

export interface CreateAlertMonitorActivityInput {
	alert_monitor_id: number;
	active: boolean;
}

export interface CreateAlertMonitorActivityOverrideInput {
	alert_monitor_id: number;
	override: boolean | null;
}

export interface CreateChannelAlertMonitorInput {
	alert_monitor_id: number;
	channel_id: number;
}

export interface CreateAlertMonitorRangeInput {
	alert_monitor_id: number;
	min_value: number;
	max_value: number;
}

type TimelineRow = {
	introduced: Date | string;
	archived: Date | string | null;
};
type Serialized<T extends TimelineRow> = Omit<T, "introduced" | "archived"> & {
	introduced: string;
	archived: string | null;
};

export interface AlertMonitorRecordResponse {
	alert_monitor: Serialized<AlertMonitorRow>;
	configs: Serialized<AlertMonitorConfigRow>[];
	activities: Serialized<AlertMonitorConfigActivityRow>[];
	activity_overrides: Serialized<AlertMonitorConfigActivityOverrideRow>[];
	channel_links: Serialized<ChannelAlertMonitorRow>[];
	ranges: Serialized<AlertMonitorConfigRangeRow>[];
}

export interface AlertMonitorStatusResponse {
	alert_monitor_id: number;
	device_id: number;
	local_id: number;
	type_id: number;
	alert_id: number;
	active: boolean;
	override: boolean | null;
	channel_id: number;
	range: { id: number; min_value: number; max_value: number } | null;
	latest_measurement_record: {
		id: string;
		date: string;
		value: number | null;
	} | null;
	gauge_station: { id: number; name: string; location: string };
}

export class AlertMonitorNotFoundError extends Error {
	constructor(alertMonitorId: number) {
		super(
			`alert monitor ${alertMonitorId} does not exist or is not available to your client`,
		);
		this.name = "AlertMonitorNotFoundError";
	}
}

export class AlertMonitorDeviceNotFoundError extends Error {
	constructor(deviceId: number) {
		super(
			`device ${deviceId} does not exist or is not available to your client`,
		);
		this.name = "AlertMonitorDeviceNotFoundError";
	}
}

export class AlertMonitorChannelNotFoundError extends Error {
	constructor(channelId: number) {
		super(
			`channel ${channelId} does not exist or is not available to your client`,
		);
		this.name = "AlertMonitorChannelNotFoundError";
	}
}

export class AlertMonitorAlertNotFoundError extends Error {
	constructor(alertId: number) {
		super(`alert ${alertId} does not exist`);
		this.name = "AlertMonitorAlertNotFoundError";
	}
}

export class AlertMonitorRelationshipError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AlertMonitorRelationshipError";
	}
}

function toIso(value: Date | string): string {
	return new Date(value).toISOString();
}

function serialize<T extends TimelineRow>(row: T): Serialized<T> {
	return {
		...row,
		introduced: toIso(row.introduced),
		archived: row.archived === null ? null : toIso(row.archived),
	};
}

async function findAccessibleMonitor(
	db: Kysely<DB>,
	alertMonitorId: number,
	session: SessionSubject,
	access: AlertMonitorWriteAccess | AlertMonitorReadAccess,
): Promise<AlertMonitorRow> {
	const canAccessExternal =
		"canWriteExternal" in access
			? access.canWriteExternal
			: access.canReadExternal;
	const monitor = canAccessExternal
		? await queries.findAlertMonitorById(db, alertMonitorId)
		: await queries.findAlertMonitorByIdForClient(
				db,
				alertMonitorId,
				session.client_id,
			);
	if (!monitor) throw new AlertMonitorNotFoundError(alertMonitorId);
	return monitor;
}

async function ensureDeviceIsAccessible(
	db: Kysely<DB>,
	deviceId: number,
	session: SessionSubject,
	access: AlertMonitorWriteAccess,
): Promise<void> {
	const device = access.canWriteExternal
		? await queries.findDeviceById(db, deviceId)
		: await queries.findDeviceByIdForClient(
				db,
				deviceId,
				session.client_id,
			);
	if (!device) throw new AlertMonitorDeviceNotFoundError(deviceId);
}

async function ensureAlertExists(
	db: Kysely<DB>,
	alertId: number,
): Promise<void> {
	const alert = await queries.findAlertById(db, alertId);
	if (!alert) throw new AlertMonitorAlertNotFoundError(alertId);
}

export async function listAlertMonitors(
	db: Kysely<DB>,
	session: SessionSubject,
	access: AlertMonitorReadAccess,
): Promise<AlertMonitorRecordResponse[]> {
	const monitors = access.canReadExternal
		? await queries.listAlertMonitors(db)
		: await queries.listAlertMonitorsForClient(db, session.client_id);
	const [configs, activities, overrides, channelLinks, ranges] =
		access.canReadExternal
			? await Promise.all([
					queries.listConfigs(db),
					queries.listActivities(db),
					queries.listActivityOverrides(db),
					queries.listChannelLinks(db),
					queries.listRanges(db),
				])
			: await Promise.all([
					queries.listConfigsForClient(db, session.client_id),
					queries.listActivitiesForClient(db, session.client_id),
					queries.listActivityOverridesForClient(
						db,
						session.client_id,
					),
					queries.listChannelLinksForClient(db, session.client_id),
					queries.listRangesForClient(db, session.client_id),
				]);

	return monitors.map((monitor) => ({
		alert_monitor: serialize(monitor),
		configs: configs
			.filter((row) => row.alert_monitor_id === monitor.id)
			.map(serialize),
		activities: activities
			.filter((row) => row.alert_monitor_id === monitor.id)
			.map(serialize),
		activity_overrides: overrides
			.filter((row) => row.alert_monitor_id === monitor.id)
			.map(serialize),
		channel_links: channelLinks
			.filter((row) => row.alert_monitor_id === monitor.id)
			.map(serialize),
		ranges: ranges
			.filter((row) => row.alert_monitor_id === monitor.id)
			.map(serialize),
	}));
}

function toStatusResponse(
	row: AlertMonitorStatusRow,
): AlertMonitorStatusResponse {
	return {
		alert_monitor_id: row.alert_monitor_id,
		device_id: row.device_id,
		local_id: row.local_id,
		type_id: row.type_id,
		alert_id: row.alert_id,
		active: row.active,
		override: row.override,
		channel_id: row.channel_id,
		range:
			row.range_id === null ||
			row.min_value === null ||
			row.max_value === null
				? null
				: {
						id: row.range_id,
						min_value: row.min_value,
						max_value: row.max_value,
					},
		latest_measurement_record:
			row.latest_measurement_record_id === null ||
			row.latest_measurement_record_date === null
				? null
				: {
						id: String(row.latest_measurement_record_id),
						date: toIso(row.latest_measurement_record_date),
						value: row.latest_measurement_record_value,
					},
		gauge_station: {
			id: row.gauge_station_id,
			name: row.gauge_station_name,
			location: row.gauge_station_location,
		},
	};
}

export async function listAlertMonitorStatuses(
	db: Kysely<DB>,
	session: SessionSubject,
	access: AlertMonitorReadAccess,
): Promise<AlertMonitorStatusResponse[]> {
	const rows = access.canReadExternal
		? await queries.listAlertMonitorStatuses(db)
		: await queries.listAlertMonitorStatusesForClient(
				db,
				session.client_id,
			);
	return rows.map(toStatusResponse);
}

export async function listConfigs(
	db: Kysely<DB>,
	session: SessionSubject,
	access: AlertMonitorReadAccess,
) {
	const rows = access.canReadExternal
		? await queries.listConfigs(db)
		: await queries.listConfigsForClient(db, session.client_id);
	return rows.map(serialize);
}

export async function listActivities(
	db: Kysely<DB>,
	session: SessionSubject,
	access: AlertMonitorReadAccess,
) {
	const rows = access.canReadExternal
		? await queries.listActivities(db)
		: await queries.listActivitiesForClient(db, session.client_id);
	return rows.map(serialize);
}

export async function listActivityOverrides(
	db: Kysely<DB>,
	session: SessionSubject,
	access: AlertMonitorReadAccess,
) {
	const rows = access.canReadExternal
		? await queries.listActivityOverrides(db)
		: await queries.listActivityOverridesForClient(db, session.client_id);
	return rows.map(serialize);
}

export async function listChannelLinks(
	db: Kysely<DB>,
	session: SessionSubject,
	access: AlertMonitorReadAccess,
) {
	const rows = access.canReadExternal
		? await queries.listChannelLinks(db)
		: await queries.listChannelLinksForClient(db, session.client_id);
	return rows.map(serialize);
}

export async function listRanges(
	db: Kysely<DB>,
	session: SessionSubject,
	access: AlertMonitorReadAccess,
) {
	const rows = access.canReadExternal
		? await queries.listRanges(db)
		: await queries.listRangesForClient(db, session.client_id);
	return rows.map(serialize);
}

export async function createAlertMonitor(
	db: Kysely<DB>,
	session: SessionSubject,
	access: AlertMonitorWriteAccess,
	input: CreateAlertMonitorInput,
) {
	await ensureDeviceIsAccessible(db, input.device_id, session, access);
	return serialize(await queries.insertAlertMonitor(db, input));
}

export async function createConfig(
	db: Kysely<DB>,
	session: SessionSubject,
	access: AlertMonitorWriteAccess,
	input: CreateAlertMonitorConfigInput,
) {
	await findAccessibleMonitor(db, input.alert_monitor_id, session, access);
	await ensureAlertExists(db, input.alert_id);
	return serialize(await queries.insertConfig(db, input));
}

export async function createActivity(
	db: Kysely<DB>,
	session: SessionSubject,
	access: AlertMonitorWriteAccess,
	input: CreateAlertMonitorActivityInput,
) {
	await findAccessibleMonitor(db, input.alert_monitor_id, session, access);
	return serialize(await queries.insertActivity(db, input));
}

export async function createActivityOverride(
	db: Kysely<DB>,
	session: SessionSubject,
	access: AlertMonitorWriteAccess,
	input: CreateAlertMonitorActivityOverrideInput,
) {
	await findAccessibleMonitor(db, input.alert_monitor_id, session, access);
	return serialize(await queries.insertActivityOverride(db, input));
}

export async function createChannelLink(
	db: Kysely<DB>,
	session: SessionSubject,
	access: AlertMonitorWriteAccess,
	input: CreateChannelAlertMonitorInput,
) {
	const monitor = await findAccessibleMonitor(
		db,
		input.alert_monitor_id,
		session,
		access,
	);
	const channel = access.canWriteExternal
		? await queries.findChannelById(db, input.channel_id)
		: await queries.findChannelByIdForClient(
				db,
				input.channel_id,
				session.client_id,
			);
	if (!channel) throw new AlertMonitorChannelNotFoundError(input.channel_id);
	if (channel.device_id !== monitor.device_id) {
		throw new AlertMonitorRelationshipError(
			"channel must belong to the same device as the alert monitor",
		);
	}
	return serialize(await queries.insertChannelLink(db, input));
}

export async function createRange(
	db: Kysely<DB>,
	session: SessionSubject,
	access: AlertMonitorWriteAccess,
	input: CreateAlertMonitorRangeInput,
) {
	await findAccessibleMonitor(db, input.alert_monitor_id, session, access);
	if (input.min_value >= input.max_value) {
		throw new AlertMonitorRelationshipError(
			"min_value must be less than max_value",
		);
	}
	return serialize(await queries.insertRange(db, input));
}
