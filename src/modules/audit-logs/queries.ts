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

export interface RolePermissionsAuditLogFilters extends AuditLogListFilters {
	roleName?: string;
}

export interface ControlAuditLogRow {
	id: number;
	date: Date;
	action: string;
	action_text: string;
	device_id: number;
	actor_user_id: string;
}

export interface UserAuditLogRow {
	id: number;
	date: Date;
	action: string;
	action_text: string;
	actor_user_id: string;
	target_user_id: string;
}

export interface RolePermissionsAuditLogRow {
	id: number;
	date: Date;
	action: string;
	action_text: string;
	actor_user_id: string;
	role_name: string;
	permission_id: number | null;
	added: boolean;
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
		.innerJoin("user as actor", "actor.id", "control_audit_log.actor_user_id")
		.select([
			"control_audit_log.id",
			"control_audit_log.date",
			"audit_log_action.action_id as action",
			"audit_log_action.action_text",
			"control_audit_log.device_id",
			"control_audit_log.actor_user_id",
		]);

	if (filters.clientId !== undefined) query = query.where("actor.client_id", "=", filters.clientId);
	if (filters.from !== undefined) query = query.where("control_audit_log.date", ">=", filters.from);
	if (filters.to !== undefined) query = query.where("control_audit_log.date", "<=", filters.to);
	if (filters.logActionId !== undefined) {
		query = query.where("control_audit_log.log_action_id", "=", filters.logActionId);
	}
	if (filters.actorId !== undefined) {
		query = query.where("control_audit_log.actor_user_id", "=", filters.actorId);
	}
	if (filters.deviceId !== undefined) {
		query = query.where("control_audit_log.device_id", "=", filters.deviceId);
	}

	return query
		.orderBy("control_audit_log.date", "desc")
		.orderBy("control_audit_log.id", "desc")
		.limit(filters.limit)
		.offset(filters.offset)
		.execute();
}

export function insertControlAuditLog(
	db: Kysely<DB>,
	values: { log_action_id: number; device_id: number; actor_user_id: string },
): Promise<InsertedAuditLogRow> {
	return db
		.insertInto("control_audit_log")
		.values({ ...values, date: new Date() })
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
		.innerJoin("user as target", "target.id", "user_audit_log.target_user_id")
		.select([
			"user_audit_log.id",
			"user_audit_log.date",
			"audit_log_action.action_id as action",
			"audit_log_action.action_text",
			"user_audit_log.actor_user_id",
			"user_audit_log.target_user_id",
		]);

	if (filters.clientId !== undefined) query = query.where("target.client_id", "=", filters.clientId);
	if (filters.from !== undefined) query = query.where("user_audit_log.date", ">=", filters.from);
	if (filters.to !== undefined) query = query.where("user_audit_log.date", "<=", filters.to);
	if (filters.logActionId !== undefined) {
		query = query.where("user_audit_log.log_action_id", "=", filters.logActionId);
	}
	if (filters.actorId !== undefined) {
		query = query.where("user_audit_log.actor_user_id", "=", filters.actorId);
	}
	if (filters.targetId !== undefined) {
		query = query.where("user_audit_log.target_user_id", "=", filters.targetId);
	}

	return query
		.orderBy("user_audit_log.date", "desc")
		.orderBy("user_audit_log.id", "desc")
		.limit(filters.limit)
		.offset(filters.offset)
		.execute();
}

export function insertUserAuditLog(
	db: Kysely<DB>,
	values: { log_action_id: number; actor_user_id: string; target_user_id: string },
): Promise<InsertedAuditLogRow> {
	return db
		.insertInto("user_audit_log")
		.values({ ...values, date: new Date() })
		.returning(["id", "date"])
		.executeTakeFirstOrThrow();
}

export function listRolePermissionsAuditLogs(
	db: Kysely<DB>,
	filters: RolePermissionsAuditLogFilters,
): Promise<RolePermissionsAuditLogRow[]> {
	let query = db
		.selectFrom("role_permissions_audit_log")
		.innerJoin("audit_log_action", "audit_log_action.id", "role_permissions_audit_log.log_action_id")
		.innerJoin("user as actor", "actor.id", "role_permissions_audit_log.actor_user_id")
		.select([
			"role_permissions_audit_log.id",
			"role_permissions_audit_log.date",
			"audit_log_action.action_id as action",
			"audit_log_action.action_text",
			"role_permissions_audit_log.actor_user_id",
			"role_permissions_audit_log.role_name",
			"role_permissions_audit_log.permission_id",
			"role_permissions_audit_log.added",
		]);

	if (filters.clientId !== undefined) query = query.where("actor.client_id", "=", filters.clientId);
	if (filters.from !== undefined) {
		query = query.where("role_permissions_audit_log.date", ">=", filters.from);
	}
	if (filters.to !== undefined) {
		query = query.where("role_permissions_audit_log.date", "<=", filters.to);
	}
	if (filters.logActionId !== undefined) {
		query = query.where("role_permissions_audit_log.log_action_id", "=", filters.logActionId);
	}
	if (filters.actorId !== undefined) {
		query = query.where("role_permissions_audit_log.actor_user_id", "=", filters.actorId);
	}
	if (filters.roleName !== undefined) {
		query = query.where("role_permissions_audit_log.role_name", "=", filters.roleName);
	}

	return query
		.orderBy("role_permissions_audit_log.date", "desc")
		.orderBy("role_permissions_audit_log.id", "desc")
		.limit(filters.limit)
		.offset(filters.offset)
		.execute();
}

export function insertRolePermissionsAuditLog(
	db: Kysely<DB>,
	values: {
		log_action_id: number;
		actor_user_id: string;
		role_name: string;
		permission_id: number | null;
		added: boolean;
	},
): Promise<InsertedAuditLogRow> {
	return db
		.insertInto("role_permissions_audit_log")
		.values({ ...values, date: new Date() })
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
	return db.selectFrom("user").select(["id", "client_id"]).where("id", "=", id).executeTakeFirst();
}

export function findRoleById(
	db: Kysely<DB>,
	id: number,
): Promise<{ id: number; name: string; client_id: number } | undefined> {
	return db
		.selectFrom("role")
		.select(["id", "name", "client_id"])
		.where("id", "=", id)
		.where("deleted_at", "is", null)
		.executeTakeFirst();
}

export function findPermissionById(
	db: Kysely<DB>,
	id: number,
): Promise<{ id: number } | undefined> {
	return db.selectFrom("permission").select(["id"]).where("id", "=", id).executeTakeFirst();
}
