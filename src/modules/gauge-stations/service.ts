import type { Kysely } from "kysely";
import type { DB } from "@/db/types";
import type { SessionSubject } from "../auth/service";
import type { GaugeStationRiskRow, GaugeStationRow } from "./queries";
import * as queries from "./queries";

export interface GaugeStationListInput {
	cityId?: number;
	includeArchived?: boolean;
	active?: boolean;
}

// R_EXTERNAL_DEVICES / W_EXTERNAL_DEVICES holders operate across all clients;
// otherwise access is scoped to gauge stations linked to the session's own client.
// canViewInactive is the matching write permission for the read scope
// (W_EXTERNAL_DEVICES when reading externally, W_CLIENT_DEVICES otherwise):
// inactive gauge stations are a maintenance view, hidden from read-only users.
export interface GaugeStationReadAccess {
	canReadExternal: boolean;
	canViewInactive: boolean;
}

export interface GaugeStationWriteAccess {
	canWriteExternal: boolean;
}

export interface CreateGaugeStationInput {
	name: string;
	clientId: number;
	cityId: number;
	location: string;
	latitude: number;
	longitude: number;
	publiclyVisible?: boolean;
	active?: boolean;
}

export interface UpdateGaugeStationInput {
	name?: string;
	cityId?: number;
	location?: string;
	latitude?: number;
	longitude?: number;
	publiclyVisible?: boolean;
	active?: boolean;
}

export interface GaugeStationResponse {
	id: number;
	name: string;
	introduced: string;
	archived: string | null;
	city: { id: number; state: string; name: string };
	clients: { id: number; name: string }[];
	location: string;
	latitude: number;
	longitude: number;
	publiclyVisible: boolean;
	active: boolean;
}

export interface GaugeStationFeatureResponse {
	type: "Feature";
	id: number;
	geometry: { type: "Point"; coordinates: [number, number] };
	properties: {
		name: string;
		introduced: string;
		archived: string | null;
		city: { id: number; state: string; name: string };
		clients: { id: number; name: string }[];
		location: string;
		publiclyVisible: boolean;
		active: boolean;
		riskLevel: number | null;
	};
}

export interface GaugeStationFeatureCollectionResponse {
	type: "FeatureCollection";
	features: GaugeStationFeatureResponse[];
}

export class GaugeStationNotFoundError extends Error {
	constructor(gaugeStationId: number | string) {
		super(`gauge station ${gaugeStationId} does not exist`);
		this.name = "GaugeStationNotFoundError";
	}
}

export class GaugeStationNameConflictError extends Error {
	constructor(name: string) {
		super(`gauge station named "${name}" already exists`);
		this.name = "GaugeStationNameConflictError";
	}
}

export class GaugeStationAccessDeniedError extends Error {
	constructor(message = "not allowed to manage gauge stations for other clients") {
		super(message);
		this.name = "GaugeStationAccessDeniedError";
	}
}

export class GaugeStationCityNotFoundError extends Error {
	constructor(cityId: number) {
		super(`city ${cityId} does not exist`);
		this.name = "GaugeStationCityNotFoundError";
	}
}

export class GaugeStationClientNotFoundError extends Error {
	constructor(clientId: number) {
		super(`client ${clientId} does not exist`);
		this.name = "GaugeStationClientNotFoundError";
	}
}

function isUniqueViolation(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { code?: unknown }).code === "23505"
	);
}

function toGaugeStationResponse(row: GaugeStationRow): GaugeStationResponse {
	return {
		id: row.id,
		name: row.name,
		introduced: new Date(row.introduced).toISOString(),
		archived: row.archived === null ? null : new Date(row.archived).toISOString(),
		city: { id: row.city_id, state: row.city_state, name: row.city_name },
		clients: row.clients,
		location: row.location,
		latitude: row.latitude,
		longitude: row.longitude,
		publiclyVisible: row.publicly_visible,
		active: row.active,
	};
}

// Shared by listGaugeStations and listGaugeStationsGeoJson so the visibility rules cannot
// drift between the two list projections.
function resolveActiveFilter(access: GaugeStationReadAccess, input: GaugeStationListInput): boolean | undefined {
	if (access.canViewInactive) return input.active;
	if (input.active === false)
		throw new GaugeStationAccessDeniedError("not allowed to view inactive gauge stations");
	// Read-only users are implicitly limited to active gauge stations.
	return true;
}

export async function listGaugeStations(
	db: Kysely<DB>,
	session: SessionSubject,
	access: GaugeStationReadAccess,
	input: GaugeStationListInput = {},
): Promise<GaugeStationResponse[]> {
	const filters = { ...input, active: resolveActiveFilter(access, input) };
	const rows = access.canReadExternal
		? await queries.listGaugeStations(db, filters)
		: await queries.listGaugeStationsForClient(db, session.client_id, filters);
	return rows.map(toGaugeStationResponse);
}

function toGaugeStationFeature(row: GaugeStationRiskRow): GaugeStationFeatureResponse {
	return {
		type: "Feature",
		id: row.id,
		// GeoJSON is longitude-first.
		geometry: { type: "Point", coordinates: [row.longitude, row.latitude] },
		properties: {
			name: row.name,
			introduced: new Date(row.introduced).toISOString(),
			archived: row.archived === null ? null : new Date(row.archived).toISOString(),
			city: { id: row.city_id, state: row.city_state, name: row.city_name },
			clients: row.clients,
			location: row.location,
			publiclyVisible: row.publicly_visible,
			active: row.active,
			riskLevel: row.risk_level,
		},
	};
}

