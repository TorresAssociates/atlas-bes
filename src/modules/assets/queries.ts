import type { DB } from "@/db/types";
import type { Insertable, Kysely, Selectable, Updateable } from "kysely";

export type AssetRow = Selectable<DB["asset"]>;
export type AssetTypeLookupRow = Pick<Selectable<DB["asset_type"]>, "id" | "owner_client_id">;
type InsertAssetRow = Insertable<DB["asset"]>;
type UpdateAssetRow = Updateable<DB["asset"]>;

const assetColumns = [
	"asset.id",
	"asset.asset_type_id",
	"asset.cost",
	"asset.creation_date",
	"asset.deploy_date",
	"asset.eos_date",
	"asset.gauge_station_id",
	"asset.serial_number",
] as const;

export function listAssets(db: Kysely<DB>): Promise<AssetRow[]> {
	return db.selectFrom("asset").select(assetColumns).orderBy("asset.id", "asc").execute();
}

export function listAssetsForClient(db: Kysely<DB>, clientId: number): Promise<AssetRow[]> {
	return db
		.selectFrom("asset")
		.innerJoin("client_gauge_station", "client_gauge_station.gauge_station_id", "asset.gauge_station_id")
		.select(assetColumns)
		.where("client_gauge_station.client_id", "=", clientId)
		.orderBy("asset.id", "asc")
		.execute();
}

export function findAssetById(db: Kysely<DB>, id: number): Promise<AssetRow | undefined> {
	return db
		.selectFrom("asset")
		.select(assetColumns)
		.where("asset.id", "=", id)
		.executeTakeFirst();
}

export function findAssetByIdForClient(
	db: Kysely<DB>,
	id: number,
	clientId: number,
): Promise<AssetRow | undefined> {
	return db
		.selectFrom("asset")
		.innerJoin("client_gauge_station", "client_gauge_station.gauge_station_id", "asset.gauge_station_id")
		.select(assetColumns)
		.where("asset.id", "=", id)
		.where("client_gauge_station.client_id", "=", clientId)
		.executeTakeFirst();
}

export function findAssetTypeById(
	db: Kysely<DB>,
	id: number,
): Promise<AssetTypeLookupRow | undefined> {
	return db
		.selectFrom("asset_type")
		.select(["id", "owner_client_id"])
		.where("id", "=", id)
		.executeTakeFirst();
}


export function insertAsset(db: Kysely<DB>, asset: InsertAssetRow): Promise<AssetRow> {
	return db.insertInto("asset").values(asset).returning(assetColumns).executeTakeFirstOrThrow();
}

export function updateAsset(
	db: Kysely<DB>,
	id: number,
	asset: UpdateAssetRow,
): Promise<AssetRow | undefined> {
	return db
		.updateTable("asset")
		.set(asset)
		.where("id", "=", id)
		.returning(assetColumns)
		.executeTakeFirst();
}

export function deleteAsset(db: Kysely<DB>, id: number): Promise<AssetRow | undefined> {
	return db.deleteFrom("asset").where("id", "=", id).returning(assetColumns).executeTakeFirst();
}

