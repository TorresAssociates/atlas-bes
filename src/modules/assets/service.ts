import type { Kysely } from "kysely";
import type { DB } from "@/db/types";
import type { SessionSubject } from "../auth/service";
import { GaugeStationNotFoundError, getGaugeStation } from "../gauge-stations/service";
import type { AssetRow } from "./queries";
import * as queries from "./queries";

export interface AssetReadAccess {
	canReadExternal: boolean;
}

export interface AssetWriteAccess {
	canWriteExternal: boolean;
}

export interface CreateAssetInput {
	asset_type_id: number;
	cost?: string | null;
	creation_date: string | Date;
	deploy_date?: string | Date | null;
	eos_date?: string | Date | null;
	gauge_station_id: number;
	serial_number?: string | null;
}

export interface UpdateAssetInput {
	asset_type_id?: number;
	cost?: string | null;
	creation_date?: string | Date;
	deploy_date?: string | Date | null;
	eos_date?: string | Date | null;
	gauge_station_id?: number;
	serial_number?: string | null;
}

export interface AssetResponse {
	id: number;
	asset_type_id: number;
	cost: string | null;
	creation_date: string;
	deploy_date: string | null;
	eos_date: string | null;
	gauge_station_id: number | null;
	serial_number: string | null;
}

export class AssetNotFoundError extends Error {
	constructor(assetId: number) {
		super(`asset ${assetId} does not exist`);
		this.name = "AssetNotFoundError";
	}
}

export class AssetAccessDeniedError extends Error {
	constructor(message = "not allowed to manage assets for other clients") {
		super(message);
		this.name = "AssetAccessDeniedError";
	}
}

export class AssetTypeNotFoundError extends Error {
	constructor(assetTypeId: number) {
		super(`asset type ${assetTypeId} does not exist`);
		this.name = "AssetTypeNotFoundError";
	}
}

export class AssetGaugeStationNotFoundError extends Error {
	constructor(gaugeStationId: number) {
		super(`gauge station ${gaugeStationId} does not exist`);
		this.name = "AssetGaugeStationNotFoundError";
	}
}

export class AssetSerialNumberConflictError extends Error {
	constructor() {
		super("asset serial number already exists for that asset type");
		this.name = "AssetSerialNumberConflictError";
	}
}

function isUniqueViolation(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { code?: unknown }).code === "23505"
	);
}

function toIso(value: Date | string): string {
	return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toAssetResponse(row: AssetRow): AssetResponse {
	return {
		...row,
		creation_date: toIso(row.creation_date),
		deploy_date: row.deploy_date === null ? null : toIso(row.deploy_date),
		eos_date: row.eos_date === null ? null : toIso(row.eos_date),
	};
}

async function ensureAssetTypeAccess(
	db: Kysely<DB>,
	session: SessionSubject,
	access: AssetWriteAccess,
	assetTypeId: number,
): Promise<void> {
	const assetType = await queries.findAssetTypeById(db, assetTypeId);
	if (!assetType) throw new AssetTypeNotFoundError(assetTypeId);
	if (!access.canWriteExternal && assetType.owner_client_id !== session.client_id) {
		throw new AssetAccessDeniedError("not allowed to use asset types for other clients");
	}
}

async function ensureGaugeStationAccess(
	db: Kysely<DB>,
	session: SessionSubject,
	access: AssetWriteAccess,
	gaugeStationId: number,
): Promise<void> {
	try {
		await getGaugeStation(db, gaugeStationId, session, {
			canReadExternal: access.canWriteExternal,
			canViewInactive: true,
		});
	} catch (error) {
		if (error instanceof GaugeStationNotFoundError) {
			throw new AssetGaugeStationNotFoundError(gaugeStationId);
		}
		throw error;
	}
}

async function findVisibleAsset(
	db: Kysely<DB>,
	id: number,
	session: SessionSubject,
	access: AssetReadAccess | AssetWriteAccess,
): Promise<AssetRow> {
	const canAccessExternal =
		"canReadExternal" in access ? access.canReadExternal : access.canWriteExternal;
	const asset = canAccessExternal
		? await queries.findAssetById(db, id)
		: await queries.findAssetByIdForClient(db, id, session.client_id);
	if (!asset) throw new AssetNotFoundError(id);
	return asset;
}

export async function listAssets(
	db: Kysely<DB>,
	session: SessionSubject,
	access: AssetReadAccess,
): Promise<AssetResponse[]> {
	const rows = access.canReadExternal
		? await queries.listAssets(db)
		: await queries.listAssetsForClient(db, session.client_id);
	return rows.map(toAssetResponse);
}

export async function getAsset(
	db: Kysely<DB>,
	id: number,
	session: SessionSubject,
	access: AssetReadAccess,
): Promise<AssetResponse> {
	return toAssetResponse(await findVisibleAsset(db, id, session, access));
}

export async function createAsset(
	db: Kysely<DB>,
	session: SessionSubject,
	access: AssetWriteAccess,
	input: CreateAssetInput,
): Promise<AssetResponse> {
	await ensureAssetTypeAccess(db, session, access, input.asset_type_id);

	await ensureGaugeStationAccess(db, session, access, input.gauge_station_id);

	try {
		return toAssetResponse(
			await queries.insertAsset(db, {
				asset_type_id: input.asset_type_id,
				creation_date: input.creation_date,
				gauge_station_id: input.gauge_station_id,
				...(input.cost === undefined ? {} : { cost: input.cost }),
				...(input.deploy_date === undefined ? {} : { deploy_date: input.deploy_date }),
				...(input.eos_date === undefined ? {} : { eos_date: input.eos_date }),
				...(input.serial_number === undefined
					? {}
					: { serial_number: input.serial_number }),
			}),
		);
	} catch (error) {
		if (isUniqueViolation(error)) throw new AssetSerialNumberConflictError();
		throw error;
	}
}

export async function updateAsset(
	db: Kysely<DB>,
	id: number,
	session: SessionSubject,
	access: AssetWriteAccess,
	input: UpdateAssetInput,
): Promise<AssetResponse> {
	await findVisibleAsset(db, id, session, access);
	if (input.asset_type_id !== undefined)
		await ensureAssetTypeAccess(db, session, access, input.asset_type_id);
	if (input.gauge_station_id !== undefined)
		await ensureGaugeStationAccess(db, session, access, input.gauge_station_id);

	try {
		const updated = await queries.updateAsset(db, id, input);
		if (!updated) throw new AssetNotFoundError(id);
		return toAssetResponse(updated);
	} catch (error) {
		if (isUniqueViolation(error)) throw new AssetSerialNumberConflictError();
		throw error;
	}
}

export async function deleteAsset(
	db: Kysely<DB>,
	id: number,
	session: SessionSubject,
	access: AssetWriteAccess,
): Promise<void> {
	await findVisibleAsset(db, id, session, access);
	const deleted = await queries.deleteAsset(db, id);
	if (!deleted) throw new AssetNotFoundError(id);
}
