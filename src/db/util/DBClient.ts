import { DatabaseError, Pool, type PoolClient, type PoolConfig, type QueryConfig, type QueryResult, type QueryResultRow } from "pg";
import type { Logger } from "pino";
import type { ConnectionOptions } from "tls";

/** The credentials needed to log into the database */
export interface DatabaseCredentials {
    user: string,
    password: string,
    host: string,
    port: number,
    database: string,
}

/**
 * Used to ensure that at least one of two things is included
 * Source: https://stackoverflow.com/questions/40510611/typescript-interface-require-one-of-two-properties-to-exist
 */
type RequireAtLeastOne<T, Keys extends keyof T = keyof T> =
    Pick<T, Exclude<keyof T, Keys>> 
    & {
        [K in Keys]-?: Required<Pick<T, K>> & Partial<Pick<T, Exclude<Keys, K>>>
    }[Keys];

/**
 * These are the configs used for pool/credential configuration for the DBClient.
 */
export interface DBClientPoolConfig {
    /**
     * The configuration for the pool. Must set the maxLifetimeSeconds or maxUses for when the pool should expire, or
     * leave one of them as 0 to never expire. 
     * 
     * Database connection information and SSL information is also specified here. If functions are specified for 
     * credential/ssl rotation, then specified credentials will be trated as default/initial credentials. If not 
     * specified, but the functions are, the functions will be used to retrieve them initially.
     * 
     * Note: If the credentials do not expire, the authentication is not revoked on a database credential change. 
     * The expiration is so that it can connect with the new credentials, and old logins can be phased out over time.
     * 
     * @default {maxLifetimeSeconds: 604800} // 1 week
     */
    poolConfig?: PoolConfig; // ({maxLifetimeSeconds: number, maxUses?: number} | {maxLifetimeSeconds?: number, maxUses: number});
    /**
     * When retrying a connection to the database due to a connection failure, this is the max wait time (in ms) 
     * it will wait before trying again. The system will use random exponential backoff with jitter for waiting 
     * for reconnection.
     * 
     * Can be set to 0 for no delay in connection retry.
     * 
     * @default 10000 // ms
     */
    maxRetryWaitTime?: number;
    /**
     * This is the time (in seconds) after the pool is initialized at it will try to automatically switch to a different pool.
     * 
     * This is intended to be used to rotate the credentials before they become invalid, to maintain always-on connectivity.
     * 
     * Must be < poolConfig.maxLifetimeSeconds to be effective.
     * 
     * @default 302400 // half a week
     */
    maxAutoSwitchTime?: number;
    // maxAutoSwitchUses?: number;
    /**
     * This function is run when switching to the pool to get new pool credentials. It is run when for the pool when it is 
     * switched to, before the pool login is validated.
     * @param previousCredentials The previous credentials used for the pool. If no credentials are used previously, it will be undefined.
     * @throws Error if it is unable to get the credentials. If this function error, it will need to be handled outside of the class.
     * The class itself will not handle it, and it will leave the previous pool as the used one.
     * @returns The credentials to use for the pool.
     */
    onSwitchCredentials?: ((previousCredentials: undefined | DatabaseCredentials) => Promise<DatabaseCredentials>);
    /**
     * This function is run when switching to the pool and the current credentials are no longer valid and fail to login to the 
     * database. On database unauthorized, this function will run to do whatever to fix the current credentials or get a new set of 
     * valid credentials.
     * @param previousCredentials The previous credentials used for the pool. If no credentials are used previously, it will be undefined.
     * @throws Error if it is unable to get the credentials. If this function error, it will need to be handled outside of the class.
     * The class itself will not handle it, and it will leave the previous pool as the used one.
     * @returns The credentials to use for the pool.
     */
    onCredentialUnauthorized?: ((previousCredentials: undefined | DatabaseCredentials) => Promise<DatabaseCredentials>);
    /**
     * This function is run when switching to the pool to get new pool ssl config. It is run when for the pool when it is 
     * switched to, before the pool login is validated.
     * @param previousSslConfig The previous ssl config used for the pool. If no ssl was used previously, it will be undefined.
     * @throws Error if it is unable to get the ssl config. If this function error, it will need to be handled outside of the class.
     * The class itself will not handle it, and it will leave the previous pool as the used one.
     * @returns The ssl config to use for the pool.
     */
    onSwitchSsl?: ((previousSslConfig: boolean | ConnectionOptions | undefined) => Promise<boolean | ConnectionOptions | undefined>);
    /**
     * This function is run when switching to the pool and the current ssl config are no longer valid and fail to login to the 
     * database. On database unauthorized, this function will run to do whatever to fix the current ssl config or get a new set of 
     * valid ssl config.
     * @param previousSslConfig The previous ssl config used for the pool. If no ssl config are used previously, it will be undefined.
     * @throws Error if it is unable to get the ssl config. If this function error, it will need to be handled outside of the class.
     * The class itself will not handle it, and it will leave the previous pool as the used one.
     * @returns The ssl config to use for the pool.
     */
    onSslInvalid?: ((previousSslConfig: boolean | ConnectionOptions | undefined) => Promise<boolean | ConnectionOptions>);
};

/**
 * The properties used to define a DBClient.
 */
