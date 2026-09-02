import { expressionBuilder, type Kysely, type RawBuilder, sql } from "kysely";
import { jsonArrayFrom } from "kysely/helpers/postgres";
import type { DB } from "@/db/types";

export interface GaugeStationListFilters {
	cityId?: number;
	includeArchived?: boolean;
	active?: boolean;
}

// The full read shape: gauge_station joined with its current (archived IS NULL)
// gauge_station_info row and that row's city, plus the linked clients.
function gaugeStationSelect(db: Kysely<DB>) {
	return db
		.selectFrom("gauge_station")
		.innerJoin("gauge_station_info", (join) =>
			join
				.onRef("gauge_station_info.gauge_station_id", "=", "gauge_station.id")
				.on("gauge_station_info.archived", "is", null),
		)
		.innerJoin("city", "city.id", "gauge_station_info.city_id")
		.select((eb) => [
			"gauge_station.id",
			"gauge_station.name",
			"gauge_station.introduced",
			"gauge_station.archived",
			"gauge_station_info.location",
			"gauge_station_info.latitude",
			"gauge_station_info.longitude",
			"gauge_station_info.publicly_visible",
			"gauge_station_info.active",
			"city.id as city_id",
			"city.state as city_state",
			"city.name as city_name",
			jsonArrayFrom(
				eb
					.selectFrom("client_gauge_station")
					.innerJoin("client", "client.id", "client_gauge_station.client_id")
					.select(["client.id", "client.name"])
					.whereRef("client_gauge_station.gauge_station_id", "=", "gauge_station.id")
					.where("client.deleted_at", "is", null)
					.orderBy("client.name"),
			).as("clients"),
		]);
}

type GaugeStationSelect = ReturnType<typeof gaugeStationSelect>;

export type GaugeStationRow = Awaited<ReturnType<GaugeStationSelect["execute"]>>[number];

function applyGaugeStationFilters(query: GaugeStationSelect, filters: GaugeStationListFilters): GaugeStationSelect {
	if (!filters.includeArchived) query = query.where("gauge_station.archived", "is", null);
	if (filters.cityId !== undefined)
		query = query.where("gauge_station_info.city_id", "=", filters.cityId);
	if (filters.active !== undefined)
		query = query.where("gauge_station_info.active", "=", filters.active);
	return query;
}

function linkedToClient(query: GaugeStationSelect, clientId: number): GaugeStationSelect {
	return query.where(({ exists, selectFrom }) =>
		exists(
			selectFrom("client_gauge_station")
				.select("client_gauge_station.id")
				.whereRef("client_gauge_station.gauge_station_id", "=", "gauge_station.id")
				.where("client_gauge_station.client_id", "=", clientId),
		),
	);
}

// --- gauge station risk level --------------------------------------------------------
// Self-contained copy of the per-device risk building blocks in
// src/modules/devices/queries.ts (riskLevelCase / deviceRiskLevel /
// deviceRiskLevelOverrideValue / deviceEffectiveRiskLevel) — modules stay
// independently portable, so keep both sites in sync when the risk config
// tables change. Risk reads measurement_record_latest, so it is "now"-only;
// this copy drops the `at` parameter the devices version carries.

function currentRow(table: string): RawBuilder<boolean> {
	return sql<boolean>`${sql.ref(`${table}.archived`)} IS NULL`;
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

// Device-level risk comes from the highest-priority monitor config (lower
// number = higher priority) among monitors that yield a risk value; monitors
// with no computable risk are skipped, and equal priorities resolve to the
// most significant (highest) risk value.
function deviceRiskLevel() {
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
				.on(currentRow("risk_level_monitor_config")),
		)
		.innerJoin("risk_level_monitor_channel", (join) =>
			join
				.onRef(
					"risk_level_monitor_channel.risk_level_monitor_id",
					"=",
					"risk_level_monitor.id",
				)
				.on(currentRow("risk_level_monitor_channel")),
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
				.on(currentRow("risk_level_monitor_config_range")),
		)
		.leftJoin("risk_level_monitor_config_gradient", (join) =>
			join
				.onRef(
					"risk_level_monitor_config_gradient.risk_level_monitor_id",
					"=",
					"risk_level_monitor.id",
				)
				.on(currentRow("risk_level_monitor_config_gradient")),
		)
		.whereRef("risk_level_monitor.device_id", "=", "device.id")
		.where(currentRow("risk_level_monitor"))
		.select(
			sql<
				number | null
			>`(ARRAY_AGG(${riskLevelCase} ORDER BY risk_level_monitor_config.priority, ${riskLevelCase} DESC) FILTER (WHERE ${riskLevelCase} IS NOT NULL))[1]`.as(
				"risk_level",
			),
		);
}

function deviceRiskLevelOverrideValue() {
	const eb = expressionBuilder<DB, "device">();
	return eb
		.selectFrom("risk_level_monitor_config_override")
		.select("risk_level_monitor_config_override.risk_level")
		.whereRef("risk_level_monitor_config_override.device_id", "=", "device.id")
		.where(currentRow("risk_level_monitor_config_override"))
		.orderBy("risk_level_monitor_config_override.introduced", "desc")
		.limit(1);
}

// A manual override (the old system's "overtopping") beats the computed monitor
// risk for as long as an unarchived override row exists for the device.
function deviceEffectiveRiskLevel() {
	return sql<
		number | null
	>`COALESCE((${deviceRiskLevelOverrideValue()}), (${deviceRiskLevel()}))`;
}

