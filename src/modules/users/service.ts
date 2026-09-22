import type { Kysely } from "kysely";
import type { DB } from "@/db/types";
import { invalidateUserPermissions, type PermissionName } from "@/plugins/authorization";
import {
	expandPermissionHierarchy,
	isProperPermissionSuperset,
	listRolePermissionNames,
} from "@/plugins/authorization.hierarchy";
import { recordUserAuditLog } from "../audit-logs/service";
import type { SessionSubject } from "../auth/service";
import type { UserPermissionRow, UserRow } from "./queries";
import * as queries from "./queries";

export interface UserListAccess {
	canReadExternalUsers: boolean;
	canReadClientUsers: boolean;
}

export interface UserReadAccess {
	canReadExternalUsers: boolean;
	canReadClientUsers: boolean;
}

export interface UserWriteAccess {
	canWriteExternalUsers: boolean;
	canWriteClientUsers: boolean;
}

export type UserResponse = Omit<
	UserRow,
	"deleted_at" | "created_at" | "updated_at" | "last_login_at" | "last_active_at"
> & {
	deleted_at: string | null;
	created_at: string;
	updated_at: string;
	last_login_at: string | null;
	last_active_at: string | null;
};

export interface CurrentUserResponse {
	user: UserResponse;
	permissions: PermissionName[];
}

export class UserNotFoundError extends Error {
	constructor(userId: string) {
		super(`user ${JSON.stringify(userId)} does not exist`);
		this.name = "UserNotFoundError";
	}
}

export class UserEmailNotFoundError extends Error {
	constructor(email: string) {
		super(`user with email ${JSON.stringify(email)} does not exist`);
		this.name = "UserEmailNotFoundError";
	}
}

export class UserAccessDeniedError extends Error {
	constructor() {
		super("not allowed to list users");
		this.name = "UserAccessDeniedError";
	}
}

export class UserAlreadyDeletedError extends Error {
	constructor(userId: string) {
		super(`user ${userId} has already been deleted`);
		this.name = "UserAlreadyDeletedError";
	}
}

function toTimestamp(value: Date | string | null): string | null {
	if (!value) return null;
	return value instanceof Date ? value.toISOString() : value;
}

function toUserResponse(user: UserRow): UserResponse {
	return {
		...user,
		deleted_at: toTimestamp(user.deleted_at),
		created_at: user.created_at.toISOString(),
		updated_at: user.updated_at.toISOString(),
		last_login_at: toTimestamp(user.last_login_at),
		last_active_at: toTimestamp(user.last_active_at),
	};
}

export interface MeResponse {
	user: UserResponse;
	client_name: string;
	role_name: string;
	permissions: string[];
}

/**
 * The calling user's own profile plus the authorization context the frontend
 * needs for UI gating (client name, role name, permission names). The
 * permission list is informational — routes still enforce permissions
 * per-request via requirePermission().
 */
export async function getMe(
	db: Kysely<DB>,
	encryptionKey: string,
	session: SessionSubject,
	permissions: string[],
): Promise<MeResponse> {
	const user = await queries.findUserById(db, session.user_id, encryptionKey);
	if (!user) throw new UserNotFoundError(session.user_id);

	const [clientName, roleName] = await Promise.all([
		queries.findClientName(db, session.client_id),
		queries.findRoleName(db, session.role_id),
	]);

	return {
		user: toUserResponse(user),
		// client_id/role_id are NOT NULL FKs, so these only miss if the row
		// was hard-deleted out from under the session.
		client_name: clientName ?? "",
		role_name: roleName ?? "",
		permissions,
	};
}

export async function listUsers(
	db: Kysely<DB>,
	encryptionKey: string,
	session: SessionSubject,
	access: UserListAccess,
): Promise<UserResponse[]> {
	if (access.canReadExternalUsers) {
		return (await queries.listUsers(db, encryptionKey)).map(toUserResponse);
	}

	if (access.canReadClientUsers) {
		return (await queries.listUsersByClient(db, session.client_id, encryptionKey)).map(
			toUserResponse,
		);
	}

	throw new UserAccessDeniedError();
}