export interface DBClientProps {
    /**
     * This is the config that is used when there is no config information provided for the pool specifically.
     */
    defaultConfig?: DBClientPoolConfig;
    /**
     * This is the configuration for pool 0. Any undefined fields will use the value from defaultConfig.
     */
    pool0Config?: DBClientPoolConfig;
    /**
     * This is the configuration for pool 1. Any undefined fields will use the value from defaultConfig.
     */
    pool1Config?: DBClientPoolConfig;
    /**
     * This is the id of the pool that will be active first if specified.
     * 
     * Can only be 0 or 1.
     * 
     * @default 0
     */
    activePoolIndex?: number;
};

/**
 * This class manages a connection to the database using a single user rotation setup.
 * @author Jack Lanois
 */
export class DBClient { // extends ClientBase
    /** Max potential pools/pool configs to use */
    private readonly MAX_POOLS: number = 2;

    /** Track whether or not the client has been initialized */
    private initialized: boolean;
    
    /** The logger used by the system */
    private logger?: Logger;

    /** The list of pool configs to be used by the client for switching between */
    private poolConfigs: DBClientPoolConfig[];

    /** The list of pools to be used by the client for switching between */
    private pools: Pool[];

    /** The refers to the pool that is currently active - 0 for none, 1 for pool1 and 2 for pool2 */
    private activePoolIndex: number;

    /** Function timeout for the function to swap pool credentials */
    private poolSwitchTimeout: (NodeJS.Timeout | undefined)[];

    /** Function timeout for the function to swap pool credentials */
    private poolExponentialBackoffAttempt: number[];

    /** Used to keep track the current promise being used to switch pools for synchronization */
    private usePoolPromise: Promise<void> | undefined;
    /** Used to keep track the current promise being used to switch pools for synchronization */
    private switchPoolsPromise: Promise<void> | undefined;

