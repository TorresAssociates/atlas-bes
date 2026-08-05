import type { DB } from "@/db/types";
import type { Insertable, Kysely, Selectable, Updateable } from "kysely";

export type AssetTypeRow = Selectable<DB["asset_type"]>;
type InsertAssetTypeRow = Insertable<DB["asset_type"]>;
type UpdateAssetTypeRow = Updateable<DB["asset_type"]>;

const assetTypeColumns = [
	"id",
	"owner_client_id",
	"name",
	"lifespan",
	"current_value",
	"point_of_sale",
	"is_deprecated",
] as const;

export function listAssetTypes(db: Kysely<DB>): Promise<AssetTypeRow[]> {
	return db
		.selectFrom("asset_type")
		.select(assetTypeColumns)
		.orderBy("id", "asc")
		.execute();
}

export function listAssetTypesForClient(
	db: Kysely<DB>,
	clientId: number,
): Promise<AssetTypeRow[]> {
	return db
		.selectFrom("asset_type")
		.select(assetTypeColumns)
		.where("owner_client_id", "=", clientId)
		.orderBy("id", "asc")
		.execute();
}

export function findAssetTypeById(
	db: Kysely<DB>,
	id: number,
): Promise<AssetTypeRow | undefined> {
	return db
		.selectFrom("asset_type")
		.select(assetTypeColumns)
		.where("id", "=", id)
		.executeTakeFirst();
}

export function findAssetTypeByIdForClient(
	db: Kysely<DB>,
	id: number,
	clientId: number,
): Promise<AssetTypeRow | undefined> {
	return db
		.selectFrom("asset_type")
		.select(assetTypeColumns)
		.where("id", "=", id)
		.where("owner_client_id", "=", clientId)
		.executeTakeFirst();
}

export function findClientById(
	db: Kysely<DB>,
	id: number,
): Promise<{ id: number } | undefined> {
	return db
		.selectFrom("client")
		.select("id")
		.where("id", "=", id)
		.executeTakeFirst();
}

export function countAssetsForAssetType(
	db: Kysely<DB>,
	assetTypeId: number,
): Promise<{ count: string }> {
	return db
		.selectFrom("asset")
		.select((eb) => eb.fn.countAll<string>().as("count"))
		.where("asset_type_id", "=", assetTypeId)
		.executeTakeFirstOrThrow();
}

export function insertAssetType(
	db: Kysely<DB>,
	assetType: InsertAssetTypeRow,
): Promise<AssetTypeRow> {
	return db
		.insertInto("asset_type")
		.values(assetType)
		.returning(assetTypeColumns)
		.executeTakeFirstOrThrow();
}

export function updateAssetType(
	db: Kysely<DB>,
	id: number,
	assetType: UpdateAssetTypeRow,
): Promise<AssetTypeRow | undefined> {
	return db
		.updateTable("asset_type")
		.set(assetType)
		.where("id", "=", id)
		.returning(assetTypeColumns)
		.executeTakeFirst();
}

export function deleteAssetType(
	db: Kysely<DB>,
	id: number,
): Promise<AssetTypeRow | undefined> {
	return db
		.deleteFrom("asset_type")
		.where("id", "=", id)
		.returning(assetTypeColumns)
		.executeTakeFirst();
}