export async function listGaugeStationsGeoJson(
	db: Kysely<DB>,
	session: SessionSubject,
	access: GaugeStationReadAccess,
	input: GaugeStationListInput = {},
): Promise<GaugeStationFeatureCollectionResponse> {
	const filters = { ...input, active: resolveActiveFilter(access, input) };
	const rows = access.canReadExternal
		? await queries.listGaugeStationsWithRisk(db, filters)
		: await queries.listGaugeStationsWithRiskForClient(db, session.client_id, filters);
	return { type: "FeatureCollection", features: rows.map(toGaugeStationFeature) };
}

export async function getGaugeStation(
	db: Kysely<DB>,
	id: number,
	session: SessionSubject,
	access: GaugeStationReadAccess,
): Promise<GaugeStationResponse> {
	const row = access.canReadExternal
		? await queries.findGaugeStationById(db, id)
		: await queries.findGaugeStationByIdForClient(db, id, session.client_id);
	// Inactive gauge stations stay hidden from read-only users, matching listGaugeStations.
	if (!row || (!row.active && !access.canViewInactive)) throw new GaugeStationNotFoundError(id);
	return toGaugeStationResponse(row);
}

export async function getGaugeStationByName(
	db: Kysely<DB>,
	name: string,
	session: SessionSubject,
	access: GaugeStationReadAccess,
): Promise<GaugeStationResponse> {
	const row = access.canReadExternal
		? await queries.findGaugeStationByName(db, name)
		: await queries.findGaugeStationByNameForClient(db, name, session.client_id);
	if (!row || (!row.active && !access.canViewInactive)) throw new GaugeStationNotFoundError(name);
	return toGaugeStationResponse(row);
}

export async function createGaugeStation(
	db: Kysely<DB>,
	session: SessionSubject,
	access: GaugeStationWriteAccess,
	input: CreateGaugeStationInput,
): Promise<GaugeStationResponse> {
	if (!access.canWriteExternal && input.clientId !== session.client_id)
		throw new GaugeStationAccessDeniedError();

	const [city, client] = await Promise.all([
		queries.findCityById(db, input.cityId),
		queries.findClientById(db, input.clientId),
	]);
	if (!city) throw new GaugeStationCityNotFoundError(input.cityId);
	if (!client) throw new GaugeStationClientNotFoundError(input.clientId);

	let stationId: number;
	try {
		stationId = await db.transaction().execute(async (trx) => {
			const station = await queries.insertGaugeStation(trx, input.name);
			await queries.insertGaugeStationInfo(trx, {
				gauge_station_id: station.id,
				city_id: input.cityId,
				location: input.location,
				latitude: input.latitude,
				longitude: input.longitude,
				...(input.publiclyVisible === undefined
					? {}
					: { publicly_visible: input.publiclyVisible }),
				...(input.active === undefined ? {} : { active: input.active }),
			});
			await queries.insertClientGaugeStation(trx, station.id, input.clientId);
			return station.id;
		});
	} catch (error) {
		if (isUniqueViolation(error)) throw new GaugeStationNameConflictError(input.name);
		throw error;
	}

	const row = await queries.findGaugeStationById(db, stationId);
	if (!row) throw new GaugeStationNotFoundError(stationId);
	return toGaugeStationResponse(row);
}

export async function updateGaugeStation(
	db: Kysely<DB>,
	id: number,
	session: SessionSubject,
	access: GaugeStationWriteAccess,
	input: UpdateGaugeStationInput,
): Promise<GaugeStationResponse> {
	// Client-scoped writers only see (and may only touch) their own gauge stations, so
	// an existing gauge station linked to another client 404s rather than 403s.
	const current = access.canWriteExternal
		? await queries.findGaugeStationById(db, id)
		: await queries.findGaugeStationByIdForClient(db, id, session.client_id);
	if (!current) throw new GaugeStationNotFoundError(id);

	if (input.cityId !== undefined && input.cityId !== current.city_id) {
		const city = await queries.findCityById(db, input.cityId);
		if (!city) throw new GaugeStationCityNotFoundError(input.cityId);
	}

	const infoChanged =
		input.cityId !== undefined ||
		input.location !== undefined ||
		input.latitude !== undefined ||
		input.longitude !== undefined ||
		input.publiclyVisible !== undefined ||
		input.active !== undefined;

	try {
		await db.transaction().execute(async (trx) => {
			if (input.name !== undefined && input.name !== current.name)
				await queries.updateGaugeStationName(trx, id, input.name);

			if (infoChanged) {
				// SCD Type 2: close out the current info row and write a new one.
				await queries.archiveGaugeStationInfo(trx, id);
				await queries.insertGaugeStationInfo(trx, {
					gauge_station_id: id,
					city_id: input.cityId ?? current.city_id,
					location: input.location ?? current.location,
					latitude: input.latitude ?? current.latitude,
					longitude: input.longitude ?? current.longitude,
					publicly_visible: input.publiclyVisible ?? current.publicly_visible,
					active: input.active ?? current.active,
				});
			}
		});
	} catch (error) {
		if (isUniqueViolation(error)) throw new GaugeStationNameConflictError(input.name ?? current.name);
		throw error;
	}

	const row = await queries.findGaugeStationById(db, id);
	if (!row) throw new GaugeStationNotFoundError(id);
	return toGaugeStationResponse(row);
}
