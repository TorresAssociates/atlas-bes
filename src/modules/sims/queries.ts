import type { Insertable, Kysely, Selectable } from "kysely";
import type { DB } from "@/db/types";

export type SimRow = Selectable<DB["sim"]>;
export type SimInfoRow = Selectable<DB["sim_info"]>;
export type SimInfoHologramRow = Selectable<DB["sim_info_hologram"]>;
export type SimInfoEmnifyRow = Selectable<DB["sim_info_emnify"]>;

type InsertSimRow = Insertable<DB["sim"]>;
type InsertSimInfoRow = Insertable<DB["sim_info"]>;
type InsertSimInfoHologramRow = Insertable<DB["sim_info_hologram"]>;
type InsertSimInfoEmnifyRow = Insertable<DB["sim_info_emnify"]>;

export interface SimDeviceRow {
	device_id: number;
	serial_number: string;
	gauge_station_id: number | null;
	gauge_station_name: string;
	type: DB["device_info"]["type"];
}

export interface SimAggregateRow {
	sim: SimRow;
	info: SimInfoRow | null;
	hologram: SimInfoHologramRow | null;
	emnify: SimInfoEmnifyRow | null;
	device: SimDeviceRow | null;
}

const simColumns = ["id", "iccid", "provider", "introduced", "archived"] as const;
const simInfoColumns = [
	"id",
	"sim_id",
	"imei",
	"activated",
	"paused",
	"introduced",
	"archived",
] as const;
const hologramColumns = ["id", "sim_id", "device_id", "introduced", "archived"] as const;
const emnifyColumns = ["id", "sim_id", "bic", "introduced", "archived"] as const;

export function listSims(db: Kysely<DB>): Promise<SimRow[]> {
	return db
		.selectFrom("sim")
		.select(simColumns)
		.where("archived", "is", null)
		.orderBy("id", "asc")
		.execute();
}

export function listSimsForClient(db: Kysely<DB>, clientId: number): Promise<SimRow[]> {
	return db
		.selectFrom("sim")
		.innerJoin("device_sim", "device_sim.sim_id", "sim.id")
		.innerJoin("device", "device.id", "device_sim.device_id")
		.innerJoin("device_info", "device_info.device_id", "device.id")
		.innerJoin("gauge_station", "gauge_station.id", "device_info.gauge_station_id")
		.innerJoin(
			"client_gauge_station",
			"client_gauge_station.gauge_station_id",
			"gauge_station.id",
		)
		.select(simColumns.map((column) => `sim.${column}` as const))
		.distinct()
		.where("sim.archived", "is", null)
		.where("device_sim.archived", "is", null)
		.where("device.archived", "is", null)
		.where("device_info.archived", "is", null)
		.where("gauge_station.archived", "is", null)
		.where("client_gauge_station.client_id", "=", clientId)
		.orderBy("sim.id", "asc")
		.execute();
}

export function findSimByIccid(db: Kysely<DB>, iccid: string): Promise<SimRow | undefined> {
	return db
		.selectFrom("sim")
		.select(simColumns)
		.where("iccid", "=", iccid)
		.where("archived", "is", null)
		.executeTakeFirst();
}

export function findSimByIccidForClient(
	db: Kysely<DB>,
	iccid: string,
	clientId: number,
): Promise<SimRow | undefined> {
	return db
		.selectFrom("sim")
		.innerJoin("device_sim", "device_sim.sim_id", "sim.id")
		.innerJoin("device", "device.id", "device_sim.device_id")
		.innerJoin("device_info", "device_info.device_id", "device.id")
		.innerJoin("gauge_station", "gauge_station.id", "device_info.gauge_station_id")
		.innerJoin(
			"client_gauge_station",
			"client_gauge_station.gauge_station_id",
			"gauge_station.id",
		)
		.select(simColumns.map((column) => `sim.${column}` as const))
		.distinct()
		.where("sim.iccid", "=", iccid)
		.where("sim.archived", "is", null)
		.where("device_sim.archived", "is", null)
		.where("device.archived", "is", null)
		.where("device_info.archived", "is", null)
		.where("gauge_station.archived", "is", null)
		.where("client_gauge_station.client_id", "=", clientId)
		.executeTakeFirst();
}

