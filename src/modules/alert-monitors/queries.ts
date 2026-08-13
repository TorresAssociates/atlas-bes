import type { Insertable, Kysely, Selectable } from "kysely";
import type { DB } from "@/db/types";

export type AlertMonitorRow = Selectable<DB["alert_monitor"]>;
export type AlertMonitorConfigRow = Selectable<DB["alert_monitor_config"]>;
export type AlertMonitorConfigActivityRow = Selectable<
	DB["alert_monitor_config_activity"]
>;
export type AlertMonitorConfigActivityOverrideRow = Selectable<
	DB["alert_monitor_config_activity_override"]
>;
export type ChannelAlertMonitorRow = Selectable<DB["channel_alert_monitor"]>;
export type AlertMonitorConfigRangeRow = Selectable<
	DB["alert_monitor_config_range"]
>;
export interface AlertMonitorStatusRow {
	alert_monitor_id: number;
	device_id: number;
	local_id: number;
	type_id: number;
	alert_id: number;
	active: boolean;
	override: boolean | null;
	channel_id: number;
	range_id: number | null;
	min_value: number | null;
	max_value: number | null;
	latest_measurement_record_id: string | number | bigint | null;
	latest_measurement_record_date: Date | string | null;
	latest_measurement_record_value: number | null;
	gauge_station_id: number;
	gauge_station_name: string;
	gauge_station_location: string;
}

type InsertAlertMonitorRow = Insertable<DB["alert_monitor"]>;
type InsertAlertMonitorConfigRow = Insertable<DB["alert_monitor_config"]>;
type InsertAlertMonitorConfigActivityRow = Insertable<
	DB["alert_monitor_config_activity"]
>;
type InsertAlertMonitorConfigActivityOverrideRow = Insertable<
	DB["alert_monitor_config_activity_override"]
>;
type InsertChannelAlertMonitorRow = Insertable<DB["channel_alert_monitor"]>;
type InsertAlertMonitorConfigRangeRow = Insertable<
	DB["alert_monitor_config_range"]
>;

const alertMonitorColumns = [
	"id",
	"device_id",
	"local_id",
	"type_id",
	"introduced",
	"archived",
] as const;
const configColumns = [
	"id",
	"alert_monitor_id",
	"alert_id",
	"introduced",
	"archived",
] as const;
const activityColumns = [
	"id",
	"alert_monitor_id",
	"active",
	"introduced",
	"archived",
] as const;
const overrideColumns = [
	"id",
	"alert_monitor_id",
	"override",
	"introduced",
	"archived",
] as const;
const channelLinkColumns = [
	"id",
	"alert_monitor_id",
	"channel_id",
	"introduced",
	"archived",
] as const;
const rangeColumns = [
	"id",
	"alert_monitor_id",
	"min_value",
	"max_value",
	"introduced",
	"archived",
] as const;

function scopedDeviceIds(db: Kysely<DB>, clientId: number) {
	return db
		.selectFrom("device")
		.innerJoin("device_info", "device_info.device_id", "device.id")
		.innerJoin(
			"gauge_station",
			"gauge_station.id",
			"device_info.gauge_station_id",
		)
		.innerJoin(
			"client_gauge_station",
			"client_gauge_station.gauge_station_id",
			"gauge_station.id",
		)
		.select("device.id")
		.where("device.archived", "is", null)
		.where("device_info.archived", "is", null)
		.where("gauge_station.archived", "is", null)
		.where("client_gauge_station.client_id", "=", clientId);
}

function scopedMonitorIds(db: Kysely<DB>, clientId: number) {
	return db
		.selectFrom("alert_monitor")
		.select("alert_monitor.id")
		.where("alert_monitor.archived", "is", null)
		.where("alert_monitor.device_id", "in", scopedDeviceIds(db, clientId));
}

export function listAlertMonitors(db: Kysely<DB>): Promise<AlertMonitorRow[]> {
	return db
		.selectFrom("alert_monitor")
		.select(alertMonitorColumns)
		.where("archived", "is", null)
		.orderBy("device_id", "asc")
		.orderBy("local_id", "asc")
		.orderBy("id", "asc")
		.execute();
}

