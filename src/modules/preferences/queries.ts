import { sql, type Insertable, type Kysely, type Selectable } from "kysely";
import type { DB, Json } from "@/db/types";
import type { UpdatePreferenceInput } from "./service";

export type PreferenceRow = Selectable<DB["preference"]>;
type InsertPreferenceRow = Insertable<DB["preference"]>;

const preferenceColumns = [
	"id",
	"user_id",
	"map_style",
	"layers_on_load",
	"favorite",
	"theme",
	"data_vis_preset",
] as const;

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
		...(Object.hasOwn(preference, "data_vis_preset") && {
			data_vis_preset: jsonb(preference.data_vis_preset ?? null),
		}),
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
