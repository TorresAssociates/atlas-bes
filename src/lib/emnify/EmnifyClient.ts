export type EmnifySimState = 0 | 1 | 2 | 4;

export interface EmnifyClientConfig {
	applicationToken?: string;
	organisationId?: string;
	serviceProfileId?: number;
	tariffProfileId?: number;
	fetchFn?: typeof fetch;
}

export interface EmnifyActivationInput {
	iccid: string;
	bic: string;
	box: {
		serialNumber: string;
		boxTypeId: string;
	};
}

export interface EmnifyActivationResponse {
	status: 200;
	message: string;
}

export interface EmnifyCostByDate {
	date: string;
	amount: number;
}

export interface EmnifyServiceCost {
	service: string;
	amount: number;
	percentage: number;
	color: string;
	provider: "emnify";
}

export interface EmnifyCostsResponse {
	totalCost: number;
	costByDate: EmnifyCostByDate[];
	service: EmnifyServiceCost;
}

interface EmnifySimRecord {
	id: number;
	iccid?: string;
	status: { id: EmnifySimState };
}

interface EmnifyEndpointRecord {
	id: number;
	sim?: { id?: number };
}

const EMNIFY_API_BASE = "https://cdn.emnify.net/api/v1";
const DEFAULT_ORGANISATION_ID = "27343";
const DEFAULT_SERVICE_PROFILE_ID = 1435279;
const DEFAULT_TARIFF_PROFILE_ID = 1653400;
const REGISTERED_PRIOR = "REGISTEREDPRIOR";
const SERVICE_COLOR = "#6366F1";

const STATE_NAMES: Record<EmnifySimState, string> = {
	0: "Issued",
	1: "Activated",
	2: "Suspended",
	4: "Factory Test",
};

export class EmnifyCredentialsNotConfiguredError extends Error {
	constructor() {
		super("Emnify credentials not configured");
		this.name = "EmnifyCredentialsNotConfiguredError";
	}
}

export class EmnifyApiError extends Error {
	readonly status: number;

	constructor(status: number, statusText: string, message?: string) {
		super(message ?? `Emnify API error: ${status} ${statusText}`);
		this.name = "EmnifyApiError";
		this.status = status;
	}
}

export class EmnifyInvalidStateTransitionError extends Error {
	readonly currentState: string;
	readonly requestedState: string;

	constructor(current: EmnifySimState, requested: EmnifySimState) {
		super(`Cannot transition from ${STATE_NAMES[current]} (${current}) to ${STATE_NAMES[requested]} (${requested})`);
		this.name = "EmnifyInvalidStateTransitionError";
		this.currentState = `${current} - ${STATE_NAMES[current]}`;
		this.requestedState = `${requested} - ${STATE_NAMES[requested]}`;
	}
}

export class EmnifySimNotFoundError extends Error {
	constructor(iccid: string) {
		super(`SIM not found on Emnify: ${iccid}`);
		this.name = "EmnifySimNotFoundError";
	}
}

export class EmnifyClient {
	readonly #applicationToken?: string;
	readonly #organisationId: string;
	readonly #serviceProfileId: number;
	readonly #tariffProfileId: number;
	readonly #fetch: typeof fetch;

	constructor(config: EmnifyClientConfig) {
		this.#applicationToken = config.applicationToken;
		this.#organisationId = config.organisationId ?? DEFAULT_ORGANISATION_ID;
		this.#serviceProfileId = config.serviceProfileId ?? DEFAULT_SERVICE_PROFILE_ID;
		this.#tariffProfileId = config.tariffProfileId ?? DEFAULT_TARIFF_PROFILE_ID;
		this.#fetch = config.fetchFn ?? fetch;
	}

