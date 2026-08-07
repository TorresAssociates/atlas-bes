import type {
	HologramActivationResponse,
	HologramClient,
	HologramCostsResponse,
	HologramPlanResponse,
	HologramSimState,
} from "@/lib/hologram/HologramClient";
import {
	HologramApiError,
	HologramCredentialsNotConfiguredError,
	HologramPlanNotFoundError,
} from "@/lib/hologram/HologramClient";

export interface ActivateSimInput {
	iccid: string;
	boxId: string;
}

export interface HologramCostsInput {
	startDate?: string;
	endDate?: string;
	limit?: number;
}

export class HologramRequestFailedError extends Error {
	readonly statusCode: number;

	constructor(message: string, statusCode = 500) {
		super(message);
		this.name = "HologramRequestFailedError";
		this.statusCode = statusCode;
	}
}

export async function updateHologramDeviceState(
	client: HologramClient,
	deviceId: string,
	state: HologramSimState,
): Promise<void> {
	try {
		await client.updateDeviceState(deviceId, state);
	} catch (error) {
		throw toHologramRouteError(error, "Failed to update Hologram SIM Card");
	}
}

export async function activateHologramSim(
	client: HologramClient,
	input: ActivateSimInput,
): Promise<HologramActivationResponse> {
	try {
		return await client.activateSim(input);
	} catch (error) {
		throw toHologramRouteError(error, "Failed to Activate Hologram SIM");
	}
}

export async function getHologramPlan(client: HologramClient): Promise<HologramPlanResponse> {
	try {
		return await client.getGlobalStandardFlatRatePlan();
	} catch (error) {
		throw toHologramRouteError(error, "Failed to fetch Hologram plan data");
	}
}

export async function getHologramCosts(
	client: HologramClient,
	input: HologramCostsInput,
): Promise<HologramCostsResponse> {
	try {
		return await client.getCosts(input);
	} catch (error) {
		throw toHologramRouteError(error, "Failed to fetch Hologram balance data");
	}
}

function toHologramRouteError(error: unknown, fallback: string): HologramRequestFailedError {
	if (error instanceof HologramCredentialsNotConfiguredError) {
		return new HologramRequestFailedError(error.message, 500);
	}
	if (error instanceof HologramPlanNotFoundError) {
		return new HologramRequestFailedError(error.message, 404);
	}
	if (error instanceof HologramApiError) {
		return new HologramRequestFailedError(error.message, error.status);
	}
	return new HologramRequestFailedError(
		error instanceof Error ? `${fallback}: ${error.message}` : fallback,
		500,
	);
}
