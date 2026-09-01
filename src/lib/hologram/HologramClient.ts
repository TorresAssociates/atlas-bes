export type HologramSimState = "pause" | "resume" | "deactivate";

export interface HologramClientConfig {
	orgId?: string;
	apiKey?: string;
	fetchFn?: typeof fetch;
}

export interface HologramPlanResponse {
	status: 200;
	planId: number;
}

export interface HologramActivationResponse {
	status: 200;
	message: string;
	deviceId: number | null;
}

export interface HologramCostByDate {
	date: string;
	amount: number;
}

export interface HologramServiceCost {
	service: string;
	amount: number;
	percentage: number;
	color: string;
	provider: "hologram";
}

export interface HologramCostsResponse {
	totalCost: number;
	costByDate: HologramCostByDate[];
	service: HologramServiceCost;
}

interface HologramApiResponse<T> {
	success?: boolean;
	data?: T;
}

interface HologramPlan {
	id: number | string;
	name: string;
}

interface HologramBalanceTransaction {
	amount?: number | string;
	time?: string;
}

const HOLOGRAM_API_BASE = "https://dashboard.hologram.io/api/1";
const GLOBAL_STANDARD_FLAT_RATE = "Global Standard Flat Rate";
const SERVICE_COLOR = "#00C7B7";

export class HologramCredentialsNotConfiguredError extends Error {
	constructor() {
		super("Hologram credentials not configured");
		this.name = "HologramCredentialsNotConfiguredError";
	}
}

export class HologramApiError extends Error {
	readonly status: number;

	constructor(status: number, statusText: string) {
		super(`Hologram API error: ${status} ${statusText}`);
		this.name = "HologramApiError";
		this.status = status;
	}
}

export class HologramPlanNotFoundError extends Error {
	constructor() {
		super(`${GLOBAL_STANDARD_FLAT_RATE} plan not found`);
		this.name = "HologramPlanNotFoundError";
	}
}

export class HologramClient {
	readonly #orgId?: string;
	readonly #apiKey?: string;
	readonly #fetch: typeof fetch;

	constructor(config: HologramClientConfig) {
		this.#orgId = config.orgId;
		this.#apiKey = config.apiKey;
		this.#fetch = config.fetchFn ?? fetch;
	}

