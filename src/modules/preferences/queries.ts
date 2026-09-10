import { type Insertable, type Kysely, type Selectable, sql } from "kysely";
import type { DB, Json } from "@/db/types";
import type { UpdatePreferenceInput } from "./service";

export type PreferenceRow = Selectable<DB["preference"]>;
export type DataVisPresetRow = Selectable<DB["data_visualizer_preset"]>;
type InsertPreferenceRow = Insertable<DB["preference"]>;
interface InsertDataVisPresetRow {
	preference_id: number;
	data: Json;
}

const preferenceColumns = [
	"id",
	"user_id",
	"map_style",
	"layers_on_load",
	"favorite",
	"theme",
] as const;
const dataVisPresetColumns = ["id", "preference_id", "data"] as const;

function jsonb(value: Json | null) {
	return value === null ? null : sql<Json>`${JSON.stringify(value)}::jsonb`;
}

function toUpdateValues(preference: UpdatePreferenceInput) {
	return {
		...(Object.hasOwn(preference, "map_style") && {
			map_style: preference.map_style,
		}),
		...(Object.hasOwn(preference, "layers_on_load") && {
			layers_on_load: jsonb(preference.layers_on_load ?? null),
		}),
		...(Object.hasOwn(preference, "favorite") && {
			favorite: jsonb(preference.favorite ?? null),
		}),
		...(Object.hasOwn(preference, "theme") && { theme: preference.theme }),
	};
}

export function findPreferenceByUserId(
	db: Kysely<DB>,
	userId: string,
): Promise<PreferenceRow | undefined> {
	return db
		.selectFrom("preference")
		.select(preferenceColumns)
		.where("user_id", "=", userId)
		.executeTakeFirst();
}

export function insertPreference(
	db: Kysely<DB>,
	preference: InsertPreferenceRow,
): Promise<PreferenceRow> {
	return db
		.insertInto("preference")
		.values(preference)
		.returning(preferenceColumns)
		.executeTakeFirstOrThrow();
}

export function updatePreferenceByUserId(
	db: Kysely<DB>,
	userId: string,
	preference: UpdatePreferenceInput,
): Promise<PreferenceRow | undefined> {
	return db
		.updateTable("preference")
		.set(toUpdateValues(preference))
		.where("user_id", "=", userId)
		.returning(preferenceColumns)
		.executeTakeFirst();
}

export function listDataVisPresetsByPreferenceId(
	db: Kysely<DB>,
	preferenceId: number,
): Promise<DataVisPresetRow[]> {
	return db
		.selectFrom("data_visualizer_preset")
		.select(dataVisPresetColumns)
		.where("preference_id", "=", preferenceId)
		.orderBy("id", "asc")
		.execute();
}

export function insertDataVisPreset(
	db: Kysely<DB>,
	preset: InsertDataVisPresetRow,
): Promise<DataVisPresetRow> {
	return db
		.insertInto("data_visualizer_preset")
		.values({
			...preset,
			data: jsonb(preset.data),
		})
		.returning(dataVisPresetColumns)
		.executeTakeFirstOrThrow();
}

export function updateDataVisPresetByPreferenceId(
	db: Kysely<DB>,
	preferenceId: number,
	presetId: number,
	data: Json,
): Promise<DataVisPresetRow | undefined> {
	return db
		.updateTable("data_visualizer_preset")
		.set({ data: jsonb(data) })
		.where("preference_id", "=", preferenceId)
		.where("id", "=", presetId)
		.returning(dataVisPresetColumns)
		.executeTakeFirst();
}

export function deleteDataVisPresetByPreferenceId(
	db: Kysely<DB>,
	preferenceId: number,
	presetId: number,
): Promise<DataVisPresetRow | undefined> {
	return db
		.deleteFrom("data_visualizer_preset")
		.where("preference_id", "=", preferenceId)
		.where("id", "=", presetId)
		.returning(dataVisPresetColumns)
		.executeTakeFirst();
}
