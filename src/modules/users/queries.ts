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
	/** Newest session created_at — when the user last signed in. Null if never. */
	last_login_at: Date | null;
	/** Newest session updated_at — better-auth bumps it as the session is refreshed. */
	last_active_at: Date | null;
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

// Correlated subqueries over the better-auth session table give a cheap
// "last seen" without touching the audit tables (which only log mutations).
function lastLoginSelection() {
	return sql<Date | null>`(select max(created_at) from session where session.user_id = "user".id)`.as(
		"last_login_at",
	);
}

function lastActiveSelection() {
	return sql<Date | null>`(select max(updated_at) from session where session.user_id = "user".id)`.as(
		"last_active_at",
	);
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
		lastLoginSelection(),
		lastActiveSelection(),
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

export async function findClientName(
	db: Kysely<DB>,
	clientId: number,
): Promise<string | undefined> {
	const client = await db
		.selectFrom("client")
		.select("name")
		.where("id", "=", clientId)
		.executeTakeFirst();

	return client?.name;
}

export async function findRoleName(db: Kysely<DB>, roleId: number): Promise<string | undefined> {
	const role = await db
		.selectFrom("role")
		.select("name")
		.where("id", "=", roleId)
		.executeTakeFirst();

	return role?.name;
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

// ---------------------------------------------------------------------------
// Role assignment
// ---------------------------------------------------------------------------

export interface UserRoleRow {
	id: number;
	client_id: number;
	name: string;
}

/** Non-deleted role lookup, local to this module (no cross-module query imports). */
export function findRoleById(db: Kysely<DB>, roleId: number): Promise<UserRoleRow | undefined> {
	return db
		.selectFrom("role")
		.select(["id", "client_id", "name"])
		.where("id", "=", roleId)
		.where("deleted_at", "is", null)
		.executeTakeFirst();
}

export function updateUserRole(
	db: Kysely<DB>,
	id: string,
	roleId: number,
	encryptionKey: string,
): Promise<UserRow | undefined> {
	return db
		.updateTable("user")
		.set({ role_id: roleId, updated_at: new Date() })
		.where("id", "=", id)
		.returning(userSelections(encryptionKey))
		.executeTakeFirst();
}

// ---------------------------------------------------------------------------
// Individually granted permissions (granted_permission)
// ---------------------------------------------------------------------------

export interface UserPermissionRow {
	id: number;
	name: string;
	description: string;
	assign_role: boolean;
}

const permissionColumns = ["id", "name", "description", "assign_role"] as const;

export function listPermissions(db: Kysely<DB>): Promise<UserPermissionRow[]> {
	return db.selectFrom("permission").select(permissionColumns).orderBy("id").execute();
}

export function listPermissionsByIds(
	db: Kysely<DB>,
	permissionIds: readonly number[],
): Promise<UserPermissionRow[]> {
	if (permissionIds.length === 0) return Promise.resolve([]);

	return db
		.selectFrom("permission")
		.select(permissionColumns)
		.where("id", "in", permissionIds)
		.orderBy("id")
		.execute();
}

export function listRolePermissions(db: Kysely<DB>, roleId: number): Promise<UserPermissionRow[]> {
	return db
		.selectFrom("role_permission")
		.innerJoin("permission", "permission.id", "role_permission.permission_id")
		.select(permissionColumns.map((column) => `permission.${column}` as const))
		.where("role_permission.role_id", "=", roleId)
		.orderBy("permission.id")
		.execute();
}

export function listGrantedPermissions(
	db: Kysely<DB>,
	userId: string,
): Promise<UserPermissionRow[]> {
	return db
		.selectFrom("granted_permission")
		.innerJoin("permission", "permission.id", "granted_permission.permission_id")
		.select(permissionColumns.map((column) => `permission.${column}` as const))
		.where("granted_permission.user_id", "=", userId)
		.orderBy("permission.id")
		.execute();
}

export async function replaceGrantedPermissions(
	db: Kysely<DB>,
	userId: string,
	permissionIds: readonly number[],
): Promise<void> {
	await db.transaction().execute(async (trx) => {
		await trx.deleteFrom("granted_permission").where("user_id", "=", userId).execute();

		const uniquePermissionIds = [...new Set(permissionIds)];
		if (uniquePermissionIds.length === 0) return;

		await trx
			.insertInto("granted_permission")
			.values(
				uniquePermissionIds.map((permission_id) => ({
					user_id: userId,
					permission_id,
				})),
			)
			.execute();
	});
}
