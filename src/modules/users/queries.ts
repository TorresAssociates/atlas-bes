import { type Kysely, sql } from "kysely";
import type { DB } from "@/db/types";

export interface UserRow {
	id: string;
	client_id: number;
	created_at: Date;
	email: string;
	email_verified: boolean;
	image: string | null;
	name: string;
	phone_number: string | null;
	phone_number_verified: boolean;
	role_id: number | null;
	deleted_at: Date | string | null;
	updated_at: Date;
}

function phoneNumberSelection(encryptionKey: string) {
	return sql<string | null>`case
		when phone_number is null then null
		else pgp_sym_decrypt(phone_number, concat(${encryptionKey}::text, salt))
	end`.as("phone_number");
}

function encryptedPhoneNumber(phoneNumber: string, encryptionKey: string) {
	return sql<Buffer>`pgp_sym_encrypt(${phoneNumber}, concat(${encryptionKey}::text, salt))`;
}

function userSelections(encryptionKey: string) {
	return [
		"id",
		"client_id",
		"created_at",
		"email",
		"email_verified",
		"image",
		"name",
		"phone_number_verified",
		"role_id",
		"deleted_at",
		"updated_at",
		phoneNumberSelection(encryptionKey),
	] as const;
}

export function listUsers(db: Kysely<DB>, encryptionKey: string): Promise<UserRow[]> {
	return db.selectFrom("user").select(userSelections(encryptionKey)).orderBy("name").execute();
}

export function listUsersByClient(
	db: Kysely<DB>,
	clientId: number,
	encryptionKey: string,
): Promise<UserRow[]> {
	return db
		.selectFrom("user")
		.select(userSelections(encryptionKey))
		.where("client_id", "=", clientId)
		.orderBy("name")
		.execute();
}

export function findUserById(
	db: Kysely<DB>,
	id: string,
	encryptionKey: string,
): Promise<UserRow | undefined> {
	return db
		.selectFrom("user")
		.select(userSelections(encryptionKey))
		.where("id", "=", id)
		.executeTakeFirst();
}

export function findUserByIdForClient(
	db: Kysely<DB>,
	id: string,
	clientId: number,
	encryptionKey: string,
): Promise<UserRow | undefined> {
	return db
		.selectFrom("user")
		.select(userSelections(encryptionKey))
		.where("id", "=", id)
		.where("client_id", "=", clientId)
		.executeTakeFirst();
}

export async function userEmailExists(db: Kysely<DB>, email: string): Promise<boolean> {
	const user = await db
		.selectFrom("user")
		.select("id")
		.where("email", "=", email.toLowerCase())
		.executeTakeFirst();

	return !!user;
}

export function findUserByEmail(
	db: Kysely<DB>,
	email: string,
	encryptionKey: string,
): Promise<UserRow | undefined> {
	return db
		.selectFrom("user")
		.select(userSelections(encryptionKey))
		.where("email", "=", email.toLowerCase())
		.executeTakeFirst();
}

export function updateUserPhoneNumber(
	db: Kysely<DB>,
	id: string,
	phoneNumber: string,
	encryptionKey: string,
): Promise<UserRow | undefined> {
	return db
		.updateTable("user")
		.set({
			phone_number: encryptedPhoneNumber(phoneNumber, encryptionKey),
			phone_number_verified: false,
			updated_at: new Date(),
		})
		.where("id", "=", id)
		.returning(userSelections(encryptionKey))
		.executeTakeFirst();
}

export function updateUserPhoneNumberForClient(
	db: Kysely<DB>,
	id: string,
	clientId: number,
	phoneNumber: string,
	encryptionKey: string,
): Promise<UserRow | undefined> {
	return db
		.updateTable("user")
		.set({
			phone_number: encryptedPhoneNumber(phoneNumber, encryptionKey),
			phone_number_verified: false,
			updated_at: new Date(),
		})
		.where("id", "=", id)
		.where("client_id", "=", clientId)
		.returning(userSelections(encryptionKey))
		.executeTakeFirst();
}

export function updateUserClientAndRole(
	db: Kysely<DB>,
	id: string,
	clientId: number,
	roleId: number,
	encryptionKey: string,
): Promise<UserRow | undefined> {
	return db
		.updateTable("user")
		.set({
			client_id: clientId,
			role_id: roleId,
			updated_at: new Date(),
		})
		.where("id", "=", id)
		.returning(userSelections(encryptionKey))
		.executeTakeFirst();
}

export function deleteUser(
	db: Kysely<DB>,
	id: string,
	encryptionKey: string,
): Promise<UserRow | undefined> {
	const now = new Date();

	return db
		.updateTable("user")
		.set({
			deleted_at: now,
			updated_at: now,
			email: id,
			email_verified: false,
			image: null,
			phone_number: null,
			phone_number_verified: false,
		})
		.where("id", "=", id)
		.returning(userSelections(encryptionKey))
		.executeTakeFirst();
}

export function deleteUserForClient(
	db: Kysely<DB>,
	id: string,
	clientId: number,
	encryptionKey: string,
): Promise<UserRow | undefined> {
	const now = new Date();

	return db
		.updateTable("user")
		.set({
			deleted_at: now,
			updated_at: now,
			email: id,
			email_verified: false,
			image: null,
			phone_number: null,
			phone_number_verified: false,
		})
		.where("id", "=", id)
		.where("client_id", "=", clientId)
		.returning(userSelections(encryptionKey))
		.executeTakeFirst();
}

export async function userDeletedAtExists(
	db: Kysely<DB>,
	id: string,
): Promise<Date | string | null> {
	const user = await db
		.selectFrom("user")
		.select("deleted_at")
		.where("id", "=", id)
		.executeTakeFirst();

	return user?.deleted_at ?? null;
}
