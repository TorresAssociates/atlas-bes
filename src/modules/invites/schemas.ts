import { Type } from "@sinclair/typebox";
import { Nullable } from "@/schemas";

export const InviteSchema = Type.Object({
	id: Type.Integer(),
	token: Nullable(Type.String()),
	expires_at: Nullable(Type.String({ format: "date-time" })),
	sender_user_id: Type.String(),
	client_id: Nullable(Type.Integer()),
	role_id: Nullable(Type.Integer()),
});

export const InviteListSchema = Type.Object({
	data: Type.Array(InviteSchema),
});

export const InvitePreviewSchema = Type.Object({
	expires_at: Nullable(Type.String({ format: "date-time" })),
});

export const CreateInviteBodySchema = Type.Object({
	client_id: Type.Integer({ minimum: 1 }),
	role_id: Type.Integer({ minimum: 1 }),
	expires_at: Nullable(Type.String({ format: "date-time" })),
});

export const InviteIdParamsSchema = Type.Object({
	id: Type.Integer({ minimum: 1 }),
});
export const InviteTokenQuerySchema = Type.Object({
	token: Type.String(),
});

export const AcceptInviteBodySchema = Type.Object({
	token: Type.String(),
	email: Type.String({ format: "email" }),
	name: Type.String({ minLength: 1 }),
	password: Type.String({ minLength: 8 }),
	phone_number: Type.String({ minLength: 1 }),
});

export const AcceptedInviteSchema = Type.Object({
	id: Type.Integer(),
	invite_id: Type.Integer(),
	accepted_date: Type.String({ format: "date-time" }),
	user_id: Type.String(),
	sender_user_id: Type.String(),
});

export const AcceptedInviteListSchema = Type.Object({
	data: Type.Array(AcceptedInviteSchema),
});

export const AcceptedInviteUserSchema = Type.Object({
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