export function findSimsByCurrentImei(db: Kysely<DB>, imei: string): Promise<SimRow[]> {
	return db
		.selectFrom("sim")
		.innerJoin("sim_info", "sim_info.sim_id", "sim.id")
		.select(simColumns.map((column) => `sim.${column}` as const))
		.where("sim.archived", "is", null)
		.where("sim_info.archived", "is", null)
		.where("sim_info.imei", "=", imei)
		.orderBy("sim.id", "asc")
		.execute();
}

export function findCurrentSimInfo(db: Kysely<DB>, simId: number): Promise<SimInfoRow | undefined> {
	return db
		.selectFrom("sim_info")
		.select(simInfoColumns)
		.where("sim_id", "=", simId)
		.where("archived", "is", null)
		.orderBy("introduced", "desc")
		.orderBy("id", "desc")
		.executeTakeFirst();
}

export function findCurrentHologramInfo(
	db: Kysely<DB>,
	simId: number,
): Promise<SimInfoHologramRow | undefined> {
	return db
		.selectFrom("sim_info_hologram")
		.select(hologramColumns)
		.where("sim_id", "=", simId)
		.where("archived", "is", null)
		.orderBy("introduced", "desc")
		.orderBy("id", "desc")
		.executeTakeFirst();
}

export function findCurrentEmnifyInfo(
	db: Kysely<DB>,
	simId: number,
): Promise<SimInfoEmnifyRow | undefined> {
	return db
		.selectFrom("sim_info_emnify")
		.select(emnifyColumns)
		.where("sim_id", "=", simId)
		.where("archived", "is", null)
		.orderBy("introduced", "desc")
		.orderBy("id", "desc")
		.executeTakeFirst();
}

export function findCurrentDeviceForSim(
	db: Kysely<DB>,
	simId: number,
): Promise<SimDeviceRow | undefined> {
	return db
		.selectFrom("device_sim")
		.innerJoin("device", "device.id", "device_sim.device_id")
		.innerJoin("device_info", "device_info.device_id", "device.id")
		.innerJoin("gauge_station", "gauge_station.id", "device_info.gauge_station_id")
		.select([
			"device.id as device_id",
			"device.serial_number",
			"device_info.gauge_station_id",
			"gauge_station.name as gauge_station_name",
			"device_info.type",
		])
		.where("device_sim.sim_id", "=", simId)
		.where("device_sim.archived", "is", null)
		.where("device.archived", "is", null)
		.where("device_info.archived", "is", null)
		.where("gauge_station.archived", "is", null)
		.orderBy("device_sim.introduced", "desc")
		.orderBy("device_sim.id", "desc")
		.executeTakeFirst();
}

export function findCurrentDeviceForSims(
	db: Kysely<DB>,
	simIds: number[],
): Promise<SimDeviceRow | undefined> {
	if (simIds.length === 0) return Promise.resolve(undefined);
	return db
		.selectFrom("device_sim")
		.innerJoin("device", "device.id", "device_sim.device_id")
		.innerJoin("device_info", "device_info.device_id", "device.id")
		.innerJoin("gauge_station", "gauge_station.id", "device_info.gauge_station_id")
		.select([
			"device.id as device_id",
			"device.serial_number",
			"device_info.gauge_station_id",
			"gauge_station.name as gauge_station_name",
			"device_info.type",
		])
		.where("device_sim.sim_id", "in", simIds)
		.where("device_sim.archived", "is", null)
		.where("device.archived", "is", null)
		.where("device_info.archived", "is", null)
		.where("gauge_station.archived", "is", null)
		.orderBy("device_sim.introduced", "desc")
		.orderBy("device_sim.id", "desc")
		.executeTakeFirst();
}