    /**
     * Used to create a DBClient instance.
     * @param props The parameters for creating the DBClient.
     * @param logger If logging events concerning DB, a Pino logger can be optionally passed in.
     */
    public constructor(
        props: DBClientProps &
        // Ensure at least one defined way to get credentials
        (
            ({defaultConfig: {poolConfig: DatabaseCredentials}})
            |
            ({pool0Config: {poolConfig: DatabaseCredentials}, pool1Config: {poolConfig: DatabaseCredentials}})
            |
            ({defaultConfig: RequireAtLeastOne<DBClientPoolConfig, 'onSwitchCredentials' | 'onCredentialUnauthorized'>})
            |
            ({pool0Config: RequireAtLeastOne<DBClientPoolConfig, 'onSwitchCredentials' | 'onCredentialUnauthorized'>, pool1Config: RequireAtLeastOne<DBClientPoolConfig, 'onSwitchCredentials' | 'onCredentialUnauthorized'>})
        )
        & 
        // Ensure at least one defined way to get SSL
        (
            ({defaultConfig: {poolConfig: {ssl: boolean | ConnectionOptions | undefined}}})
            |
            ({pool0Config: {poolConfig: {ssl: boolean | ConnectionOptions | undefined}}, pool1Config: {poolConfig: {ssl: boolean | ConnectionOptions | undefined}}})
            |
            ({defaultConfig: RequireAtLeastOne<DBClientPoolConfig, 'onSwitchSsl' | 'onSslInvalid'>})
            |
            ({pool0Config: RequireAtLeastOne<DBClientPoolConfig, 'onSwitchSsl' | 'onSslInvalid'>, pool1Config: RequireAtLeastOne<DBClientPoolConfig, 'onSwitchSsl' | 'onSslInvalid'>})
        ),
        logger?: Logger,
    ) {
        // Save the logger to the class
        this.logger = logger;

        // Validate that there is a way to get credentials
        // validated through typing

        // Initialize class arrays for objects
        this.poolConfigs = [];
        this.pools = [];
        this.poolSwitchTimeout = [];
        this.poolExponentialBackoffAttempt = [];

        // Establish Defaults //
        let defaultPoolConfig: DBClientPoolConfig = {};
        if(props.defaultConfig == undefined || props.defaultConfig.poolConfig == undefined) {
            defaultPoolConfig.poolConfig = {maxLifetimeSeconds: 604800};
        } else {
            defaultPoolConfig.poolConfig = structuredClone(props.defaultConfig.poolConfig);
            if(props.defaultConfig.poolConfig.maxLifetimeSeconds == undefined) {
                defaultPoolConfig.poolConfig = {maxLifetimeSeconds: 604800};
            }
        }
        if(props.defaultConfig == undefined || props.defaultConfig.maxRetryWaitTime == undefined) {
            defaultPoolConfig.maxRetryWaitTime = 10000;
        } else {
            defaultPoolConfig.maxRetryWaitTime = props.defaultConfig.maxRetryWaitTime;
        }
        if(props.defaultConfig == undefined || props.defaultConfig.maxAutoSwitchTime == undefined) {
            defaultPoolConfig.maxAutoSwitchTime = defaultPoolConfig.poolConfig!.maxLifetimeSeconds! / 2;
        } else {
            defaultPoolConfig.maxAutoSwitchTime = props.defaultConfig.maxAutoSwitchTime;
        }

        // Set the default pool configuration
        for(let poolIndex = 0; poolIndex < this.MAX_POOLS; poolIndex++) {
            this.poolConfigs.push(structuredClone(defaultPoolConfig));
            // Set the function pointers for any default functions
            if(props.defaultConfig != undefined && props.defaultConfig.onSwitchCredentials != undefined) {
                this.poolConfigs[poolIndex]!.onSwitchCredentials = props.defaultConfig.onSwitchCredentials;
            }
            if(props.defaultConfig != undefined && props.defaultConfig.onCredentialUnauthorized != undefined) {
                this.poolConfigs[poolIndex]!.onCredentialUnauthorized = props.defaultConfig.onCredentialUnauthorized;
            }
            if(props.defaultConfig != undefined && props.defaultConfig.onSwitchSsl != undefined) {
                this.poolConfigs[poolIndex]!.onSwitchSsl = props.defaultConfig.onSwitchSsl;
            }
            if(props.defaultConfig != undefined && props.defaultConfig.onSslInvalid != undefined) {
                this.poolConfigs[poolIndex]!.onSslInvalid = props.defaultConfig.onSslInvalid;
            }

            // No timeout initially and no exponential backoff initially
            this.poolSwitchTimeout[poolIndex] = undefined;
            this.poolExponentialBackoffAttempt[poolIndex] = 0;
        }

        // Set individual pool configuration //
        // Pool 0 Config
        if(props.pool0Config != undefined) {
            if(props.pool0Config.poolConfig != undefined) {
                this.poolConfigs[0]!.poolConfig = structuredClone(props.pool0Config.poolConfig);
            }
            if(props.pool0Config.maxRetryWaitTime != undefined) {
                this.poolConfigs[0]!.maxRetryWaitTime = props.pool0Config.maxRetryWaitTime;
            }
            if(props.pool0Config.maxAutoSwitchTime != undefined) {
                this.poolConfigs[0]!.maxAutoSwitchTime = props.pool0Config.maxAutoSwitchTime;
            }
            if(props.pool0Config.onSwitchCredentials != undefined) {
                this.poolConfigs[0]!.onSwitchCredentials = props.pool0Config.onSwitchCredentials;
            }
            if(props.pool0Config.onCredentialUnauthorized != undefined) {
                this.poolConfigs[0]!.onCredentialUnauthorized = props.pool0Config.onCredentialUnauthorized;
            }
            if(props.pool0Config.onSwitchSsl != undefined) {
                this.poolConfigs[0]!.onSwitchSsl = props.pool0Config.onSwitchSsl;
            }
            if(props.pool0Config.onSslInvalid != undefined) {
                this.poolConfigs[0]!.onSslInvalid = props.pool0Config.onSslInvalid;
            }
        }
        // Pool 1 Config
        if(props.pool1Config != undefined) {
            if(props.pool1Config.poolConfig != undefined) {
                this.poolConfigs[1]!.poolConfig = structuredClone(props.pool1Config.poolConfig);
            }
            if(props.pool1Config.maxRetryWaitTime != undefined) {
                this.poolConfigs[1]!.maxRetryWaitTime = props.pool1Config.maxRetryWaitTime;
            }
            if(props.pool1Config.maxAutoSwitchTime != undefined) {
                this.poolConfigs[1]!.maxAutoSwitchTime = props.pool1Config.maxAutoSwitchTime;
            }
            if(props.pool1Config.onSwitchCredentials != undefined) {
                this.poolConfigs[1]!.onSwitchCredentials = props.pool1Config.onSwitchCredentials;
            }
            if(props.pool1Config.onCredentialUnauthorized != undefined) {
                this.poolConfigs[1]!.onCredentialUnauthorized = props.pool1Config.onCredentialUnauthorized;
            }
            if(props.pool1Config.onSwitchSsl != undefined) {
                this.poolConfigs[1]!.onSwitchSsl = props.pool1Config.onSwitchSsl;
            }
            if(props.pool1Config.onSslInvalid != undefined) {
                this.poolConfigs[1]!.onSslInvalid = props.pool1Config.onSslInvalid;
            }
        }

        // Create the initial pools -- will be replaced once initialized/used
        for(let poolIndex = 0; poolIndex < this.MAX_POOLS; poolIndex++) {
            this.pools.push(new Pool(this.poolConfigs[poolIndex]!.poolConfig!));
        }

        // Save the active pool index and initial pool index
        this.activePoolIndex = props.activePoolIndex != undefined ? props.activePoolIndex : 0;

        // The class variables
        this.usePoolPromise = undefined;
        this.switchPoolsPromise = undefined;
        this.initialized = false;
    }

    /**
     * Returns whether or nott he client is initialized.
     * @returns Whether or nott he client is initialized.
     */
    public isInitialized(): boolean {
        return this.initialized;
    }

    /**
     * Returns the current active pool id. Should be either 0 or 1.
     * @returns the current active pool id. Should be either 0 or 1.
     */
    public getActivePoolIndex(): number {
        return this.activePoolIndex;
    }

    // /**
    //  * Returns the pool config for the specified pool index.
    //  * @param poolIndex The index of which to get the pool from
    //  * @returns The pool config for the requested pool index.
    //  */
    // public getPoolConfig(poolIndex: number): DBClientPoolConfig | undefined {
    //     return this.poolConfigs[poolIndex];
    // }

