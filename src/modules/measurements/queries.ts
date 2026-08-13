import { expressionBuilder, type Kysely, sql } from "kysely";
import type { DB } from "@/db/types";

export interface ChannelListFilters {
	channelId?: number;
	category?: string;
	includeInactive?: boolean;
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

function deviceSelect(db: Kysely<DB>) {
	return db
		.selectFrom("device")
		.innerJoin("device_info", (join) =>
			join
				.onRef("device_info.device_id", "=", "device.id")
				.on("device_info.archived", "is", null),
		)
		.select(["device.id", "device_info.active"]);
}

export type DeviceRow = Awaited<ReturnType<ReturnType<typeof deviceSelect>["execute"]>>[number];

export function findDevice(db: Kysely<DB>, id: number): Promise<DeviceRow | undefined> {
	return deviceSelect(db).where("device.id", "=", id).executeTakeFirst();
}

export function findDeviceForClient(
	db: Kysely<DB>,
	id: number,
	clientId: number,
): Promise<DeviceRow | undefined> {
	return deviceSelect(db)
		.where("device.id", "=", id)
		.where(deviceLinkedToClient(clientId))
		.executeTakeFirst();
}

function channelSelect(db: Kysely<DB>) {
	return db
		.selectFrom("channel")
		.innerJoin("channel_config", (join) =>
			join
				.onRef("channel_config.channel_id", "=", "channel.id")
				.on("channel_config.archived", "is", null),
		)
		.leftJoin("channel_config_display", (join) =>
			join
				.onRef("channel_config_display.channel_id", "=", "channel.id")
				.on("channel_config_display.archived", "is", null),
		)
		.select([
			"channel.id",
			"channel.device_id",
			"channel.local_id",
			"channel_config.name",
			"channel_config.category",
			"channel_config.units",
			"channel_config.scale",
			"channel_config.offset",
			"channel_config.active",
			"channel_config_display.display_index",
		])
		.where("channel.archived", "is", null);
}

type ChannelSelect = ReturnType<typeof channelSelect>;

export type ChannelRow = Awaited<ReturnType<ChannelSelect["execute"]>>[number];

function applyChannelFilters(query: ChannelSelect, filters: ChannelListFilters): ChannelSelect {
	if (filters.channelId !== undefined) query = query.where("channel.id", "=", filters.channelId);
	if (filters.category !== undefined)
		query = query.where("channel_config.category", "=", filters.category);
	if (!filters.includeInactive) query = query.where("channel_config.active", "=", true);
	return query;
}

export function listChannels(
	db: Kysely<DB>,
	deviceId: number,
	filters: ChannelListFilters = {},
): Promise<ChannelRow[]> {
	return applyChannelFilters(channelSelect(db), filters)
		.where("channel.device_id", "=", deviceId)
		.orderBy("channel_config_display.display_index")
		.orderBy("channel.local_id")
		.execute();
}

const convertedValue = sql<
	number | null
>`${sql.ref("measurement_record.value")} * ${sql.ref("channel_config.scale")} + ${sql.ref("channel_config.offset")}`;

export function listMeasurementRecords(db: Kysely<DB>, channelIds: number[], from: Date, to: Date) {
	return db
		.selectFrom("measurement_record")
		.innerJoin("channel_config", (join) =>
			join
				.onRef("channel_config.channel_id", "=", "measurement_record.channel_id")
				.on("channel_config.archived", "is", null),
		)
		.select([
			"measurement_record.channel_id",
			"measurement_record.date",
			convertedValue.as("value"),
		])
		.where("measurement_record.channel_id", "in", channelIds)
		.where("measurement_record.date", ">=", from)
		.where("measurement_record.date", "<=", to)
		.orderBy("measurement_record.channel_id")
		.orderBy("measurement_record.date")
		.execute();
}

export type MeasurementRecordRow = Awaited<ReturnType<typeof listMeasurementRecords>>[number];

const convertedLatestValue = sql<
	number | null
>`${sql.ref("latest_measurement_record.value")} * ${sql.ref("channel_config.scale")} + ${sql.ref("channel_config.offset")}`;

export function listLatestMeasurements(
	db: Kysely<DB>,
	deviceId: number,
	filters: ChannelListFilters = {},
) {
	return applyChannelFilters(channelSelect(db), filters)
		.leftJoin("latest_measurement_record", "latest_measurement_record.channel_id", "channel.id")
		.select(["latest_measurement_record.date", convertedLatestValue.as("value")])
		.where("channel.device_id", "=", deviceId)
		.orderBy("channel_config_display.display_index")
		.orderBy("channel.local_id")
		.execute();
}

export type ChannelLatestRow = Awaited<ReturnType<typeof listLatestMeasurements>>[number];