export async function getUser(
	db: Kysely<DB>,
	encryptionKey: string,
	id: string,
	session: SessionSubject,
	access: UserReadAccess,
): Promise<UserResponse> {
	const user = access.canReadExternalUsers
		? await queries.findUserById(db, id, encryptionKey)
		: access.canReadClientUsers
			? await queries.findUserByIdForClient(db, id, session.client_id, encryptionKey)
			: null;

	if (!user) throw new UserNotFoundError(id);

	return toUserResponse(user);
}

export async function getUserByEmail(
	db: Kysely<DB>,
	encryptionKey: string,
	email: string,
): Promise<UserResponse> {
	const user = await queries.findUserByEmail(db, email, encryptionKey);
	if (!user) throw new UserEmailNotFoundError(email);
	return toUserResponse(user);
}

export async function updateOwnPhoneNumber(
	db: Kysely<DB>,
	encryptionKey: string,
	session: SessionSubject,
	phoneNumber: string,
): Promise<UserResponse> {
	const updated = await queries.updateUserPhoneNumber(
		db,
		session.user_id,
		phoneNumber,
		encryptionKey,
	);

	if (!updated) {
		throw new UserNotFoundError(session.user_id);
	}

	await recordUserAuditLog(db, session.user_id, "UPDATE_USER", session.user_id);
	return toUserResponse(updated);
}

export async function updateUserPhoneNumber(
	db: Kysely<DB>,
	encryptionKey: string,
	id: string,
	phoneNumber: string,
	session: SessionSubject,
	access: UserWriteAccess,
): Promise<UserResponse> {
	const updated = access.canWriteExternalUsers
		? await queries.updateUserPhoneNumber(db, id, phoneNumber, encryptionKey)
		: access.canWriteClientUsers
			? await queries.updateUserPhoneNumberForClient(
					db,
					id,
					session.client_id,
					phoneNumber,
					encryptionKey,
				)
			: null;

	if (!updated) {
		throw new UserNotFoundError(id);
	}

	await recordUserAuditLog(db, session.user_id, "UPDATE_USER", id);
	return toUserResponse(updated);
}

export async function updateUserClientAndRole(
	db: Kysely<DB>,
	encryptionKey: string,
	id: string,
	clientId: number,
	roleId: number,
): Promise<UserResponse> {
	const updated = await queries.updateUserClientAndRole(db, id, clientId, roleId, encryptionKey);
	if (!updated) throw new UserNotFoundError(id);
	return toUserResponse(updated);
}

export async function deleteUser(
	db: Kysely<DB>,
	encryptionKey: string,
	id: string,
	session: SessionSubject,
	access: UserWriteAccess,
): Promise<UserResponse> {
	const deletedAt = await queries.userDeletedAtExists(db, id);
	if (deletedAt) {
		throw new UserAlreadyDeletedError(id);
	}

	const updated = access.canWriteExternalUsers
		? await queries.deleteUser(db, id, encryptionKey)
		: access.canWriteClientUsers
			? await queries.deleteUserForClient(db, id, session.client_id, encryptionKey)
			: null;

	if (!updated) {
		throw new UserNotFoundError(id);
	}

	await recordUserAuditLog(db, session.user_id, "DELETE_USER", id);
	return toUserResponse(updated);
}

// ---------------------------------------------------------------------------
// Access management: role assignment + individually granted permissions
// ---------------------------------------------------------------------------

export class UserRoleNotFoundError extends Error {
	constructor(roleId: number) {
		super(`role ${roleId} does not exist`);
		this.name = "UserRoleNotFoundError";
	}
}

export class UserRoleClientMismatchError extends Error {
	constructor(roleId: number, clientId: number) {
		super(`role ${roleId} does not belong to client ${clientId}`);
		this.name = "UserRoleClientMismatchError";
	}
}

export class UserSelfAccessChangeError extends Error {
	constructor() {
		super("cannot change your own role or permissions");
		this.name = "UserSelfAccessChangeError";
	}
}

