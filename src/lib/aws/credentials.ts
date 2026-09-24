import type { AwsCredentialIdentity } from "@smithy/types";

export interface AwsCredentialOverrides {
	awsAccessKeyIdOverride?: string;
	awsSecretAccessKeyOverride?: string;
}

/**
 * Static credentials from the *_OVERRIDE env vars, for local development
 * without an `aws login` session. Returns undefined when they are not set so
 * every AWS client falls through to the SDK default chain (the ECS task role
 * in Fargate).
 */
export function staticAwsCredentials(
	overrides: AwsCredentialOverrides = {},
): AwsCredentialIdentity | undefined {
	const { awsAccessKeyIdOverride, awsSecretAccessKeyOverride } = overrides;
	if (!awsAccessKeyIdOverride || !awsSecretAccessKeyOverride) return undefined;
	return { accessKeyId: awsAccessKeyIdOverride, secretAccessKey: awsSecretAccessKeyOverride };
}
