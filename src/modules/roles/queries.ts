import {
	sql,
	type Insertable,
	type Kysely,
	type Selectable,
	type Updateable,
} from "kysely";
import type { DB } from "@/db/types";

export type RoleRow = Selectable<DB["role"]>;
export type PermissionRow = Selectable<DB["permission"]>;
type InsertRoleRow = Insertable<DB["role"]>;
type UpdateRoleRow = Updateable<DB["role"]>;

const roleColumns = ["id", "name", "client_id", "deleted_at"] as const;
const permissionColumns = ["id", "name", "description", "assign_role"] as const;

export function listRoles(db: Kysely<DB>): Promise<RoleRow[]> {
	return db
		.selectFrom("role")
		.select(roleColumns)
		.where("deleted_at", "is", null)
		.orderBy("id")
		.execute();
}

export function listRolesForClient(
	db: Kysely<DB>,
	clientId: number,
): Promise<RoleRow[]> {
	return db
		.selectFrom("role")
		.select(roleColumns)
		.where("client_id", "=", clientId)
		.where("deleted_at", "is", null)
		.orderBy("id")
		.execute();
}

export function findRoleById(
	db: Kysely<DB>,
	id: number,
): Promise<RoleRow | undefined> {
	return db
		.selectFrom("role")
		.select(roleColumns)
		.where("id", "=", id)
		.where("deleted_at", "is", null)
		.executeTakeFirst();
}

export function findRoleByIdForClient(
	db: Kysely<DB>,
	id: number,
	clientId: number,
): Promise<RoleRow | undefined> {
	return db
		.selectFrom("role")
		.select(roleColumns)
		.where("id", "=", id)
		.where("client_id", "=", clientId)
		.where("deleted_at", "is", null)
		.executeTakeFirst();
}

export function insertRole(
	db: Kysely<DB>,
	role: InsertRoleRow,
): Promise<RoleRow> {
	return db
		.insertInto("role")
		.values(role)
		.returning(roleColumns)
		.executeTakeFirstOrThrow();
}

export function updateRoleById(
	db: Kysely<DB>,
	id: number,
	role: UpdateRoleRow,
): Promise<RoleRow | undefined> {
	return db
		.updateTable("role")
		.set(role)
		.where("id", "=", id)
		.where("deleted_at", "is", null)
		.returning(roleColumns)
		.executeTakeFirst();
}

export function updateRoleByIdForClient(
	db: Kysely<DB>,
	id: number,
	clientId: number,
	role: UpdateRoleRow,
): Promise<RoleRow | undefined> {
	return db
		.updateTable("role")
		.set(role)
		.where("id", "=", id)
		.where("client_id", "=", clientId)
		.where("deleted_at", "is", null)
		.returning(roleColumns)
		.executeTakeFirst();
}

export async function softDeleteRoleById(
	db: Kysely<DB>,
	id: number,
): Promise<RoleRow | undefined> {
	return db.transaction().execute(async (trx) => {
		const deleted = await trx
			.updateTable("role")
			.set({ deleted_at: new Date() })
			.where("id", "=", id)
			.where("deleted_at", "is", null)
			.returning(roleColumns)
			.executeTakeFirst();

		if (!deleted) return undefined;

		await trx
			.updateTable("invite")
			.set({ role_id: null })
			.where("role_id", "=", id)
			.execute();
		return deleted;
	});
}

export async function softDeleteRoleByIdForClient(
	db: Kysely<DB>,
	id: number,
	clientId: number,
): Promise<RoleRow | undefined> {
	return db.transaction().execute(async (trx) => {
		const deleted = await trx
			.updateTable("role")
			.set({ deleted_at: new Date() })
			.where("id", "=", id)
			.where("client_id", "=", clientId)
			.where("deleted_at", "is", null)
			.returning(roleColumns)
			.executeTakeFirst();

		if (!deleted) return undefined;

		await trx
			.updateTable("invite")
			.set({ role_id: null })
			.where("role_id", "=", id)
			.execute();
		return deleted;
	});
}

export async function deleteRolePermissions(
	db: Kysely<DB>,
	roleId: number,
): Promise<void> {
	await db
		.deleteFrom("role_permission")
		.where("role_id", "=", roleId)
		.execute();
}

export function listPermissions(db: Kysely<DB>): Promise<PermissionRow[]> {
	return db
		.selectFrom("permission")
		.select(permissionColumns)
		.orderBy("id")
		.execute();
}

export function listAssignablePermissionsByIds(
	db: Kysely<DB>,
	permissionIds: readonly number[],
): Promise<PermissionRow[]> {
	if (permissionIds.length === 0) return Promise.resolve([]);

	return db
		.selectFrom("permission")
		.select(permissionColumns)
		.where("id", "in", permissionIds)
		.where("assign_role", "=", true)
		.orderBy("id")
		.execute();
}

export function listRolePermissions(
	db: Kysely<DB>,
	roleId: number,
): Promise<PermissionRow[]> {
	return db
		.selectFrom("role_permission")
		.innerJoin(
			"permission",
			"permission.id",
			"role_permission.permission_id",
		)
		.select(
			permissionColumns.map((column) => `permission.${column}` as const),
		)
		.where("role_permission.role_id", "=", roleId)
		.orderBy("permission.id")
		.execute();
}

export async function replaceRolePermissions(
	db: Kysely<DB>,
	roleId: number,
	permissionIds: readonly number[],
): Promise<void> {
	await db.transaction().execute(async (trx) => {
		await trx
			.deleteFrom("role_permission")
			.where("role_id", "=", roleId)
			.execute();

		const uniquePermissionIds = [...new Set(permissionIds)];
		if (uniquePermissionIds.length === 0) return;

		await trx
			.insertInto("role_permission")
			.values(
				uniquePermissionIds.map((permission_id) => ({
					role_id: roleId,
					permission_id,
				})),
			)
			.execute();
	});
}

export async function countRoleUsers(
	db: Kysely<DB>,
	roleId: number,
): Promise<number> {
	const row = await db
		.selectFrom("user")
		.select(sql<number>`count(*)::int`.as("user_count"))
		.where("role_id", "=", roleId)
		.executeTakeFirstOrThrow();
	return row.user_count;
}

export async function countRoleInvites(
	db: Kysely<DB>,
	roleId: number,
): Promise<number> {
	const row = await db
		.selectFrom("invite")
		.select(sql<number>`count(*)::int`.as("invite_count"))
		.where("role_id", "=", roleId)
		.executeTakeFirstOrThrow();
	return row.invite_count;
}
