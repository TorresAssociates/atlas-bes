import { Type } from "@sinclair/typebox";

export const CitySchema = Type.Object({
	id: Type.Integer(),
	state: Type.String({ minLength: 2, maxLength: 2 }),
	name: Type.String({ minLength: 1, maxLength: 64 }),
});

export const CityListSchema = Type.Object({
	data: Type.Array(CitySchema),
});

export const CityIdParamsSchema = Type.Object({
	id: Type.Integer({ minimum: 1 }),
});

export const CityListQuerySchema = Type.Partial(
	Type.Object({
		state: Type.String({ minLength: 2, maxLength: 2 }),
		name: Type.String({ minLength: 1, maxLength: 64 }),
	}),
);

export const CreateCityBodySchema = Type.Object({
	state: Type.String({ minLength: 2, maxLength: 2 }),
	name: Type.String({ minLength: 1, maxLength: 64 }),
});

export const UpdateCityBodySchema = Type.Partial(
	Type.Object({
		state: Type.String({ minLength: 2, maxLength: 2 }),
		name: Type.String({ minLength: 1, maxLength: 64 }),
	}),
);
