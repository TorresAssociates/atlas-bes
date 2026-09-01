import type { Kysely } from "kysely";
import type { DB, Json } from "@/db/types";
import type { SessionSubject } from "../auth/service";
import type { PreferenceRow } from "./queries";
import * as queries from "./queries";

export interface UpdatePreferenceInput {
	map_style?: string | null;
	layers_on_load?: Json | null;
	favorite?: Json | null;
	theme?: string | null;
	data_vis_preset?: Json | null;
}

export type PreferenceResponse = PreferenceRow;

export class PreferenceNotFoundError extends Error {
	constructor(userId: string) {
		super(`preferences for user ${JSON.stringify(userId)} do not exist`);
		this.name = "PreferenceNotFoundError";
	}
}

async function ensurePreference(db: Kysely<DB>, userId: string): Promise<PreferenceRow> {
	const preference = await queries.findPreferenceByUserId(db, userId);
	if (preference) return preference;

	return queries.insertPreference(db, { user_id: userId });
}

export function getOwnPreferences(
	db: Kysely<DB>,
	session: SessionSubject,
): Promise<PreferenceResponse> {
	return ensurePreference(db, session.user_id);
}

export async function updateOwnPreferences(
	db: Kysely<DB>,
	session: SessionSubject,
	input: UpdatePreferenceInput,
): Promise<PreferenceResponse> {
	await ensurePreference(db, session.user_id);

	if (Object.keys(input).length === 0) {
		return ensurePreference(db, session.user_id);
	}

	const updated = await queries.updatePreferenceByUserId(db, session.user_id, input);
	if (!updated) throw new PreferenceNotFoundError(session.user_id);

	return updated;
}
