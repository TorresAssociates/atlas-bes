import { type Insertable, type Kysely, sql } from "kysely";
import type { DB } from "@/db/types";

export interface DeviceLookupRow {
	id: number;
	serial_number: string;
}

export function findDeviceBySerialNumber(
	db: Kysely<DB>,
	serialNumber: string,
): Promise<DeviceLookupRow | undefined> {
	return db
		.selectFrom("device")
		.select(["id", "serial_number"])
		.where("serial_number", "=", serialNumber)
		.where("archived", "is", null)
		.executeTakeFirst();
}

export function findDeviceBySerialNumberForClient(
	db: Kysely<DB>,
	serialNumber: string,
	clientId: number,
): Promise<DeviceLookupRow | undefined> {
	return db
		.selectFrom("device")
		.innerJoin("device_info", "device_info.device_id", "device.id")
		.innerJoin("gauge_station", "gauge_station.id", "device_info.gauge_station_id")
		.innerJoin(
			"client_gauge_station",
			"client_gauge_station.gauge_station_id",
			"gauge_station.id",
		)
		.select(["device.id", "device.serial_number"])
		.distinct()
		.where("device.serial_number", "=", serialNumber)
		.where("device.archived", "is", null)
		.where("device_info.archived", "is", null)
		.where("gauge_station.archived", "is", null)
		.where("client_gauge_station.client_id", "=", clientId)
		.executeTakeFirst();
}

export async function archiveCurrentDeviceInfo(db: Kysely<DB>, deviceId: number): Promise<void> {
	await db
		.updateTable("device_info")
		.set({ archived: new Date() })
		.where("device_id", "=", deviceId)
		.where("archived", "is", null)
		.execute();
}

export function findCurrentDeviceInfo(db: Kysely<DB>, deviceId: number) {
	return db
		.selectFrom("device_info")
		.selectAll()
		.where("device_id", "=", deviceId)
		.where("archived", "is", null)
		.orderBy("introduced", "desc")
		.orderBy("id", "desc")
		.executeTakeFirst();
}

export function insertDeviceInfo(db: Kysely<DB>, info: Insertable<DB["device_info"]>) {
	return db.insertInto("device_info").values(info).returningAll().executeTakeFirstOrThrow();
}

export async function archiveCurrentWifiActive(db: Kysely<DB>, deviceId: number): Promise<void> {
	await db
		.updateTable("device_wifi_interface_active")
		.set({ archived: new Date() })
		.where("device_id", "=", deviceId)
		.where("archived", "is", null)
		.execute();
}

export function insertWifiActive(db: Kysely<DB>, deviceId: number, wifiActive: boolean) {
	return db
		.insertInto("device_wifi_interface_active")
		.values({ device_id: deviceId, wifi_active: wifiActive })
		.returningAll()
		.executeTakeFirstOrThrow();
}

export async function archiveCurrentWifiConfig(db: Kysely<DB>, deviceId: number): Promise<void> {
	await db
		.updateTable("device_wifi_interface_config")
		.set({ archived: new Date() })
		.where("device_id", "=", deviceId)
		.where("archived", "is", null)
		.execute();
}

export async function insertEncryptedWifiPassword(
	db: Kysely<DB>,
	deviceId: number,
	password: string,
	encryptionKey: string,
): Promise<void> {
	await sql`
		with salt(val) as (select default_gen_salt())
		insert into device_wifi_interface_config (device_id, password, salt)
		values (${deviceId}, pgp_sym_encrypt(${password}, concat(${encryptionKey}::text, (select val from salt))), (select val from salt))
	`.execute(db);
}

export async function archiveCurrentDevicePower(db: Kysely<DB>, deviceId: number): Promise<void> {
	await db
		.updateTable("device_power")
		.set({ archived: new Date() })
		.where("device_id", "=", deviceId)
		.where("archived", "is", null)
		.execute();
}

export function findCurrentDevicePower(db: Kysely<DB>, deviceId: number) {
	return db
		.selectFrom("device_power")
		.selectAll()
		.where("device_id", "=", deviceId)
		.where("archived", "is", null)
		.orderBy("introduced", "desc")
		.orderBy("id", "desc")
		.executeTakeFirst();
}

export function insertDevicePower(
	db: Kysely<DB>,
	deviceId: number,
	minVoltage: number,
	maxVoltage: number,
) {
	return db
		.insertInto("device_power")
		.values({
			device_id: deviceId,
			min_voltage: minVoltage,
			max_voltage: maxVoltage,
		})
		.returningAll()
		.executeTakeFirstOrThrow();
}

export async function archiveCurrentDeviceDatalogging(
	db: Kysely<DB>,
	deviceId: number,
): Promise<void> {
	await db
		.updateTable("device_datalogging")
		.set({ archived: new Date() })
		.where("device_id", "=", deviceId)
		.where("archived", "is", null)
		.execute();
}

export function findCurrentDeviceDatalogging(db: Kysely<DB>, deviceId: number) {
	return db
		.selectFrom("device_datalogging")
		.selectAll()
		.where("device_id", "=", deviceId)
		.where("archived", "is", null)
		.orderBy("introduced", "desc")
		.orderBy("id", "desc")
		.executeTakeFirst();
}

export function insertDeviceDatalogging(db: Kysely<DB>, deviceId: number, timestep: number) {
	return db
		.insertInto("device_datalogging")
		.values({ device_id: deviceId, timestep })
		.returningAll()
		.executeTakeFirstOrThrow();
}
