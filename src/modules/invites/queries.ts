import type { Insertable, Kysely, Selectable } from "kysely";
import type { DB } from "@/db/types";

export type InviteRow = Selectable<DB["invite"]>;
export type AcceptedInviteRow = Selectable<DB["accepted_invites"]>;
export type AcceptedInviteWithSenderRow = AcceptedInviteRow & {
	sender_user_id: string;
};
export type InsertInviteRow = Insertable<DB["invite"]>;

const inviteColumns = [
	"id",
	"token",
	"expires_at",
	"sender_user_id",
	"client_id",
	"role_id",
] as const;

export function listInvites(db: Kysely<DB>): Promise<InviteRow[]> {
	return db.selectFrom("invite").select(inviteColumns).orderBy("id", "desc").execute();
}

export function listInvitesForClient(db: Kysely<DB>, clientId: number): Promise<InviteRow[]> {
	return db
		.selectFrom("invite")
		.select(inviteColumns)
		.where("client_id", "=", clientId)
		.orderBy("id", "desc")
		.execute();
}

export function insertInvite(db: Kysely<DB>, invite: InsertInviteRow): Promise<InviteRow> {
	return db
		.insertInto("invite")
		.values(invite)
		.returning(inviteColumns)
		.executeTakeFirstOrThrow();
}

export function findInviteByToken(db: Kysely<DB>, token: string): Promise<InviteRow | undefined> {
	return db
		.selectFrom("invite")
		.select(inviteColumns)
		.where("token", "=", token)
		.executeTakeFirst();
}

export function findInviteById(db: Kysely<DB>, id: number): Promise<InviteRow | undefined> {
	return db.selectFrom("invite").select(inviteColumns).where("id", "=", id).executeTakeFirst();
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

export function softDeleteInviteById(db: Kysely<DB>, id: number): Promise<InviteRow | undefined> {
	return db
		.updateTable("invite")
		.set({ token: null, expires_at: new Date() })
		.where("id", "=", id)
		.returning(inviteColumns)
		.executeTakeFirst();
}

export function softDeleteInviteByIdForClient(
	db: Kysely<DB>,
	id: number,
	clientId: number,
): Promise<InviteRow | undefined> {
	return db
		.updateTable("invite")
		.set({ token: null, expires_at: new Date() })
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
		.values({ invite_id: inviteId, user_id: userId, accepted_date: new Date() })
		.returningAll()
		.executeTakeFirstOrThrow();
}

export function listAcceptedInvites(db: Kysely<DB>): Promise<AcceptedInviteWithSenderRow[]> {
	return db
		.selectFrom("accepted_invites")
		.innerJoin("invite", "invite.id", "accepted_invites.invite_id")
		.select([
			"accepted_invites.id",
			"accepted_invites.invite_id",
			"accepted_invites.accepted_date",
			"accepted_invites.user_id",
			"invite.sender_user_id",
		])
		.orderBy("accepted_invites.accepted_date", "desc")
		.execute();
}

export function listAcceptedInvitesForClient(
	db: Kysely<DB>,
	clientId: number,
): Promise<AcceptedInviteWithSenderRow[]> {
	return db
		.selectFrom("accepted_invites")
		.innerJoin("invite", "invite.id", "accepted_invites.invite_id")
		.select([
			"accepted_invites.id",
			"accepted_invites.invite_id",
			"accepted_invites.accepted_date",
			"accepted_invites.user_id",
			"invite.sender_user_id",
		])
		.where("invite.client_id", "=", clientId)
		.orderBy("accepted_invites.accepted_date", "desc")
		.execute();
}

export function findRoleById(db: Kysely<DB>, roleId: number) {
	return db
		.selectFrom("role")
		.select(["id", "client_id"])
		.where("id", "=", roleId)
		.where("deleted_at", "is", null)
		.executeTakeFirst();
}
