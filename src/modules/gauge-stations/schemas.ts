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
export const GaugeStationSchema = Type.Object({
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

export const GaugeStationListSchema = Type.Object({
	data: Type.Array(GaugeStationSchema),
});

// GeoJSON (RFC 7946) shapes for GET /v1/gaugeStations/geojson. Coordinates are
// [longitude, latitude]. The feature `id` sits on the Feature itself so
// MapLibre feature-state can key off it, and `riskLevel` is a top-level
// property so style expressions can ["get"] it directly.
export const GaugeStationPointGeometrySchema = Type.Object({
	type: Type.Literal("Point"),
	coordinates: Type.Tuple([Type.Number(), Type.Number()]),
});

// GaugeStationSchema minus latitude/longitude (they live in the geometry) plus the
// highest effective risk level across the gauge station's devices (null when none of
// its devices yields a risk value).
export const GaugeStationFeaturePropertiesSchema = Type.Object({
	name: Type.String(),
	introduced: Type.String({ format: "date-time" }),
	archived: Nullable(Type.String({ format: "date-time" })),
	city: CitySchema,
	clients: Type.Array(ClientSchema),
	location: Type.String(),
	publiclyVisible: Type.Boolean(),
	active: Type.Boolean(),
	riskLevel: Nullable(Type.Number()),
});

export const GaugeStationFeatureSchema = Type.Object({
	type: Type.Literal("Feature"),
	id: Type.Integer(),
	geometry: GaugeStationPointGeometrySchema,
	properties: GaugeStationFeaturePropertiesSchema,
});

export const GaugeStationFeatureCollectionSchema = Type.Object({
	type: Type.Literal("FeatureCollection"),
	features: Type.Array(GaugeStationFeatureSchema),
});

export const GaugeStationIdParamsSchema = Type.Object({
	id: Type.Integer({ minimum: 1 }),
});

// active=false (the maintenance view of hidden gauge stations) requires the write
// permission matching the read scope; see GaugeStationReadAccess in service.ts.
export const GaugeStationListQuerySchema = Type.Partial(
	Type.Object({
		cityId: Type.Integer({ minimum: 1 }),
		includeArchived: Type.Boolean(),
		active: Type.Boolean(),
	}),
);

// name is varchar(32), location varchar(128) in the schema.
export const CreateGaugeStationBodySchema = Type.Object({
	name: Type.String({ minLength: 1, maxLength: 32 }),
	clientId: Type.Integer({ minimum: 1 }),
	cityId: Type.Integer({ minimum: 1 }),
	location: Type.String({ minLength: 1, maxLength: 128 }),
	latitude: Type.Number({ minimum: -90, maximum: 90 }),
	longitude: Type.Number({ minimum: -180, maximum: 180 }),
	publiclyVisible: Type.Optional(Type.Boolean()),
	active: Type.Optional(Type.Boolean()),
});

export const UpdateGaugeStationBodySchema = Type.Partial(
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
