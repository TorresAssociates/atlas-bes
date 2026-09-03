import { expressionBuilder, type Kysely, type RawBuilder, sql } from "kysely";
import { jsonArrayFrom } from "kysely/helpers/postgres";
import type { DB, DeviceType } from "@/db/types";

export interface DeviceListFilters {
	gaugeStationId?: number;
	type?: DeviceType;
	active?: boolean;
	connected?: boolean;
	includeArchived?: boolean;
}

function validAt(table: string, at?: Date): RawBuilder<boolean> {
	const introduced = sql.ref(`${table}.introduced`);
	const archived = sql.ref(`${table}.archived`);
	if (at === undefined) return sql<boolean>`${archived} IS NULL`;
	return sql<boolean>`${introduced} <= ${at} AND (${archived} IS NULL OR ${archived} > ${at})`;
}

function deviceLinkedToClient(clientId: number) {
	const eb = expressionBuilder<DB, "device_info">();
	return eb.exists(
		eb
			.selectFrom("client_gauge_station")
			.select("client_gauge_station.id")
			.whereRef("client_gauge_station.gauge_station_id", "=", "device_info.gauge_station_id")
			.where("client_gauge_station.client_id", "=", clientId),
	);
}

const riskLevelCase = sql<number | null>`CASE
	WHEN risk_level_monitor_config_range.id IS NOT NULL
		AND measurement_record_latest.value >= risk_level_monitor_config_range.min_value
		AND measurement_record_latest.value <= risk_level_monitor_config_range.max_value
		THEN risk_level_monitor_config_range.risk_level
	WHEN risk_level_monitor_config_gradient.id IS NOT NULL
		AND measurement_record_latest.value IS NOT NULL
		THEN risk_level_monitor_config_gradient.begin_risk_level
			+ (risk_level_monitor_config_gradient.end_risk_level - risk_level_monitor_config_gradient.begin_risk_level)
			* LEAST(1, GREATEST(0,
				(measurement_record_latest.value - risk_level_monitor_config_gradient.begin_value)
				/ NULLIF(risk_level_monitor_config_gradient.end_value - risk_level_monitor_config_gradient.begin_value, 0)))
END`;


function riskLevelMonitorJoins() {
	const eb = expressionBuilder<DB, "device">();
	return eb
		.selectFrom("risk_level_monitor")
		.innerJoin("risk_level_monitor_config", (join) =>
			join
				.onRef(
					"risk_level_monitor_config.risk_level_monitor_id",
					"=",
					"risk_level_monitor.id",
				)
				.on(validAt("risk_level_monitor_config")),
		)
		.innerJoin("risk_level_monitor_channel", (join) =>
			join
				.onRef(
					"risk_level_monitor_channel.risk_level_monitor_id",
					"=",
					"risk_level_monitor.id",
				)
				.on(validAt("risk_level_monitor_channel")),
		)
		.leftJoin(
			"measurement_record_latest",
			"measurement_record_latest.channel_id",
			"risk_level_monitor_channel.channel_id",
		)
		.leftJoin("risk_level_monitor_config_range", (join) =>
			join
				.onRef(
					"risk_level_monitor_config_range.risk_level_monitor_id",
					"=",
					"risk_level_monitor.id",
				)
				.on(validAt("risk_level_monitor_config_range")),
		)
		.leftJoin("risk_level_monitor_config_gradient", (join) =>
			join
				.onRef(
					"risk_level_monitor_config_gradient.risk_level_monitor_id",
					"=",
					"risk_level_monitor.id",
				)
				.on(validAt("risk_level_monitor_config_gradient")),
		)
		.whereRef("risk_level_monitor.device_id", "=", "device.id")
		.where(validAt("risk_level_monitor"));
}

function deviceRiskLevel(at?: Date) {
	let query = riskLevelMonitorJoins().select(
		sql<
			number | null
		>`(ARRAY_AGG(${riskLevelCase} ORDER BY risk_level_monitor_config.priority, ${riskLevelCase} DESC) FILTER (WHERE ${riskLevelCase} IS NOT NULL))[1]`.as(
			"risk_level",
		),
	);
	if (at !== undefined) query = query.where(sql<boolean>`FALSE`);
	return query;
}

