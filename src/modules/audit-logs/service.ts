import type { Kysely } from "kysely";
import type { DB } from "@/db/types";
import type { SessionSubject } from "../auth/service";
import type {
	AuditLogActionRow,
	AuditLogListFilters,
	ControlAuditLogRow,
	RolePermissionsAuditLogRow,
	UserAuditLogRow,
} from "./queries";
import * as queries from "./queries";

// Audit logs are append-only: this service exposes list and create only, on
// purpose. There is no update or delete — do not add them.

export interface AuditLogReadAccess {
	canReadExternal: boolean;
	canReadClient: boolean;
}

export interface AuditLogWriteAccess {
	canWriteExternal: boolean;
	canWriteClient: boolean;
}

export interface AuditLogListInput {
	from?: string;
	to?: string;
	action?: string;
	actor_id?: string;
	limit?: number;
	offset?: number;
}

export interface ControlAuditLogListInput extends AuditLogListInput {
	device_id?: number;
}

export interface UserAuditLogListInput extends AuditLogListInput {
	target_id?: string;
}

export interface RolesPermsAuditLogListInput extends AuditLogListInput {
	role_name?: string;
}

export interface CreateControlAuditLogInput {
	action: string;
	device_id: number;
}

export interface CreateUserAuditLogInput {
	action: string;
	target_id: string;
}

export interface CreateRolesPermsAuditLogInput {
	action: string;
	role_id: number;
	permission_id?: number;
	added?: boolean;
}

export interface AuditLogActionResponse {
	id: number;
	action: string;
	action_text: string;
}

export type ControlAuditLogResponse = Omit<ControlAuditLogRow, "date"> & { date: string };
export type UserAuditLogResponse = Omit<UserAuditLogRow, "date"> & { date: string };
export type RolesPermsAuditLogResponse = Omit<RolePermissionsAuditLogRow, "date"> & {
	date: string;
};

export class AuditLogAccessDeniedError extends Error {
	constructor() {
		super("not allowed to access audit logs");
		this.name = "AuditLogAccessDeniedError";
	}
}

export class AuditLogActionNotFoundError extends Error {
	constructor(action: string) {
		super(`audit log action ${JSON.stringify(action)} does not exist`);
		this.name = "AuditLogActionNotFoundError";
	}
}

export class AuditLogDeviceNotFoundError extends Error {
	constructor(deviceId: number) {
		super(`device ${deviceId} does not exist`);
		this.name = "AuditLogDeviceNotFoundError";
	}
}

export class AuditLogTargetUserNotFoundError extends Error {
	constructor(targetId: string) {
		super(`user ${JSON.stringify(targetId)} does not exist`);
		this.name = "AuditLogTargetUserNotFoundError";
	}
}

export class AuditLogRoleNotFoundError extends Error {
	constructor(roleId: number) {
		super(`role ${roleId} does not exist`);
		this.name = "AuditLogRoleNotFoundError";
	}
}

export class AuditLogPermissionNotFoundError extends Error {
	constructor(permissionId: number) {
		super(`permission ${permissionId} does not exist`);
		this.name = "AuditLogPermissionNotFoundError";
	}
}

const DEFAULT_LIMIT = 100;

function toActionResponse(action: AuditLogActionRow): AuditLogActionResponse {
	return { id: action.id, action: action.action_id, action_text: action.action_text };
}

async function getActionByKey(db: Kysely<DB>, action: string): Promise<AuditLogActionRow> {
	const row = await queries.findAuditLogActionByKey(db, action);
	if (!row) throw new AuditLogActionNotFoundError(action);
	return row;
}

async function resolveListFilters(
	db: Kysely<DB>,
	session: SessionSubject,
	access: AuditLogReadAccess,
	input: AuditLogListInput,
): Promise<AuditLogListFilters> {
	if (!access.canReadExternal && !access.canReadClient) {
		throw new AuditLogAccessDeniedError();
	}

	return {
		from: input.from === undefined ? undefined : new Date(input.from),
		to: input.to === undefined ? undefined : new Date(input.to),
		logActionId:
			input.action === undefined ? undefined : (await getActionByKey(db, input.action)).id,
		actorId: input.actor_id,
		clientId: access.canReadExternal ? undefined : session.client_id,
		limit: input.limit ?? DEFAULT_LIMIT,
		offset: input.offset ?? 0,
	};
}

function requireWrite(access: AuditLogWriteAccess): void {
	if (!access.canWriteExternal && !access.canWriteClient) {
		throw new AuditLogAccessDeniedError();
	}
}

export async function listAuditLogActions(db: Kysely<DB>): Promise<AuditLogActionResponse[]> {
	return (await queries.listAuditLogActions(db)).map(toActionResponse);
}

export async function recordUserAuditLog(
	db: Kysely<DB>,
	actorUserId: string,
	actionKey: string,
	targetUserId: string,
): Promise<void> {
	const action = await getActionByKey(db, actionKey);
	await queries.insertUserAuditLog(db, {
		log_action_id: action.id,
		actor_user_id: actorUserId,
		target_user_id: targetUserId,
	});
}

export async function recordInviteAuditLog(
	db: Kysely<DB>,
	actorUserId: string,
	actionKey: string,
): Promise<void> {
	await recordUserAuditLog(db, actorUserId, actionKey, actorUserId);
}

