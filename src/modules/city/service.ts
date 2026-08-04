import type { Kysely } from "kysely";
import type { DB } from "@/db/types";
import type { SessionSubject } from "../auth/service";
import type { CityRow } from "./queries";
import * as queries from "./queries";

export interface CityListInput {
	state?: string;
	name?: string;
}

export interface CityWriteAccess {
	canWriteClients: boolean;
}

export interface CityReadAccess {
	canReadClients: boolean;
}

export interface CreateCityInput {
	state: string;
	name: string;
}

export interface UpdateCityInput {
	state?: string;
	name?: string;
}

export type CityResponse = CityRow;

export class CityNotFoundError extends Error {
	constructor(cityId: number) {
		super(`city ${cityId} does not exist`);
		this.name = "CityNotFoundError";
	}
}

export class CityAccessDeniedError extends Error {
	constructor() {
		super("not allowed to manage cities");
		this.name = "CityAccessDeniedError";
	}
}

function normalizeState(state: string): string {
	return state.toUpperCase();
}

function normalizeCityInput<T extends { state?: string }>(input: T): T {
	return input.state === undefined
		? input
		: { ...input, state: normalizeState(input.state) };
}

export function listCities(
	db: Kysely<DB>,
	session: SessionSubject,
	access: CityReadAccess,
	input: CityListInput = {},
): Promise<CityResponse[]> {
	const normalized = normalizeCityInput(input);
	return access.canReadClients
		? queries.listCities(db, normalized)
		: queries.listCitiesForClient(db, session.client_id, normalized);
}

export async function getCity(
	db: Kysely<DB>,
	id: number,
	session: SessionSubject,
	access: CityReadAccess,
): Promise<CityResponse> {
	const city = access.canReadClients
		? await queries.findCityById(db, id)
		: await queries.findCityByIdForClient(db, id, session.client_id);
	if (!city) throw new CityNotFoundError(id);
	return city;
}

export function createCity(
	db: Kysely<DB>,
	access: CityWriteAccess,
	input: CreateCityInput,
): Promise<CityResponse> {
	if (!access.canWriteClients) throw new CityAccessDeniedError();
	return queries.insertCity(db, normalizeCityInput(input));
}

export async function updateCity(
	db: Kysely<DB>,
	id: number,
	access: CityWriteAccess,
	input: UpdateCityInput,
): Promise<CityResponse> {
	if (!access.canWriteClients) throw new CityAccessDeniedError();

	const updated = await queries.updateCityById(
		db,
		id,
		normalizeCityInput(input),
	);
	if (!updated) throw new CityNotFoundError(id);
	return updated;
}