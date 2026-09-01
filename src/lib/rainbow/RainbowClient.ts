export interface RainbowClientConfig {
	apiToken?: string;
	fetchFn?: typeof fetch;
}

// Rainbow returns the snapshot identifier used in tile paths
// (/precip/{snapshot}/{forecastTime}/{z}/{x}/{y}); pass it through opaquely.
export interface RainbowSnapshotResponse {
	snapshot: string | number;
}

const RAINBOW_API_BASE = "https://api.rainbow.ai/tiles/v1";

export class RainbowCredentialsNotConfiguredError extends Error {
	constructor() {
		super("Rainbow API token not configured");
		this.name = "RainbowCredentialsNotConfiguredError";
	}
}

export class RainbowApiError extends Error {
	readonly status: number;

	constructor(status: number, statusText: string) {
		super(`Rainbow API error: ${status} ${statusText}`);
		this.name = "RainbowApiError";
		this.status = status;
	}
}

export class RainbowMalformedResponseError extends Error {
	constructor() {
		super("Rainbow API response did not include a snapshot");
		this.name = "RainbowMalformedResponseError";
	}
}

export class RainbowClient {
	readonly #apiToken?: string;
	readonly #fetch: typeof fetch;

	constructor(config: RainbowClientConfig) {
		this.#apiToken = config.apiToken;
		this.#fetch = config.fetchFn ?? fetch;
	}

	async getSnapshot(): Promise<RainbowSnapshotResponse> {
		if (!this.#apiToken) throw new RainbowCredentialsNotConfiguredError();

		const url = new URL(`${RAINBOW_API_BASE}/snapshot`);
		url.searchParams.set("token", this.#apiToken);

		const response = await this.#fetch(url);
		if (!response.ok) {
			throw new RainbowApiError(response.status, response.statusText);
		}

		const body = (await response.json()) as { snapshot?: unknown };
		const snapshot = body?.snapshot;
		if (typeof snapshot !== "string" && typeof snapshot !== "number") {
			throw new RainbowMalformedResponseError();
		}
		return { snapshot };
	}
}

export function createRainbowClient(config: RainbowClientConfig = {}): RainbowClient {
	return new RainbowClient(config);
}