export async function recordControlAuditLog(
	db: Kysely<DB>,
	actorUserId: string,
	actionKey: string,
	deviceId: number,
): Promise<void> {
	const action = await getActionByKey(db, actionKey);
	await queries.insertControlAuditLog(db, {
		log_action_id: action.id,
		device_id: deviceId,
		actor_user_id: actorUserId,
	});
}

export async function recordRolePermissionsAuditLog(
	db: Kysely<DB>,
	actorUserId: string,
	actionKey: string,
	roleName: string,
	permissionId: number | null = null,
	added: boolean,
): Promise<void> {
	const action = await getActionByKey(db, actionKey);
	await queries.insertRolePermissionsAuditLog(db, {
		log_action_id: action.id,
		actor_user_id: actorUserId,
		role_name: roleName,
		permission_id: permissionId,
		added,
	});
}

export async function listControlAuditLogs(
	db: Kysely<DB>,
	session: SessionSubject,
	access: AuditLogReadAccess,
	input: ControlAuditLogListInput,
): Promise<ControlAuditLogResponse[]> {
	const filters = await resolveListFilters(db, session, access, input);
	const rows = await queries.listControlAuditLogs(db, { ...filters, deviceId: input.device_id });

	return rows.map((row) => ({ ...row, date: row.date.toISOString() }));
}

export async function createControlAuditLog(
	db: Kysely<DB>,
	session: SessionSubject,
	access: AuditLogWriteAccess,
	input: CreateControlAuditLogInput,
): Promise<ControlAuditLogResponse> {
	requireWrite(access);

	const action = await getActionByKey(db, input.action);

	// The device table is still a placeholder without a client column, so
	// existence is all that can be checked here — no per-client device scoping yet.
	const device = await queries.findDeviceById(db, input.device_id);
	if (!device) throw new AuditLogDeviceNotFoundError(input.device_id);

	const inserted = await queries.insertControlAuditLog(db, {
		log_action_id: action.id,
		device_id: input.device_id,
		actor_user_id: session.user_id,
	});

	return {
		id: inserted.id,
		date: inserted.date.toISOString(),
		action: action.action_id,
		action_text: action.action_text,
		device_id: input.device_id,
		actor_user_id: session.user_id,
	};
}

export async function listUserAuditLogs(
	db: Kysely<DB>,
	session: SessionSubject,
	access: AuditLogReadAccess,
	input: UserAuditLogListInput,
): Promise<UserAuditLogResponse[]> {
	const filters = await resolveListFilters(db, session, access, input);
	const rows = await queries.listUserAuditLogs(db, { ...filters, targetId: input.target_id });

	return rows.map((row) => ({ ...row, date: row.date.toISOString() }));
}

export async function createUserAuditLog(
	db: Kysely<DB>,
	session: SessionSubject,
	access: AuditLogWriteAccess,
	input: CreateUserAuditLogInput,
): Promise<UserAuditLogResponse> {
	requireWrite(access);

	const action = await getActionByKey(db, input.action);

	// Not-found (rather than forbidden) for a cross-client target, so the
	// response does not leak whether a user id exists in another client.
	const target = await queries.findUserClientById(db, input.target_id);
	if (!target || (!access.canWriteExternal && target.client_id !== session.client_id)) {
		throw new AuditLogTargetUserNotFoundError(input.target_id);
	}

	const inserted = await queries.insertUserAuditLog(db, {
		log_action_id: action.id,
		actor_user_id: session.user_id,
		target_user_id: input.target_id,
	});

	return {
		id: inserted.id,
		date: inserted.date.toISOString(),
		action: action.action_id,
		action_text: action.action_text,
		actor_user_id: session.user_id,
		target_user_id: input.target_id,
	};
}

export async function listRolesPermsAuditLogs(
	db: Kysely<DB>,
	session: SessionSubject,
	access: AuditLogReadAccess,
	input: RolesPermsAuditLogListInput,
): Promise<RolesPermsAuditLogResponse[]> {
	const filters = await resolveListFilters(db, session, access, input);
	const rows = await queries.listRolePermissionsAuditLogs(db, {
		...filters,
		roleName: input.role_name,
	});

	return rows.map((row) => ({ ...row, date: row.date.toISOString() }));
}

export async function createRolesPermsAuditLog(
	db: Kysely<DB>,
	session: SessionSubject,
	access: AuditLogWriteAccess,
	input: CreateRolesPermsAuditLogInput,
): Promise<RolesPermsAuditLogResponse> {
	requireWrite(access);

	const action = await getActionByKey(db, input.action);
	const role = await queries.findRoleById(db, input.role_id);
	if (!role || (!access.canWriteExternal && role.client_id !== session.client_id)) {
		throw new AuditLogRoleNotFoundError(input.role_id);
	}

	let permissionId: number | null = null;
	if (input.permission_id !== undefined) {
		const permission = await queries.findPermissionById(db, input.permission_id);
		if (!permission) throw new AuditLogPermissionNotFoundError(input.permission_id);
		permissionId = permission.id;
	}

	const added = input.added ?? false;
	const inserted = await queries.insertRolePermissionsAuditLog(db, {
		log_action_id: action.id,
		actor_user_id: session.user_id,
		role_name: role.name,
		permission_id: permissionId,
		added,
	});

	return {
		id: inserted.id,
		date: inserted.date.toISOString(),
		action: action.action_id,
		action_text: action.action_text,
		actor_user_id: session.user_id,
		role_name: role.name,
		permission_id: permissionId,
		added,
	};
}
