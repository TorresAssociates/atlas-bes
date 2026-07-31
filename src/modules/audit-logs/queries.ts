import type { Kysely, Selectable } from "kysely";
import type { DB } from "@/db/types";

export type AuditLogActionRow = Selectable<DB["audit_log_action"]>;

export interface AuditLogListFilters {
	from?: Date;
	to?: Date;
	logActionId?: number;
	actorId?: string;
	// When set, results are restricted to this client (via the joined user row).
	// External readers pass undefined and see every client.
	clientId?: number;
	limit: number;
	offset: number;
}

export interface ControlAuditLogFilters extends AuditLogListFilters {
	deviceId?: number;
}

export interface UserAuditLogFilters extends AuditLogListFilters {
	targetId?: string;
}

export interface RolesPermsAuditLogFilters extends AuditLogListFilters {
	roleId?: number;
}

export interface ControlAuditLogRow {
	id: number;
	date: Date;
	action: string;
	action_text: string;
	device_id: number;
	actor_id: string;
}

export interface UserAuditLogRow {
	id: number;
	date: Date;
	action: string;
	action_text: string;
	actor_id: string;
	target_id: string;
}

export interface RolesPermsAuditLogRow {
	id: number;
	date: Date;
	action: string;
	action_text: string;
	actor_id: string;
	role_id: number | null;
	permission_id: number | null;
	added: boolean | null;
}

// Inserts return only the generated columns; callers already hold the rest.
export interface InsertedAuditLogRow {
	id: number;
	date: Date;
}

export function listAuditLogActions(db: Kysely<DB>): Promise<AuditLogActionRow[]> {
	return db.selectFrom("audit_log_action").selectAll().orderBy("id").execute();
}

export function findAuditLogActionByKey(
	db: Kysely<DB>,
	action: string,
): Promise<AuditLogActionRow | undefined> {
	return db
		.selectFrom("audit_log_action")
		.selectAll()
		.where("action_id", "=", action)
		.executeTakeFirst();
}

export function listControlAuditLogs(
	db: Kysely<DB>,
	filters: ControlAuditLogFilters,
): Promise<ControlAuditLogRow[]> {
	// control_audit_log has no client of its own (device is still a placeholder
	// table), so client scoping goes through the acting user.
	let query = db
		.selectFrom("control_audit_log")
		.innerJoin("audit_log_action", "audit_log_action.id", "control_audit_log.log_action_id")
		.innerJoin("user as actor", "actor.id", "control_audit_log.actor_id")
		.select([
			"control_audit_log.id",
			"control_audit_log.date",
			"audit_log_action.action_id as action",
			"audit_log_action.action_text",
			"control_audit_log.device_id",
			"control_audit_log.actor_id",
		]);

	if (filters.clientId !== undefined)
		query = query.where("actor.client_id", "=", filters.clientId);
	if (filters.from !== undefined)
		query = query.where("control_audit_log.date", ">=", filters.from);
	if (filters.to !== undefined) query = query.where("control_audit_log.date", "<=", filters.to);
	if (filters.logActionId !== undefined)
		query = query.where("control_audit_log.log_action_id", "=", filters.logActionId);
	if (filters.actorId !== undefined)
		query = query.where("control_audit_log.actor_id", "=", filters.actorId);
	if (filters.deviceId !== undefined)
		query = query.where("control_audit_log.device_id", "=", filters.deviceId);

	return query
		.orderBy("control_audit_log.date", "desc")
		.orderBy("control_audit_log.id", "desc")
		.limit(filters.limit)
		.offset(filters.offset)
		.execute();
}

export function insertControlAuditLog(
	db: Kysely<DB>,
	values: { log_action_id: number; device_id: number; actor_id: string },
): Promise<InsertedAuditLogRow> {
	return db
		.insertInto("control_audit_log")
		.values(values)
		.returning(["id", "date"])
		.executeTakeFirstOrThrow();
}

