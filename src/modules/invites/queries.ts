import type { Insertable, Kysely, Selectable } from "kysely";
import type { DB } from "@/db/types";

export type InviteRow = Selectable<DB["invite"]>;
export type AcceptedInviteRow = Selectable<DB["accepted_invites"]>;
export type InsertInviteRow = Insertable<DB["invite"]>;

const inviteColumns = [
	"id",
	"token",
	"expires_at",
	"sender_user_id",
	"client_id",
	"role_id",
] as const;

export function insertInvite(
	db: Kysely<DB>,
	invite: InsertInviteRow,
): Promise<InviteRow> {
	return db
		.insertInto("invite")
		.values(invite)
		.returning(inviteColumns)
		.executeTakeFirstOrThrow();
}

export function findInviteByToken(
	db: Kysely<DB>,
	token: string,
): Promise<InviteRow | undefined> {
	return db
		.selectFrom("invite")
		.select(inviteColumns)
		.where("token", "=", token)
		.executeTakeFirst();
}

export function findInviteById(
	db: Kysely<DB>,
	id: number,
): Promise<InviteRow | undefined> {
	return db
		.selectFrom("invite")
		.select(inviteColumns)
		.where("id", "=", id)
		.executeTakeFirst();
}

export function findInviteByIdForClient(
	db: Kysely<DB>,
	id: number,
	clientId: number,
): Promise<InviteRow | undefined> {
	return db
		.selectFrom("invite")
		.select(inviteColumns)
		.where("id", "=", id)
		.where("client_id", "=", clientId)
		.executeTakeFirst();
}

export function deleteInviteById(
	db: Kysely<DB>,
	id: number,
): Promise<InviteRow | undefined> {
	return db
		.deleteFrom("invite")
		.where("id", "=", id)
		.returning(inviteColumns)
		.executeTakeFirst();
}

export function deleteInviteByIdForClient(
	db: Kysely<DB>,
	id: number,
	clientId: number,
): Promise<InviteRow | undefined> {
	return db
		.deleteFrom("invite")
		.where("id", "=", id)
		.where("client_id", "=", clientId)
		.returning(inviteColumns)
		.executeTakeFirst();
}

export function findAcceptedInviteByInviteId(
	db: Kysely<DB>,
	inviteId: number,
): Promise<AcceptedInviteRow | undefined> {
	return db
		.selectFrom("accepted_invites")
		.selectAll()
		.where("invite_id", "=", inviteId)
		.executeTakeFirst();
}

export function insertAcceptedInvite(
	db: Kysely<DB>,
	inviteId: number,
	userId: string,
): Promise<AcceptedInviteRow> {
	return db
		.insertInto("accepted_invites")
		.values({ invite_id: inviteId, user_id: userId })
		.returningAll()
		.executeTakeFirstOrThrow();
}

export function listAcceptedInvites(
	db: Kysely<DB>,
): Promise<AcceptedInviteRow[]> {
	return db
		.selectFrom("accepted_invites")
		.selectAll()
		.orderBy("accepted_date", "desc")
		.execute();
}
export function findRoleById(db: Kysely<DB>, roleId: number) {
	return db
		.selectFrom("role")
		.select(["id", "client_id"])
		.where("id", "=", roleId)
		.executeTakeFirst();
}
