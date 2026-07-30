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
	client_id: number;
	role_id: number;
	expires_at: string | null;
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
	expires_at: string | null;
};

export interface InvitePreviewResponse {
	expires_at: string | null;
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

export class InviteEmailAlreadyExistsError extends Error {
	constructor(email: string) {
		super(`user with email ${JSON.stringify(email)} already exists`);
		this.name = "InviteEmailAlreadyExistsError";
	}
}

export class InviteAlreadyAcceptedError extends Error {
	constructor(inviteId: number) {
		super(`invite ${inviteId} has already been accepted`);
		this.name = "InviteAlreadyAcceptedError";
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
		expires_at: invite.expires_at?.toISOString() ?? null,
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
		deleted_at: user.deleted_at?.toISOString() ?? null,
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

	if (invite.expires_at && invite.expires_at.getTime() <= Date.now()) {
		throw new InviteExpiredError();
	}

	return invite;
}

function convertToChar(val: number) {
    let out = val % 62;
    if(out < 10) {
        out += 48;
    } else
    if(out < 36) {
        out += 65 - 10;
    } else {
        out += 97 - 36;
    }
    return String.fromCharCode(out);
}

function getRandomString(strLen: number) {
    // 48-57, 65-90, 97-122
    // 10 + 26 + 26 = 62
    // 0 - 9, 10 - 35, 37 - 61
    let arr = new Uint32Array(strLen);
    crypto.getRandomValues(arr);
    let out = "";
    for(let i = 0; i < arr.length; i++) {
        out += convertToChar(arr[i]!);
    }
    return out;
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
		token: getRandomString(9),
		expires_at: input.expires_at ? new Date(input.expires_at) : null,
		sender_user_id: session.user_id,
		client_id: input.client_id,
		role_id: input.role_id,
	});

	return toInviteResponse(invite);
}


export async function deleteInvite(
	db: Kysely<DB>,
	id: number,
	session: SessionSubject,
	access: InviteWriteAccess,
): Promise<InviteResponse> {
	const invite = access.canWriteExternalUsers
		? await queries.findInviteById(db, id)
		: access.canWriteClientUsers
			? await queries.findInviteByIdForClient(db, id, session.client_id)
			: null;

	if (!invite) throw new InviteNotFoundError();

	const acceptedInvite = await queries.findAcceptedInviteByInviteId(db, id);
	if (acceptedInvite) throw new InviteAlreadyAcceptedError(id);

	const deleted = access.canWriteExternalUsers
		? await queries.deleteInviteById(db, id)
		: await queries.deleteInviteByIdForClient(db, id, session.client_id);

	if (!deleted) throw new InviteNotFoundError();

	return toInviteResponse(deleted);
}
export async function validateInvite(
	db: Kysely<DB>,
	token: string,
): Promise<InvitePreviewResponse> {
	const invite = await getValidInvite(db, token);

	return {
		expires_at: invite.expires_at?.toISOString() ?? null,
	};
}

export async function acceptInvite(
	db: Kysely<DB>,
	encryptionKey: string,
	input: AcceptInviteInput,
): Promise<UserResponse> {
	const invite = await getValidInvite(db, input.token);
	const email = input.email.toLowerCase();

	if (await userQueries.userEmailExists(db, email)) {
		throw new InviteEmailAlreadyExistsError(email);
	}

	const userId = await createInvitedEmailPasswordUser({
		email,
		name: input.name,
		password: input.password,
		client_id: invite.client_id,
		role_id: invite.role_id,
	});

	const user = await userQueries.updateUserPhoneNumber(
		db,
		userId,
		input.phone_number,
		encryptionKey,
	);

	await queries.insertAcceptedInvite(db, invite.id, userId);

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