    /**
     * Returns the database credentials for the pool at the index.
     * @param poolIndex The index of the pool to get the database credentials from.
     * @returns the credentials for the pool at the index.
     */
    private getPoolConfigDatabaseCredentials(poolIndex: number): DatabaseCredentials | undefined {
        if(!(this.poolConfigs[poolIndex]!.poolConfig!.host == undefined
            || this.poolConfigs[poolIndex]!.poolConfig!.port == undefined
            || this.poolConfigs[poolIndex]!.poolConfig!.database == undefined
            || this.poolConfigs[poolIndex]!.poolConfig!.user == undefined
            || this.poolConfigs[poolIndex]!.poolConfig!.password == undefined
        )) {
            return {
                host: this.poolConfigs[poolIndex]!.poolConfig!.host!,
                port: this.poolConfigs[poolIndex]!.poolConfig!.port!,
                database: this.poolConfigs[poolIndex]!.poolConfig!.database!,
                user: this.poolConfigs[poolIndex]!.poolConfig!.user!,
                password: this.poolConfigs[poolIndex]!.poolConfig!.password! as string,
            };
        }
        return undefined;
    }

    /**
     * Used to set new credentials for a pool config. Note: The pool must not be on, or must be reset for changes to take effect.
     * @param poolIndex The index of the pool to update the credentials to.
     * @param newCredentials The updated credentials.
     */
    private setPoolConfigDatabaseCredentials(poolIndex: number, newCredentials: DatabaseCredentials): void {
        this.poolConfigs[poolIndex]!.poolConfig!.host = newCredentials.host;
        this.poolConfigs[poolIndex]!.poolConfig!.port = newCredentials.port;
        this.poolConfigs[poolIndex]!.poolConfig!.database = newCredentials.database;
        this.poolConfigs[poolIndex]!.poolConfig!.user = newCredentials.user;
        this.poolConfigs[poolIndex]!.poolConfig!.password  = newCredentials.password;
    }

    /**
     * Initializes the class by connecting the initial pool.
     * @throws Error if unable to initialize and connect the initial pool.
     */
    public async init(): Promise<void> {
        if(this.logger) {this.logger.info(`Initializing DBClient`);}
        
        // Get the first pool ready
        await this.connectPool(this.activePoolIndex);

        // Start the initial pool's switch triggers
        this.startPoolSwitchTriggers(this.activePoolIndex);

        // The class is now initialized
        this.initialized = true;
        if(this.logger) {this.logger.debug(`Done initializing DBClient`);}
    }

    /**
     * This must be called before the client is destroyed. It is used to
     * stop the timer and release the active pool.
     */
    public async end(): Promise<void> {
        if(this.initialized) {
            if(this.logger) {this.logger.info(`Ending DBClient`);}
            // No longer initialized
            this.initialized = false;
            // End the pool connections
            for(let poolIndex = 0; poolIndex < this.MAX_POOLS; poolIndex++) {
                this.endPoolSwitchTriggers(poolIndex);
                if(!this.pools[poolIndex]!.ended || !this.pools[poolIndex]!.ended) {
                    this.pools[poolIndex]!.end();
                }
            }
        }
    }

    /////////// Methods used for postgres -- made as individual methods for testing ///////////

    protected async connectPoolClient(pool: Pool): Promise<PoolClient> {
        return pool.connect();
    }

    protected releasePoolClient(poolClient: PoolClient, err?: Error | boolean): void {
        return poolClient.release(err);
    }

    protected async queryPoolClient<R extends QueryResultRow = any, I = any[]>(poolClient: PoolClient, query: string, parameters: any[]): Promise<QueryResult<R>> {
        return poolClient.query<R>(query, parameters);
    }

    //////////////////////////////////////////////////////////////////////////////////////////

    /**
     * Used to get the current active pool if there is one.
     * @returns The currently active pool or undefined if there is not one.
     */
    private getActivePool(): Pool {
        return this.pools[this.activePoolIndex]!;
    }

