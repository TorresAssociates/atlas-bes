import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { AwsCredentialIdentity } from "@smithy/types";

export interface PresignGetObjectInput {
	bucket: string;
	key: string;
	/** Overrides the Content-Type S3 sends back, so playback doesn't depend on what ingest set on the object. */
	responseContentType?: string;
	/** Seconds until the URL expires. Defaults to one hour. */
	expiresIn?: number;
}

export interface S3UrlSignerConfig {
	region?: string;
	/** Static credentials; omit to use the SDK default chain. */
	credentials?: AwsCredentialIdentity;
	client?: S3Client;
}

const DEFAULT_EXPIRES_IN_SECONDS = 3600;

/**
 * Mints presigned GET URLs. BES never streams object bytes — it hands the
 * client a URL and the client fetches from S3/CloudFront directly.
 */
export class S3UrlSigner {
	readonly #client: S3Client;

	constructor(config: S3UrlSignerConfig = {}) {
		this.#client =
			config.client ??
			new S3Client({ region: config.region, credentials: config.credentials });
	}

	presignGetObject(input: PresignGetObjectInput): Promise<string> {
		const command = new GetObjectCommand({
			Bucket: input.bucket,
			Key: input.key,
			...(input.responseContentType
				? { ResponseContentType: input.responseContentType }
				: {}),
		});
		return getSignedUrl(this.#client, command, {
			expiresIn: input.expiresIn ?? DEFAULT_EXPIRES_IN_SECONDS,
		});
	}
}

export function createS3UrlSigner(config: S3UrlSignerConfig = {}): S3UrlSigner {
	return new S3UrlSigner(config);
}
