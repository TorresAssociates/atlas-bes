import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager"

/**
 * These are the input parameters used for the AwsSecretRetriever class.
 */
export interface AwsSecretRetrieverProps {
    /**
     * This is the region to override with, if a custom region is to be used.
     */
    awsRegionOverride?: string;
    /**
     * The aws iam account access key id to override with if using one. Must also include aws region and secret access key if overriding.
     */
    awsAccessKeyIdOverride?: string;
    /**
     * The aws iam account secret access key to override with if using one. Must also include aws region and access key id if overriding.
     */
    awsSecretAccessKeyOverride?: string
};

/**
 * This class is used to grab secrets from AWS and cache them.
 * 
 * @author Jack Lanois
 */
export class AwsSecretRetriever {
    /** The client dealing with AWS SecretsManager */
    private client: SecretsManagerClient;

    /** Stores cached secrets */
    private cachedSecrets: {[secretName: string]: {[versionStage: string]: string | undefined}};

    /**
     * This is used to create the object. It is private so that it enforces the singleton pattern.
     * @param awsRegionOverride 
     * @param awsAccessKeyIdOverride 
     * @param awsSecretAccessKeyOverride 
     */
    public constructor(awsSecretRetrieverProps?: AwsSecretRetrieverProps) {
        // Connect the secrets client object depending on the credentials provided
        if(awsSecretRetrieverProps != undefined && (awsSecretRetrieverProps.awsAccessKeyIdOverride || awsSecretRetrieverProps.awsSecretAccessKeyOverride)) {
            this.client = new SecretsManagerClient({
                region: awsSecretRetrieverProps.awsRegionOverride, 
                credentials: {
                    accessKeyId: awsSecretRetrieverProps.awsAccessKeyIdOverride!,
                    secretAccessKey: awsSecretRetrieverProps.awsSecretAccessKeyOverride!
                }
            });
        } else if(awsSecretRetrieverProps != undefined && (awsSecretRetrieverProps.awsRegionOverride)) {
            this.client = new SecretsManagerClient({
                region: process.env.AWS_REGION_OVERRIDE,
                // USING DEFAULT CREDENTIALS
            });
        } else {
            // Create it with the default credentials
            this.client = new SecretsManagerClient()
        }

        // Initialize the class variables
        this.cachedSecrets = {};
    }

    /**
     * This function is used to retrieve a secret from the AWS secret manager and cache it. 
     * An updated/new secret can be retrieved if needed.
     * @param secretId The id of the secret in AWS Secret Manager.
     * @param versionStage The version/stage of the secret to get from AWS.
     * @throws Error if unable to retrieve the secret from AWS secret manager. For a list of 
     * errors, see https://docs.aws.amazon.com/secretsmanager/latest/apireference/API_GetSecretValue.html.
     * @returns The secret that was requested or undefined if it was not able to retrieve it.
     */
    public async retrieveSecret(secretId: string, versionStage: string = "AWSCURRENT"): Promise<string | undefined> {
        // Get the secret
        let response = await this.client.send(
            new GetSecretValueCommand({
                SecretId: secretId,
                VersionStage: versionStage, // VersionStage defaults to AWSCURRENT if unspecified
                // VersionStage: "AWSCURRENT", 
                // VersionStage: "AWSPREVIOUS"
                // VersionId: versionId, 
            })
        );
        // Store the key value json to the object
        if(this.cachedSecrets[secretId] == undefined) {
            this.cachedSecrets[secretId] = {};
        }
        this.cachedSecrets[secretId]![versionStage] = response.SecretString;

        // Return anything that was found
        return response.SecretString;
    }

    /**
     * This is used to get a previously retrieved secret which was cached.
     * @param secretName The name of the secret to get.
     * @param versionStage The secret version stage to get. Defaults to "AWSCURRENT".
     * @returns The cached secret or undefined if there isnt one.
     */
    public getCachedSecret(secretName: string, versionStage: string = "AWSCURRENT"): string | undefined {
        let cachedSecret = this.cachedSecrets[secretName];
        if(cachedSecret != undefined) {
            return cachedSecret[versionStage];
        }
        return undefined;
    }
}