function deviceRiskLevelConfigRanges(at?: Date) {
	const eb = expressionBuilder<DB, "device">();
	let query = eb
		.selectFrom("risk_level_monitor_config_range")
		.innerJoin(
			"risk_level_monitor",
			"risk_level_monitor.id",
			"risk_level_monitor_config_range.risk_level_monitor_id",
		)
		.leftJoin("risk_level_monitor_channel", (join) =>
			join
				.onRef(
					"risk_level_monitor_channel.risk_level_monitor_id",
					"=",
					"risk_level_monitor.id",
				)
				.on(validAt("risk_level_monitor_channel")),
		)
		.leftJoin("channel_config", (join) =>
			join
				.onRef("channel_config.channel_id", "=", "risk_level_monitor_channel.channel_id")
				.on(validAt("channel_config")),
		)
		.select([
			// Migrated bands use float ±infinity for open bounds, which Postgres
			// renders as the JSON strings "Infinity"/"-Infinity" inside json_agg
			// and would fail response serialization — surface them as null.
			sql<
				number | null
			>`NULLIF(${sql.ref("risk_level_monitor_config_range.min_value")}, '-infinity'::float8)`.as(
				"min_value",
			),
			sql<
				number | null
			>`NULLIF(${sql.ref("risk_level_monitor_config_range.max_value")}, 'infinity'::float8)`.as(
				"max_value",
			),
			"risk_level_monitor_config_range.risk_level",
			sql<string | null>`CASE
				WHEN COUNT(DISTINCT ${sql.ref("channel_config.category")}) = 1
					THEN MIN(${sql.ref("channel_config.category")})
				ELSE NULL
			END`.as("category"),
		])
		.groupBy([
			"risk_level_monitor_config_range.min_value",
			"risk_level_monitor_config_range.max_value",
			"risk_level_monitor_config_range.risk_level",
		])
		.whereRef("risk_level_monitor.device_id", "=", "device.id")
		.where(validAt("risk_level_monitor"))
		.where(validAt("risk_level_monitor_config_range"))
		.orderBy("risk_level_monitor_config_range.min_value")
		.orderBy("risk_level_monitor_config_range.risk_level");
	if (at !== undefined) query = query.where(sql<boolean>`FALSE`);
	return query;
}

function deviceRiskLevelOverrideValue(at?: Date) {
	const eb = expressionBuilder<DB, "device">();
	return eb
		.selectFrom("risk_level_monitor_config_override")
		.select("risk_level_monitor_config_override.risk_level")
		.whereRef("risk_level_monitor_config_override.device_id", "=", "device.id")
		.where(validAt("risk_level_monitor_config_override", at))
		.orderBy("risk_level_monitor_config_override.introduced", "desc")
		.limit(1);
}

// A manual override (the old system's "overtopping") beats the computed monitor
// risk for as long as an unarchived override row exists for the device.
function deviceEffectiveRiskLevel(at?: Date) {
	return sql<
		number | null
	>`COALESCE((${deviceRiskLevelOverrideValue(at)}), (${deviceRiskLevel(at)}))`;
}

function deviceRiskLevels(at?: Date) {
	let query = riskLevelMonitorJoins()
		.select([
			"risk_level_monitor.id as monitor_id",
			"risk_level_monitor_channel.channel_id",
			"risk_level_monitor_config.priority",
			"measurement_record_latest.date",
			"measurement_record_latest.value",
		])
		.select(sql<number | null>`MAX(${riskLevelCase})`.as("risk_level"))
		.groupBy([
			"risk_level_monitor.id",
			"risk_level_monitor_channel.channel_id",
			"risk_level_monitor_config.priority",
			"measurement_record_latest.date",
			"measurement_record_latest.value",
		])
		.orderBy("risk_level_monitor_config.priority")
		.orderBy("risk_level_monitor.id");
	if (at !== undefined) query = query.where(sql<boolean>`FALSE`);
	return query;
}

// The list/map shape: device + device_info + device_connected + risk level.
function deviceSummarySelect(db: Kysely<DB>, at?: Date) {
	return db
		.selectFrom("device")
		.innerJoin("device_info", (join) =>
			join.onRef("device_info.device_id", "=", "device.id").on(validAt("device_info", at)),
		)
		.leftJoin("device_connected", (join) =>
			join
				.onRef("device_connected.device_id", "=", "device.id")
				.on(validAt("device_connected", at)),
		)
		.select([
			"device.id",
			"device.serial_number",
			"device_info.type",
			"device_info.gauge_station_id",
			"device_info.latitude",
			"device_info.longitude",
			"device_info.active",
			"device_connected.connected",
			deviceEffectiveRiskLevel(at).as("risk_level"),
			deviceRiskLevelOverrideValue(at).as("risk_level_override"),
			"device_info.display_name",
		])
		.select(() => [
			jsonArrayFrom(deviceRiskLevelConfigRanges(at)).as("risk_level_config_ranges"),
		]);
}

type DeviceSummarySelect = ReturnType<typeof deviceSummarySelect>;

export type DeviceSummaryRow = Awaited<ReturnType<DeviceSummarySelect["execute"]>>[number];

