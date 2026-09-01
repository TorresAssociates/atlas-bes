import { Type } from "@sinclair/typebox";

// Snapshot IDs are opaque path segments minted by Rainbow — string or number
// depending on their API version, so accept both and pass through untouched.
export const RadarSnapshotResponseSchema = Type.Object({
	snapshot: Type.Union([Type.String(), Type.Number()]),
});
