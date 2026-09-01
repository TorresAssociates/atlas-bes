import type { Kysely } from "kysely";
import type { DB } from "@/db/types";
import type { SessionSubject } from "../auth/service";
import type { GaugeStationRiskRow, GaugeStationRow, GaugeStationStatusRow } from "./queries";
import * as queries from "./queries";

export interface GaugeListInput {
	cityId?: number;
	includeArchived?: boolean;
	active?: boolean;
}

// R_EXTERNAL_DEVICES / W_EXTERNAL_DEVICES holders operate across all clients;
// otherwise access is scoped to gauges linked to the session's own client.
// canViewInactive is the matching write permission for the read scope
// (W_EXTERNAL_DEVICES when reading externally, W_CLIENT_DEVICES otherwise):
// inactive gauges are a maintenance view, hidden from read-only users.
export interface GaugeReadAccess {
	canReadExternal: boolean;
	canViewInactive: boolean;
}

export interface GaugeWriteAccess {
	canWriteExternal: boolean;
}

export interface CreateGaugeInput {
	name: string;
	clientId: number;
	cityId: number;
	location: string;
	latitude: number;
	longitude: number;
	publiclyVisible?: boolean;
	active?: boolean;
}

export interface UpdateGaugeInput {
	name?: string;
	cityId?: number;
	location?: string;
	latitude?: number;
	longitude?: number;
	publiclyVisible?: boolean;
	active?: boolean;
}

export interface GaugeResponse {
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

export interface GaugeFeatureResponse {
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

export interface GaugeFeatureCollectionResponse {
	type: "FeatureCollection";
	features: GaugeFeatureResponse[];
}

export interface GaugeStatusInput extends GaugeListInput {
	rainfallWindow?: number;
}

export interface GaugeStatusResponse {
	id: number;
	riskLevel: number | null;
	connected: boolean | null;
	waterLevel: number | null;
	waterLevelDate: string | null;
	rainfall: number | null;
	rainfallAccumulation: number | null;
}

export const DEFAULT_RAINFALL_WINDOW_HOURS = 3;

export class GaugeNotFoundError extends Error {
	constructor(gaugeId: number | string) {
		super(`gauge station ${gaugeId} does not exist`);
		this.name = "GaugeNotFoundError";
	}
}

export class GaugeNameConflictError extends Error {
	constructor(name: string) {
		super(`gauge station named "${name}" already exists`);
		this.name = "GaugeNameConflictError";
	}
}

export class GaugeAccessDeniedError extends Error {
	constructor(message = "not allowed to manage gauge stations for other clients") {
		super(message);
		this.name = "GaugeAccessDeniedError";
	}
}

export class GaugeCityNotFoundError extends Error {
	constructor(cityId: number) {
		super(`city ${cityId} does not exist`);
		this.name = "GaugeCityNotFoundError";
	}
}

export class GaugeClientNotFoundError extends Error {
	constructor(clientId: number) {
		super(`client ${clientId} does not exist`);
		this.name = "GaugeClientNotFoundError";
	}
}

function isUniqueViolation(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { code?: unknown }).code === "23505"
	);
}

