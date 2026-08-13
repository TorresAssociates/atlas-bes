import { Type } from "@sinclair/typebox";
import { Nullable } from "@/schemas";

export const AssetIdParamsSchema = Type.Object({
	id: Type.Integer({ minimum: 1 }),
});

export const AssetSchema = Type.Object({
	id: Type.Integer(),
	asset_type_id: Type.Integer(),
	cost: Nullable(Type.String()),
	creation_date: Type.String({ format: "date-time" }),
	deploy_date: Nullable(Type.String({ format: "date-time" })),
	eos_date: Nullable(Type.String({ format: "date-time" })),
	gauge_station_id: Nullable(Type.Integer()),
	serial_number: Nullable(Type.String()),
});

export const AssetListSchema = Type.Object({
	data: Type.Array(AssetSchema),
});

export const CreateAssetBodySchema = Type.Object({
	asset_type_id: Type.Integer({ minimum: 1 }),
	cost: Type.Optional(Nullable(Type.String({ minLength: 1, maxLength: 64 }))),
	creation_date: Type.String({ format: "date-time" }),
	deploy_date: Type.Optional(Nullable(Type.String({ format: "date-time" }))),
	eos_date: Type.Optional(Nullable(Type.String({ format: "date-time" }))),
	gauge_station_id: Type.Integer({ minimum: 1 }),
	serial_number: Type.Optional(Nullable(Type.String({ minLength: 1, maxLength: 32 }))),
});

export const UpdateAssetBodySchema = Type.Partial(
	Type.Object({
		asset_type_id: Type.Integer({ minimum: 1 }),
		cost: Nullable(Type.String({ minLength: 1, maxLength: 64 })),
		creation_date: Type.String({ format: "date-time" }),
		deploy_date: Nullable(Type.String({ format: "date-time" })),
		eos_date: Nullable(Type.String({ format: "date-time" })),
		gauge_station_id: Type.Integer({ minimum: 1 }),
		serial_number: Nullable(Type.String({ minLength: 1, maxLength: 32 })),
	}),
);