export function listAlertMonitorsForClient(
	db: Kysely<DB>,
	clientId: number,
): Promise<AlertMonitorRow[]> {
	return db
		.selectFrom("alert_monitor")
		.select(alertMonitorColumns)
		.where("archived", "is", null)
		.where("device_id", "in", scopedDeviceIds(db, clientId))
		.orderBy("device_id", "asc")
		.orderBy("local_id", "asc")
		.orderBy("id", "asc")
		.execute();
}

function alertMonitorStatusQuery(db: Kysely<DB>) {
	return db
		.selectFrom("alert_monitor")
		.innerJoin("alert_monitor_config", (join) =>
			join
				.onRef(
					"alert_monitor_config.alert_monitor_id",
					"=",
					"alert_monitor.id",
				)
				.on("alert_monitor_config.archived", "is", null),
		)
		.innerJoin("alert_monitor_config_activity", (join) =>
			join
				.onRef(
					"alert_monitor_config_activity.alert_monitor_id",
					"=",
					"alert_monitor.id",
				)
				.on("alert_monitor_config_activity.archived", "is", null),
		)
		.innerJoin("channel_alert_monitor", (join) =>
			join
				.onRef(
					"channel_alert_monitor.alert_monitor_id",
					"=",
					"alert_monitor.id",
				)
				.on("channel_alert_monitor.archived", "is", null),
		)
		.leftJoin("alert_monitor_config_activity_override", (join) =>
			join
				.onRef(
					"alert_monitor_config_activity_override.alert_monitor_id",
					"=",
					"alert_monitor.id",
				)
				.on(
					"alert_monitor_config_activity_override.archived",
					"is",
					null,
				),
		)
		.leftJoin("alert_monitor_config_range", (join) =>
			join
				.onRef(
					"alert_monitor_config_range.alert_monitor_id",
					"=",
					"alert_monitor.id",
				)
				.on("alert_monitor_config_range.archived", "is", null),
		)
		.innerJoin("device", "device.id", "alert_monitor.device_id")
		.innerJoin("device_info", (join) =>
			join
				.onRef("device_info.device_id", "=", "device.id")
				.on("device_info.archived", "is", null),
		)
		.innerJoin(
			"gauge_station",
			"gauge_station.id",
			"device_info.gauge_station_id",
		)
		.innerJoin("gauge_station_info", (join) =>
			join
				.onRef(
					"gauge_station_info.gauge_station_id",
					"=",
					"gauge_station.id",
				)
				.on("gauge_station_info.archived", "is", null),
		)
		.leftJoin(
			"latest_measurement_record",
			"latest_measurement_record.channel_id",
			"channel_alert_monitor.channel_id",
		)
		.select([
			"alert_monitor.id as alert_monitor_id",
			"alert_monitor.device_id",
			"alert_monitor.local_id",
			"alert_monitor.type_id",
			"alert_monitor_config.alert_id",
			"alert_monitor_config_activity.active",
			"alert_monitor_config_activity_override.override",
			"channel_alert_monitor.channel_id",
			"alert_monitor_config_range.id as range_id",
			"alert_monitor_config_range.min_value",
			"alert_monitor_config_range.max_value",
			"latest_measurement_record.id as latest_measurement_record_id",
			"latest_measurement_record.date as latest_measurement_record_date",
			"latest_measurement_record.value as latest_measurement_record_value",
			"gauge_station.id as gauge_station_id",
			"gauge_station.name as gauge_station_name",
			"gauge_station_info.location as gauge_station_location",
		])
		.where("alert_monitor.archived", "is", null)
		.where("device.archived", "is", null)
		.where("gauge_station.archived", "is", null);
}

export function listAlertMonitorStatuses(
	db: Kysely<DB>,
): Promise<AlertMonitorStatusRow[]> {
	return alertMonitorStatusQuery(db)
		.orderBy("alert_monitor.device_id", "asc")
		.orderBy("alert_monitor.local_id", "asc")
		.orderBy("channel_alert_monitor.channel_id", "asc")
		.orderBy("alert_monitor_config_range.id", "asc")
		.execute();
}

