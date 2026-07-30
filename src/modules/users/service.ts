import type { Kysely } from "kysely";
import type { DB } from "@/db/types";
import type { SessionSubject } from "../auth/service";
import type { UserRow } from "./queries";
import * as queries from "./queries";

export interface UserListAccess {
	canReadExternalUsers: boolean;
	canReadClientUsers: boolean;
}

export interface UserReadAccess {
	canReadExternalUsers: boolean;
	canReadClientUsers: boolean;
}

export interface UserWriteAccess {
	canWriteExternalUsers: boolean;
	canWriteClientUsers: boolean;
}

export type UserResponse = Omit<UserRow, "deleted_at" | "created_at" | "updated_at"> & {
	deleted_at: string | null;
	created_at: string;
	updated_at: string;
};

export class UserNotFoundError extends Error {
	constructor(userId: string) {
		super(`user ${JSON.stringify(userId)} does not exist`);
		this.name = "UserNotFoundError";
	}
}

export class UserEmailNotFoundError extends Error {
	constructor(email: string) {
		super(`user with email ${JSON.stringify(email)} does not exist`);
		this.name = "UserEmailNotFoundError";
	}
}

export class UserAccessDeniedError extends Error {
	constructor() {
		super("not allowed to list users");
		this.name = "UserAccessDeniedError";
	}
}

function toTimestamp(value: Date | string | null): string | null {
	if (!value) return null;
	return value instanceof Date ? value.toISOString() : value;
}

function toUserResponse(user: UserRow): UserResponse {
	return {
		...user,
		deleted_at: toTimestamp(user.deleted_at),
		created_at: user.created_at.toISOString(),
		updated_at: user.updated_at.toISOString(),
	};
}

export async function listUsers(
	db: Kysely<DB>,
	encryptionKey: string,
	session: SessionSubject,
	access: UserListAccess,
): Promise<UserResponse[]> {
	if (access.canReadExternalUsers) {
		return (await queries.listUsers(db, encryptionKey)).map(toUserResponse);
	}

	if (access.canReadClientUsers) {
		return (
			await queries.listUsersByClient(db, session.client_id, encryptionKey)
		).map(toUserResponse);
	}

	throw new UserAccessDeniedError();
}

export async function getUser(
	db: Kysely<DB>,
	encryptionKey: string,
	id: string,
	session: SessionSubject,
	access: UserReadAccess,
): Promise<UserResponse> {
	const user = access.canReadExternalUsers
		? await queries.findUserById(db, id, encryptionKey)
		: access.canReadClientUsers
			? await queries.findUserByIdForClient(
					db,
					id,
					session.client_id,
					encryptionKey,
				)
			: null;

	if (!user) throw new UserNotFoundError(id);

	return toUserResponse(user);
}

export async function getUserByEmail(
	db: Kysely<DB>,
	encryptionKey: string,
	email: string,
): Promise<UserResponse> {
	const user = await queries.findUserByEmail(db, email, encryptionKey);
	if (!user) throw new UserEmailNotFoundError(email);
	return toUserResponse(user);
}

export async function updateOwnPhoneNumber(
	db: Kysely<DB>,
	encryptionKey: string,
	session: SessionSubject,
	phoneNumber: string,
): Promise<UserResponse> {
	const updated = await queries.updateUserPhoneNumber(
		db,
		session.user_id,
		phoneNumber,
		encryptionKey,
	);

	if (!updated) {
		throw new UserNotFoundError(session.user_id);
	}

	return toUserResponse(updated);
}

export async function updateUserPhoneNumber(
	db: Kysely<DB>,
	encryptionKey: string,
	id: string,
	phoneNumber: string,
	session: SessionSubject,
	access: UserWriteAccess,
): Promise<UserResponse> {
	const updated = access.canWriteExternalUsers
		? await queries.updateUserPhoneNumber(db, id, phoneNumber, encryptionKey)
		: access.canWriteClientUsers
			? await queries.updateUserPhoneNumberForClient(
					db,
					id,
					session.client_id,
					phoneNumber,
					encryptionKey,
				)
			: null;

	if (!updated) {
		throw new UserNotFoundError(id);
	}

	return toUserResponse(updated);
}

export async function updateUserClientAndRole(
	db: Kysely<DB>,
	encryptionKey: string,
	id: string,
	clientId: number,
	roleId: number,
): Promise<UserResponse> {
	const updated = await queries.updateUserClientAndRole(
		db,
		id,
		clientId,
		roleId,
		encryptionKey,
	);
	if (!updated) throw new UserNotFoundError(id);
	return toUserResponse(updated);
}

export async function deleteUser(
	db: Kysely<DB>,
	encryptionKey: string,
	id: string,
	session: SessionSubject,
	access: UserWriteAccess,
): Promise<UserResponse> {
	const updated = access.canWriteExternalUsers
		? await queries.deleteUser(db, id, encryptionKey)
		: access.canWriteClientUsers
			? await queries.deleteUserForClient(db, id, session.client_id, encryptionKey)
			: null;

	if (!updated) {
		throw new UserNotFoundError(id);
	}

	return toUserResponse(updated);
}
