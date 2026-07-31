import { Nullable } from "@/schemas";
import { Type } from "@sinclair/typebox";

const JsonValueSchema = Type.Any();

export const PreferenceSchema = Type.Object({
	id: Type.Integer(),
	user_id: Type.String(),
	map_style: Nullable(Type.String()),
	layers_on_load: Nullable(JsonValueSchema),
	favorite: Nullable(JsonValueSchema),
	theme: Nullable(Type.String()),
	data_vis_preset: Nullable(JsonValueSchema),
});

export const UpdatePreferenceBodySchema = Type.Partial(
	Type.Object({
		map_style: Type.Any(),
		layers_on_load: JsonValueSchema,
		favorite: JsonValueSchema,
		theme: Type.Any(),
		data_vis_preset: JsonValueSchema,
	}),
);