function deviceDetailSelect(db: Kysely<DB>, at?: Date) {
	return db
		.selectFrom("device")
		.innerJoin("device_info", (join) =>
			join.onRef("device_info.device_id", "=", "device.id").on(validAt("device_info", at)),
		)
		.leftJoin("device_connected", (join) =>
			join
				.onRef("device_connected.device_id", "=", "device.id")
				.on(validAt("device_connected", at)),
		)
		.leftJoin("device_networking", (join) =>
			join
				.onRef("device_networking.device_id", "=", "device.id")
				.on(validAt("device_networking", at)),
		)
		.leftJoin("device_wifi_interface_active", (join) =>
			join
				.onRef("device_wifi_interface_active.device_id", "=", "device.id")
				.on(validAt("device_wifi_interface_active", at)),
		)
		.leftJoin("device_power", (join) =>
			join.onRef("device_power.device_id", "=", "device.id").on(validAt("device_power", at)),
		)
		.leftJoin("device_datalogging", (join) =>
			join
				.onRef("device_datalogging.device_id", "=", "device.id")
				.on(validAt("device_datalogging", at)),
		)
		.leftJoin("device_connection_quality", (join) =>
			join
				.onRef("device_connection_quality.device_id", "=", "device.id")
				.on(validAt("device_connection_quality", at)),
		)
		.leftJoin("device_camera_trigger_override", (join) =>
			join
				.onRef("device_camera_trigger_override.device_id", "=", "device.id")
				.on(validAt("device_camera_trigger_override", at)),
		)
		.leftJoin("device_camera_trigger", (join) =>
			join
				.onRef("device_camera_trigger.device_id", "=", "device.id")
				.on(validAt("device_camera_trigger", at)),
		)
		.leftJoin("device_sim_active", (join) =>
			join
				.onRef("device_sim_active.device_id", "=", "device.id")
				.on(validAt("device_sim_active", at)),
		)
		.select(() => {
			const eb = expressionBuilder<DB, "device" | "device_sim_active">();
			return [
				jsonArrayFrom(
					eb
						.selectFrom("device_sim")
						.innerJoin("sim", "sim.id", "device_sim.sim_id")
						.select([
							"device_sim.sim_id",
							"sim.iccid",
							"sim.provider",
							"device_sim.sim_index",
							sql<boolean>`COALESCE(${sql.ref("device_sim.sim_index")} = ${sql.ref("device_sim_active.active_sim_index")}, FALSE)`.as(
								"is_active",
							),
						])
						.whereRef("device_sim.device_id", "=", "device.id")
						.where(validAt("device_sim", at))
						.orderBy("device_sim.sim_index"),
				).as("sims"),
				jsonArrayFrom(deviceRiskLevels(at)).as("risk_levels"),
				jsonArrayFrom(deviceRiskLevelConfigRanges(at)).as("risk_level_config_ranges"),
			];
		})
		.select([
			"device.id",
			"device.serial_number",
			"device.introduced",
			"device.archived",
			"device_info.type",
			"device_info.gauge_station_id",
			"device_info.page_version",
			"device_info.activation_date",
			"device_info.warranty_end_date",
			"device_info.latitude",
			"device_info.longitude",
			"device_info.active",
			"device_info.display_name",
			"device_connected.connected",
			"device_networking.protocol",
			"device_networking.api_version",
			"device_wifi_interface_active.wifi_active",
			"device_power.min_voltage",
			"device_power.max_voltage",
			"device_datalogging.timestep",
			"device_connection_quality.id as connection_quality_id",
			"device_connection_quality.min_rssi",
			"device_connection_quality.max_rssi",
			"device_connection_quality.min_rsrp",
			"device_connection_quality.max_rsrp",
			"device_connection_quality.min_rsrq",
			"device_connection_quality.max_rsrq",
			"device_camera_trigger_override.id as camera_info_id",
			"device_camera_trigger_override.trigger_override",
			"device_camera_trigger.triggered",
			deviceEffectiveRiskLevel(at).as("risk_level"),
			deviceRiskLevelOverrideValue(at).as("risk_level_override"),
		]);
}

type DeviceDetailSelect = ReturnType<typeof deviceDetailSelect>;

export type DeviceDetailRow = Awaited<ReturnType<DeviceDetailSelect["execute"]>>[number];

function applyDeviceFilters(
	query: DeviceSummarySelect,
	filters: DeviceListFilters,
	at?: Date,
): DeviceSummarySelect {
	if (!filters.includeArchived) query = query.where(validAt("device", at));
	if (filters.gaugeStationId !== undefined)
		query = query.where("device_info.gauge_station_id", "=", filters.gaugeStationId);
	if (filters.type !== undefined) query = query.where("device_info.type", "=", filters.type);
	if (filters.active !== undefined)
		query = query.where("device_info.active", "=", filters.active);
	if (filters.connected !== undefined)
		query = query.where(
			sql<boolean>`COALESCE(${sql.ref("device_connected.connected")}, FALSE) = ${filters.connected}`,
		);
	return query;
}

