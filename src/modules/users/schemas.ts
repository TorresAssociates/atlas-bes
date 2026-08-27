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
	permissions: Type.Array(Type.String()),
});