export function findDeviceByIdForClient(
	db: Kysely<DB>,
	deviceId: number,
	clientId: number,
): Promise<{ id: number } | undefined> {
	return db
		.selectFrom("device")
		.innerJoin("device_info", "device_info.device_id", "device.id")
		.innerJoin("gauge_station", "gauge_station.id", "device_info.gauge_station_id")
		.innerJoin(
			"client_gauge_station",
			"client_gauge_station.gauge_station_id",
			"gauge_station.id",
		)
		.select("device.id")
		.where("device.id", "=", deviceId)
		.where("device.archived", "is", null)
		.where("device_info.archived", "is", null)
		.where("gauge_station.archived", "is", null)
		.where("client_gauge_station.client_id", "=", clientId)
		.executeTakeFirst();
}

export function findGaugeStationByName(
	db: Kysely<DB>,
	name: string,
): Promise<{ id: number } | undefined> {
	return db
		.selectFrom("gauge_station")
		.select("id")
		.where("name", "=", name)
		.where("archived", "is", null)
		.executeTakeFirst();
}

export function findGaugeStationByNameForClient(
	db: Kysely<DB>,
	name: string,
	clientId: number,
): Promise<{ id: number } | undefined> {
	return db
		.selectFrom("gauge_station")
		.innerJoin(
			"client_gauge_station",
			"client_gauge_station.gauge_station_id",
			"gauge_station.id",
		)
		.select("gauge_station.id")
		.where("gauge_station.name", "=", name)
		.where("gauge_station.archived", "is", null)
		.where("client_gauge_station.client_id", "=", clientId)
		.executeTakeFirst();
}

export function insertSim(db: Kysely<DB>, sim: InsertSimRow): Promise<SimRow> {
	return db.insertInto("sim").values(sim).returning(simColumns).executeTakeFirstOrThrow();
}

export function insertSimInfo(db: Kysely<DB>, info: InsertSimInfoRow): Promise<SimInfoRow> {
	return db
		.insertInto("sim_info")
		.values(info)
		.returning(simInfoColumns)
		.executeTakeFirstOrThrow();
}

export function insertHologramInfo(
	db: Kysely<DB>,
	info: InsertSimInfoHologramRow,
): Promise<SimInfoHologramRow> {
	return db
		.insertInto("sim_info_hologram")
		.values(info)
		.returning(hologramColumns)
		.executeTakeFirstOrThrow();
}

export function insertEmnifyInfo(
	db: Kysely<DB>,
	info: InsertSimInfoEmnifyRow,
): Promise<SimInfoEmnifyRow> {
	return db
		.insertInto("sim_info_emnify")
		.values(info)
		.returning(emnifyColumns)
		.executeTakeFirstOrThrow();
}

export async function archiveCurrentSimInfo(db: Kysely<DB>, simId: number): Promise<void> {
	await db
		.updateTable("sim_info")
		.set({ archived: new Date() })
		.where("sim_id", "=", simId)
		.where("archived", "is", null)
		.execute();
}

export async function archiveCurrentHologramInfo(db: Kysely<DB>, simId: number): Promise<void> {
	await db
		.updateTable("sim_info_hologram")
		.set({ archived: new Date() })
		.where("sim_id", "=", simId)
		.where("archived", "is", null)
		.execute();
}

export async function archiveCurrentDeviceInfo(db: Kysely<DB>, deviceId: number): Promise<void> {
	await db
		.updateTable("device_info")
		.set({ archived: new Date() })
		.where("device_id", "=", deviceId)
		.where("archived", "is", null)
		.execute();
}

export function insertDeviceInfo(
	db: Kysely<DB>,
	info: Insertable<DB["device_info"]>,
): Promise<Selectable<DB["device_info"]>> {
	return db.insertInto("device_info").values(info).returningAll().executeTakeFirstOrThrow();
}
