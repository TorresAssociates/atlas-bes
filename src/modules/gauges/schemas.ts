import { Type } from "@sinclair/typebox";
import { Nullable } from "@/schemas";

// Local copies of the client/city shapes so this module stays independently
// portable (no imports from other modules' schemas.ts).
export const ClientSchema = Type.Object({
	id: Type.Integer(),
	name: Type.String(),
});

export const CitySchema = Type.Object({
	id: Type.Integer(),
	state: Type.String({ minLength: 2, maxLength: 2 }),
	name: Type.String({ minLength: 1, maxLength: 64 }),
});

// A gauge station joined with its current (archived IS NULL) gauge_station_info
// row. `clients` is an array because client_gauge_station is many-to-many.
export const GaugeSchema = Type.Object({
	id: Type.Integer(),
	name: Type.String(),
	introduced: Type.String({ format: "date-time" }),
	archived: Nullable(Type.String({ format: "date-time" })),
	city: CitySchema,
	clients: Type.Array(ClientSchema),
	location: Type.String(),
	latitude: Type.Number(),
	longitude: Type.Number(),
	publiclyVisible: Type.Boolean(),
	active: Type.Boolean(),
});

export const GaugeListSchema = Type.Object({
	data: Type.Array(GaugeSchema),
});

export const GaugeIdParamsSchema = Type.Object({
	id: Type.Integer({ minimum: 1 }),
});

// active=false (the maintenance view of hidden gauges) requires the write
// permission matching the read scope; see GaugeReadAccess in service.ts.
export const GaugeListQuerySchema = Type.Partial(
	Type.Object({
		cityId: Type.Integer({ minimum: 1 }),
		includeArchived: Type.Boolean(),
		active: Type.Boolean(),
	}),
);

// name is varchar(32), location varchar(128) in the schema.
export const CreateGaugeBodySchema = Type.Object({
	name: Type.String({ minLength: 1, maxLength: 32 }),
	clientId: Type.Integer({ minimum: 1 }),
	cityId: Type.Integer({ minimum: 1 }),
	location: Type.String({ minLength: 1, maxLength: 128 }),
	latitude: Type.Number({ minimum: -90, maximum: 90 }),
	longitude: Type.Number({ minimum: -180, maximum: 180 }),
	publiclyVisible: Type.Optional(Type.Boolean()),
	active: Type.Optional(Type.Boolean()),
});

export const UpdateGaugeBodySchema = Type.Partial(
	Type.Object({
		name: Type.String({ minLength: 1, maxLength: 32 }),
		cityId: Type.Integer({ minimum: 1 }),
		location: Type.String({ minLength: 1, maxLength: 128 }),
		latitude: Type.Number({ minimum: -90, maximum: 90 }),
		longitude: Type.Number({ minimum: -180, maximum: 180 }),
		publiclyVisible: Type.Boolean(),
		active: Type.Boolean(),
	}),
);
