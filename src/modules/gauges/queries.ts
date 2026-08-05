import { type Kysely, sql } from "kysely";
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

export function listGaugeStations(
	db: Kysely<DB>,
	filters: GaugeListFilters = {},
): Promise<GaugeStationRow[]> {
	return applyGaugeFilters(gaugeSelect(db), filters).orderBy("gauge_station.name").execute();
}

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
