import { Type } from "@sinclair/typebox";
import { Nullable } from "@/schemas";

export const PermissionSchema = Type.Object({
	id: Type.Integer(),
	name: Type.String(),
	description: Type.String(),
	assign_role: Type.Boolean(),
});

export const RoleSchema = Type.Object({
	id: Type.Integer(),
	client_id: Type.Integer(),
	name: Type.String(),
	deleted_at: Nullable(Type.String({ format: "date-time" })),
	permissions: Type.Array(PermissionSchema),
});

export const RoleListSchema = Type.Object({
	data: Type.Array(RoleSchema),
});

export const PermissionListSchema = Type.Object({
	data: Type.Array(PermissionSchema),
});

export const RoleIdParamsSchema = Type.Object({
	id: Type.Integer({ minimum: 1 }),
});

export const CreateRoleBodySchema = Type.Object({
	name: Type.String({ minLength: 1 }),
	client_id: Type.Integer({ minimum: 1 }),
	permission_ids: Type.Optional(Type.Array(Type.Integer({ minimum: 1 }))),
});

export const UpdateRoleBodySchema = Type.Partial(
	Type.Object({
		name: Type.String({ minLength: 1 }),
		client_id: Type.Integer({ minimum: 1 }),
	}),
);

export const ReplaceRolePermissionsBodySchema = Type.Object({
	permission_ids: Type.Array(Type.Integer({ minimum: 1 })),
});
