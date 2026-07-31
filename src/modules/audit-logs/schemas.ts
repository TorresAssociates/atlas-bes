import { Type } from "@sinclair/typebox";
import { Nullable } from "@/schemas";

// Log actions are addressed by their stable machine key (audit_log_action.action_id,
// e.g. "WIFI_ON"), never the numeric row id or the display text — same rule as the
// measurement type registry.

export const AuditLogActionSchema = Type.Object({
	id: Type.Integer(),
	action: Type.String(),
	action_text: Type.String(),
});

export const AuditLogActionListSchema = Type.Object({
	data: Type.Array(AuditLogActionSchema),
});

// Shared list filters. Time-range parameters (not "now"-relative) so historical
// windows are replayable.
const listQueryBase = {
	from: Type.Optional(Type.String({ format: "date-time" })),
	to: Type.Optional(Type.String({ format: "date-time" })),
	action: Type.Optional(Type.String({ minLength: 1 })),
	actor_id: Type.Optional(Type.String({ minLength: 1 })),
	limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, default: 100 })),
	offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
};

export const ControlAuditLogListQuerySchema = Type.Object({
	...listQueryBase,
	device_id: Type.Optional(Type.Integer({ minimum: 1 })),
});

export const UserAuditLogListQuerySchema = Type.Object({
	...listQueryBase,
	target_id: Type.Optional(Type.String({ minLength: 1 })),
});

export const RolesPermsAuditLogListQuerySchema = Type.Object({
	...listQueryBase,
	role_id: Type.Optional(Type.Integer({ minimum: 1 })),
});

export const ControlAuditLogSchema = Type.Object({
	id: Type.Integer(),
	date: Type.String({ format: "date-time" }),
	action: Type.String(),
	action_text: Type.String(),
	device_id: Type.Integer(),
	actor_id: Type.String(),
});

export const ControlAuditLogListSchema = Type.Object({
	data: Type.Array(ControlAuditLogSchema),
});

export const UserAuditLogSchema = Type.Object({
	id: Type.Integer(),
	date: Type.String({ format: "date-time" }),
	action: Type.String(),
	action_text: Type.String(),
	actor_id: Type.String(),
	target_id: Type.String(),
});

export const UserAuditLogListSchema = Type.Object({
	data: Type.Array(UserAuditLogSchema),
});

export const RolesPermsAuditLogSchema = Type.Object({
	id: Type.Integer(),
	date: Type.String({ format: "date-time" }),
	action: Type.String(),
	action_text: Type.String(),
	actor_id: Type.String(),
	role_id: Nullable(Type.Integer()),
	permission_id: Nullable(Type.Integer()),
	added: Nullable(Type.Boolean()),
});

export const RolesPermsAuditLogListSchema = Type.Object({
	data: Type.Array(RolesPermsAuditLogSchema),
});

// Create bodies carry no actor_id and no date: the actor is always the
// authenticated session user and the timestamp is set by the database, so a
// client cannot write a log entry as someone else or backdate one.
export const CreateControlAuditLogBodySchema = Type.Object({
	action: Type.String({ minLength: 1 }),
	device_id: Type.Integer({ minimum: 1 }),
});

export const CreateUserAuditLogBodySchema = Type.Object({
	action: Type.String({ minLength: 1 }),
	target_id: Type.String({ minLength: 1 }),
});

export const CreateRolesPermsAuditLogBodySchema = Type.Object({
	action: Type.String({ minLength: 1 }),
	role_id: Type.Optional(Type.Integer({ minimum: 1 })),
	permission_id: Type.Optional(Type.Integer({ minimum: 1 })),
	added: Type.Optional(Type.Boolean()),
});