export function listAlertMonitorStatusesForClient(
	db: Kysely<DB>,
	clientId: number,
): Promise<AlertMonitorStatusRow[]> {
	return alertMonitorStatusQuery(db)
		.where("alert_monitor.device_id", "in", scopedDeviceIds(db, clientId))
		.orderBy("alert_monitor.device_id", "asc")
		.orderBy("alert_monitor.local_id", "asc")
		.orderBy("channel_alert_monitor.channel_id", "asc")
		.orderBy("alert_monitor_config_range.id", "asc")
		.execute();
}

export function findAlertMonitorById(
	db: Kysely<DB>,
	id: number,
): Promise<AlertMonitorRow | undefined> {
	return db
		.selectFrom("alert_monitor")
		.select(alertMonitorColumns)
		.where("id", "=", id)
		.where("archived", "is", null)
		.executeTakeFirst();
}

export function findAlertMonitorByIdForClient(
	db: Kysely<DB>,
	id: number,
	clientId: number,
): Promise<AlertMonitorRow | undefined> {
	return db
		.selectFrom("alert_monitor")
		.select(alertMonitorColumns)
		.where("id", "=", id)
		.where("archived", "is", null)
		.where("device_id", "in", scopedDeviceIds(db, clientId))
		.executeTakeFirst();
}

export function findDeviceById(
	db: Kysely<DB>,
	id: number,
): Promise<{ id: number } | undefined> {
	return db
		.selectFrom("device")
		.select("id")
		.where("id", "=", id)
		.where("archived", "is", null)
		.executeTakeFirst();
}

export function findDeviceByIdForClient(
	db: Kysely<DB>,
	id: number,
	clientId: number,
): Promise<{ id: number } | undefined> {
	return scopedDeviceIds(db, clientId)
		.where("device.id", "=", id)
		.executeTakeFirst();
}

export function findChannelById(
	db: Kysely<DB>,
	id: number,
): Promise<{ id: number; device_id: number } | undefined> {
	return db
		.selectFrom("channel")
		.select(["id", "device_id"])
		.where("id", "=", id)
		.where("archived", "is", null)
		.executeTakeFirst();
}

export function findChannelByIdForClient(
	db: Kysely<DB>,
	id: number,
	clientId: number,
): Promise<{ id: number; device_id: number } | undefined> {
	return db
		.selectFrom("channel")
		.select(["id", "device_id"])
		.where("id", "=", id)
		.where("archived", "is", null)
		.where("device_id", "in", scopedDeviceIds(db, clientId))
		.executeTakeFirst();
}

export function findAlertById(
	db: Kysely<DB>,
	id: number,
): Promise<{ id: number } | undefined> {
	return db
		.selectFrom("alert")
		.select("id")
		.where("id", "=", id)
		.executeTakeFirst();
}

export function listConfigs(db: Kysely<DB>): Promise<AlertMonitorConfigRow[]> {
	return db
		.selectFrom("alert_monitor_config")
		.select(configColumns)
		.where("archived", "is", null)
		.orderBy("alert_monitor_id")
		.orderBy("id")
		.execute();
}

export function listConfigsForClient(
	db: Kysely<DB>,
	clientId: number,
): Promise<AlertMonitorConfigRow[]> {
	return db
		.selectFrom("alert_monitor_config")
		.select(configColumns)
		.where("archived", "is", null)
		.where("alert_monitor_id", "in", scopedMonitorIds(db, clientId))
		.orderBy("alert_monitor_id")
		.orderBy("id")
		.execute();
}

export function listActivities(
	db: Kysely<DB>,
): Promise<AlertMonitorConfigActivityRow[]> {
	return db
		.selectFrom("alert_monitor_config_activity")
		.select(activityColumns)
		.where("archived", "is", null)
		.orderBy("alert_monitor_id")
		.orderBy("id")
		.execute();
}

export function listActivitiesForClient(
	db: Kysely<DB>,
	clientId: number,
): Promise<AlertMonitorConfigActivityRow[]> {
	return db
		.selectFrom("alert_monitor_config_activity")
		.select(activityColumns)
		.where("archived", "is", null)
		.where("alert_monitor_id", "in", scopedMonitorIds(db, clientId))
		.orderBy("alert_monitor_id")
		.orderBy("id")
		.execute();
}

