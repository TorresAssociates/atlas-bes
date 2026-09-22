import { Type } from "@sinclair/typebox";
import { Nullable } from "@/schemas";

export const UserSchema = Type.Object({
	id: Type.String(),
	client_id: Type.Integer(),
	created_at: Type.String({ format: "date-time" }),
	email: Type.String({ format: "email" }),
	email_verified: Type.Boolean(),
	image: Nullable(Type.String()),
	name: Type.String(),
	phone_number: Nullable(Type.String()),
	phone_number_verified: Type.Boolean(),
	role_id: Nullable(Type.Integer()),
	deleted_at: Nullable(Type.String({ format: "date-time" })),
	updated_at: Type.String({ format: "date-time" }),
	last_login_at: Nullable(Type.String({ format: "date-time" })),
	last_active_at: Nullable(Type.String({ format: "date-time" })),
});

export const UserIdParamsSchema = Type.Object({
	id: Type.String({ minLength: 1 }),
});

export const UserPhoneNumberBodySchema = Type.Object({
	phone_number: Type.String({ minLength: 1 }),
});

export const UserListSchema = Type.Object({
	data: Type.Array(UserSchema),
});

export const UserMeSchema = Type.Object({
	user: UserSchema,
	client_name: Type.String(),
	role_name: Type.String(),
	permissions: Type.Array(Type.String()),
});

export const UserRoleBodySchema = Type.Object({
	role_id: Type.Integer({ minimum: 1 }),
});

export const UserPermissionSchema = Type.Object({
	id: Type.Integer(),
	name: Type.String(),
	description: Type.String(),
	assign_role: Type.Boolean(),
});

/**
 * A user's access breakdown: permissions inherited from their role, the
 * individually granted extras, and the catalog the caller may grant.
 */
export const UserPermissionsSchema = Type.Object({
	role: Nullable(
		Type.Object({
			id: Type.Integer(),
			name: Type.String(),
			permissions: Type.Array(UserPermissionSchema),
		}),
	),
	granted: Type.Array(UserPermissionSchema),
	grantable: Type.Array(UserPermissionSchema),
});

export const ReplaceUserPermissionsBodySchema = Type.Object({
	permission_ids: Type.Array(Type.Integer({ minimum: 1 })),
});
