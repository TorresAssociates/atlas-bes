import type { Kysely } from "kysely";
import type { DB } from "@/db/types";
import type { SessionSubject } from "../auth/service";
import type { ChannelLatestRow, ChannelRow } from "./queries";
import * as queries from "./queries";

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;

// Hard cap on measurement points returned per request. Bounds the payload and
// the synchronous serialization work regardless of how wide a window or how
// many devices the caller asks for; responses flag the cut via `truncated`.
export const MAX_MEASUREMENT_POINTS = 100_000;

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
	truncated: boolean;
	data: { channel: ChannelResponse; measurements: MeasurementPointResponse[] }[];
}

export interface BulkDeviceDataResponse {
	from: string;
	to: string;
	truncated: boolean;
	devices: {
		deviceId: number;
		data: { channel: ChannelResponse; measurements: MeasurementPointResponse[] }[];
	}[];
}

export interface DeviceLatestDataResponse {
	deviceId: number;
	data: { channel: ChannelResponse; date: string | null; value: number | null }[];
}

export interface BulkDeviceLatestDataResponse {
	devices: DeviceLatestDataResponse[];
}

export class MeasurementDeviceNotFoundError extends Error {
	constructor(deviceId: number) {
		super(`device ${deviceId} does not exist`);
		this.name = "MeasurementDeviceNotFoundError";
	}
}

export class MeasurementDevicesNotFoundError extends Error {
	readonly deviceIds: readonly number[];

	constructor(deviceIds: readonly number[]) {
		super(`devices ${deviceIds.join(", ")} do not exist`);
		this.name = "MeasurementDevicesNotFoundError";
		this.deviceIds = deviceIds;
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

/**
 * Fetches at most `maxPoints` measurement points for the devices' channels
 * (applying the same channel filters as the channel listing) and groups them
 * by channel id. `truncated` reports whether the cap cut anything off.
 * Resolves channels itself so it can run concurrently with the channel query.
 */
async function fetchMeasurementPoints(
	db: Kysely<DB>,
	deviceIds: readonly number[],
	input: DeviceDataInput,
	from: Date,
	to: Date,
	maxPoints: number,
): Promise<{ points: Map<number, MeasurementPointResponse[]>; truncated: boolean }> {
	// Fetch one extra row purely to detect truncation.
	const rows = await queries.listMeasurementRecordsForDevices(
		db,
		deviceIds,
		{
			channelId: input.channelId,
			category: input.category,
			includeInactive: input.includeInactiveChannels,
		},
		from,
		to,
		maxPoints + 1,
	);
	const truncated = rows.length > maxPoints;
	if (truncated) rows.length = maxPoints;

	const points = new Map<number, MeasurementPointResponse[]>();
	for (const row of rows) {
		let list = points.get(row.channel_id);
		if (!list) {
			list = [];
			points.set(row.channel_id, list);
		}
		list.push({ date: row.date.toISOString(), value: row.value });
	}
	return { points, truncated };
}

export async function getDeviceData(
	db: Kysely<DB>,
	deviceId: number,
	session: SessionSubject,
	access: MeasurementReadAccess,
	input: DeviceDataInput = {},
	maxPoints: number = MAX_MEASUREMENT_POINTS,
): Promise<DeviceDataResponse> {
	const { from, to } = resolveWindow(input);

	const [, channels, { points, truncated }] = await Promise.all([
		ensureDeviceVisible(db, deviceId, session, access),
		queries.listChannels(db, deviceId, {
			channelId: input.channelId,
			category: input.category,
			includeInactive: input.includeInactiveChannels,
		}),
		fetchMeasurementPoints(db, [deviceId], input, from, to, maxPoints),
	]);

	return {
		deviceId,
		from: from.toISOString(),
		to: to.toISOString(),
		truncated,
		data: channels.map((channel) => ({
			channel: toChannelResponse(channel),
			measurements: points.get(channel.id) ?? [],
		})),
	};
}

/** Throws when any of the (already-deduped) `uniqueIds` is not visible. */
async function ensureDevicesVisible(
	db: Kysely<DB>,
	uniqueIds: readonly number[],
	session: SessionSubject,
	access: MeasurementReadAccess,
): Promise<void> {
	const deviceRows = access.canReadExternal
		? await queries.listDevices(db, uniqueIds)
		: await queries.listDevicesForClient(db, uniqueIds, session.client_id);
	const visibleIds = new Set(
		deviceRows
			.filter((row) => row.active === true || access.canViewInactive)
			.map((row) => row.id),
	);
	const missingIds = uniqueIds.filter((id) => !visibleIds.has(id));
	if (missingIds.length > 0) throw new MeasurementDevicesNotFoundError(missingIds);
}

export async function getBulkDeviceData(
	db: Kysely<DB>,
	deviceIds: readonly number[],
	session: SessionSubject,
	access: MeasurementReadAccess,
	input: DeviceDataInput = {},
	maxPoints: number = MAX_MEASUREMENT_POINTS,
): Promise<BulkDeviceDataResponse> {
	const uniqueIds = [...new Set(deviceIds)];
	const { from, to } = resolveWindow(input);

	const [, channels, { points, truncated }] = await Promise.all([
		ensureDevicesVisible(db, uniqueIds, session, access),
		queries.listChannelsForDevices(db, uniqueIds, {
			channelId: input.channelId,
			category: input.category,
			includeInactive: input.includeInactiveChannels,
		}),
		fetchMeasurementPoints(db, uniqueIds, input, from, to, maxPoints),
	]);

	const channelsByDevice = new Map<number, ChannelRow[]>();
	for (const channel of channels) {
		let list = channelsByDevice.get(channel.device_id);
		if (!list) {
			list = [];
			channelsByDevice.set(channel.device_id, list);
		}
		list.push(channel);
	}

	return {
		from: from.toISOString(),
		to: to.toISOString(),
		truncated,
		devices: uniqueIds.map((deviceId) => ({
			deviceId,
			data: (channelsByDevice.get(deviceId) ?? []).map((channel) => ({
				channel: toChannelResponse(channel),
				measurements: points.get(channel.id) ?? [],
			})),
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
	const [, rows] = await Promise.all([
		ensureDeviceVisible(db, deviceId, session, access),
		queries.listLatestMeasurements(db, deviceId, input),
	]);

	return {
		deviceId,
		data: rows.map((row: ChannelLatestRow) => ({
			channel: toChannelResponse(row),
			date: row.date === null ? null : row.date.toISOString(),
			value: row.value,
		})),
	};
}

export async function getBulkDeviceLatestData(
	db: Kysely<DB>,
	deviceIds: readonly number[],
	session: SessionSubject,
	access: MeasurementReadAccess,
	input: ChannelListInput = {},
): Promise<BulkDeviceLatestDataResponse> {
	const uniqueIds = [...new Set(deviceIds)];

	const [, rows] = await Promise.all([
		ensureDevicesVisible(db, uniqueIds, session, access),
		queries.listLatestMeasurementsForDevices(db, uniqueIds, input),
	]);

	const rowsByDevice = new Map<number, ChannelLatestRow[]>();
	for (const row of rows) {
		let list = rowsByDevice.get(row.device_id);
		if (!list) {
			list = [];
			rowsByDevice.set(row.device_id, list);
		}
		list.push(row);
	}

	return {
		devices: uniqueIds.map((deviceId) => ({
			deviceId,
			data: (rowsByDevice.get(deviceId) ?? []).map((row) => ({
				channel: toChannelResponse(row),
				date: row.date === null ? null : row.date.toISOString(),
				value: row.value,
			})),
		})),
	};
}
