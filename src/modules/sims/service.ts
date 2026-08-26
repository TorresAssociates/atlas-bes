import type { Kysely } from "kysely";
import type { DB } from "@/db/types";
import type { EmnifyClient } from "@/lib/emnify/EmnifyClient";
import type { HologramClient } from "@/lib/hologram/HologramClient";
import type { SessionSubject } from "../auth/service";
import type { SimAggregateRow, SimDeviceRow, SimInfoRow, SimRow } from "./queries";
import * as queries from "./queries";

export interface SimReadAccess {
	canReadExternal: boolean;
}

export interface SimWriteAccess {
	canWriteExternal: boolean;
}

export interface SimProviderResponse {
	name: string;
	apn: string | null;
}

export interface SimResponse {
	id: number;
	iccid: string;
	imei: string | null;
	imsi: null;
	simProvider: SimProviderResponse;
	isActivated: boolean;
	isPaused: boolean;
	boxSerialNumber: string | null;
	gaugeName: string | null;
	deviceId?: number;
	bic?: string;
}

export interface CreateSimInput {
	simType: "hologram" | "emnify";
	iccid: string;
	deviceId?: number | string;
	bic?: string;
}

export interface CreateSimResponse {
	message: string;
	usimId: number;
}

export interface UpdateSimImeiInput {
	iccid: string;
	imei: string;
}

export interface UpdateSimImeiResponse {
	message: string;
	usimId: number;
}

export interface ActivateSimsInput {
	imei: string;
	boxType: DB["device_info"]["type"];
	gaugeId: string;
}

export interface ActivateSimsResponse {
	message: string;
	boxId: number;
}

export class SimNotFoundError extends Error {
	constructor(identifier: string) {
		super(`SIM card ${identifier} not found`);
		this.name = "SimNotFoundError";
	}
}

export class SimConflictError extends Error {
	constructor() {
		super("SIM card already exists");
		this.name = "SimConflictError";
	}
}

export class SimBadRequestError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SimBadRequestError";
	}
}

export class SimAccessDeniedError extends Error {
	constructor(message = "not allowed to manage SIM cards for other clients") {
		super(message);
		this.name = "SimAccessDeniedError";
	}
}

export class SimDeviceNotFoundError extends Error {
	constructor() {
		super("Box corresponding to SIM card not found");
		this.name = "SimDeviceNotFoundError";
	}
}

export class SimGaugeNotFoundError extends Error {
	constructor(gaugeName: string) {
		super(`Gauge ${gaugeName} not found`);
		this.name = "SimGaugeNotFoundError";
	}
}

function isUniqueViolation(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { code?: unknown }).code === "23505"
	);
}

function toApn(provider: string): string | null {
	if (provider === "hologram") return "hologram";
	if (provider === "emnify") return "em";
	return null;
}

function toSimResponse(row: SimAggregateRow): SimResponse {
	const response: SimResponse = {
		id: row.sim.id,
		iccid: row.sim.iccid,
		imei: row.info?.imei ?? null,
		imsi: null,
		simProvider: {
			name: row.sim.provider,
			apn: toApn(row.sim.provider),
		},
		isActivated: row.info?.activated ?? false,
		isPaused: row.info?.paused ?? false,
		boxSerialNumber: row.device?.serial_number ?? null,
		gaugeName: row.device?.gauge_station_name ?? null,
	};
	if (row.hologram?.device_id !== null && row.hologram?.device_id !== undefined)
		response.deviceId = row.hologram.device_id;
	if (row.emnify) response.bic = row.emnify.bic.trim();
	return response;
}

async function hydrateSim(db: Kysely<DB>, sim: SimRow): Promise<SimAggregateRow> {
	const [info, hologram, emnify, device] = await Promise.all([
		queries.findCurrentSimInfo(db, sim.id),
		queries.findCurrentHologramInfo(db, sim.id),
		queries.findCurrentEmnifyInfo(db, sim.id),
		queries.findCurrentDeviceForSim(db, sim.id),
	]);
	return {
		sim,
		info: info ?? null,
		hologram: hologram ?? null,
		emnify: emnify ?? null,
		device: device ?? null,
	};
}

async function writeSimInfo(
	db: Kysely<DB>,
	simId: number,
	values: { imei: string; activated: boolean; paused: boolean },
): Promise<SimInfoRow> {
	await queries.archiveCurrentSimInfo(db, simId);
	return queries.insertSimInfo(db, {
		sim_id: simId,
		imei: values.imei,
		activated: values.activated,
		paused: values.paused,
	});
}

async function ensureDeviceAccess(
	db: Kysely<DB>,
	session: SessionSubject,
	access: SimWriteAccess,
	device: SimDeviceRow,
): Promise<void> {
	if (access.canWriteExternal) return;
	const visible = await queries.findDeviceByIdForClient(db, device.device_id, session.client_id);
	if (!visible) throw new SimAccessDeniedError();
}

async function ensureGaugeAccess(
	db: Kysely<DB>,
	session: SessionSubject,
	access: SimWriteAccess,
	gaugeName: string,
): Promise<number> {
	const gauge = access.canWriteExternal
		? await queries.findGaugeStationByName(db, gaugeName)
		: await queries.findGaugeStationByNameForClient(db, gaugeName, session.client_id);
	if (!gauge) throw new SimGaugeNotFoundError(gaugeName);
	return gauge.id;
}

