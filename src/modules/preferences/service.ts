import type { Kysely } from "kysely";
import type { DB, Json } from "@/db/types";
import type { SessionSubject } from "../auth/service";
import type { DataVisPresetRow, PreferenceRow } from "./queries";
import * as queries from "./queries";

export interface UpdatePreferenceInput {
	map_style?: string | null;
	layers_on_load?: Json | null;
	favorite?: Json | null;
	theme?: string | null;
}

export interface CreateDataVisPresetInput {
	data: Json;
}

export interface UpdateDataVisPresetInput {
	data: Json;
}

export interface PreferenceResponse extends PreferenceRow {
	data_vis_presets: DataVisPresetRow[];
}

export class PreferenceNotFoundError extends Error {
	constructor(userId: string) {
		super(`preferences for user ${JSON.stringify(userId)} do not exist`);
		this.name = "PreferenceNotFoundError";
	}
}

export class DataVisPresetNotFoundError extends Error {
	constructor(id: number) {
		super(`data visualization preset ${id} does not exist`);
		this.name = "DataVisPresetNotFoundError";
	}
}

async function ensurePreference(db: Kysely<DB>, userId: string): Promise<PreferenceRow> {
	const preference = await queries.findPreferenceByUserId(db, userId);
	if (preference) return preference;

	return queries.insertPreference(db, { user_id: userId });
}

async function hydratePreference(
	db: Kysely<DB>,
	preference: PreferenceRow,
): Promise<PreferenceResponse> {
	return {
		...preference,
		data_vis_presets: await queries.listDataVisPresetsByPreferenceId(db, preference.id),
	};
}

export async function getOwnPreferences(
	db: Kysely<DB>,
	session: SessionSubject,
): Promise<PreferenceResponse> {
	return hydratePreference(db, await ensurePreference(db, session.user_id));
}

export async function updateOwnPreferences(
	db: Kysely<DB>,
	session: SessionSubject,
	input: UpdatePreferenceInput,
): Promise<PreferenceResponse> {
	const preference = await ensurePreference(db, session.user_id);

	if (Object.keys(input).length === 0) {
		return hydratePreference(db, preference);
	}

	const updated = await queries.updatePreferenceByUserId(db, session.user_id, input);
	if (!updated) throw new PreferenceNotFoundError(session.user_id);

	return hydratePreference(db, updated);
}

export async function createOwnDataVisPreset(
	db: Kysely<DB>,
	session: SessionSubject,
	input: CreateDataVisPresetInput,
): Promise<DataVisPresetRow> {
	const preference = await ensurePreference(db, session.user_id);
	return queries.insertDataVisPreset(db, {
		preference_id: preference.id,
		data: input.data,
	});
}

export async function updateOwnDataVisPreset(
	db: Kysely<DB>,
	session: SessionSubject,
	id: number,
	input: UpdateDataVisPresetInput,
): Promise<DataVisPresetRow> {
	const preference = await ensurePreference(db, session.user_id);
	const updated = await queries.updateDataVisPresetByPreferenceId(
		db,
		preference.id,
		id,
		input.data,
	);
	if (!updated) throw new DataVisPresetNotFoundError(id);

	return updated;
}

export async function deleteOwnDataVisPreset(
	db: Kysely<DB>,
	session: SessionSubject,
	id: number,
): Promise<void> {
	const preference = await ensurePreference(db, session.user_id);
	const deleted = await queries.deleteDataVisPresetByPreferenceId(db, preference.id, id);
	if (!deleted) throw new DataVisPresetNotFoundError(id);
}
