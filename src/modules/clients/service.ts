import type { Kysely } from "kysely";
import { isForeignKeyViolation, isUniqueViolation } from "@/db";
import type { DB } from "@/db/types";
import * as queries from "./queries";

// Domain errors. routes.ts translates these to HTTP status codes — this file
// knows nothing about HTTP.

export class ClientNotFoundError extends Error {
    constructor(clientId: number) {
        super(`client ${clientId} does not exist`);
        this.name = "ClientNotFoundError";
    }
}

export class ClientNameTakenError extends Error {
    constructor(clientName: string) {
        super(`a client named ${JSON.stringify(clientName)} already exists`);
        this.name = "ClientNameTakenError";
    }
}

export class ClientInUseError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ClientInUseError";
    }
}

export function listClients(db: Kysely<DB>) {
    return queries.listClients(db);
}

export async function createClient(db: Kysely<DB>, name: string) {
    try {
        return await queries.insertClient(db, name);
    } catch (err) {
        if (isUniqueViolation(err)) throw new ClientNameTakenError(name);
        throw err;
    }
}

export async function updateClient(db: Kysely<DB>, id: number, name: string) {
    try {
        const updated = await queries.updateClientName(db, id, name);
        if (!updated) throw new ClientNotFoundError(id);
        return updated;
    } catch (err) {
        if (isUniqueViolation(err)) throw new ClientNameTakenError(name);
        throw err;
    }
}

export async function deleteClient(db: Kysely<DB>, id: number): Promise<void> {
    // Explicit check (user.client_id is NOT NULL) rather than relying on the FK
    // error surfacing, so the client gets a real message.
    const userCount = await queries.countClientUsers(db, id);
    if (userCount > 0) {
        throw new ClientInUseError(
            `client ${id} still has ${userCount} user(s)`,
        );
    }
    try {
        const deleted = await queries.deleteClientById(db, id);
        if (!deleted) throw new ClientNotFoundError(id);
    } catch (err) {
        // Backstop for other referencing tables (role, invite) and for the
        // check-then-delete race: still a conflict, never a raw driver error.
        if (isForeignKeyViolation(err)) {
            throw new ClientInUseError(
                `client ${id} is still referenced by other records`,
            );
        }
        throw err;
    }
}