	async updateSimState(iccid: string, state: EmnifySimState): Promise<void> {
		const jwt = await this.#authenticate();
		const sim = await this.#findSimByIccid(iccid, jwt);
		const currentState = sim.status.id;
		if (!isValidTransition(currentState, state)) throw new EmnifyInvalidStateTransitionError(currentState, state);

		const response = await this.#fetch(`${EMNIFY_API_BASE}/sim/${sim.id}`, {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${jwt}`,
			},
			body: JSON.stringify({ status: { id: state } }),
		});
		if (response.status !== 204) throw new EmnifyApiError(response.status, response.statusText, "Failed to update Emnify SIM status");
	}

	async activateSim(input: EmnifyActivationInput): Promise<EmnifyActivationResponse> {
		const jwt = await this.#authenticate();
		if (input.bic === REGISTERED_PRIOR) {
			await this.#alreadyRegisteredActivation(input.iccid, input.box, jwt);
		} else {
			let activationBic = encodeURIComponent(input.bic);
			if (!activationBic.startsWith("%23")) activationBic = `%23${activationBic}`;

			const simResponse = await this.#fetch(`${EMNIFY_API_BASE}/sim_batch/bic/${activationBic}`, {
				method: "GET",
				headers: { Authorization: `Bearer ${jwt}` },
			});

			if (simResponse.status === 400) {
				await this.#alreadyRegisteredActivation(input.iccid, input.box, jwt);
			} else if (simResponse.status === 200) {
				const registerResponse = await this.#fetch(`${EMNIFY_API_BASE}/sim_batch/bic/${activationBic}`, {
					method: "PATCH",
					headers: {
						"Content-Type": "application/json",
						Authorization: `Bearer ${jwt}`,
					},
					body: JSON.stringify({ sim_status: { id: 1 } }),
				});
				if (!registerResponse.ok) {
					throw new EmnifyApiError(registerResponse.status, registerResponse.statusText, await registerResponse.text());
				}
				await this.#createEndpointAndActivateSim(input.iccid, input.box, jwt);
			} else {
				throw new EmnifyApiError(simResponse.status, simResponse.statusText, await simResponse.text());
			}
		}

		return { status: 200, message: "Emnify SIM Activated Successfully" };
	}

	async getCosts(input: { startDate?: string; endDate?: string }): Promise<EmnifyCostsResponse> {
		const jwt = await this.#authenticate();
		const dailyUrl = new URL(`${EMNIFY_API_BASE}/organisation/${this.#organisationId}/stats/daily`);
		if (input.startDate !== undefined) dailyUrl.searchParams.append("start_date", dateOnly(input.startDate));
		if (input.endDate !== undefined) dailyUrl.searchParams.append("end_date", dateOnly(input.endDate));

		const dailyResponse = await this.#fetch(dailyUrl.toString(), {
			method: "GET",
			headers: { Authorization: `Bearer ${jwt}` },
		});
		if (!dailyResponse.ok) throw new EmnifyApiError(dailyResponse.status, dailyResponse.statusText);
		await dailyResponse.json();

		const monthlyResponse = await this.#fetch(`${EMNIFY_API_BASE}/organisation/${this.#organisationId}/stats`, {
			method: "GET",
			headers: { Authorization: `Bearer ${jwt}` },
		});
		if (!monthlyResponse.ok) throw new EmnifyApiError(monthlyResponse.status, monthlyResponse.statusText);
		const monthlyData = await monthlyResponse.json();
		return processEmnifyData(monthlyData);
	}

	async #authenticate(): Promise<string> {
		if (!this.#applicationToken) throw new EmnifyCredentialsNotConfiguredError();
		const response = await this.#fetch(`${EMNIFY_API_BASE}/authenticate`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ application_token: this.#applicationToken }),
		});
		if (!response.ok) throw new EmnifyApiError(response.status, response.statusText, "Emnify authentication failed");
		const data = (await response.json()) as { auth_token?: string };
		if (!data.auth_token) throw new EmnifyApiError(response.status, response.statusText, "Failed to obtain authentication token from Emnify");
		return data.auth_token;
	}

	async #findSimByIccid(iccid: string, jwt: string): Promise<EmnifySimRecord> {
		const response = await this.#fetch(`${EMNIFY_API_BASE}/sim?q=iccid_with_luhn:${iccid}`, {
			method: "GET",
			headers: { Authorization: `Bearer ${jwt}` },
		});
		if (!response.ok) throw new EmnifySimNotFoundError(iccid);
		const data = await response.json();
		const sim = Array.isArray(data) ? data[0] : (data as { data?: unknown[] })?.data?.[0];
		if (!sim) throw new EmnifySimNotFoundError(iccid);
		return sim as EmnifySimRecord;
	}

	async #alreadyRegisteredActivation(iccid: string, box: EmnifyActivationInput["box"], jwt: string): Promise<void> {
		const sim = await this.#findSimByIccid(iccid, jwt);
		const endpointResponse = await this.#fetch(`${EMNIFY_API_BASE}/endpoint?q=iccid_with_luhn:${sim.iccid ?? iccid}&per_page=1`, {
			method: "GET",
			headers: { Authorization: `Bearer ${jwt}` },
		});
		if (!endpointResponse.ok) throw new EmnifyApiError(endpointResponse.status, endpointResponse.statusText, "Failed to fetch endpoint");
		const endpointData = await endpointResponse.json();
		const endpoint = (endpointData as { data?: EmnifyEndpointRecord[] })?.data?.[0];

		if (!endpoint?.sim?.id) {
			await this.#createEndpointAndActivateSim(iccid, box, jwt);
			return;
		}

		const activateResponse = await this.#fetch(`${EMNIFY_API_BASE}/endpoint/${endpoint.id}`, {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${jwt}`,
			},
			body: JSON.stringify({
				status: { id: 0 },
				sim: { id: endpoint.sim.id, status: { id: 1 } },
			}),
		});
		if (!activateResponse.ok) throw new EmnifyApiError(activateResponse.status, activateResponse.statusText, await activateResponse.text());
	}

	async #createEndpointAndActivateSim(iccid: string, box: EmnifyActivationInput["box"], jwt: string): Promise<void> {
		const response = await this.#fetch(`${EMNIFY_API_BASE}/endpoint`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${jwt}`,
			},
			body: JSON.stringify({
				name: box.serialNumber,
				tags: `B-FEWS ${capitalizeFirstLetter(box.boxTypeId)}`,
				sim: { iccid_with_luhn: iccid, activate: true },
				status: { id: 0 },
				service_profile: { id: this.#serviceProfileId },
				tariff_profile: { id: this.#tariffProfileId },
			}),
		});
		if (!response.ok) throw new EmnifyApiError(response.status, response.statusText, await response.text());
	}
}