export function listDevices(
	db: Kysely<DB>,
	filters: DeviceListFilters = {},
	at?: Date,
): Promise<DeviceSummaryRow[]> {
	return applyDeviceFilters(deviceSummarySelect(db, at), filters, at)
		.orderBy("device.serial_number")
		.execute();
}

export function listDevicesForClient(
	db: Kysely<DB>,
	clientId: number,
	filters: DeviceListFilters = {},
	at?: Date,
): Promise<DeviceSummaryRow[]> {
	return applyDeviceFilters(deviceSummarySelect(db, at), filters, at)
		.where(deviceLinkedToClient(clientId))
		.orderBy("device.serial_number")
		.execute();
}

export function findDeviceById(
	db: Kysely<DB>,
	id: number,
	at?: Date,
): Promise<DeviceDetailRow | undefined> {
	return deviceDetailSelect(db, at).where("device.id", "=", id).executeTakeFirst();
}

export function findDeviceByIdForClient(
	db: Kysely<DB>,
	id: number,
	clientId: number,
	at?: Date,
): Promise<DeviceDetailRow | undefined> {
	return deviceDetailSelect(db, at)
		.where("device.id", "=", id)
		.where(deviceLinkedToClient(clientId))
		.executeTakeFirst();
}

export function findGaugeStationById(
	db: Kysely<DB>,
	id: number,
): Promise<{ id: number } | undefined> {
	return db
		.selectFrom("gauge_station")
		.select("id")
		.where("id", "=", id)
		.where("archived", "is", null)
		.executeTakeFirst();
}

export function isGaugeStationLinkedToClient(
	db: Kysely<DB>,
	gaugeStationId: number,
	clientId: number,
): Promise<{ id: number } | undefined> {
	return db
		.selectFrom("client_gauge_station")
		.select("id")
		.where("gauge_station_id", "=", gaugeStationId)
		.where("client_id", "=", clientId)
		.executeTakeFirst();
}

export interface InsertDeviceInfoInput {
	device_id: number;
	gauge_station_id: number | null;
	type: DeviceType;
	page_version: string | null;
	activation_date: Date | string | null;
	warranty_end_date: Date | string | null;
	latitude: number | null;
	longitude: number | null;
	active: boolean | null;
	display_name: string | null;
}

export function insertDeviceInfo(
	db: Kysely<DB>,
	info: InsertDeviceInfoInput,
): Promise<{ id: number }> {
	return db.insertInto("device_info").values(info).returning("id").executeTakeFirstOrThrow();
}

export async function archiveDeviceInfo(db: Kysely<DB>, deviceId: number): Promise<void> {
	await db
		.updateTable("device_info")
		.set({ archived: sql`now()` })
		.where("device_id", "=", deviceId)
		.where("archived", "is", null)
		.execute();
}

export interface InsertDevicePowerInput {
	device_id: number;
	min_voltage: number;
	max_voltage: number;
}

export function insertDevicePower(
	db: Kysely<DB>,
	power: InsertDevicePowerInput,
): Promise<{ id: number }> {
	return db.insertInto("device_power").values(power).returning("id").executeTakeFirstOrThrow();
}

export async function archiveDevicePower(db: Kysely<DB>, deviceId: number): Promise<void> {
	await db
		.updateTable("device_power")
		.set({ archived: sql`now()` })
		.where("device_id", "=", deviceId)
		.where("archived", "is", null)
		.execute();
}

export function findCurrentRiskLevelOverride(
	db: Kysely<DB>,
	deviceId: number,
): Promise<{ id: number; risk_level: number } | undefined> {
	return db
		.selectFrom("risk_level_monitor_config_override")
		.select(["id", "risk_level"])
		.where("device_id", "=", deviceId)
		.where("archived", "is", null)
		.executeTakeFirst();
}

export function insertRiskLevelOverride(
	db: Kysely<DB>,
	deviceId: number,
	riskLevel: number,
): Promise<{ id: number }> {
	return db
		.insertInto("risk_level_monitor_config_override")
		.values({ device_id: deviceId, risk_level: riskLevel })
		.returning("id")
		.executeTakeFirstOrThrow();
}

export async function archiveRiskLevelOverride(db: Kysely<DB>, deviceId: number): Promise<void> {
	await db
		.updateTable("risk_level_monitor_config_override")
		.set({ archived: sql`now()` })
		.where("device_id", "=", deviceId)
		.where("archived", "is", null)
		.execute();
}