function toGaugeResponse(row: GaugeStationRow): GaugeResponse {
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

// Shared by listGauges and listGaugesGeoJson so the visibility rules cannot
// drift between the two list projections.
function resolveActiveFilter(access: GaugeReadAccess, input: GaugeListInput): boolean | undefined {
	if (access.canViewInactive) return input.active;
	if (input.active === false)
		throw new GaugeAccessDeniedError("not allowed to view inactive gauge stations");
	// Read-only users are implicitly limited to active gauges.
	return true;
}

export async function listGauges(
	db: Kysely<DB>,
	session: SessionSubject,
	access: GaugeReadAccess,
	input: GaugeListInput = {},
): Promise<GaugeResponse[]> {
	const filters = { ...input, active: resolveActiveFilter(access, input) };
	const rows = access.canReadExternal
		? await queries.listGaugeStations(db, filters)
		: await queries.listGaugeStationsForClient(db, session.client_id, filters);
	return rows.map(toGaugeResponse);
}

function toGaugeFeature(row: GaugeStationRiskRow): GaugeFeatureResponse {
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

export async function listGaugesGeoJson(
	db: Kysely<DB>,
	session: SessionSubject,
	access: GaugeReadAccess,
	input: GaugeListInput = {},
): Promise<GaugeFeatureCollectionResponse> {
	const filters = { ...input, active: resolveActiveFilter(access, input) };
	const rows = access.canReadExternal
		? await queries.listGaugeStationsWithRisk(db, filters)
		: await queries.listGaugeStationsWithRiskForClient(db, session.client_id, filters);
	return { type: "FeatureCollection", features: rows.map(toGaugeFeature) };
}

function toGaugeStatus(row: GaugeStationStatusRow): GaugeStatusResponse {
	return {
		id: row.id,
		riskLevel: row.risk_level,
		connected: row.connected,
		waterLevel: row.water_level,
		waterLevelDate:
			row.water_level_date === null ? null : new Date(row.water_level_date).toISOString(),
		rainfall: row.rainfall,
		rainfallAccumulation: row.rainfall_accumulation,
	};
}

// Same authorized row set as listGauges/listGaugesGeoJson (shared filters and
// resolveActiveFilter), so a status row exists for exactly the gauges the
// caller sees in geojson.
export async function listGaugeStatuses(
	db: Kysely<DB>,
	session: SessionSubject,
	access: GaugeReadAccess,
	input: GaugeStatusInput = {},
): Promise<GaugeStatusResponse[]> {
	const windowHours = input.rainfallWindow ?? DEFAULT_RAINFALL_WINDOW_HOURS;
	const filters = {
		cityId: input.cityId,
		includeArchived: input.includeArchived,
		active: resolveActiveFilter(access, input),
	};
	const rows = access.canReadExternal
		? await queries.listGaugeStationStatuses(db, windowHours, filters)
		: await queries.listGaugeStationStatusesForClient(
				db,
				session.client_id,
				windowHours,
				filters,
			);
	return rows.map(toGaugeStatus);
}

export async function getGauge(
	db: Kysely<DB>,
	id: number,
	session: SessionSubject,
	access: GaugeReadAccess,
): Promise<GaugeResponse> {
	const row = access.canReadExternal
		? await queries.findGaugeStationById(db, id)
		: await queries.findGaugeStationByIdForClient(db, id, session.client_id);
	// Inactive gauges stay hidden from read-only users, matching listGauges.
	if (!row || (!row.active && !access.canViewInactive)) throw new GaugeNotFoundError(id);
	return toGaugeResponse(row);
}

export async function getGaugeByName(
	db: Kysely<DB>,
	name: string,
	session: SessionSubject,
	access: GaugeReadAccess,
): Promise<GaugeResponse> {
	const row = access.canReadExternal
		? await queries.findGaugeStationByName(db, name)
		: await queries.findGaugeStationByNameForClient(db, name, session.client_id);
	if (!row || (!row.active && !access.canViewInactive)) throw new GaugeNotFoundError(name);
	return toGaugeResponse(row);
}

export async function createGauge(
	db: Kysely<DB>,
	session: SessionSubject,
	access: GaugeWriteAccess,
	input: CreateGaugeInput,
): Promise<GaugeResponse> {
	if (!access.canWriteExternal && input.clientId !== session.client_id)
		throw new GaugeAccessDeniedError();

	const [city, client] = await Promise.all([
		queries.findCityById(db, input.cityId),
		queries.findClientById(db, input.clientId),
	]);
	if (!city) throw new GaugeCityNotFoundError(input.cityId);
	if (!client) throw new GaugeClientNotFoundError(input.clientId);

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
		if (isUniqueViolation(error)) throw new GaugeNameConflictError(input.name);
		throw error;
	}

	const row = await queries.findGaugeStationById(db, stationId);
	if (!row) throw new GaugeNotFoundError(stationId);
	return toGaugeResponse(row);
}

export async function updateGauge(
	db: Kysely<DB>,
	id: number,
	session: SessionSubject,
	access: GaugeWriteAccess,
	input: UpdateGaugeInput,
): Promise<GaugeResponse> {
	// Client-scoped writers only see (and may only touch) their own gauges, so
	// an existing gauge linked to another client 404s rather than 403s.
	const current = access.canWriteExternal
		? await queries.findGaugeStationById(db, id)
		: await queries.findGaugeStationByIdForClient(db, id, session.client_id);
	if (!current) throw new GaugeNotFoundError(id);

	if (input.cityId !== undefined && input.cityId !== current.city_id) {
		const city = await queries.findCityById(db, input.cityId);
		if (!city) throw new GaugeCityNotFoundError(input.cityId);
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
		if (isUniqueViolation(error)) throw new GaugeNameConflictError(input.name ?? current.name);
		throw error;
	}

	const row = await queries.findGaugeStationById(db, id);
	if (!row) throw new GaugeNotFoundError(id);
	return toGaugeResponse(row);
}