export class UserAccessHierarchyError extends Error {
	constructor(message = "not allowed to manage a user with that level of access") {
		super(message);
		this.name = "UserAccessHierarchyError";
	}
}

/**
 * Torres & Associates (seed client id 1) is the only client whose members may
 * hold internal-only permissions: every *_EXTERNAL_* permission plus
 * R_CLIENTS / W_CLIENTS. Mirrored by isInternalOnlyPermission in the atlas frontend.
 */
const INTERNAL_CLIENT_ID = 1;
const INTERNAL_ONLY_PERMISSIONS = new Set(["R_CLIENTS", "W_CLIENTS"]);

function isInternalOnlyPermission(name: string): boolean {
	return name.includes("_EXTERNAL_") || INTERNAL_ONLY_PERMISSIONS.has(name);
}

export class UserExternalPermissionNotAllowedError extends Error {
	constructor(permissionNames: readonly string[]) {
		super(
			`permission(s) ${permissionNames.join(", ")} are reserved for internal (Torres & Associates) users`,
		);
		this.name = "UserExternalPermissionNotAllowedError";
	}
}

export class UserPermissionNotFoundError extends Error {
	constructor(permissionIds: readonly number[]) {
		super(`permission id(s) ${permissionIds.join(", ")} do not exist`);
		this.name = "UserPermissionNotFoundError";
	}
}

export interface UserPermissionsResponse {
	role: { id: number; name: string; permissions: UserPermissionRow[] } | null;
	granted: UserPermissionRow[];
	grantable: UserPermissionRow[];
}

/**
 * Resolves the target of an access change. Visibility follows the same
 * client scoping as reads; deleted users and the caller's own account are
 * rejected so a manager can't lock themselves out or resurrect a removed user.
 */
async function findAccessTarget(
	db: Kysely<DB>,
	encryptionKey: string,
	id: string,
	session: SessionSubject,
	access: UserWriteAccess,
): Promise<UserRow> {
	if (id === session.user_id) throw new UserSelfAccessChangeError();

	const user = access.canWriteExternalUsers
		? await queries.findUserById(db, id, encryptionKey)
		: access.canWriteClientUsers
			? await queries.findUserByIdForClient(db, id, session.client_id, encryptionKey)
			: null;

	if (!user) throw new UserNotFoundError(id);
	if (user.deleted_at) throw new UserAlreadyDeletedError(id);
	return user;
}

async function listEffectivePermissionNames(
	db: Kysely<DB>,
	roleId: number | null,
	grantedNames: readonly string[],
): Promise<PermissionName[]> {
	const roleNames = roleId === null ? [] : await listRolePermissionNames(db, roleId);
	return [...new Set([...roleNames, ...(grantedNames as PermissionName[])])];
}

/**
 * Client-scoped actors may only manage users who hold strictly less access
 * than their own role (role permissions only, mirroring the roles module).
 * External actors bypass the hierarchy check entirely.
 */
async function ensureActorOutranks(
	db: Kysely<DB>,
	session: SessionSubject,
	access: UserWriteAccess,
	targetPermissions: readonly PermissionName[],
): Promise<void> {
	if (access.canWriteExternalUsers) return;

	const actorPermissions = await listRolePermissionNames(db, session.role_id);
	if (!isProperPermissionSuperset(actorPermissions, targetPermissions)) {
		throw new UserAccessHierarchyError();
	}
}