export function listUserAuditLogs(
	db: Kysely<DB>,
	filters: UserAuditLogFilters,
): Promise<UserAuditLogRow[]> {
	// Client scoping is done inspecting by the target user's client
	let query = db
		.selectFrom("user_audit_log")
		.innerJoin("audit_log_action", "audit_log_action.id", "user_audit_log.log_action_id")
		.innerJoin("user as target", "target.id", "user_audit_log.target_id")
		.select([
			"user_audit_log.id",
			"user_audit_log.date",
			"audit_log_action.action_id as action",
			"audit_log_action.action_text",
			"user_audit_log.actor_id",
			"user_audit_log.target_id",
		]);

	if (filters.clientId !== undefined)
		query = query.where("target.client_id", "=", filters.clientId);
	if (filters.from !== undefined) query = query.where("user_audit_log.date", ">=", filters.from);
	if (filters.to !== undefined) query = query.where("user_audit_log.date", "<=", filters.to);
	if (filters.logActionId !== undefined)
		query = query.where("user_audit_log.log_action_id", "=", filters.logActionId);
	if (filters.actorId !== undefined)
		query = query.where("user_audit_log.actor_id", "=", filters.actorId);
	if (filters.targetId !== undefined)
		query = query.where("user_audit_log.target_id", "=", filters.targetId);

	return query
		.orderBy("user_audit_log.date", "desc")
		.orderBy("user_audit_log.id", "desc")
		.limit(filters.limit)
		.offset(filters.offset)
		.execute();
}

export function insertUserAuditLog(
	db: Kysely<DB>,
	values: { log_action_id: number; actor_id: string; target_id: string },
): Promise<InsertedAuditLogRow> {
	return db
		.insertInto("user_audit_log")
		.values(values)
		.returning(["id", "date"])
		.executeTakeFirstOrThrow();
}

export function listRolesPermsAuditLogs(
	db: Kysely<DB>,
	filters: RolesPermsAuditLogFilters,
): Promise<RolesPermsAuditLogRow[]> {
	// role_id is nullable, so client scoping goes through the acting user
	// rather than the affected role.
	let query = db
		.selectFrom("roles_perms_audit_log")
		.innerJoin("audit_log_action", "audit_log_action.id", "roles_perms_audit_log.log_action_id")
		.innerJoin("user as actor", "actor.id", "roles_perms_audit_log.actor_id")
		.select([
			"roles_perms_audit_log.id",
			"roles_perms_audit_log.date",
			"audit_log_action.action_id as action",
			"audit_log_action.action_text",
			"roles_perms_audit_log.actor_id",
			"roles_perms_audit_log.role_id",
			"roles_perms_audit_log.permission_id",
			"roles_perms_audit_log.added",
		]);

	if (filters.clientId !== undefined)
		query = query.where("actor.client_id", "=", filters.clientId);
	if (filters.from !== undefined)
		query = query.where("roles_perms_audit_log.date", ">=", filters.from);
	if (filters.to !== undefined)
		query = query.where("roles_perms_audit_log.date", "<=", filters.to);
	if (filters.logActionId !== undefined)
		query = query.where("roles_perms_audit_log.log_action_id", "=", filters.logActionId);
	if (filters.actorId !== undefined)
		query = query.where("roles_perms_audit_log.actor_id", "=", filters.actorId);
	if (filters.roleId !== undefined)
		query = query.where("roles_perms_audit_log.role_id", "=", filters.roleId);

	return query
		.orderBy("roles_perms_audit_log.date", "desc")
		.orderBy("roles_perms_audit_log.id", "desc")
		.limit(filters.limit)
		.offset(filters.offset)
		.execute();
}

export function insertRolesPermsAuditLog(
	db: Kysely<DB>,
	values: {
		log_action_id: number;
		actor_id: string;
		role_id: number | null;
		permission_id: number | null;
		added: boolean | null;
	},
): Promise<InsertedAuditLogRow> {
	return db
		.insertInto("roles_perms_audit_log")
		.values(values)
		.returning(["id", "date"])
		.executeTakeFirstOrThrow();
}

export function findDeviceById(db: Kysely<DB>, id: number): Promise<{ id: number } | undefined> {
	return db.selectFrom("device").select(["id"]).where("id", "=", id).executeTakeFirst();
}

export function findUserClientById(
	db: Kysely<DB>,
	id: string,
): Promise<{ id: string; client_id: number } | undefined> {
	return db
		.selectFrom("user")
		.select(["id", "client_id"])
		.where("id", "=", id)
		.executeTakeFirst();
}

// client_id is nullable on role in the current schema; a null-client role never
// matches a caller's client, so non-external writers cannot reference it.
export function findRoleById(
	db: Kysely<DB>,
	id: number,
): Promise<{ id: number; client_id: number | null } | undefined> {
	return db
		.selectFrom("role")
		.select(["id", "client_id"])
		.where("id", "=", id)
		.executeTakeFirst();
}

export function findPermissionById(
	db: Kysely<DB>,
	id: number,
): Promise<{ id: number } | undefined> {
	return db.selectFrom("permission").select(["id"]).where("id", "=", id).executeTakeFirst();
}
