import type {
	EmnifyActivationInput,
	EmnifyActivationResponse,
	EmnifyClient,
	EmnifyCostsResponse,
	EmnifySimState,
} from "@/lib/emnify/EmnifyClient";
import {
	EmnifyApiError,
	EmnifyCredentialsNotConfiguredError,
	EmnifyInvalidStateTransitionError,
	EmnifySimNotFoundError,
} from "@/lib/emnify/EmnifyClient";

export type ActivateSimInput = EmnifyActivationInput;

export interface EmnifyCostsInput {
	startDate?: string;
	endDate?: string;
}

export class EmnifyRequestFailedError extends Error {
	readonly statusCode: number;
	readonly currentState?: string;
	readonly requestedState?: string;

	constructor(
		message: string,
		statusCode = 500,
		stateDetails?: { currentState: string; requestedState: string },
	) {
		super(message);
		this.name = "EmnifyRequestFailedError";
		this.statusCode = statusCode;
		this.currentState = stateDetails?.currentState;
		this.requestedState = stateDetails?.requestedState;
	}
}

export async function updateEmnifySimState(
	client: EmnifyClient,
	iccid: string,
	state: EmnifySimState,
): Promise<void> {
	try {
		await client.updateSimState(iccid, state);
	} catch (error) {
		throw toEmnifyRouteError(error, "Failed to update Emnify SIM Card");
	}
}

export async function activateEmnifySim(
	client: EmnifyClient,
	input: ActivateSimInput,
): Promise<EmnifyActivationResponse> {
	try {
		return await client.activateSim(input);
	} catch (error) {
		throw toEmnifyRouteError(error, "Failed to Activate Emnify SIM");
	}
}

export async function getEmnifyCosts(
	client: EmnifyClient,
	input: EmnifyCostsInput,
): Promise<EmnifyCostsResponse> {
	try {
		return await client.getCosts(input);
	} catch (error) {
		throw toEmnifyRouteError(error, "Failed to fetch Emnify cost data");
	}
}

function toEmnifyRouteError(error: unknown, fallback: string): EmnifyRequestFailedError {
	if (error instanceof EmnifyCredentialsNotConfiguredError) {
		return new EmnifyRequestFailedError(error.message, 500);
	}
	if (error instanceof EmnifyInvalidStateTransitionError) {
		return new EmnifyRequestFailedError(error.message, 400, {
			currentState: error.currentState,
			requestedState: error.requestedState,
		});
	}
	if (error instanceof EmnifySimNotFoundError) {
		return new EmnifyRequestFailedError(error.message, 404);
	}
	if (error instanceof EmnifyApiError) {
		return new EmnifyRequestFailedError(error.message, error.status);
	}
	return new EmnifyRequestFailedError(
		error instanceof Error ? `${fallback}: ${error.message}` : fallback,
		500,
	);
}