export async function listSims(
	db: Kysely<DB>,
	session: SessionSubject,
	access: SimReadAccess,
): Promise<SimResponse[]> {
	const sims = access.canReadExternal
		? await queries.listSims(db)
		: await queries.listSimsForClient(db, session.client_id);
	const hydrated = await Promise.all(sims.map((sim) => hydrateSim(db, sim)));
	return hydrated.map(toSimResponse);
}

export async function getSim(
	db: Kysely<DB>,
	iccid: string,
	session: SessionSubject,
	access: SimReadAccess,
): Promise<SimResponse> {
	const sim = access.canReadExternal
		? await queries.findSimByIccid(db, iccid)
		: await queries.findSimByIccidForClient(db, iccid, session.client_id);
	if (!sim) throw new SimNotFoundError(iccid);
	return toSimResponse(await hydrateSim(db, sim));
}

export async function createSim(db: Kysely<DB>, input: CreateSimInput): Promise<CreateSimResponse> {
	if (input.simType === "hologram" && input.deviceId === undefined) {
		throw new SimBadRequestError("Missing required field: deviceId");
	}
	if (input.simType === "emnify" && !input.bic) {
		throw new SimBadRequestError("Missing required field: bic");
	}

	try {
		const sim = await db.transaction().execute(async (trx) => {
			const created = await queries.insertSim(trx, {
				iccid: input.iccid,
				provider: input.simType,
			});
			if (input.simType === "hologram") {
				await queries.insertHologramInfo(trx, {
					sim_id: created.id,
					device_id: Number(input.deviceId),
				});
			} else {
				const bic = input.bic;
				if (bic === undefined) throw new SimBadRequestError("Missing required field: bic");
				await queries.insertEmnifyInfo(trx, {
					sim_id: created.id,
					bic,
				});
			}
			return created;
		});
		return { message: "SIM card inserted successfully", usimId: sim.id };
	} catch (error) {
		if (isUniqueViolation(error)) throw new SimConflictError();
		throw error;
	}
}

export async function updateSimImei(
	db: Kysely<DB>,
	input: UpdateSimImeiInput,
): Promise<UpdateSimImeiResponse> {
	const sim = await queries.findSimByIccid(db, input.iccid);
	if (!sim) throw new SimNotFoundError(input.iccid);
	const current = await queries.findCurrentSimInfo(db, sim.id);
	await writeSimInfo(db, sim.id, {
		imei: input.imei,
		activated: current?.activated ?? false,
		paused: current?.paused ?? false,
	});
	return { message: "SIM card updated successfully", usimId: sim.id };
}

export async function activateSims(
	db: Kysely<DB>,
	session: SessionSubject,
	access: SimWriteAccess,
	clients: { hologram: HologramClient; emnify: EmnifyClient },
	input: ActivateSimsInput,
): Promise<ActivateSimsResponse> {
	const sims = await queries.findSimsByCurrentImei(db, input.imei);
	if (sims.length === 0) throw new SimNotFoundError("for provided IMEI");

	const device = await queries.findCurrentDeviceForSims(
		db,
		sims.map((sim) => sim.id),
	);
	if (!device) throw new SimDeviceNotFoundError();
	await ensureDeviceAccess(db, session, access, device);
	const gaugeStationId = await ensureGaugeAccess(db, session, access, input.gaugeId);

	for (const sim of sims) {
		const [info, hologram, emnify] = await Promise.all([
			queries.findCurrentSimInfo(db, sim.id),
			queries.findCurrentHologramInfo(db, sim.id),
			queries.findCurrentEmnifyInfo(db, sim.id),
		]);
		if (!info || info.activated || info.imei === null) continue;
		const imei = info.imei;

		if (hologram) {
			const result = await clients.hologram.activateSim({
				iccid: sim.iccid,
				boxId: device.serial_number,
			});
			await db.transaction().execute(async (trx) => {
				await writeSimInfo(trx, sim.id, { imei, activated: true, paused: false });
				if (result.deviceId !== null) {
					await queries.archiveCurrentHologramInfo(trx, sim.id);
					await queries.insertHologramInfo(trx, {
						sim_id: sim.id,
						device_id: result.deviceId,
					});
				}
			});
		} else if (emnify) {
			const bic = emnify.bic.trim();
			if (!bic) throw new SimBadRequestError("BIC not found for Emnify SIM");
			await clients.emnify.activateSim({
				iccid: sim.iccid,
				bic,
				box: {
					serialNumber: device.serial_number,
					boxTypeId: input.boxType,
				},
			});
			await writeSimInfo(db, sim.id, { imei, activated: true, paused: false });
		}
	}

	await db.transaction().execute(async (trx) => {
		await queries.archiveCurrentDeviceInfo(trx, device.device_id);
		await queries.insertDeviceInfo(trx, {
			device_id: device.device_id,
			gauge_station_id: gaugeStationId,
			type: input.boxType,
			active: true,
			activation_date: new Date(),
			warranty_end_date: new Date(new Date().setFullYear(new Date().getFullYear() + 2)),
		});
	});

	return { message: "SIM card activated successfully", boxId: device.device_id };
}
