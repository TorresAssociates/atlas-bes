import { Type } from "@sinclair/typebox";

export const InviteSchema = Type.Object({
	id: Type.Integer(),
	token: Type.String({ format: "uuid" }),
	email: Type.String({ format: "email" }),
	expires_at: Type.String({ format: "date-time" }),
	sender_user_id: Type.String(),
	client_id: Type.Integer(),
	role_id: Type.Integer(),
});

export const InvitePreviewSchema = Type.Object({
	email: Type.String({ format: "email" }),
	expires_at: Type.String({ format: "date-time" }),
});

export const CreateInviteBodySchema = Type.Object({
	email: Type.String({ format: "email" }),
	client_id: Type.Integer({ minimum: 1 }),
	role_id: Type.Integer({ minimum: 1 }),
	expires_at: Type.String({ format: "date-time" }),
});

export const InviteTokenQuerySchema = Type.Object({
	token: Type.String({ format: "uuid" }),
});

export const AcceptInviteBodySchema = Type.Object({
	token: Type.String({ format: "uuid" }),
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
});

export const AcceptedInviteListSchema = Type.Object({
	data: Type.Array(AcceptedInviteSchema),
});

