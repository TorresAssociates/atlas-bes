import type { Kysely } from "kysely";
import type { DB } from "@/db/types";
import type { SessionSubject } from "../auth/service";
import type {
	ChannelConfigAccumulationRow,
	ChannelConfigDisplayRow,
	ChannelConfigInternalPowerSensorRow,
	ChannelConfigRow,
	ChannelConfigSdi12Row,
	ChannelConfigTiltRow,
	ChannelRow,
} from "./queries";
import * as queries from "./queries";

export interface ChannelReadAccess {
	canReadExternal: boolean;
}

type SerializedTimelineRow<
	T extends { introduced: Date | string; archived: Date | string | null },
> = Omit<T, "introduced" | "archived"> & {
	introduced: string;
	archived: string | null;
};

export interface ChannelRecordResponse {
	channel: SerializedTimelineRow<ChannelRow>;
	channel_config: SerializedTimelineRow<ChannelConfigRow> | null;
	channel_config_display: SerializedTimelineRow<ChannelConfigDisplayRow> | null;
	channel_config_internal_power_sensor: SerializedTimelineRow<ChannelConfigInternalPowerSensorRow> | null;
	channel_config_sdi12: SerializedTimelineRow<ChannelConfigSdi12Row> | null;
	channel_config_accumulation: SerializedTimelineRow<ChannelConfigAccumulationRow> | null;
	channel_config_tilt: SerializedTimelineRow<ChannelConfigTiltRow> | null;
}

export class ChannelDeviceNotFoundError extends Error {
	constructor(deviceId: number) {
		super(
			`device ${deviceId} does not exist or is not available to your client`,
		);
		this.name = "ChannelDeviceNotFoundError";
	}
}

export class ChannelNotFoundError extends Error {
	constructor(channelId: number) {
		super(
			`channel ${channelId} does not exist or is not available to your client`,
		);
		this.name = "ChannelNotFoundError";
	}
}

function serializeDate(value: Date | string): string {
	return value instanceof Date
		? value.toISOString()
		: new Date(value).toISOString();
}

function withSerializedDates<
	T extends { introduced: Date | string; archived: Date | string | null },
>(row: T): T & { introduced: string; archived: string | null } {
	return {
		...row,
		introduced: serializeDate(row.introduced),
		archived: row.archived === null ? null : serializeDate(row.archived),
	};
}

async function hydrateChannel(
	db: Kysely<DB>,
	channel: ChannelRow,
): Promise<ChannelRecordResponse> {
	const [
		channelConfig,
		displayConfig,
		internalPowerSensorConfig,
		sdi12Config,
		accumulationConfig,
		tiltConfig,
	] = await Promise.all([
		queries.findCurrentChannelConfig(db, channel.id),
		queries.findCurrentDisplayConfig(db, channel.id),
		queries.findCurrentInternalPowerSensorConfig(db, channel.id),
		queries.findCurrentSdi12Config(db, channel.id),
		queries.findCurrentAccumulationConfig(db, channel.id),
		queries.findCurrentTiltConfig(db, channel.id),
	]);

	return {
		channel: withSerializedDates(channel),
		channel_config: channelConfig
			? withSerializedDates(channelConfig)
			: null,
		channel_config_display: displayConfig
			? withSerializedDates(displayConfig)
			: null,
		channel_config_internal_power_sensor: internalPowerSensorConfig
			? withSerializedDates(internalPowerSensorConfig)
			: null,
		channel_config_sdi12: sdi12Config
			? withSerializedDates(sdi12Config)
			: null,
		channel_config_accumulation: accumulationConfig
			? withSerializedDates(accumulationConfig)
			: null,
		channel_config_tilt: tiltConfig
			? withSerializedDates(tiltConfig)
			: null,
	};
}

export async function listChannels(
	db: Kysely<DB>,
	session: SessionSubject,
	access: ChannelReadAccess,
): Promise<ChannelRecordResponse[]> {
	const channels = access.canReadExternal
		? await queries.listChannels(db)
		: await queries.listChannelsForClient(db, session.client_id);
	return Promise.all(channels.map((channel) => hydrateChannel(db, channel)));
}
export async function listChannelsForDevice(
	db: Kysely<DB>,
	deviceId: number,
	session: SessionSubject,
	access: ChannelReadAccess,
): Promise<ChannelRecordResponse[]> {
	const device = access.canReadExternal
		? await queries.findDeviceById(db, deviceId)
		: await queries.findDeviceByIdForClient(
				db,
				deviceId,
				session.client_id,
			);
	if (!device) throw new ChannelDeviceNotFoundError(deviceId);

	const channels = await queries.listChannelsForDevice(db, deviceId);
	return Promise.all(channels.map((channel) => hydrateChannel(db, channel)));
}

export async function getChannel(
	db: Kysely<DB>,
	channelId: number,
	session: SessionSubject,
	access: ChannelReadAccess,
): Promise<ChannelRecordResponse> {
	const channel = access.canReadExternal
		? await queries.findChannelById(db, channelId)
		: await queries.findChannelByIdForClient(
				db,
				channelId,
				session.client_id,
			);
	if (!channel) throw new ChannelNotFoundError(channelId);
	return hydrateChannel(db, channel);
}