// The gauge station's headline risk: MAX across its current (unarchived) devices of
// each device's effective risk. The override is applied per device *before*
// the MAX so a manual override on one device can never mask a higher risk on a
// sibling device (lift stations carry two sensors). Inactive devices still
// count — deactivation is a maintenance flag, not a risk statement. Gauge stations
// with no devices or no computable risk yield NULL.
function gaugeStationRiskLevel() {
	const eb = expressionBuilder<DB, "gauge_station">();
	return eb
		.selectFrom("device")
		.innerJoin("device_info", (join) =>
			join.onRef("device_info.device_id", "=", "device.id").on(currentRow("device_info")),
		)
		.whereRef("device_info.gauge_station_id", "=", "gauge_station.id")
		.where(currentRow("device"))
		.select(sql<number | null>`MAX(${deviceEffectiveRiskLevel()})`.as("risk_level"));
}

export function listGaugeStations(
	db: Kysely<DB>,
	filters: GaugeStationListFilters = {},
): Promise<GaugeStationRow[]> {
	return applyGaugeStationFilters(gaugeStationSelect(db), filters).orderBy("gauge_station.name").execute();
}

export function listGaugeStationsWithRisk(db: Kysely<DB>, filters: GaugeStationListFilters = {}) {
	return applyGaugeStationFilters(gaugeStationSelect(db), filters)
		.select(gaugeStationRiskLevel().as("risk_level"))
		.orderBy("gauge_station.name")
		.execute();
}

export function listGaugeStationsWithRiskForClient(
	db: Kysely<DB>,
	clientId: number,
	filters: GaugeStationListFilters = {},
) {
	return applyGaugeStationFilters(linkedToClient(gaugeStationSelect(db), clientId), filters)
		.select(gaugeStationRiskLevel().as("risk_level"))
		.orderBy("gauge_station.name")
		.execute();
}

export type GaugeStationRiskRow = Awaited<ReturnType<typeof listGaugeStationsWithRisk>>[number];

export function listGaugeStationsForClient(
	db: Kysely<DB>,
	clientId: number,
	filters: GaugeStationListFilters = {},
): Promise<GaugeStationRow[]> {
	return applyGaugeStationFilters(linkedToClient(gaugeStationSelect(db), clientId), filters)
		.orderBy("gauge_station.name")
		.execute();
}

export function findGaugeStationById(
	db: Kysely<DB>,
	id: number,
): Promise<GaugeStationRow | undefined> {
	return gaugeStationSelect(db).where("gauge_station.id", "=", id).executeTakeFirst();
}

export function findGaugeStationByIdForClient(
	db: Kysely<DB>,
	id: number,
	clientId: number,
): Promise<GaugeStationRow | undefined> {
	return linkedToClient(gaugeStationSelect(db), clientId)
		.where("gauge_station.id", "=", id)
		.executeTakeFirst();
}

export function findGaugeStationByName(
	db: Kysely<DB>,
	name: string,
): Promise<GaugeStationRow | undefined> {
	return gaugeStationSelect(db).where("gauge_station.name", "=", name).executeTakeFirst();
}

export function findGaugeStationByNameForClient(
	db: Kysely<DB>,
	name: string,
	clientId: number,
): Promise<GaugeStationRow | undefined> {
	return linkedToClient(gaugeStationSelect(db), clientId)
		.where("gauge_station.name", "=", name)
		.executeTakeFirst();
}

// Existence checks used to validate foreign keys before inserting, so callers
// get a clear error instead of a raw FK violation.
export function findCityById(db: Kysely<DB>, id: number): Promise<{ id: number } | undefined> {
	return db.selectFrom("city").select("id").where("id", "=", id).executeTakeFirst();
}

export function findClientById(db: Kysely<DB>, id: number): Promise<{ id: number } | undefined> {
	return db
		.selectFrom("client")
		.select("id")
		.where("id", "=", id)
		.where("deleted_at", "is", null)
		.executeTakeFirst();
}

// Writes are single statements; the service composes them inside
// db.transaction() so they stay portable to sqlc-style query functions.
export function insertGaugeStation(db: Kysely<DB>, name: string): Promise<{ id: number }> {
	return db
		.insertInto("gauge_station")
		.values({ name })
		.returning("id")
		.executeTakeFirstOrThrow();
}

export interface InsertGaugeStationInfoInput {
	gauge_station_id: number;
	city_id: number;
	location: string;
	latitude: number;
	longitude: number;
	publicly_visible?: boolean;
	active?: boolean;
}

export function insertGaugeStationInfo(
	db: Kysely<DB>,
	info: InsertGaugeStationInfoInput,
): Promise<{ id: number }> {
	return db
		.insertInto("gauge_station_info")
		.values(info)
		.returning("id")
		.executeTakeFirstOrThrow();
}

export function insertClientGaugeStation(
	db: Kysely<DB>,
	gaugeStationId: number,
	clientId: number,
): Promise<{ id: number }> {
	return db
		.insertInto("client_gauge_station")
		.values({ gauge_station_id: gaugeStationId, client_id: clientId })
		.returning("id")
		.executeTakeFirstOrThrow();
}

export function updateGaugeStationName(
	db: Kysely<DB>,
	id: number,
	name: string,
): Promise<{ id: number } | undefined> {
	return db
		.updateTable("gauge_station")
		.set({ name })
		.where("id", "=", id)
		.returning("id")
		.executeTakeFirst();
}

export async function archiveGaugeStationInfo(
	db: Kysely<DB>,
	gaugeStationId: number,
): Promise<void> {
	await db
		.updateTable("gauge_station_info")
		.set({ archived: sql`now()` })
		.where("gauge_station_id", "=", gaugeStationId)
		.where("archived", "is", null)
		.execute();
}
