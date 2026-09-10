import { Type } from "@sinclair/typebox";
import { Nullable } from "@/schemas";

const JsonValueSchema = Type.Any();
const StringSetSchema = Type.Array(Type.String());

export const DataVisPresetDataSchema = Type.Object({
	name: Type.String({ minLength: 1 }),
	source: StringSetSchema,
	metric: StringSetSchema,
	time_range: Type.Union([
		Type.Integer({ minimum: 1 }),
		Type.Object({
			start: Type.String(),
			end: Type.String(),
		}),
	]),
});

export const DataVisPresetSchema = Type.Object({
	id: Type.Integer(),
	preference_id: Type.Integer(),
	data: JsonValueSchema,
});

export const DataVisPresetIdParamsSchema = Type.Object({
	id: Type.Integer(),
});

export const PreferenceSchema = Type.Object({
	id: Type.Integer(),
	user_id: Type.String(),
	map_style: Nullable(Type.String()),
	layers_on_load: Nullable(JsonValueSchema),
	favorite: Nullable(JsonValueSchema),
	theme: Nullable(Type.String()),
	data_vis_presets: Type.Array(DataVisPresetSchema),
});

export const UpdatePreferenceBodySchema = Type.Partial(
	Type.Object({
		map_style: Type.Any(),
		layers_on_load: JsonValueSchema,
		favorite: JsonValueSchema,
		theme: Type.Any(),
	}),
);

export const CreateDataVisPresetBodySchema = Type.Object({
	data: DataVisPresetDataSchema,
});

export const UpdateDataVisPresetBodySchema = Type.Object({
	data: DataVisPresetDataSchema,
});