export function createEmnifyClient(config: EmnifyClientConfig): EmnifyClient {
	return new EmnifyClient(config);
}

export function isValidTransition(from: EmnifySimState, to: EmnifySimState): boolean {
	if (from === to) return false;
	switch (from) {
		case 0:
			return to === 1 || to === 4;
		case 1:
			return to === 2;
		case 2:
			return to === 1;
		case 4:
			return to === 1;
	}
}

function processEmnifyData(monthlyData: any): EmnifyCostsResponse {
	const currentMonthCost = Number.parseFloat(monthlyData.current_month?.data?.cost) || 0;
	const hostingFees = Number.parseFloat(monthlyData.hosting_fees) || 0;
	const now = new Date();
	const startOfCurrentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
	const daysPassed = Math.floor((now.getTime() - startOfCurrentMonth.getTime()) / (1000 * 60 * 60 * 24)) + 1;
	const dailyUsageCost = daysPassed > 0 ? currentMonthCost / daysPassed : 0;
	const costByDate: EmnifyCostByDate[] = [];
	let totalCost = hostingFees;

	const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0] ?? "";
	costByDate.push({ date: firstOfMonth, amount: hostingFees + dailyUsageCost });
	for (let i = 1; i < daysPassed; i += 1) {
		const date = new Date(now.getFullYear(), now.getMonth(), i + 1).toISOString().split("T")[0] ?? "";
		costByDate.push({ date, amount: dailyUsageCost });
		totalCost += dailyUsageCost;
	}
	costByDate.sort((a, b) => a.date.localeCompare(b.date));

	return {
		totalCost,
		costByDate,
		service: {
			service: "Emnify: SIMs & Cellular Data",
			amount: totalCost,
			percentage: 0,
			color: SERVICE_COLOR,
			provider: "emnify",
		},
	};
}

function dateOnly(date: string): string {
	return new Date(date).toISOString().split("T")[0] ?? date;
}

function capitalizeFirstLetter(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}

