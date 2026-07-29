import type { Kysely } from "kysely";
import type { DB } from "@/db/types";
import {
	createInvitedEmailPasswordUser,
	type SessionSubject,
} from "../auth/service";
import type { UserRow } from "../users/queries";
import * as userQueries from "../users/queries";
import type { UserResponse } from "../users/service";
import type { AcceptedInviteRow, InviteRow } from "./queries";
import * as queries from "./queries";

export interface CreateInviteInput {
	email: string;
	client_id: number;
	role_id: number;
	expires_at: string;
}

export interface AcceptInviteInput {
	token: string;
	email: string;
	name: string;
	password: string;
	phone_number: string;
}

export interface InviteWriteAccess {
	canWriteExternalUsers: boolean;
	canWriteClientUsers: boolean;
}

export type InviteResponse = Omit<InviteRow, "expires_at"> & {
	expires_at: string;
};

export interface InvitePreviewResponse {
	email: string;
	expires_at: string;
}

export type AcceptedInviteResponse = Omit<
	AcceptedInviteRow,
	"accepted_date"
> & {
	accepted_date: string;
};

export class InviteNotFoundError extends Error {
	constructor() {
		super("invite does not exist");
		this.name = "InviteNotFoundError";
	}
}

export class InviteExpiredError extends Error {
	constructor() {
		super("invite has expired");
		this.name = "InviteExpiredError";
	}
}

export class InviteAccessDeniedError extends Error {
	constructor() {
		super("not allowed to create invite for that client");
		this.name = "InviteAccessDeniedError";
	}
}

export class InviteRoleNotFoundError extends Error {
	constructor(roleId: number) {
		super(`role ${roleId} does not exist`);
		this.name = "InviteRoleNotFoundError";
	}
}

export class InviteRoleClientMismatchError extends Error {
	constructor(roleId: number, clientId: number) {
		super(`role ${roleId} does not belong to client ${clientId}`);
		this.name = "InviteRoleClientMismatchError";
	}
}

function isAdmin(session: SessionSubject): boolean {
	return session.role_id === 1 && session.client_id === 1;
}

function canCreateInviteForTarget(
	session: SessionSubject,
	input: CreateInviteInput,
): boolean {
	if (session.role_id === 1 && session.client_id === 1) {
		return true;
	}

	if (session.role_id === 3 && session.client_id === 2) {
		return input.client_id === 2 && input.role_id === 4;
	}

	return false;
}

function toInviteResponse(invite: InviteRow): InviteResponse {
	return {
		...invite,
		expires_at: invite.expires_at.toISOString(),
	};
}

function toAcceptedInviteResponse(
	acceptedInvite: AcceptedInviteRow,
): AcceptedInviteResponse {
	return {
		...acceptedInvite,
		accepted_date: acceptedInvite.accepted_date.toISOString(),
	};
}

function toUserResponse(user: UserRow): UserResponse {
	return {
		...user,
		created_at: user.created_at.toISOString(),
		updated_at: user.updated_at.toISOString(),
	};
}

async function getValidInvite(
	db: Kysely<DB>,
	token: string,
): Promise<InviteRow> {
	const invite = await queries.findInviteByToken(db, token);
	if (!invite) throw new InviteNotFoundError();

	if (invite.expires_at.getTime() <= Date.now()) {
		throw new InviteExpiredError();
	}

	return invite;
}

export async function createInvite(
	db: Kysely<DB>,
	session: SessionSubject,
	access: InviteWriteAccess,
	input: CreateInviteInput,
): Promise<InviteResponse> {
	if (!access.canWriteExternalUsers && !access.canWriteClientUsers) {
		throw new InviteAccessDeniedError();
	}

	if (!canCreateInviteForTarget(session, input)) {
		throw new InviteAccessDeniedError();
	}

	const role = await queries.findRoleById(db, input.role_id);
	if (!role) throw new InviteRoleNotFoundError(input.role_id);
	if (role.client_id !== input.client_id) {
		throw new InviteRoleClientMismatchError(input.role_id, input.client_id);
	}

	const invite = await queries.insertInvite(db, {
		token: crypto.randomUUID(),
		email: input.email.toLowerCase(),
		expires_at: new Date(input.expires_at),
		sender_user_id: session.user_id,
		client_id: input.client_id,
		role_id: input.role_id,
	});

	return toInviteResponse(invite);
}

export async function validateInvite(
	db: Kysely<DB>,
	token: string,
): Promise<InvitePreviewResponse> {
	const invite = await getValidInvite(db, token);

	return {
		email: invite.email,
		expires_at: invite.expires_at.toISOString(),
	};
}

export async function acceptInvite(
	db: Kysely<DB>,
	input: AcceptInviteInput,
): Promise<UserResponse> {
	const invite = await getValidInvite(db, input.token);

	const userId = await createInvitedEmailPasswordUser({
		email: input.email.toLowerCase(),
		name: input.name,
		password: input.password,
		phone_number: input.phone_number,
		client_id: invite.client_id,
		role_id: invite.role_id,
	});

	await queries.insertAcceptedInvite(db, invite.id, userId);

	const user = await userQueries.findUserById(db, userId);
	if (!user)
		throw new Error(`created user ${JSON.stringify(userId)} was not found`);

	return toUserResponse(user);
}

export async function listAcceptedInvites(
	db: Kysely<DB>,
	session: SessionSubject,
): Promise<AcceptedInviteResponse[]> {
	if (!isAdmin(session)) {
		throw new InviteAccessDeniedError();
	}

	return (await queries.listAcceptedInvites(db)).map(
		toAcceptedInviteResponse,
	);
}

