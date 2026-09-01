import type { Insertable, Kysely, Selectable, Updateable } from "kysely";
import type { DB } from "@/db/types";

export type CityRow = Selectable<DB["city"]>;
type InsertCityRow = Insertable<DB["city"]>;
type UpdateCityRow = Updateable<DB["city"]>;

export interface CityListFilters {
	state?: string;
	name?: string;
}

const cityColumns = ["id", "state", "name"] as const;

export function listCities(db: Kysely<DB>, filters: CityListFilters = {}): Promise<CityRow[]> {
	let query = db.selectFrom("city").select(cityColumns);

	if (filters.state !== undefined) query = query.where("state", "=", filters.state);
	if (filters.name !== undefined) query = query.where("name", "=", filters.name);

	return query.orderBy("state").orderBy("name").execute();
}

export function listCitiesForClient(
	db: Kysely<DB>,
	clientId: number,
	filters: CityListFilters = {},
): Promise<CityRow[]> {
	let query = db
		.selectFrom("city")
		.innerJoin("gauge_station_info", "gauge_station_info.city_id", "city.id")
		.innerJoin(
			"client_gauge_station",
			"client_gauge_station.gauge_station_id",
			"gauge_station_info.gauge_station_id",
		)
		.select(cityColumns.map((column) => `city.${column}` as const))
		.distinct()
		.where("client_gauge_station.client_id", "=", clientId)
		.where("gauge_station_info.archived", "is", null);

	if (filters.state !== undefined) query = query.where("city.state", "=", filters.state);
	if (filters.name !== undefined) query = query.where("city.name", "=", filters.name);

	return query.orderBy("city.state").orderBy("city.name").execute();
}

export function findCityById(db: Kysely<DB>, id: number): Promise<CityRow | undefined> {
	return db.selectFrom("city").select(cityColumns).where("id", "=", id).executeTakeFirst();
}

export function findCityByIdForClient(
	db: Kysely<DB>,
	id: number,
	clientId: number,
): Promise<CityRow | undefined> {
	return db
		.selectFrom("city")
		.innerJoin("gauge_station_info", "gauge_station_info.city_id", "city.id")
		.innerJoin(
			"client_gauge_station",
			"client_gauge_station.gauge_station_id",
			"gauge_station_info.gauge_station_id",
		)
		.select(cityColumns.map((column) => `city.${column}` as const))
		.where("city.id", "=", id)
		.where("client_gauge_station.client_id", "=", clientId)
		.where("gauge_station_info.archived", "is", null)
		.executeTakeFirst();
}

export function findCityByName(db: Kysely<DB>, name: string): Promise<CityRow | undefined> {
	return db.selectFrom("city").select(cityColumns).where("name", "=", name).executeTakeFirst();
}

export function findCitiesByState(db: Kysely<DB>, state: string): Promise<CityRow[]> {
	return db.selectFrom("city").select(cityColumns).where("state", "=", state).execute();
}

export function insertCity(db: Kysely<DB>, city: InsertCityRow): Promise<CityRow> {
	return db.insertInto("city").values(city).returning(cityColumns).executeTakeFirstOrThrow();
}

export function updateCityById(
	db: Kysely<DB>,
	id: number,
	city: UpdateCityRow,
): Promise<CityRow | undefined> {
	return db
		.updateTable("city")
		.set(city)
		.where("id", "=", id)
		.returning(cityColumns)
		.executeTakeFirst();
}
