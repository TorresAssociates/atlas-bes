import type { DB } from "@/db/types";
import type { Kysely, Selectable } from "kysely";

export type ChannelRow = Selectable<DB["channel"]>;
export type ChannelConfigRow = Selectable<DB["channel_config"]>;
export type ChannelConfigDisplayRow = Selectable<DB["channel_config_display"]>;
export type ChannelConfigInternalPowerSensorRow = Selectable<
	DB["channel_config_internal_power_sensor"]
>;
export type ChannelConfigSdi12Row = Selectable<DB["channel_config_sdi12"]>;
export type ChannelConfigAccumulationRow = Selectable<
	DB["channel_config_accumulation"]
>;
export type ChannelConfigTiltRow = Selectable<DB["channel_config_tilt"]>;

const channelColumns = [
	"channel.id",
	"channel.device_id",
	"channel.local_id",
	"channel.channel_type_id",
	"channel.introduced",
	"channel.archived",
] as const;
const channelConfigColumns = [
	"id",
	"channel_id",
	"name",
	"active",
	"category",
	"units",
	"scale",
	"offset",
	"introduced",
	"archived",
] as const;
const displayColumns = [
	"id",
	"channel_id",
	"display_index",
	"introduced",
	"archived",
] as const;
const internalPowerSensorColumns = [
	"id",
	"channel_id",
	"measurement_type",
	"introduced",
	"archived",
] as const;
const sdi12Columns = [
	"id",
	"channel_id",
	"address",
	"measurement_set",
	"measurement_index",
	"introduced",
	"archived",
] as const;
const accumulationColumns = [
	"id",
	"channel_id",
	"source_local_id",
	"drain_const",
	"introduced",
	"archived",
] as const;
const tiltColumns = [
	"id",
	"channel_id",
	"alignment_x",
	"alignment_y",
	"alignment_z",
	"introduced",
	"archived",
] as const;

