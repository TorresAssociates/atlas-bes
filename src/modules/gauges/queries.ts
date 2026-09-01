import { expressionBuilder, type Kysely, type RawBuilder, sql } from "kysely";
import { jsonArrayFrom } from "kysely/helpers/postgres";
import type { DB } from "@/db/types";

export interface GaugeListFilters {
	cityId?: number;
	includeArchived?: boolean;
	active?: boolean;
}

// The full read shape: gauge_station joined with its current (archived IS NULL)
// gauge_station_info row and that row's city, plus the linked clients.
function gaugeSelect(db: Kysely<DB>) {
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

type GaugeSelect = ReturnType<typeof gaugeSelect>;

export type GaugeStationRow = Awaited<ReturnType<GaugeSelect["execute"]>>[number];

function applyGaugeFilters(query: GaugeSelect, filters: GaugeListFilters): GaugeSelect {
	if (!filters.includeArchived) query = query.where("gauge_station.archived", "is", null);
	if (filters.cityId !== undefined)
		query = query.where("gauge_station_info.city_id", "=", filters.cityId);
	if (filters.active !== undefined)
		query = query.where("gauge_station_info.active", "=", filters.active);
	return query;
}

function linkedToClient(query: GaugeSelect, clientId: number): GaugeSelect {
	return query.where(({ exists, selectFrom }) =>
		exists(
			selectFrom("client_gauge_station")
				.select("client_gauge_station.id")
				.whereRef("client_gauge_station.gauge_station_id", "=", "gauge_station.id")
				.where("client_gauge_station.client_id", "=", clientId),
		),
	);
}

// --- gauge risk level --------------------------------------------------------
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

// The gauge's headline risk: MAX across its current (unarchived) devices of
// each device's effective risk. The override is applied per device *before*
// the MAX so a manual override on one device can never mask a higher risk on a
// sibling device (lift stations carry two sensors). Inactive devices still
// count — deactivation is a maintenance flag, not a risk statement. Gauges
// with no devices or no computable risk yield NULL.
function gaugeRiskLevel() {
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
	filters: GaugeListFilters = {},
): Promise<GaugeStationRow[]> {
	return applyGaugeFilters(gaugeSelect(db), filters).orderBy("gauge_station.name").execute();
}

export function listGaugeStationsWithRisk(db: Kysely<DB>, filters: GaugeListFilters = {}) {
	return applyGaugeFilters(gaugeSelect(db), filters)
		.select(gaugeRiskLevel().as("risk_level"))
		.orderBy("gauge_station.name")
		.execute();
}

export function listGaugeStationsWithRiskForClient(
	db: Kysely<DB>,
	clientId: number,
	filters: GaugeListFilters = {},
) {
	return applyGaugeFilters(linkedToClient(gaugeSelect(db), clientId), filters)
		.select(gaugeRiskLevel().as("risk_level"))
		.orderBy("gauge_station.name")
		.execute();
}

export type GaugeStationRiskRow = Awaited<ReturnType<typeof listGaugeStationsWithRisk>>[number];

// --- gauge live status -------------------------------------------------------
// channel_config.category is the canonical sensor discriminator (successor to
// the legacy HV/PP channel codes). Values verified against the live database:
// 'water_level' (ft) is the stage channel, 'precipitation_increment' (in) the
// incremental rainfall channel. Candidate channels are current channels with a
// current ACTIVE channel_config on a current device of the gauge. Gauges
// commonly carry several channels of the same category (multiple dataloggers,
// lift-station dual sensors), so readings come from ONE preferred channel —
// active-device first, then most recent reading, then lowest channel id —
// rather than mixing sensors; summing rainfall across sensors at one site
// would double-count.

const CHANNEL_CATEGORY_WATER_LEVEL = "water_level";
const CHANNEL_CATEGORY_RAINFALL = "precipitation_increment";

// Raw values convert via the channel's config, mirroring
// src/modules/measurements/queries.ts (value * scale + offset).
const latestConvertedValue = sql<
	number | null
>`${sql.ref("measurement_record_latest.value")} * ${sql.ref("channel_config.scale")} + ${sql.ref("channel_config.offset")}`;

const recordConvertedValue = sql<
	number | null
>`${sql.ref("measurement_record.value")} * ${sql.ref("channel_config.scale")} + ${sql.ref("channel_config.offset")}`;

// The gauge's preferred channel of a category, restricted to channels that
// have a latest reading; selects one row, ordered per the note above.
function latestReadingRow(category: string) {
	const eb = expressionBuilder<DB, "gauge_station">();
	return eb
		.selectFrom("device")
		.innerJoin("device_info", (join) =>
			join.onRef("device_info.device_id", "=", "device.id").on(currentRow("device_info")),
		)
		.innerJoin("channel", (join) =>
			join.onRef("channel.device_id", "=", "device.id").on(currentRow("channel")),
		)
		.innerJoin("channel_config", (join) =>
			join
				.onRef("channel_config.channel_id", "=", "channel.id")
				.on(currentRow("channel_config"))
				.on("channel_config.active", "=", true),
		)
		.innerJoin(
			"measurement_record_latest",
			"measurement_record_latest.channel_id",
			"channel.id",
		)
		.whereRef("device_info.gauge_station_id", "=", "gauge_station.id")
		.where(currentRow("device"))
		.where("channel_config.category", "=", category)
		.orderBy(sql`${sql.ref("device_info.active")} DESC NULLS LAST`)
		.orderBy("measurement_record_latest.date", "desc")
		.orderBy("channel.id")
		.limit(1);
}

function latestReadingValue(category: string) {
	return latestReadingRow(category).select(latestConvertedValue.as("value"));
}

function latestReadingDate(category: string) {
	return latestReadingRow(category).select("measurement_record_latest.date");
}

// Whether the gauge has any candidate channel of the category at all
// (irrespective of measurement data) — distinguishes "no sensor" (NULL
// accumulation) from "sensor with no records in the window" (0).
function gaugeChannelExists(category: string) {
	const eb = expressionBuilder<DB, "gauge_station">();
	return eb
		.selectFrom("device")
		.innerJoin("device_info", (join) =>
			join.onRef("device_info.device_id", "=", "device.id").on(currentRow("device_info")),
		)
		.innerJoin("channel", (join) =>
			join.onRef("channel.device_id", "=", "device.id").on(currentRow("channel")),
		)
		.innerJoin("channel_config", (join) =>
			join
				.onRef("channel_config.channel_id", "=", "channel.id")
				.on(currentRow("channel_config"))
				.on("channel_config.active", "=", true),
		)
		.whereRef("device_info.gauge_station_id", "=", "gauge_station.id")
		.where(currentRow("device"))
		.where("channel_config.category", "=", category)
		.select("channel.id");
}

// SUM of incremental rainfall over the trailing window on the preferred rain
// channel. Negative increments (sensor resets) clamp to 0 after conversion,
// matching legacy accumulation behavior. Relies on the
// measurement_record (channel_id, date) index.
function rainfallWindowSum(windowHours: number) {
	const eb = expressionBuilder<DB, "gauge_station">();
	return eb
		.selectFrom("measurement_record")
		.innerJoin("channel_config", (join) =>
			join
				.onRef("channel_config.channel_id", "=", "measurement_record.channel_id")
				.on(currentRow("channel_config")),
		)
		.where(
			"measurement_record.channel_id",
			"=",
			latestReadingRow(CHANNEL_CATEGORY_RAINFALL).select("channel.id"),
		)
		.where(
			sql<boolean>`${sql.ref("measurement_record.date")} >= NOW() - (${windowHours} * INTERVAL '1 hour')`,
		)
		.select(sql<number | null>`SUM(GREATEST(${recordConvertedValue}, 0))`.as("total"));
}

function gaugeRainfallAccumulation(windowHours: number) {
	return sql<
		number | null
	>`CASE WHEN EXISTS (${gaugeChannelExists(CHANNEL_CATEGORY_RAINFALL)}) THEN COALESCE((${rainfallWindowSum(windowHours)}), 0) END`;
}

// true if ANY current, active DATALOGGER of the gauge reports connected; false
// when at least one reports connectivity and none are connected; NULL when no
// current active datalogger has connectivity data (or the gauge has none).
// Only dataloggers count — the marker's "connected" answers "is the station's
// sensor telemetry alive", and a flasher/camera/barrier being online doesn't
// mean readings are flowing (matches legacy "any active datalogger connected").
// BOOL_OR ignores NULL rows, which yields exactly those semantics.
function gaugeConnected() {
	const eb = expressionBuilder<DB, "gauge_station">();
	return eb
		.selectFrom("device")
		.innerJoin("device_info", (join) =>
			join.onRef("device_info.device_id", "=", "device.id").on(currentRow("device_info")),
		)
		.leftJoin("device_connected", (join) =>
			join
				.onRef("device_connected.device_id", "=", "device.id")
				.on(currentRow("device_connected")),
		)
		.whereRef("device_info.gauge_station_id", "=", "gauge_station.id")
		.where(currentRow("device"))
		.where("device_info.active", "=", true)
		.where("device_info.type", "=", "datalogger")
		.select(
			sql<boolean | null>`BOOL_OR(${sql.ref("device_connected.connected")})`.as("connected"),
		);
}

function gaugeStatusSelects(windowHours: number) {
	return [
		gaugeRiskLevel().as("risk_level"),
		gaugeConnected().as("connected"),
		latestReadingValue(CHANNEL_CATEGORY_WATER_LEVEL).as("water_level"),
		latestReadingDate(CHANNEL_CATEGORY_WATER_LEVEL).as("water_level_date"),
		latestReadingValue(CHANNEL_CATEGORY_RAINFALL).as("rainfall"),
		gaugeRainfallAccumulation(windowHours).as("rainfall_accumulation"),
	];
}

export function listGaugeStationStatuses(
	db: Kysely<DB>,
	windowHours: number,
	filters: GaugeListFilters = {},
) {
	return applyGaugeFilters(gaugeSelect(db), filters)
		.select(gaugeStatusSelects(windowHours))
		.orderBy("gauge_station.name")
		.execute();
}

export function listGaugeStationStatusesForClient(
	db: Kysely<DB>,
	clientId: number,
	windowHours: number,
	filters: GaugeListFilters = {},
) {
	return applyGaugeFilters(linkedToClient(gaugeSelect(db), clientId), filters)
		.select(gaugeStatusSelects(windowHours))
		.orderBy("gauge_station.name")
		.execute();
}

export type GaugeStationStatusRow = Awaited<ReturnType<typeof listGaugeStationStatuses>>[number];

export function listGaugeStationsForClient(
	db: Kysely<DB>,
	clientId: number,
	filters: GaugeListFilters = {},
): Promise<GaugeStationRow[]> {
	return applyGaugeFilters(linkedToClient(gaugeSelect(db), clientId), filters)
		.orderBy("gauge_station.name")
		.execute();
}

export function findGaugeStationById(
	db: Kysely<DB>,
	id: number,
): Promise<GaugeStationRow | undefined> {
	return gaugeSelect(db).where("gauge_station.id", "=", id).executeTakeFirst();
}

export function findGaugeStationByIdForClient(
	db: Kysely<DB>,
	id: number,
	clientId: number,
): Promise<GaugeStationRow | undefined> {
	return linkedToClient(gaugeSelect(db), clientId)
		.where("gauge_station.id", "=", id)
		.executeTakeFirst();
}

export function findGaugeStationByName(
	db: Kysely<DB>,
	name: string,
): Promise<GaugeStationRow | undefined> {
	return gaugeSelect(db).where("gauge_station.name", "=", name).executeTakeFirst();
}

export function findGaugeStationByNameForClient(
	db: Kysely<DB>,
	name: string,
	clientId: number,
): Promise<GaugeStationRow | undefined> {
	return linkedToClient(gaugeSelect(db), clientId)
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
