import { Type } from "@sinclair/typebox";

export const ClientSchema = Type.Object({
    id: Type.Integer(),
    name: Type.String(),
});

export const ClientIdParamsSchema = Type.Object({
    id: Type.Integer({ minimum: 1 }),
});

// name is varchar(64) in the schema.
export const ClientNameBodySchema = Type.Object({
    name: Type.String({ minLength: 1, maxLength: 64 }),
});

// List responses are { data: [...] } rather than a bare array so pagination
// metadata can be added later without breaking clients.
export const ClientListSchema = Type.Object({
    data: Type.Array(ClientSchema),
});