    /**
     * This function is used to wait time between requests, backing off at an exponential rate to 
     * reduce collisions and serve more requests.
     * @param poolIndex The pool index which is backing off/waiting
     */
    private async fullExpnentialBackoffWithJitterWaitTime(poolIndex: number): Promise<void> {
        // https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/

        // Full jitter alg
        // random_between(0, min(cap, base * 2 ^ attempt));

        // The standard wait time in ms
        const BASE: number = 2000;

        // Max retry wait time is in ms
        let maxWaitTime = Math.min(this.poolConfigs[poolIndex]!.maxRetryWaitTime!, BASE * Math.pow(2, this.poolExponentialBackoffAttempt[poolIndex]!));

        // Add 1 tot he backoff for the attempt
        this.poolExponentialBackoffAttempt[poolIndex]! += 1;

        // Get the time to wait
        let waitTime = Math.floor(Math.random() * maxWaitTime); // Math.random() gets between 0 and 1

        if(this.logger) {this.logger.info(`Waiting ${waitTime} ms...`);}
        // Actually wait the amount of time
        return new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    /**
     * Private helper method used to check whether or not an error is a SSL error.
     * @param error The error being checked to see if it's an SSL error
     * @returns Whether or not the error is an SSL error.
     */
    private isSslError(error: any): boolean {
        // Check for database errors related to SSL
        if(error instanceof DatabaseError) {
            // Check cases that are NOT DB auth related
            switch(error.code) {
                case "28000": // "no pg_hba.conf entry for host, ..., no encryption"
                    return true;
            }
        }
        return (error.code != undefined 
            && ( 
                    // Across both
                error.code == "SELF_SIGNED_CERT_IN_CHAIN"
                    // Bun-specific errors
                || error.code == "ERR_BORINGSSL"
                    // node or both specific errors
                || error.code == "UNABLE_TO_GET_ISSUER_CERT"
                || error.code == "UNABLE_TO_GET_CRL"
                || error.code == "UNABLE_TO_DECRYPT_CERT_SIGNATURE"
                || error.code == "UNABLE_TO_DECRYPT_CRL_SIGNATURE"
                || error.code == "UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY"
                || error.code == "CERT_SIGNATURE_FAILURE"
                || error.code == "CRL_SIGNATURE_FAILURE"
                || error.code == "CERT_NOT_YET_VALID"
                || error.code == "CERT_HAS_EXPIRED"
                || error.code == "CRL_NOT_YET_VALID"
                || error.code == "CRL_HAS_EXPIRED"
                || error.code == "ERROR_IN_CERT_NOT_BEFORE_FIELD"
                || error.code == "ERROR_IN_CERT_NOT_AFTER_FIELD"
                || error.code == "ERROR_IN_CRL_LAST_UPDATE_FIELD"
                || error.code == "ERROR_IN_CRL_NEXT_UPDATE_FIELD"
                || error.code == "OUT_OF_MEM"
                || error.code == "DEPTH_ZERO_SELF_SIGNED_CERT"
                || error.code == "DEPTH_ZERO_SELF_SIGNED_CERT"
                || error.code == "UNABLE_TO_GET_ISSUER_CERT_LOCALLY"
                || error.code == "UNABLE_TO_VERIFY_LEAF_SIGNATURE"
                || error.code == "CERT_CHAIN_TOO_LONG"
                || error.code == "CERT_REVOKED"
                || error.code == "INVALID_CA"
                || error.code == "PATH_LENGTH_EXCEEDED"
                || error.code == "INVALID_PURPOSE"
                || error.code == "CERT_UNTRUSTED"
                || error.code == "CERT_REJECTED"
                || error.code == "HOSTNAME_MISMATCH"
            )
            && (error instanceof Error)
        );
    }

    /**
     * Private helper method used to check whether or not an error is a auth error.
     * @param error The error being checked to see if it's an auth error
     * @returns Whether or not the error is an auth error.
     */
    private isAuthError(error: any): boolean {
        if(error instanceof DatabaseError) {
            // Check cases that are NOT DB auth related
            switch(error.code) {
                case "28000": // "no pg_hba.conf entry for host, ..., no encryption"
                    return false;
            }
            return true;
        }
        return false
    }

    /**
     * This stops all the automated triggers for the pool that would cause an automated pool switch.
     * @param poolIndex The index of the pool for which to end the automated triggers.
     */
    private endPoolSwitchTriggers(poolIndex: number) {
        // Reset the timeout used for the pool
        clearTimeout(this.poolSwitchTimeout[poolIndex]);
        this.poolSwitchTimeout[poolIndex] = undefined;
        this.pools[poolIndex]!.removeAllListeners();
        if(this.logger) {this.logger.info(`Cleared timeout`);}
    }

    /**
     * This function is used to start automatic triggers that cause the the DBClient to switch pools.
     * @param poolIndex The index of the pool for which to start the
     */
    private startPoolSwitchTriggers(poolIndex: number) {
        // Make sure it's ended already to not make any new ones
        this.endPoolSwitchTriggers(poolIndex);

        // Timeout for when to switch the pool automatically
        if(this.poolConfigs[poolIndex]!.maxAutoSwitchTime! > 0) {
            if(this.logger) {this.logger.info(`Starting pool switch timer to trigger switch in ${this.poolConfigs[poolIndex]!.maxAutoSwitchTime} seconds`);}

            // Start the pool switch time
            this.poolSwitchTimeout[poolIndex] = setTimeout(async (client: DBClient) => {
                // Switch the pools when the time is ready
                await client.switchPools();
            }, this.poolConfigs[poolIndex]!.maxAutoSwitchTime! * 1000, this); // *1000 to do things in seconds
        } else {
            if(this.logger) {this.logger.info(`No pool switch time set`);}
        }

        // This will switch the pools if there is an error with the connection for some reason
        this.pools[poolIndex]!.on("error", async (error: Error, client: PoolClient) => {
            if(this.logger) {this.logger.warn(error, `Pool error encountered`);}
            await this.switchPools();
        });

        // This will execute when the pool is closed due to maxLifetimeSeconds or maxUses
        this.pools[poolIndex]!.on("remove", async (client: PoolClient) => {
            if(this.logger) {this.logger.info(`Pool remove encountered`);}
            await this.switchPools();
        });
    }

    /**
     * This is used to activate the pool, and connect it to the database.
     * @param poolIndex The pool index to activate.
     */
    private async connectPool(poolIndex: number): Promise<void> {
        // Reset the exponential backoff for the pool
        this.poolExponentialBackoffAttempt[poolIndex] = 0;

        // How many attempts to try getting credentials and connecting to the database -- 1 initial attempt + 3 follow-up attempts
        const MAX_ATTEMPTS: number = 1 + 3;

        // This will be set to true for retrying after an invalid ssl command runs or a unauthorized credential command runs
        let attemptingCredentialsRetry = false;
        let attemptingSslRetry = false;

        // Get initial set of ssl/credentials if none provided already and it can't get them without failing first
        // if onSwitchCredentials is defined
            // will use those to get credentials. Does not matter if initial credentials are specified
        // if onInvalid/onUnauthorized is defined
            // if initial credentials are defined
                // use those instead
            // otherwise, use the onInvalid/onUnauthorized functions to get the initial credentials

        // if no ssl defined, then get the ssl
        if(this.poolConfigs[this.activePoolIndex]!.poolConfig!.ssl === undefined && this.poolConfigs[poolIndex]!.onSwitchSsl == undefined && this.poolConfigs[poolIndex]!.onSslInvalid != undefined) {
            if(this.logger) {this.logger.info(`Running onSslInvalid()`);}
            let newSslConfig: boolean | ConnectionOptions | undefined = undefined;
            newSslConfig = await this.poolConfigs[poolIndex]!.onSslInvalid!(this.poolConfigs[poolIndex]!.poolConfig!.ssl);
            // not catching anything thrown by ^
            // Update the current setup
            this.poolConfigs[poolIndex]!.poolConfig!.ssl = newSslConfig;
        }

        // if no credentials defined, then get the credentials
        if(this.getPoolConfigDatabaseCredentials(poolIndex) == undefined && this.poolConfigs[poolIndex]!.onSwitchCredentials == undefined && this.poolConfigs[poolIndex]!.onCredentialUnauthorized != undefined) {
            if(this.logger) {this.logger.info(`Running onCredentialUnauthorized()`);}
            let newCredentials: DatabaseCredentials | undefined = undefined;
            newCredentials = await this.poolConfigs[poolIndex]!.onCredentialUnauthorized!(this.getPoolConfigDatabaseCredentials(poolIndex));
            // not catching anything thrown by ^
            // Update the current setup
            this.setPoolConfigDatabaseCredentials(poolIndex, newCredentials!);
        }

        // MAX_ATTEMPTS + 1 for original attempt
        for(let attempt = 0; attempt < MAX_ATTEMPTS + 1; (attempt += (attemptingCredentialsRetry || attemptingSslRetry) ? 0 : 1)) {
            // // SSL Setup Handling // //

            // // Get new ssl if needed
            let newSslConfig: boolean | ConnectionOptions | undefined = undefined;
            if(!(attemptingCredentialsRetry || attemptingSslRetry)) {
                if(this.poolConfigs[poolIndex]!.onSwitchSsl != undefined) {
                    if(this.logger) {this.logger.info(`Running onSwitchSsl()`);}
                    // Get the new SSL from the function
                    newSslConfig = await this.poolConfigs[poolIndex]!.onSwitchSsl!(this.poolConfigs[poolIndex]!.poolConfig!.ssl);
                    // not catching anything thrown by ^
                    // Update the current setup
                    this.poolConfigs[poolIndex]!.poolConfig!.ssl = newSslConfig;
                }
            }

            // // Credentials Setup Handling // //

            let newCredentials: DatabaseCredentials | undefined = undefined;
            if(!(attemptingCredentialsRetry || attemptingSslRetry)) {
                if(this.poolConfigs[poolIndex]!.onSwitchCredentials != undefined) {
                    // Get the credentials from the function
                    if(this.logger) {this.logger.info(`Running onSwitchCredentials()`);}
                    newCredentials = await this.poolConfigs[poolIndex]!.onSwitchCredentials!(this.getPoolConfigDatabaseCredentials(poolIndex));
                    // not catching anything thrown by ^
                    // Update the current setup
                    this.setPoolConfigDatabaseCredentials(poolIndex, newCredentials);
                }
            }

            // Create the new pool to be used
            this.pools[poolIndex] = new Pool(this.poolConfigs[poolIndex]!.poolConfig!);
            
            // Check to see if the credentials are valid
            try {
                if(this.logger) {this.logger.info(`Attempting database connection for pool ${poolIndex}`);}
                // attempt to connect with client credentials
                let tempClient = await this.connectPoolClient(this.pools[poolIndex]!);
                if(this.logger) {this.logger.info(`Connected pool to database successfully`);}
                // Release the client since it's not being used any more
                this.releasePoolClient(tempClient);
                // // all good
                break;
            } catch(error) {
                // IF ERROR IS AUTH ERROR (and has function to retry getting the credentials)
                if(this.isAuthError(error)) {
                    if(this.logger) {this.logger.warn(error, `Database error encountered`);}
                    // // auth failed
                    if(this.poolConfigs[poolIndex]!.onCredentialUnauthorized != undefined) {
                        // // is auth retry?
                        if(attemptingCredentialsRetry) {
                            if(this.logger) {this.logger.warn(error, `Credentials retry failed`);}
                            // No longer attempting a retry --> advance the loop check
                            attemptingCredentialsRetry = false;
                            attemptingSslRetry = false;
                            // Wait a bit before trying again
                            await this.fullExpnentialBackoffWithJitterWaitTime(poolIndex);
                        } else {
                            // On Unauthorized Retrieval/rotation function being used (if specified/set)
                            // Get the credentials from the function
                            if(this.logger) {this.logger.info(`Running onCredentialUnauthorized()`);}
                            newCredentials = await this.poolConfigs[poolIndex]!.onCredentialUnauthorized!(this.getPoolConfigDatabaseCredentials(poolIndex));
                            // not catching anything thrown by ^
                            // Update the current setup
                            this.setPoolConfigDatabaseCredentials(poolIndex, newCredentials);
                            // Attempt a retry with new credentials
                            attemptingCredentialsRetry = true;
                        }
                        continue;
                    }
                } else
                // IF ERROR IS SSL ERROR (and has function to retry getting the credentials)
                if(this.isSslError(error)) {
                    // Cast to the error type
                    let sslError: Error & {code: string, errno: number | undefined} = (error as any);
                    if(this.logger) {this.logger.warn(error, `SSL error encountered: ${sslError.code}`);}
                    if(this.poolConfigs[poolIndex]!.onSslInvalid != undefined) {
                        // Check for and cast a tls error
                        if(attemptingSslRetry) {
                            if(this.logger) {this.logger.warn(`Ssl retry failed`);}
                            // No longer attempting a retry --> advance the loop check
                            attemptingCredentialsRetry = false;
                            attemptingSslRetry = false;
                            // Wait a bit before trying again
                            await this.fullExpnentialBackoffWithJitterWaitTime(poolIndex);
                        } else {
                            if(this.logger) {this.logger.info(`Running onSslInvalid()`);}
                            // Get the new SSL from the function
                            newSslConfig = await this.poolConfigs[poolIndex]!.onSslInvalid!(this.poolConfigs[poolIndex]!.poolConfig!.ssl);
                            // not catching anything thrown by ^
                            // Update the current setup
                            this.poolConfigs[poolIndex]!.poolConfig!.ssl = newSslConfig;
                            // Attempt a retry with new ssl config
                            attemptingSslRetry = true;
                        }
                        continue;
                    }
                } else {
                    // Throw anything else
                    if(this.logger) {this.logger.error(error, `Other error encountered`);}
                    throw error;
                }

                // If it's the last attempt, throw the error
                if(attempt == MAX_ATTEMPTS - 1) {
                    throw error;
                }
                // If it gets here (other errors) -- reset and do full retry
                attemptingCredentialsRetry = false;
                attemptingSslRetry = false;
                // Wait a bit before trying again
                await this.fullExpnentialBackoffWithJitterWaitTime(poolIndex);
            }
        }
    }

    /**
     * This is used to set the currently active pool. If trying to use the currently active pool, nothing will happen.
     * @param newActivePoolIndex The pool to start actively using.
     * @throws Error if it could not connect/use the pool at the index.
     */
    public async usePool(newActivePoolIndex: number): Promise<void> {
        // Do not run if not initialized
        if(!this.initialized) {
            throw Error("DBClient is not initialized. Please run the init() method first.");
        }

        // if already using pools, return the already used promise
        if(this.usePoolPromise != undefined) {
            return this.usePoolPromise;
        }

        // Create the promise to return
        this.usePoolPromise = new Promise(async (resolve, reject) => {

            // Ensure the input number is in bounds
            newActivePoolIndex %= this.MAX_POOLS;

            if(newActivePoolIndex == this.activePoolIndex) {
                // if it is the currently active pool, do nothing. Must switch to other pool
                return;
            }

            // Connect the new pool
            if(this.logger) {this.logger.info(`Connecting pool ${newActivePoolIndex}`);}
            try {
                await this.connectPool(newActivePoolIndex);

                // Switch the pools and deactivate the old pool if needed
                if(this.logger) {this.logger.info(`Updating active pool index to ${this.activePoolIndex}`);}
                let prevActiveIndex = this.activePoolIndex;
                this.activePoolIndex = newActivePoolIndex;
                if(!this.pools[prevActiveIndex]!.ending || !this.pools[prevActiveIndex]!.ended) {
                    this.pools[prevActiveIndex]!.end();
                }

                // Clear any previous pool switching attempts
                this.endPoolSwitchTriggers(prevActiveIndex);
                // Start new set of pool switching triggers
                this.startPoolSwitchTriggers(newActivePoolIndex);

                if(this.logger) {this.logger.info(`Now using pool ${newActivePoolIndex}`);}
                resolve(undefined);
            } catch(error) {
                reject(error);
            }
        });

        // Wait for the promise to finish
        await this.usePoolPromise;
        // Clear the previous promise, now that it is done
        this.usePoolPromise = undefined;
        return;
    }

    /**
     * Get new credentials, and switches the active pool to the next one.
     * This should happen before the
     */
    public async switchPools(): Promise<void> {
        // Do not run if not initialized
        if(!this.initialized) {
            throw Error("DBClient is not initialized. Please run the init() method first.");
        }

        // if already switching pools, return the already used promise
        if(this.switchPoolsPromise != undefined) {
            return this.switchPoolsPromise;
        }
        
        // Create the promise to return
        this.switchPoolsPromise = new Promise(async (resolve, reject) => {
            if(this.logger) {this.logger.info(`Switching pools`);}

            // Get the pool id to switch to
            let nextPoolIndex = this.MAX_POOLS - 1 - this.activePoolIndex; // (this.activePoolIndex + 1) % this.MAX_POOLS
            
            // Switch to the other pool
            try {
                await this.usePool(nextPoolIndex);
                if(this.logger) {this.logger.info(`Done switching pools`);}
                resolve(undefined);
            } catch(error) {
                reject(error);
            }
        });

        // Wait for the promise to finish
        await this.switchPoolsPromise;
        // Clear the previous promise, now that it is done
        this.switchPoolsPromise = undefined;
        return;
    }

    // query<T extends Submittable>(queryStream: T): T;
    // // tslint:disable:no-unnecessary-generics

    // query<R extends any[] = any[], I = any[]>(
    //     queryConfig: QueryArrayConfig<I>,
    //     values?: QueryConfigValues<I>,
    // ): Promise<QueryArrayResult<R>>;
    // query<R extends QueryResultRow = any, I = any>(
    //     queryConfig: QueryConfig<I>,
    // ): Promise<QueryResult<R>>;

    // query<R extends QueryResultRow = any, I = any[]>(
    //     queryTextOrConfig: string | QueryConfig<I>,
    //     values?: QueryConfigValues<I>,
    // ): Promise<QueryResult<R>>;
    // query<R extends any[] = any[], I = any[]>(
    //     queryConfig: QueryArrayConfig<I>,
    //     callback: (err: Error, result: QueryArrayResult<R>) => void,
    // ): void;
    // query<R extends QueryResultRow = any, I = any[]>(
    //     queryTextOrConfig: string | QueryConfig<I>,
    //     callback: (err: Error, result: QueryResult<R>) => void,
    // ): void;
    // query<R extends QueryResultRow = any, I = any[]>(
    //     queryText: string,
    //     values: QueryConfigValues<I>,
    //     callback: (err: Error, result: QueryResult<R>) => void,
    // ): void;

    // // public query<T extends Submittable>(queryStream: T): T {
    // //     let client: PoolClient = this.pools[0]!.connect();
    // //     return client.query<T>(queryStream);
    // // }

    // override query<T extends Submittable, R extends any[] = any[], I = any[], R extends QueryResultRow = any>
    // (queryText: unknown, values?: unknown, callback?: unknown): void | T | Promise<QueryArrayResult<R>> | Promise<QueryResult<R>> | Promise<QueryResult<R>> {
    //     //
    // }
    // public query
    // <T extends Submittable, R extends any[] = any[], I = any[]>
    // (queryStream?: T, queryConfig?: QueryArrayConfig<I>, values?: QueryConfigValues<I>,): 
    // T | Promise<QueryArrayResult<R>> {

    private async getPoolClient(): Promise<PoolClient> {
        // Do not run if not initialized
        if(!this.initialized) {
            throw Error("DBClient is not initialized. Please run the init() method first.");
        }
        
        // Do not run if not initialized
        if(!this.initialized) {
            throw Error("DBClient is not initialized. Please run the init() method first.");
        }

        // The client being used from the pool
        let client: PoolClient | undefined = undefined;

        // Used to track whether or not a retry is happening from a newly connected pool
        let newPoolRetry: boolean = false;

        // Reset the exponential backoff for the pool
        this.poolExponentialBackoffAttempt[this.activePoolIndex] = 0;

        // How many attempts to try getting credentials and connecting to the database -- 1 initial attempt + 3 follow-up attempts
        const MAX_ATTEMPTS: number = 1 + 3;

        for(let attempt = 0; attempt < MAX_ATTEMPTS; attempt += newPoolRetry ? 0 : 1) {
            // // Get the client from the pool
            if(this.logger) {this.logger.info(`Getting connection for pool ${this.activePoolIndex}`);}
            try {
                client = await this.connectPoolClient(this.getActivePool());
                // Got the client now, don't need the for loop any more
                break;
            } catch(error) {
                if(this.logger) {this.logger.info(error, `ERRORED GETTING CONNECTION`);}
                // // if failed auth or failed ssl
                if(this.isAuthError(error) || this.isSslError(error)) {
                    // // new pool retry?
                    if(!newPoolRetry) {
                        // Switch pools and try again
                        await this.switchPools();
                        // not catching anything thrown by ^
                        newPoolRetry = true;
                    } else {
                        // Reset the retry variable
                        newPoolRetry = false;
                        // Wait a bit before trying again
                        await this.fullExpnentialBackoffWithJitterWaitTime(this.activePoolIndex);
                    }
                } else {
                    // Throw any unknown errors
                    throw error;
                }
                // Throw the error if its' the last attempt
                if(attempt == MAX_ATTEMPTS - 1) {
                    throw error;
                }
            }
        }

        if(this.logger) {this.logger.info(`Connected to client from pool ${this.activePoolIndex}`);}

        // Return the client
        return client!;
    }

    /**
     * This is used to execute an SQL query.
     * @param query The query. EX: `SELECT * FROM "Box" WHERE "id" = $1`
     * @param parameters The query parameters. EX: [80]
     */
    public async query<T extends QueryResultRow>(query: string | QueryConfig<any[]>, parameters?: any[] | undefined): Promise<QueryResult<T>> {
        // The client being used from the pool
        let client: PoolClient = await this.getPoolClient();

        let response: QueryResult<T> | undefined = undefined;
        try {
            // Run the query
            response = await client!.query<T>(query, parameters);
        } catch(error) {
            // release the client
            if(this.logger) {this.logger.warn(error, `Failed executing query`);}
            this.releasePoolClient(client!);
            if(this.logger) {this.logger.info(`Released pool client`);}
            throw error;
        }
        // Done executing query, release the client
        this.releasePoolClient(client!);
        if(this.logger) {this.logger.info(`Released pool client`);}

        // return the response
        return response;
    }

    /**
     * This is used to perform a transaction. The client provided must be used for the transaction.
     * @param transactionFunction The function with everything to do for the transaction.
     */
    public async transaction(transactionFunction: (client: PoolClient) => Promise<void>): Promise<void> {
        // The client being used from the pool
        let client: PoolClient = await this.getPoolClient();

        // Perform the transaction with the client
        try {
            // Start the transaction
            await client.query(`BEGIN`);
            // Run everything inside the transaction
            await transactionFunction(client);
            // Finish the transaction
            await client.query(`COMMIT`);
            // release the client
            this.releasePoolClient(client!);
        } catch(error) {
            // Rollback the transaction
            await client.query(`ROLLBACK`);
            // release the client
            this.releasePoolClient(client!);
            // throw the error
            throw error;
        }
    }

}