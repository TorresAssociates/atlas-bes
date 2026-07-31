import type { Kysely } from "kysely";
import type { DB } from "@/db/types";
import type { PermissionName } from "@/plugins/authorization";

/**
 * Loads the permission names assigned directly to a role through role_permission.
 * Individual user grants are not included here.
 */
export async function listRolePermissionNames(
	db: Kysely<DB>,
	roleId: number,
): Promise<PermissionName[]> {
	const permissions = await db
		.selectFrom("role_permission")
		.innerJoin("permission", "permission.id", "role_permission.permission_id")
		.select("permission.name")
		.where("role_permission.role_id", "=", roleId)
		.execute();

	return [...new Set(permissions.map((row) => row.name as PermissionName))];
}

/**
 * Expands implied permissions before hierarchy comparisons.
 * External permissions also count as their matching client-scoped permission.
 */
export function expandPermissionHierarchy(
	permissions: Iterable<PermissionName>,
): Set<PermissionName> {
	const expanded = new Set<PermissionName>();

	for (const permission of permissions) {
		expanded.add(permission);

		if (permission.includes("_EXTERNAL_")) {
			expanded.add(
				permission.replace("_EXTERNAL_", "_CLIENT_") as PermissionName,
			);
		}
	}

	return expanded;
}

/**
 * Returns true only when the actor has every effective target permission plus
 * at least one additional effective permission. Equal permission sets fail.
 */
export function isProperPermissionSuperset(
	actorPermissions: Iterable<PermissionName>,
	targetPermissions: Iterable<PermissionName>,
): boolean {
	const actor = expandPermissionHierarchy(actorPermissions);
	const target = expandPermissionHierarchy(targetPermissions);

	if (actor.size <= target.size) return false;

	for (const permission of target) {
		if (!actor.has(permission)) return false;
	}

	return true;
}

/**
 * Checks whether one role outranks another role using role permissions only.
 * Use this when individual user grants should not affect role hierarchy.
 */
export async function roleHasProperPermissionSupersetOfRole(
	db: Kysely<DB>,
	actorRoleId: number,
	targetRoleId: number,
): Promise<boolean> {
	const [actorPermissions, targetPermissions] = await Promise.all([
		listRolePermissionNames(db, actorRoleId),
		listRolePermissionNames(db, targetRoleId),
	]);

	return isProperPermissionSuperset(actorPermissions, targetPermissions);
}
