import { createHash, createHmac } from "node:crypto";
import { defaultProvider } from "@aws-sdk/credential-provider-node";
import { SignatureV4 } from "@smithy/signature-v4";
import type { Checksum, HttpRequest, Provider } from "@smithy/types";

type SourceData = string | ArrayBuffer | ArrayBufferView;

export interface MqtxClientConfig {
	hostname?: string;
	region?: string;
	fetchFn?: typeof fetch;
}

export interface MqtxResponse {
	status: number;
	success: boolean;
	body: string;
}

const DEFAULT_MQTX_HOSTNAME = "mqtx.torresassociates.com";
const DEFAULT_MQTX_REGION = "us-east-1";
const EXECUTE_API_SERVICE = "execute-api";

class NodeSha256 implements Checksum {
	readonly #secret?: SourceData;
	#chunks: Uint8Array[] = [];

	constructor(secret?: SourceData) {
		this.#secret = secret;
	}

	update(chunk: Uint8Array): void {
		this.#chunks.push(chunk);
	}

	reset(): void {
		this.#chunks = [];
	}

	async digest(): Promise<Uint8Array> {
		const chunks = this.#chunks.map((chunk) => Buffer.from(chunk));
		const output =
			this.#secret === undefined
				? createHash("sha256").update(Buffer.concat(chunks)).digest()
				: createHmac("sha256", toBuffer(this.#secret))
						.update(Buffer.concat(chunks))
						.digest();
		return new Uint8Array(output);
	}
}

export class MqtxClient {
	readonly #hostname: string;
	readonly #fetch: typeof fetch;
	readonly #signer: SignatureV4;

	constructor(config: MqtxClientConfig = {}) {
		this.#hostname = config.hostname ?? DEFAULT_MQTX_HOSTNAME;
		this.#fetch = config.fetchFn ?? fetch;
		this.#signer = new SignatureV4({
			credentials: defaultProvider() as Provider<never>,
			region: config.region ?? DEFAULT_MQTX_REGION,
			service: EXECUTE_API_SERVICE,
			sha256: NodeSha256,
		});
	}

	async sendStateUpdate(
		deviceId: string,
		version: string,
		payload: unknown,
	): Promise<MqtxResponse> {
		return this.#post(`/${version}/${deviceId}/state/update/in`, payload);
	}

	async sendConfigUpdate(
		deviceId: string,
		version: string,
		payload: unknown,
	): Promise<MqtxResponse> {
		return this.#post(`/${version}/${deviceId}/config/update/in`, payload);
	}

	async sendDataGet(
		deviceId: string,
		version: string,
		codes: string[],
	): Promise<MqtxResponse> {
		return this.#post(`/${version}/${deviceId}/data/get/in`, { codes });
	}

	async sendV1LightsCommand(
		deviceId: string,
		command: "ON" | "OFF",
	): Promise<MqtxResponse> {
		return this.#post(`/v1/lights/${deviceId}`, {
			command,
			source: "frontend",
		});
	}

	async sendPing(deviceId: string, version: string): Promise<MqtxResponse> {
		return this.#post(`/${version}/${deviceId}/ping/in`);
	}

	async #post(path: string, payload?: unknown): Promise<MqtxResponse> {
		const body =
			payload === undefined ? undefined : JSON.stringify(payload);
		const request: HttpRequest = {
			method: "POST",
			protocol: "https:",
			hostname: this.#hostname,
			path,
			headers: {
				host: this.#hostname,
				...(body === undefined
					? {}
					: { "content-type": "application/json" }),
			},
			body,
		};
		const signedRequest = await this.#signer.sign(request);
		const response = await this.#fetch(
			`https://${signedRequest.hostname}${signedRequest.path}`,
			{
				method: signedRequest.method,
				headers: signedRequest.headers,
				body: signedRequest.body as string | undefined,
			},
		);
		return {
			status: response.status,
			success: response.ok,
			body: await response.text(),
		};
	}
}

export function createMqtxClient(config: MqtxClientConfig = {}): MqtxClient {
	return new MqtxClient(config);
}

function toBuffer(data: SourceData): Buffer {
	if (typeof data === "string") return Buffer.from(data);
	if (ArrayBuffer.isView(data))
		return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
	return Buffer.from(data);
}
