import type { Kysely } from "kysely";
import { isForeignKeyViolation } from "@/db";
import type { DB } from "@/db/types";
import type { PermissionName } from "@/plugins/authorization";
import {
	isProperPermissionSuperset,
	listRolePermissionNames,
} from "@/plugins/authorization.hierarchy";
import type { SessionSubject } from "../auth/service";
import type { PermissionRow, RoleRow } from "./queries";
import * as queries from "./queries";

export interface RoleAccess {
	canAccessExternalUsers: boolean;
	canAccessClientUsers: boolean;
}

export interface CreateRoleInput {
	name: string;
	client_id: number;
	permission_ids?: number[];
}

export interface UpdateRoleInput {
	name?: string;
	client_id?: number;
}

export interface ReplaceRolePermissionsInput {
	permission_ids: number[];
}

export type PermissionResponse = PermissionRow;
export type RoleResponse = Omit<RoleRow, "deleted_at"> & { deleted_at: string | null; permissions: PermissionResponse[] };

export class RoleNotFoundError extends Error {
	constructor(roleId: number) {
		super(`role ${roleId} does not exist`);
		this.name = "RoleNotFoundError";
	}
}

export class RoleAccessDeniedError extends Error {
	constructor() {
		super("not allowed to manage that role");
		this.name = "RoleAccessDeniedError";
	}
}

export class RolePermissionAccessDeniedError extends Error {
	constructor() {
		super("not allowed to assign those permissions");
		this.name = "RolePermissionAccessDeniedError";
	}
}

export class RolePermissionNotAssignableError extends Error {
	constructor(permissionIds: readonly number[]) {
		super(`permission id(s) ${permissionIds.join(", ")} do not exist or cannot be assigned to a role`);
		this.name = "RolePermissionNotAssignableError";
	}
}

export class RoleInUseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "RoleInUseError";
	}
}

async function toRoleResponse(db: Kysely<DB>, role: RoleRow): Promise<RoleResponse> {
	return {
		...role,
		deleted_at: role.deleted_at?.toISOString() ?? null,
		permissions: await queries.listRolePermissions(db, role.id),
	};
}

async function toRoleResponses(db: Kysely<DB>, roles: RoleRow[]): Promise<RoleResponse[]> {
	return Promise.all(roles.map((role) => toRoleResponse(db, role)));
}

function ensureAccess(access: RoleAccess): void {
	if (!access.canAccessExternalUsers && !access.canAccessClientUsers) {
		throw new RoleAccessDeniedError();
	}
}

function ensureClientAccess(
	session: SessionSubject,
	access: RoleAccess,
	clientId: number | null,
): void {
	ensureAccess(access);

	if (access.canAccessExternalUsers) return;
	if (access.canAccessClientUsers && clientId === session.client_id) return;

	throw new RoleAccessDeniedError();
}

async function findVisibleRole(
	db: Kysely<DB>,
	id: number,
	session: SessionSubject,
	access: RoleAccess,
): Promise<RoleRow> {
	const role = access.canAccessExternalUsers
		? await queries.findRoleById(db, id)
		: access.canAccessClientUsers
			? await queries.findRoleByIdForClient(db, id, session.client_id)
			: null;

	if (!role) throw new RoleNotFoundError(id);
	return role;
}

async function validateAssignablePermissions(
	db: Kysely<DB>,
	session: SessionSubject,
	permissionIds: readonly number[],
): Promise<void> {
	const uniquePermissionIds = [...new Set(permissionIds)];
	const permissions = await queries.listAssignablePermissionsByIds(db, uniquePermissionIds);
	if (permissions.length !== uniquePermissionIds.length) {
		const found = new Set(permissions.map((permission) => permission.id));
		throw new RolePermissionNotAssignableError(
			uniquePermissionIds.filter((permissionId) => !found.has(permissionId)),
		);
	}

	const actorPermissions = await listRolePermissionNames(db, session.role_id);
	const targetPermissions = permissions.map((permission) => permission.name as PermissionName);
	if (!isProperPermissionSuperset(actorPermissions, targetPermissions)) {
		throw new RolePermissionAccessDeniedError();
	}
}

export async function listRoles(
	db: Kysely<DB>,
	session: SessionSubject,
	access: RoleAccess,
): Promise<RoleResponse[]> {
	ensureAccess(access);

	const roles = access.canAccessExternalUsers
		? await queries.listRoles(db)
		: await queries.listRolesForClient(db, session.client_id);

	return toRoleResponses(db, roles);
}

export async function getRole(
	db: Kysely<DB>,
	id: number,
	session: SessionSubject,
	access: RoleAccess,
): Promise<RoleResponse> {
	return toRoleResponse(db, await findVisibleRole(db, id, session, access));
}

export async function listPermissions(
	db: Kysely<DB>,
	session: SessionSubject,
	access: RoleAccess,
): Promise<PermissionResponse[]> {
	ensureAccess(access);

	const permissions = await queries.listPermissions(db);
	if (access.canAccessExternalUsers) return permissions;

	const actorPermissions = new Set(await listRolePermissionNames(db, session.role_id));
	return permissions.filter(
		(permission) =>
			permission.assign_role && actorPermissions.has(permission.name as PermissionName),
	);
}

export async function createRole(
	db: Kysely<DB>,
	session: SessionSubject,
	access: RoleAccess,
	input: CreateRoleInput,
): Promise<RoleResponse> {
	ensureClientAccess(session, access, input.client_id);
	await validateAssignablePermissions(db, session, input.permission_ids ?? []);

	const role = await queries.insertRole(db, {
		name: input.name,
		client_id: input.client_id,
	});
	await queries.replaceRolePermissions(db, role.id, input.permission_ids ?? []);

	return toRoleResponse(db, role);
}

export async function updateRole(
	db: Kysely<DB>,
	id: number,
	session: SessionSubject,
	access: RoleAccess,
	input: UpdateRoleInput,
): Promise<RoleResponse> {
	const existing = await findVisibleRole(db, id, session, access);
	ensureClientAccess(session, access, input.client_id ?? existing.client_id);

	const updated = access.canAccessExternalUsers
		? await queries.updateRoleById(db, id, input)
		: await queries.updateRoleByIdForClient(db, id, session.client_id, input);

	if (!updated) throw new RoleNotFoundError(id);
	return toRoleResponse(db, updated);
}

export async function replaceRolePermissions(
	db: Kysely<DB>,
	id: number,
	session: SessionSubject,
	access: RoleAccess,
	input: ReplaceRolePermissionsInput,
): Promise<RoleResponse> {
	const role = await findVisibleRole(db, id, session, access);
	ensureClientAccess(session, access, role.client_id);
	await validateAssignablePermissions(db, session, input.permission_ids);

	await queries.replaceRolePermissions(db, id, input.permission_ids);
	return toRoleResponse(db, role);
}

export async function deleteRole(
	db: Kysely<DB>,
	id: number,
	session: SessionSubject,
	access: RoleAccess,
): Promise<void> {
	const role = await findVisibleRole(db, id, session, access);
	ensureClientAccess(session, access, role.client_id);

	const userCount = await queries.countRoleUsers(db, id);
	if (userCount > 0) {
		throw new RoleInUseError(`role ${id} still has ${userCount} user(s)`);
	}

	const deleted = access.canAccessExternalUsers
		? await queries.softDeleteRoleById(db, id)
		: await queries.softDeleteRoleByIdForClient(db, id, session.client_id);
	if (!deleted) throw new RoleNotFoundError(id);
}