	async updateDeviceState(deviceId: string, state: HologramSimState): Promise<void> {
		const { apiKey } = this.#credentials();
		const response = await this.#fetch(`${HOLOGRAM_API_BASE}/devices/${deviceId}/state`, {
			method: "POST",
			headers: {
				Authorization: `Basic ${apiKey}`,
			},
			body: JSON.stringify({ state }),
		});
		const data = await readJson<HologramApiResponse<unknown>>(response);
		if (!response.ok || data.success === false)
			throw new HologramApiError(response.status, response.statusText);
	}

	async getGlobalStandardFlatRatePlan(): Promise<HologramPlanResponse> {
		const { orgId, apiKey } = this.#credentials();
		const response = await this.#fetch(
			`${HOLOGRAM_API_BASE}/plans?orgid=${encodeURIComponent(orgId)}`,
			{
				method: "GET",
				headers: { Authorization: `Basic ${apiKey}` },
			},
		);
		const data = await readJson<HologramApiResponse<HologramPlan[]>>(response);
		if (!response.ok || data.success === false)
			throw new HologramApiError(response.status, response.statusText);

		const plan = (data.data ?? []).find(
			(candidate) => candidate.name === GLOBAL_STANDARD_FLAT_RATE,
		);
		if (!plan) throw new HologramPlanNotFoundError();
		return { status: 200, planId: Number(plan.id) };
	}

	async activateSim(input: {
		iccid: string;
		boxId: string;
	}): Promise<HologramActivationResponse> {
		const { orgId, apiKey } = this.#credentials();
		const { planId } = await this.getGlobalStandardFlatRatePlan();
		const response = await this.#fetch(
			`${HOLOGRAM_API_BASE}/links/cellular/sim_${input.iccid}/claim`,
			{
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					Authorization: `Basic ${apiKey}`,
				},
				body: JSON.stringify({ plan: planId, zone: "global", orgid: Number(orgId) }),
			},
		);
		const data =
			await readJson<
				HologramApiResponse<Array<{ device?: number | string }> | Record<string, unknown>>
			>(response);

		if (!response.ok) {
			const simError = isRecord(data.data) ? data.data[input.iccid] : undefined;
			if (simError !== "SIM is already activated")
				throw new HologramApiError(response.status, response.statusText);
		}

		const firstActivated = Array.isArray(data.data) ? data.data[0] : undefined;
		const deviceId =
			firstActivated?.device === undefined ? null : Number(firstActivated.device);
		if (deviceId !== null) {
			await this.#fetch(
				`${HOLOGRAM_API_BASE}/devices/${deviceId}?orgid=${encodeURIComponent(orgId)}`,
				{
					method: "PUT",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Basic ${apiKey}`,
					},
					body: JSON.stringify({ name: input.boxId }),
				},
			);
		}

		return { status: 200, message: "Hologram SIM Activated Successfully", deviceId };
	}

	async getCosts(input: {
		startDate?: string;
		endDate?: string;
		limit?: number;
	}): Promise<HologramCostsResponse> {
		const { orgId, apiKey } = this.#credentials();
		const balanceResponse = await this.#fetch(
			`${HOLOGRAM_API_BASE}/organizations/${orgId}/balance`,
			{
				method: "GET",
				headers: { Authorization: `Basic ${apiKey}` },
			},
		);
		const balanceData = await readJson<HologramApiResponse<unknown>>(balanceResponse);
		if (!balanceResponse.ok || balanceData.success === false) {
			throw new HologramApiError(balanceResponse.status, balanceResponse.statusText);
		}

		const historyUrl = new URL(`${HOLOGRAM_API_BASE}/organizations/${orgId}/balancehistory`);
		if (input.startDate !== undefined)
			historyUrl.searchParams.append("timestart", seconds(input.startDate));
		if (input.endDate !== undefined)
			historyUrl.searchParams.append("timeend", seconds(input.endDate));
		historyUrl.searchParams.append("limit", String(input.limit ?? 200));

		const historyResponse = await this.#fetch(historyUrl.toString(), {
			method: "GET",
			headers: { Authorization: `Basic ${apiKey}` },
		});
		const historyData =
			await readJson<HologramApiResponse<HologramBalanceTransaction[]>>(historyResponse);
		if (!historyResponse.ok || historyData.success === false) {
			throw new HologramApiError(historyResponse.status, historyResponse.statusText);
		}

		return processHologramData(historyData.data ?? []);
	}

	#credentials(): { orgId: string; apiKey: string } {
		if (!this.#orgId || !this.#apiKey) throw new HologramCredentialsNotConfiguredError();
		return { orgId: this.#orgId, apiKey: this.#apiKey };
	}
}

export function createHologramClient(config: { orgId?: string; apiKey?: string }): HologramClient {
	return new HologramClient(config);
}

function processHologramData(history: HologramBalanceTransaction[]): HologramCostsResponse {
	const costMap = new Map<string, number>();
	let totalCost = 0;

	for (const transaction of history) {
		if (transaction.amount === undefined || transaction.time === undefined) continue;
		const amount = Number.parseFloat(String(transaction.amount)) || 0;
		if (amount >= 0) continue;
		const date = transaction.time.split(" ")[0] ?? transaction.time;
		const cost = Math.abs(amount);
		costMap.set(date, (costMap.get(date) ?? 0) + cost);
		totalCost += cost;
	}

	const costByDate = Array.from(costMap.entries())
		.map(([date, amount]) => ({ date, amount }))
		.sort((a, b) => a.date.localeCompare(b.date));

	return {
		totalCost,
		costByDate,
		service: {
			service: "Hologram: SIMs & Cellular Data",
			amount: totalCost,
			percentage: 0,
			color: SERVICE_COLOR,
			provider: "hologram",
		},
	};
}

function seconds(date: string): string {
	return String(Math.floor(new Date(date).getTime() / 1000));
}

async function readJson<T>(response: Response): Promise<T> {
	return (await response.json()) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
