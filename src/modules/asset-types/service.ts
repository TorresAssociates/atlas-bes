import type { Kysely } from "kysely";
import type { DB } from "@/db/types";
import type { SessionSubject } from "../auth/service";
import type { AssetTypeRow } from "./queries";
import * as queries from "./queries";

export interface AssetTypeReadAccess {
	canReadExternal: boolean;
}

export interface AssetTypeWriteAccess {
	canWriteExternal: boolean;
}

export interface CreateAssetTypeInput {
	owner_client_id?: number;
	name: string;
	lifespan?: number | null;
	current_value?: string | null;
	point_of_sale?: string | null;
	is_deprecated?: boolean;
}

export interface UpdateAssetTypeInput {
	owner_client_id?: number;
	name?: string;
	lifespan?: number | null;
	current_value?: string | null;
	point_of_sale?: string | null;
	is_deprecated?: boolean;
}

export type AssetTypeResponse = AssetTypeRow;

export class AssetTypeNotFoundError extends Error {
	constructor(assetTypeId: number) {
		super(`asset type ${assetTypeId} does not exist`);
		this.name = "AssetTypeNotFoundError";
	}
}

export class AssetTypeAccessDeniedError extends Error {
	constructor(message = "not allowed to manage asset types for other clients") {
		super(message);
		this.name = "AssetTypeAccessDeniedError";
	}
}

export class AssetTypeClientNotFoundError extends Error {
	constructor(clientId: number) {
		super(`client ${clientId} does not exist`);
		this.name = "AssetTypeClientNotFoundError";
	}
}

export class AssetTypeInUseError extends Error {
	constructor(assetTypeId: number) {
		super(`asset type ${assetTypeId} is still referenced by assets`);
		this.name = "AssetTypeInUseError";
	}
}

export async function listAssetTypes(
	db: Kysely<DB>,
	session: SessionSubject,
	access: AssetTypeReadAccess,
): Promise<AssetTypeResponse[]> {
	return access.canReadExternal
		? queries.listAssetTypes(db)
		: queries.listAssetTypesForClient(db, session.client_id);
}

export async function createAssetType(
	db: Kysely<DB>,
	session: SessionSubject,
	access: AssetTypeWriteAccess,
	input: CreateAssetTypeInput,
): Promise<AssetTypeResponse> {
	const ownerClientId = input.owner_client_id ?? session.client_id;
	if (!access.canWriteExternal && ownerClientId !== session.client_id) {
		throw new AssetTypeAccessDeniedError();
	}

	await ensureClientExists(db, ownerClientId);

	return queries.insertAssetType(db, {
		owner_client_id: ownerClientId,
		name: input.name,
		...(input.lifespan === undefined ? {} : { lifespan: input.lifespan }),
		...(input.current_value === undefined ? {} : { current_value: input.current_value }),
		...(input.point_of_sale === undefined ? {} : { point_of_sale: input.point_of_sale }),
		...(input.is_deprecated === undefined ? {} : { is_deprecated: input.is_deprecated }),
	});
}

export async function updateAssetType(
	db: Kysely<DB>,
	id: number,
	session: SessionSubject,
	access: AssetTypeWriteAccess,
	input: UpdateAssetTypeInput,
): Promise<AssetTypeResponse> {
	const current = access.canWriteExternal
		? await queries.findAssetTypeById(db, id)
		: await queries.findAssetTypeByIdForClient(db, id, session.client_id);
	if (!current) throw new AssetTypeNotFoundError(id);

	if (
		!access.canWriteExternal &&
		input.owner_client_id !== undefined &&
		input.owner_client_id !== session.client_id
	) {
		throw new AssetTypeAccessDeniedError();
	}

	if (input.owner_client_id !== undefined && input.owner_client_id !== current.owner_client_id) {
		await ensureClientExists(db, input.owner_client_id);
	}

	const updated = await queries.updateAssetType(db, id, input);
	if (!updated) throw new AssetTypeNotFoundError(id);
	return updated;
}

export async function deleteAssetType(
	db: Kysely<DB>,
	id: number,
	session: SessionSubject,
	access: AssetTypeWriteAccess,
): Promise<void> {
	const current = access.canWriteExternal
		? await queries.findAssetTypeById(db, id)
		: await queries.findAssetTypeByIdForClient(db, id, session.client_id);
	if (!current) throw new AssetTypeNotFoundError(id);

	const usage = await queries.countAssetsForAssetType(db, id);
	if (Number(usage.count) > 0) throw new AssetTypeInUseError(id);

	const deleted = await queries.deleteAssetType(db, id);
	if (!deleted) throw new AssetTypeNotFoundError(id);
}

async function ensureClientExists(db: Kysely<DB>, clientId: number): Promise<void> {
	const client = await queries.findClientById(db, clientId);
	if (!client) throw new AssetTypeClientNotFoundError(clientId);
}
