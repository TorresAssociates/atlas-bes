import { Type, type TSchema } from "@sinclair/typebox";

const Nullable = <T extends TSchema>(T: T) => {
	// type Nullable<T> = T | null
	return Type.Union([T, Type.Null()]);
};

export const UserSchema = Type.Object({
	id: Type.String(),
	client_id: Type.Integer(),
	created_at: Type.String({ format: "date-time" }),
	email: Type.String({ format: "email" }),
	email_verified: Type.Boolean(),
	image: Nullable(Type.String()),
	name: Type.String(),
	phone_number: Nullable(Type.String()),
	role_id: Type.Integer(),
	updated_at: Type.String({ format: "date-time" }),
});

export const UserIdParamsSchema = Type.Object({
	id: Type.String({ minLength: 1 }),
});

export const UserPhoneNumberBodySchema = Type.Object({
    phone_number: Nullable(Type.String({ minLength: 1 })),
})

export const UserListSchema = Type.Object({
	data: Type.Array(UserSchema),
});
