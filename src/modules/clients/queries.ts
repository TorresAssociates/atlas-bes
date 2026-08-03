import { type Kysely, sql } from "kysely";
import type { DB } from "@/db/types";

export function listClients(db: Kysely<DB>) {
	return db
		.selectFrom("client")
		.select(["id", "name"])
		.where("deleted_at", "is", null)
		.orderBy("id")
		.execute();
}

export function insertClient(db: Kysely<DB>, name: string) {
	return db
		.insertInto("client")
		.values({ name })
		.returning(["id", "name"])
		.executeTakeFirstOrThrow();
}

export function updateClientName(db: Kysely<DB>, id: number, name: string) {
	return db
		.updateTable("client")
		.set({ name })
		.where("id", "=", id)
		.where("deleted_at", "is", null)
		.returning(["id", "name"])
		.executeTakeFirst();
}

export async function softDeleteClientById(db: Kysely<DB>, id: number) {
	return db.transaction().execute(async (trx) => {
		const deleted = await trx
			.updateTable("client")
			.set({ deleted_at: new Date() })
			.where("id", "=", id)
			.where("deleted_at", "is", null)
			.returning("id")
			.executeTakeFirst();

		if (!deleted) return undefined;

		await trx.updateTable("invite").set({ client_id: null }).where("client_id", "=", id).execute();
		return deleted;
	});
}

export async function countClientUsers(db: Kysely<DB>, clientId: number): Promise<number> {
	const row = await db
		.selectFrom("user")
		.select(sql<number>`count(*)::int`.as("user_count"))
		.where("client_id", "=", clientId)
		.executeTakeFirstOrThrow();
	return row.user_count;
}

export async function countActiveClientRoles(db: Kysely<DB>, clientId: number): Promise<number> {
	const row = await db
		.selectFrom("role")
		.select(sql<number>`count(*)::int`.as("role_count"))
		.where("client_id", "=", clientId)
		.where("deleted_at", "is", null)
		.executeTakeFirstOrThrow();
	return row.role_count;
}
