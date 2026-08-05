import { Type } from "@sinclair/typebox";
import { Nullable } from "@/schemas";

export const AssetTypeIdParamsSchema = Type.Object({
	id: Type.Integer({ minimum: 1 }),
});

export const AssetTypeSchema = Type.Object({
	id: Type.Integer(),
	owner_client_id: Type.Integer(),
	name: Type.String(),
	lifespan: Nullable(Type.Integer()),
	current_value: Nullable(Type.String()),
	point_of_sale: Nullable(Type.String()),
	is_deprecated: Type.Boolean(),
});

export const AssetTypeListSchema = Type.Object({
	data: Type.Array(AssetTypeSchema),
});

export const CreateAssetTypeBodySchema = Type.Object({
	owner_client_id: Type.Optional(Type.Integer({ minimum: 1 })),
	name: Type.String({ minLength: 1, maxLength: 32 }),
	lifespan: Type.Optional(Nullable(Type.Integer({ minimum: 1 }))),
	current_value: Type.Optional(Nullable(Type.String({ minLength: 1, maxLength: 64 }))),
	point_of_sale: Type.Optional(Nullable(Type.String({ minLength: 1, maxLength: 255 }))),
	is_deprecated: Type.Optional(Type.Boolean()),
});

export const UpdateAssetTypeBodySchema = Type.Object({
	owner_client_id: Type.Optional(Type.Integer({ minimum: 1 })),
	name: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
	lifespan: Type.Optional(Nullable(Type.Integer({ minimum: 1 }))),
	current_value: Type.Optional(Nullable(Type.String({ minLength: 1, maxLength: 64 }))),
	point_of_sale: Type.Optional(Nullable(Type.String({ minLength: 1, maxLength: 255 }))),
	is_deprecated: Type.Optional(Type.Boolean()),
});