export async function updateUserRole(
	db: Kysely<DB>,
	encryptionKey: string,
	id: string,
	roleId: number,
	session: SessionSubject,
	access: UserWriteAccess,
): Promise<UserResponse> {
	const user = await findAccessTarget(db, encryptionKey, id, session, access);

	const role = await queries.findRoleById(db, roleId);
	if (!role) throw new UserRoleNotFoundError(roleId);
	if (role.client_id !== user.client_id) {
		throw new UserRoleClientMismatchError(roleId, user.client_id);
	}

	// The actor must outrank both the role the user holds now and the one
	// they are being moved to — otherwise a manager could promote a peer
	// above themselves or demote someone who outranks them.
	const grantedNames = (await queries.listGrantedPermissions(db, id)).map((p) => p.name);
	await ensureActorOutranks(
		db,
		session,
		access,
		await listEffectivePermissionNames(db, user.role_id, grantedNames),
	);
	await ensureActorOutranks(
		db,
		session,
		access,
		await listEffectivePermissionNames(db, role.id, grantedNames),
	);

	const updated = await queries.updateUserRole(db, id, roleId, encryptionKey);
	if (!updated) throw new UserNotFoundError(id);

	invalidateUserPermissions(id);
	await recordUserAuditLog(db, session.user_id, "UPDATE_USER", id);
	return toUserResponse(updated);
}

export async function getUserPermissions(
	db: Kysely<DB>,
	encryptionKey: string,
	id: string,
	session: SessionSubject,
	access: UserReadAccess,
): Promise<UserPermissionsResponse> {
	const user = access.canReadExternalUsers
		? await queries.findUserById(db, id, encryptionKey)
		: access.canReadClientUsers
			? await queries.findUserByIdForClient(db, id, session.client_id, encryptionKey)
			: null;
	if (!user) throw new UserNotFoundError(id);

	const [role, granted, allPermissions] = await Promise.all([
		user.role_id === null ? null : queries.findRoleById(db, user.role_id),
		queries.listGrantedPermissions(db, id),
		queries.listPermissions(db),
	]);

	// What the caller may hand out: everything for external actors, otherwise
	// only permissions implied by the caller's own role (external implies
	// client-scoped). Unlike role assignment this includes assign_role=false
	// permissions — individual grants are exactly what those exist for.
	let grantable = allPermissions;
	if (!access.canReadExternalUsers) {
		const actorPermissions = expandPermissionHierarchy(
			await listRolePermissionNames(db, session.role_id),
		);
		grantable = allPermissions.filter((p) => actorPermissions.has(p.name as PermissionName));
	}

	return {
		role: role
			? {
					id: role.id,
					name: role.name,
					permissions: await queries.listRolePermissions(db, role.id),
				}
			: null,
		granted,
		grantable,
	};
}

export async function replaceUserGrantedPermissions(
	db: Kysely<DB>,
	encryptionKey: string,
	id: string,
	permissionIds: readonly number[],
	session: SessionSubject,
	access: UserWriteAccess,
): Promise<UserPermissionsResponse> {
	const user = await findAccessTarget(db, encryptionKey, id, session, access);

	const uniquePermissionIds = [...new Set(permissionIds)];
	const permissions = await queries.listPermissionsByIds(db, uniquePermissionIds);
	if (permissions.length !== uniquePermissionIds.length) {
		const found = new Set(permissions.map((p) => p.id));
		throw new UserPermissionNotFoundError(uniquePermissionIds.filter((pid) => !found.has(pid)));
	}

	// Internal-only permissions never leave the internal client.
	if (user.client_id !== INTERNAL_CLIENT_ID) {
		const external = permissions.filter((p) => isInternalOnlyPermission(p.name));
		if (external.length > 0) {
			throw new UserExternalPermissionNotAllowedError(external.map((p) => p.name));
		}
	}

	// The actor must outrank the user both before and after the change.
	const currentNames = (await queries.listGrantedPermissions(db, id)).map((p) => p.name);
	await ensureActorOutranks(
		db,
		session,
		access,
		await listEffectivePermissionNames(db, user.role_id, currentNames),
	);
	await ensureActorOutranks(
		db,
		session,
		access,
		await listEffectivePermissionNames(
			db,
			user.role_id,
			permissions.map((p) => p.name),
		),
	);

	await queries.replaceGrantedPermissions(db, id, uniquePermissionIds);
	invalidateUserPermissions(id);
	await recordUserAuditLog(db, session.user_id, "UPDATE_USER", id);

	return getUserPermissions(db, encryptionKey, id, session, {
		canReadExternalUsers: access.canWriteExternalUsers,
		canReadClientUsers: access.canWriteClientUsers,
	});
}
