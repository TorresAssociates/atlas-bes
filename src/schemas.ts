import { Type } from "@sinclair/typebox";

// The @fastify/sensible error shape ({ statusCode, error, message }).
// Every route references this from its response map for 4xx/5xx statuses —
// do not define per-module error schemas.
export const HttpErrorSchema = Type.Object({
    statusCode: Type.Integer(),
    error: Type.String(),
    message: Type.String(),
});
