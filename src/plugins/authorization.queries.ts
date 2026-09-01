import type { Kysely } from "kysely";
import type { DB } from "@/db/types";
import type { PermissionName } from "@/plugins/authorization";

export async function listUserPermissionNames(
	db: Kysely<DB>,
	userId: string,
	roleId: number,
): Promise<PermissionName[]> {
	// UNION dedupes role-held and individually-granted names in one round trip.
	const rows = await db
		.selectFrom("role_permission")
		.innerJoin("permission", "permission.id", "role_permission.permission_id")
		.select("permission.name")
		.where("role_permission.role_id", "=", roleId)
		.union(
			db
				.selectFrom("granted_permission")
				.innerJoin("permission", "permission.id", "granted_permission.permission_id")
				.select("permission.name")
				.where("granted_permission.user_id", "=", userId),
		)
		.execute();

	return rows.map((row) => row.name as PermissionName);
}
