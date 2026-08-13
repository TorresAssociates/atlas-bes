import type { Kysely } from "kysely";
import type { DB } from "@/db/types";
import type { SessionSubject } from "../auth/service";
import type { ChannelLatestRow, ChannelRow } from "./queries";
import * as queries from "./queries";

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface MeasurementReadAccess {
	canReadExternal: boolean;
	canViewInactive: boolean;
}

export interface DeviceDataInput {
	from?: string;
	to?: string;
	channelId?: number;
	category?: string;
	includeInactiveChannels?: boolean;
}

export interface ChannelListInput {
	category?: string;
	includeInactive?: boolean;
}

export interface ChannelResponse {
	id: number;
	deviceId: number;
	localId: number;
	name: string;
	category: string;
	units: string;
	scale: number;
	offset: number;
	active: boolean;
	displayIndex: number | null;
}

export interface MeasurementPointResponse {
	date: string;
	value: number | null;
}

export interface DeviceDataResponse {
	deviceId: number;
	from: string;
	to: string;
	data: { channel: ChannelResponse; measurements: MeasurementPointResponse[] }[];
}

export interface DeviceLatestDataResponse {
	deviceId: number;
	data: { channel: ChannelResponse; date: string | null; value: number | null }[];
}

export class MeasurementDeviceNotFoundError extends Error {
	constructor(deviceId: number) {
		super(`device ${deviceId} does not exist`);
		this.name = "MeasurementDeviceNotFoundError";
	}
}

export class InvalidTimeWindowError extends Error {
	constructor() {
		super("`from` must be earlier than `to`");
		this.name = "InvalidTimeWindowError";
	}
}

function toChannelResponse(row: ChannelRow): ChannelResponse {
	return {
		id: row.id,
		deviceId: row.device_id,
		localId: row.local_id,
		name: row.name,
		category: row.category,
		units: row.units,
		scale: row.scale,
		offset: row.offset,
		active: row.active,
		displayIndex: row.display_index,
	};
}

function resolveWindow(input: { from?: string; to?: string }): { from: Date; to: Date } {
	const to = input.to === undefined ? new Date() : new Date(input.to);
	const from =
		input.from === undefined
			? new Date(to.getTime() - DEFAULT_WINDOW_MS)
			: new Date(input.from);
	if (from.getTime() >= to.getTime()) throw new InvalidTimeWindowError();
	return { from, to };
}

async function ensureDeviceVisible(
	db: Kysely<DB>,
	deviceId: number,
	session: SessionSubject,
	access: MeasurementReadAccess,
): Promise<void> {
	const row = access.canReadExternal
		? await queries.findDevice(db, deviceId)
		: await queries.findDeviceForClient(db, deviceId, session.client_id);
	if (!row || (row.active !== true && !access.canViewInactive))
		throw new MeasurementDeviceNotFoundError(deviceId);
}

export async function getDeviceData(
	db: Kysely<DB>,
	deviceId: number,
	session: SessionSubject,
	access: MeasurementReadAccess,
	input: DeviceDataInput = {},
): Promise<DeviceDataResponse> {
	await ensureDeviceVisible(db, deviceId, session, access);
	const { from, to } = resolveWindow(input);

	const channels = await queries.listChannels(db, deviceId, {
		channelId: input.channelId,
		category: input.category,
		includeInactive: input.includeInactiveChannels,
	});

	const points = new Map<number, MeasurementPointResponse[]>();
	if (channels.length > 0) {
		const rows = await queries.listMeasurementRecords(
			db,
			channels.map((channel) => channel.id),
			from,
			to,
		);
		for (const row of rows) {
			let list = points.get(row.channel_id);
			if (!list) {
				list = [];
				points.set(row.channel_id, list);
			}
			list.push({ date: new Date(row.date).toISOString(), value: row.value });
		}
	}

	return {
		deviceId,
		from: from.toISOString(),
		to: to.toISOString(),
		data: channels.map((channel) => ({
			channel: toChannelResponse(channel),
			measurements: points.get(channel.id) ?? [],
		})),
	};
}

export async function getDeviceLatestData(
	db: Kysely<DB>,
	deviceId: number,
	session: SessionSubject,
	access: MeasurementReadAccess,
	input: ChannelListInput = {},
): Promise<DeviceLatestDataResponse> {
	await ensureDeviceVisible(db, deviceId, session, access);

	const rows = await queries.listLatestMeasurements(db, deviceId, input);
	return {
		deviceId,
		data: rows.map((row: ChannelLatestRow) => ({
			channel: toChannelResponse(row),
			date: row.date === null ? null : new Date(row.date).toISOString(),
			value: row.value,
		})),
	};
}
