import type { RainbowClient, RainbowSnapshotResponse } from "@/lib/rainbow/RainbowClient";
import {
	RainbowApiError,
	RainbowCredentialsNotConfiguredError,
	RainbowMalformedResponseError,
} from "@/lib/rainbow/RainbowClient";

// Rainbow publishes a new snapshot every few minutes, and every map session
// polls for it. One cached value per process turns N user polls into at most
// one upstream call per TTL window.
const SNAPSHOT_TTL_MS = 60_000;

export class RadarRequestFailedError extends Error {
	readonly statusCode: number;

	constructor(message: string, statusCode = 502) {
		super(message);
		this.name = "RadarRequestFailedError";
		this.statusCode = statusCode;
	}
}

interface SnapshotCacheEntry {
	value: RainbowSnapshotResponse | null;
	fetchedAt: number;
	inflight: Promise<RainbowSnapshotResponse> | null;
}

// Keyed by client instance so parallel test apps (each with their own stub
// client) never share cache state.
const snapshotCache = new WeakMap<RainbowClient, SnapshotCacheEntry>();

export async function getRadarSnapshot(client: RainbowClient): Promise<RainbowSnapshotResponse> {
	let entry = snapshotCache.get(client);
	if (!entry) {
		entry = { value: null, fetchedAt: 0, inflight: null };
		snapshotCache.set(client, entry);
	}

	if (entry.value && Date.now() - entry.fetchedAt < SNAPSHOT_TTL_MS) {
		return entry.value;
	}

	// Concurrent misses share one upstream request instead of stampeding.
	if (!entry.inflight) {
		entry.inflight = client
			.getSnapshot()
			.then((value) => {
				entry.value = value;
				entry.fetchedAt = Date.now();
				return value;
			})
			.finally(() => {
				entry.inflight = null;
			});
	}

	try {
		return await entry.inflight;
	} catch (error) {
		// A stale snapshot ID still resolves valid (immutable) tiles, so a
		// Rainbow blip degrades to slightly older radar rather than an error.
		if (entry.value) return entry.value;
		throw toRadarRouteError(error);
	}
}

function toRadarRouteError(error: unknown): RadarRequestFailedError {
	if (error instanceof RainbowCredentialsNotConfiguredError) {
		return new RadarRequestFailedError(error.message, 500);
	}
	if (error instanceof RainbowApiError) {
		// Upstream failure, not a client mistake — report as bad gateway
		// rather than echoing Rainbow's status (their 401/403 would read as
		// the caller's session being rejected).
		return new RadarRequestFailedError(error.message, 502);
	}
	if (error instanceof RainbowMalformedResponseError) {
		return new RadarRequestFailedError(error.message, 502);
	}
	return new RadarRequestFailedError(
		error instanceof Error
			? `Failed to fetch radar snapshot: ${error.message}`
			: "Failed to fetch radar snapshot",
		502,
	);
}
