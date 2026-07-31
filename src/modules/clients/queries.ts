import { type Kysely, sql } from "kysely";
import type { DB } from "@/db/types";

export function listClients(db: Kysely<DB>) {
	return db.selectFrom("client").select(["id", "name"]).orderBy("id").execute();
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
		.returning(["id", "name"])
		.executeTakeFirst();
}

export function deleteClientById(db: Kysely<DB>, id: number) {
	return db.deleteFrom("client").where("id", "=", id).returning("id").executeTakeFirst();
}

export async function countClientUsers(db: Kysely<DB>, clientId: number): Promise<number> {
	const row = await db
		.selectFrom("user")
		.select(sql<number>`count(*)::int`.as("user_count"))
		.where("client_id", "=", clientId)
		.executeTakeFirstOrThrow();
	return row.user_count;
}
