import type { Kysely, Selectable } from "kysely";
import type { DB } from "@/db/types";

export type UserRow = Selectable<DB["user"]>;

const userColumns = [
	"id",
	"client_id",
	"created_at",
	"email",
	"email_verified",
	"image",
	"name",
	"phone_number",
	"role_id",
	"updated_at",
] as const;

export function listUsers(db: Kysely<DB>): Promise<UserRow[]> {
	return db.selectFrom("user").select(userColumns).orderBy("name").execute();
}

export function listUsersByClient(
	db: Kysely<DB>,
	clientId: number,
): Promise<UserRow[]> {
	return db
		.selectFrom("user")
		.select(userColumns)
		.where("client_id", "=", clientId)
		.orderBy("name")
		.execute();
}

export function findUserById(
	db: Kysely<DB>,
	id: string,
): Promise<UserRow | undefined> {
	return db
		.selectFrom("user")
		.select(userColumns)
		.where("id", "=", id)
		.executeTakeFirst();
}

export function findUserByIdForClient(
	db: Kysely<DB>,
	id: string,
	clientId: number,
): Promise<UserRow | undefined> {
	return db
		.selectFrom("user")
		.select(userColumns)
		.where("id", "=", id)
		.where("client_id", "=", clientId)
		.executeTakeFirst();
}

export function findUserByEmail(
	db: Kysely<DB>,
	email: string,
): Promise<UserRow | undefined> {
	return db
		.selectFrom("user")
		.select(userColumns)
		.where("email", "=", email.toLowerCase())
		.executeTakeFirst();
}

export function updateUserPhoneNumber(
	db: Kysely<DB>,
	id: string,
	phoneNumber: string,
): Promise<UserRow | undefined> {
	return db
		.updateTable("user")
		.set({
			phone_number: phoneNumber,
			updated_at: new Date(),
		})
		.where("id", "=", id)
		.returning(userColumns)
		.executeTakeFirst();
}

export function updateUserPhoneNumberForClient(
	db: Kysely<DB>,
	id: string,
	clientId: number,
	phoneNumber: string,
): Promise<UserRow | undefined> {
	return db
		.updateTable("user")
		.set({
			phone_number: phoneNumber,
			updated_at: new Date(),
		})
		.where("id", "=", id)
		.where("client_id", "=", clientId)
		.returning(userColumns)
		.executeTakeFirst();
}

export function updateUserClientAndRole(
	db: Kysely<DB>,
	id: string,
	clientId: number,
	roleId: number,
): Promise<UserRow | undefined> {
	return db
		.updateTable("user")
		.set({
			client_id: clientId,
			role_id: roleId,
			updated_at: new Date(),
		})
		.where("id", "=", id)
		.returning(userColumns)
		.executeTakeFirst();
}