function scopedDeviceQuery(db: Kysely<DB>, clientId: number) {
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

export function findDeviceById(
	db: Kysely<DB>,
	deviceId: number,
): Promise<{ id: number } | undefined> {
	return db
		.selectFrom("device")
		.select("id")
		.where("id", "=", deviceId)
		.where("archived", "is", null)
		.executeTakeFirst();
}

export function findDeviceByIdForClient(
	db: Kysely<DB>,
	deviceId: number,
	clientId: number,
): Promise<{ id: number } | undefined> {
	return scopedDeviceQuery(db, clientId)
		.where("device.id", "=", deviceId)
		.executeTakeFirst();
}

export function listChannels(db: Kysely<DB>): Promise<ChannelRow[]> {
	return db
		.selectFrom("channel")
		.innerJoin("device", "device.id", "channel.device_id")
		.select(channelColumns)
		.distinct()
		.where("channel.archived", "is", null)
		.where("device.archived", "is", null)
		.orderBy("channel.device_id", "asc")
		.orderBy("channel.local_id", "asc")
		.orderBy("channel.id", "asc")
		.execute();
}

export function listChannelsForClient(db: Kysely<DB>, clientId: number): Promise<ChannelRow[]> {
	return db
		.selectFrom("channel")
		.innerJoin("device", "device.id", "channel.device_id")
		.innerJoin("device_info", "device_info.device_id", "device.id")
		.innerJoin("gauge_station", "gauge_station.id", "device_info.gauge_station_id")
		.innerJoin("client_gauge_station", "client_gauge_station.gauge_station_id", "gauge_station.id")
		.select(channelColumns)
		.distinct()
		.where("channel.archived", "is", null)
		.where("device.archived", "is", null)
		.where("device_info.archived", "is", null)
		.where("gauge_station.archived", "is", null)
		.where("client_gauge_station.client_id", "=", clientId)
		.orderBy("channel.device_id", "asc")
		.orderBy("channel.local_id", "asc")
		.orderBy("channel.id", "asc")
		.execute();
}
export function listChannelsForDevice(
	db: Kysely<DB>,
	deviceId: number,
): Promise<ChannelRow[]> {
	return db
		.selectFrom("channel")
		.select(channelColumns)
		.where("channel.device_id", "=", deviceId)
		.where("channel.archived", "is", null)
		.orderBy("channel.local_id", "asc")
		.orderBy("channel.id", "asc")
		.execute();
}

export function findChannelById(
	db: Kysely<DB>,
	channelId: number,
): Promise<ChannelRow | undefined> {
	return db
		.selectFrom("channel")
		.select(channelColumns)
		.where("channel.id", "=", channelId)
		.where("channel.archived", "is", null)
		.executeTakeFirst();
}

export function findChannelByIdForClient(
	db: Kysely<DB>,
	channelId: number,
	clientId: number,
): Promise<ChannelRow | undefined> {
	return db
		.selectFrom("channel")
		.innerJoin("device", "device.id", "channel.device_id")
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
		.select(channelColumns)
		.distinct()
		.where("channel.id", "=", channelId)
		.where("channel.archived", "is", null)
		.where("device.archived", "is", null)
		.where("device_info.archived", "is", null)
		.where("gauge_station.archived", "is", null)
		.where("client_gauge_station.client_id", "=", clientId)
		.executeTakeFirst();
}

export function findCurrentChannelConfig(
	db: Kysely<DB>,
	channelId: number,
): Promise<ChannelConfigRow | undefined> {
	return db
		.selectFrom("channel_config")
		.select(channelConfigColumns)
		.where("channel_id", "=", channelId)
		.where("archived", "is", null)
		.orderBy("introduced", "desc")
		.orderBy("id", "desc")
		.executeTakeFirst();
}

export function findCurrentDisplayConfig(
	db: Kysely<DB>,
	channelId: number,
): Promise<ChannelConfigDisplayRow | undefined> {
	return db
		.selectFrom("channel_config_display")
		.select(displayColumns)
		.where("channel_id", "=", channelId)
		.where("archived", "is", null)
		.orderBy("introduced", "desc")
		.orderBy("id", "desc")
		.executeTakeFirst();
}

export function findCurrentInternalPowerSensorConfig(
	db: Kysely<DB>,
	channelId: number,
): Promise<ChannelConfigInternalPowerSensorRow | undefined> {
	return db
		.selectFrom("channel_config_internal_power_sensor")
		.select(internalPowerSensorColumns)
		.where("channel_id", "=", channelId)
		.where("archived", "is", null)
		.orderBy("introduced", "desc")
		.orderBy("id", "desc")
		.executeTakeFirst();
}

export function findCurrentSdi12Config(
	db: Kysely<DB>,
	channelId: number,
): Promise<ChannelConfigSdi12Row | undefined> {
	return db
		.selectFrom("channel_config_sdi12")
		.select(sdi12Columns)
		.where("channel_id", "=", channelId)
		.where("archived", "is", null)
		.orderBy("introduced", "desc")
		.orderBy("id", "desc")
		.executeTakeFirst();
}

export function findCurrentAccumulationConfig(
	db: Kysely<DB>,
	channelId: number,
): Promise<ChannelConfigAccumulationRow | undefined> {
	return db
		.selectFrom("channel_config_accumulation")
		.select(accumulationColumns)
		.where("channel_id", "=", channelId)
		.where("archived", "is", null)
		.orderBy("introduced", "desc")
		.orderBy("id", "desc")
		.executeTakeFirst();
}

export function findCurrentTiltConfig(
	db: Kysely<DB>,
	channelId: number,
): Promise<ChannelConfigTiltRow | undefined> {
	return db
		.selectFrom("channel_config_tilt")
		.select(tiltColumns)
		.where("channel_id", "=", channelId)
		.where("archived", "is", null)
		.orderBy("introduced", "desc")
		.orderBy("id", "desc")
		.executeTakeFirst();
}