export function listActivityOverrides(
	db: Kysely<DB>,
): Promise<AlertMonitorConfigActivityOverrideRow[]> {
	return db
		.selectFrom("alert_monitor_config_activity_override")
		.select(overrideColumns)
		.where("archived", "is", null)
		.orderBy("alert_monitor_id")
		.orderBy("id")
		.execute();
}

export function listActivityOverridesForClient(
	db: Kysely<DB>,
	clientId: number,
): Promise<AlertMonitorConfigActivityOverrideRow[]> {
	return db
		.selectFrom("alert_monitor_config_activity_override")
		.select(overrideColumns)
		.where("archived", "is", null)
		.where("alert_monitor_id", "in", scopedMonitorIds(db, clientId))
		.orderBy("alert_monitor_id")
		.orderBy("id")
		.execute();
}

export function listChannelLinks(
	db: Kysely<DB>,
): Promise<ChannelAlertMonitorRow[]> {
	return db
		.selectFrom("channel_alert_monitor")
		.select(channelLinkColumns)
		.where("archived", "is", null)
		.orderBy("alert_monitor_id")
		.orderBy("channel_id")
		.orderBy("id")
		.execute();
}

export function listChannelLinksForClient(
	db: Kysely<DB>,
	clientId: number,
): Promise<ChannelAlertMonitorRow[]> {
	return db
		.selectFrom("channel_alert_monitor")
		.select(channelLinkColumns)
		.where("archived", "is", null)
		.where("alert_monitor_id", "in", scopedMonitorIds(db, clientId))
		.orderBy("alert_monitor_id")
		.orderBy("channel_id")
		.orderBy("id")
		.execute();
}

export function listRanges(
	db: Kysely<DB>,
): Promise<AlertMonitorConfigRangeRow[]> {
	return db
		.selectFrom("alert_monitor_config_range")
		.select(rangeColumns)
		.where("archived", "is", null)
		.orderBy("alert_monitor_id")
		.orderBy("id")
		.execute();
}

export function listRangesForClient(
	db: Kysely<DB>,
	clientId: number,
): Promise<AlertMonitorConfigRangeRow[]> {
	return db
		.selectFrom("alert_monitor_config_range")
		.select(rangeColumns)
		.where("archived", "is", null)
		.where("alert_monitor_id", "in", scopedMonitorIds(db, clientId))
		.orderBy("alert_monitor_id")
		.orderBy("id")
		.execute();
}

export function insertAlertMonitor(
	db: Kysely<DB>,
	row: InsertAlertMonitorRow,
): Promise<AlertMonitorRow> {
	return db
		.insertInto("alert_monitor")
		.values(row)
		.returning(alertMonitorColumns)
		.executeTakeFirstOrThrow();
}

export function insertConfig(
	db: Kysely<DB>,
	row: InsertAlertMonitorConfigRow,
): Promise<AlertMonitorConfigRow> {
	return db
		.insertInto("alert_monitor_config")
		.values(row)
		.returning(configColumns)
		.executeTakeFirstOrThrow();
}

export function insertActivity(
	db: Kysely<DB>,
	row: InsertAlertMonitorConfigActivityRow,
): Promise<AlertMonitorConfigActivityRow> {
	return db
		.insertInto("alert_monitor_config_activity")
		.values(row)
		.returning(activityColumns)
		.executeTakeFirstOrThrow();
}

export function insertActivityOverride(
	db: Kysely<DB>,
	row: InsertAlertMonitorConfigActivityOverrideRow,
): Promise<AlertMonitorConfigActivityOverrideRow> {
	return db
		.insertInto("alert_monitor_config_activity_override")
		.values(row)
		.returning(overrideColumns)
		.executeTakeFirstOrThrow();
}

export function insertChannelLink(
	db: Kysely<DB>,
	row: InsertChannelAlertMonitorRow,
): Promise<ChannelAlertMonitorRow> {
	return db
		.insertInto("channel_alert_monitor")
		.values(row)
		.returning(channelLinkColumns)
		.executeTakeFirstOrThrow();
}

export function insertRange(
	db: Kysely<DB>,
	row: InsertAlertMonitorConfigRangeRow,
): Promise<AlertMonitorConfigRangeRow> {
	return db
		.insertInto("alert_monitor_config_range")
		.values(row)
		.returning(rangeColumns)
		.executeTakeFirstOrThrow();
}
