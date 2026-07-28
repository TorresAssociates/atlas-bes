import autoload from "@fastify/autoload";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import sensible from "@fastify/sensible";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import type { TypeBoxTypeProvider } from "@fastify/type-provider-typebox";
import underPressure from "@fastify/under-pressure";
import { Type } from "@sinclair/typebox";
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from "fastify";
import type { Kysely } from "kysely";
import type pg from "pg";
import { configPlugin } from "@/config";
import { createDb, createPool } from "@/db";
import type { DB } from "@/db/types";

declare module "fastify" {
    interface FastifyInstance {
        pool: pg.Pool | null;
        db: Kysely<DB> | null;
    }
}

export interface BuildAppOptions {
    /**
     * Set false to build the app without a database pool (unit tests hitting
     * routes that don't touch the DB). Defaults to true.
     */
    database?: boolean;
    /**
     * Inject an existing pool (e.g. testcontainers). The caller owns its
     * lifecycle; buildApp only closes pools it created itself.
     */
    pool?: pg.Pool;
    /** Logger override for tests — pass false to silence. */
    logger?: boolean;
}

const READINESS_PROBE_INTERVAL_MS = 5_000;

/**
 * Builds a fully configured Fastify instance WITHOUT listening, so tests can
 * use app.inject() against it.
 */
export async function buildApp(
    opts: BuildAppOptions = {},
): Promise<FastifyInstance> {
    const app = Fastify({
        // The logger must be configured at instantiation, before @fastify/env has
        // validated LOG_LEVEL, so it reads the raw env var here.
        logger:
            opts.logger === false
                ? false
                : { level: process.env.LOG_LEVEL ?? "info" },
    }).withTypeProvider<TypeBoxTypeProvider>();

    await app.register(configPlugin);
    await app.register(sensible);
    // Cross-origin setup: the frontend is served separately (AWS Amplify).
    // Explicit origin allowlist — a wildcard is invalid with credentials.
    await app.register(cors, {
        origin: [app.config.FRONTEND_ORIGIN],
        credentials: true,
    });
    // CSP disabled: this service serves JSON, not pages, and helmet's default
    // CSP breaks the swagger-ui pages at /docs. Everything else stays on.
    await app.register(helmet, { contentSecurityPolicy: false });
    await app.register(cookie);
    await app.register(rateLimit, { max: 100, timeWindow: "1 minute" });
    // maxEventLoopDelay: 0 disables load shedding on purpose — no production
    // numbers exist yet, and an uncalibrated threshold either sheds traffic
    // that could have been served or never fires at all. Registering the plugin
    // anyway keeps its metrics (app.memoryUsage()) available, so a real
    // threshold can be chosen from measurements later.
    await app.register(underPressure, { maxEventLoopDelay: 0 });

    await app.register(swagger, {
        openapi: {
            info: {
                title: "ATLASRain BES",
                description:
                    "Backend Engine Service for the ATLASRain flood monitoring platform",
                version: "0.1.0",
            },
        },
    });
    await app.register(swaggerUi, { routePrefix: "/docs" });

    // Pool creation lives after configPlugin so DATABASE_URL is validated.
    const createdPool =
        opts.database === false || opts.pool
            ? null
            : createPool(app.config.DATABASE_URL);
    const pool = opts.pool ?? createdPool;
    app.decorate("pool", pool);
    // Kysely rides on the same pg pool (no separate connections, no lifecycle
    // of its own — closing the pool is enough). Modules query through app.db.
    app.decorate("db", pool ? createDb(pool) : null);

    if (createdPool) {
        app.addHook("onClose", async (instance) => {
            instance.log.info("shutdown: closing database pool");
            await createdPool.end();
            instance.log.info("shutdown: database pool closed");
        });
    }

    registerHealthRoutes(app, pool);

    // Domain modules self-register. Only routes.ts files are loaded — each
    // module's service.ts / queries.ts / schemas.ts are plain imports, not
    // Fastify plugins. The module directory name becomes the route prefix under /v1 (clients → /v1/clients).
    await app.register(autoload, {
        dir: new URL("./modules", import.meta.url).pathname,
        matchFilter: (path) => path.endsWith("routes.ts"),
        options: { prefix: "/v1" },
    });

    return app;
}

function registerHealthRoutes(
    app: FastifyInstance,
    pool: pg.Pool | null,
): void {
    // Shared route options: /health and /ready are exempt from rate limiting
    // (config.rateLimit: false) and from request logging (logLevel: "silent").
    const probeRouteOptions = {
        config: { rateLimit: false },
        logLevel: "silent" as const,
    };

    // Liveness only — no database, no S3, no other dependencies. This is the ALB target:
    // if it depended on Aurora, a database blip would fail every task at once
    // and ECS would kill the whole fleet.
    app.route({
        method: "GET",
        url: "/health",
        ...probeRouteOptions,
        schema: {
            tags: ["infra"],
            response: {
                200: Type.Object({ status: Type.Literal("ok") }),
            },
        },
        handler: async () => ({ status: "ok" as const }),
    });

    // Readiness: reflects a database probe that runs on an interval, NOT per
    // request, so a scrape storm cannot amplify load on the pool. For
    // deployment gating and diagnostics only — never wire this to the ALB.
    const readiness = {
        ok: false,
        lastCheckedAt: null as string | null,
        error: null as string | null,
    };

    if (pool) {
        const probe = async (log: FastifyBaseLogger) => {
            try {
                await pool.query("SELECT 1");
                readiness.ok = true;
                readiness.error = null;
            } catch (err) {
                readiness.ok = false;
                readiness.error =
                    err instanceof Error ? err.message : String(err);
                log.warn({ err }, "readiness probe failed");
            }
            readiness.lastCheckedAt = new Date().toISOString();
        };

        void probe(app.log);
        const timer = setInterval(
            () => void probe(app.log),
            READINESS_PROBE_INTERVAL_MS,
        );
        app.addHook("onClose", () => clearInterval(timer));
    }

    const readyResponse = Type.Object({
        status: Type.Union([Type.Literal("ready"), Type.Literal("not ready")]),
        database: Type.Object({
            ok: Type.Boolean(),
            lastCheckedAt: Type.Union([Type.String(), Type.Null()]),
            error: Type.Union([Type.String(), Type.Null()]),
        }),
    });

    app.route({
        method: "GET",
        url: "/ready",
        ...probeRouteOptions,
        schema: {
            tags: ["infra"],
            response: { 200: readyResponse, 503: readyResponse },
        },
        handler: async (_request, reply) => {
            const body = {
                status: readiness.ok
                    ? ("ready" as const)
                    : ("not ready" as const),
                database: {
                    ok: readiness.ok,
                    lastCheckedAt: readiness.lastCheckedAt,
                    error: pool
                        ? readiness.error
                        : "no database pool configured",
                },
            };
            return reply.code(readiness.ok ? 200 : 503).send(body);
        },
    });
}

export async function start(): Promise<void> {
    const app = await buildApp();

    // 127.0.0.1 in development so the server is not exposed on the LAN;
    // 0.0.0.0 in production so the container port is reachable from the ALB.
    const host =
        process.env.NODE_ENV === "production" ? "0.0.0.0" : "127.0.0.1";
    await app.listen({ port: app.config.PORT, host });

    // ECS sends SIGTERM on deploy/scale-in. Stop accepting connections, drain
    // in-flight requests via app.close() (which also runs the onClose hooks
    // that close the pool), then exit. Re-entrancy guard so a second signal
    // doesn't interleave a second shutdown with the first.
    let shuttingDown = false;
    const shutdown = async (signal: NodeJS.Signals) => {
        if (shuttingDown) {
            app.log.warn(
                { signal },
                "shutdown already in progress, ignoring signal",
            );
            return;
        }
        shuttingDown = true;
        app.log.info(
            { signal },
            "shutdown: stopping new connections, draining in-flight requests",
        );
        try {
            await app.close();
            app.log.info("shutdown: complete, exiting");
            process.exit(0);
        } catch (err) {
            app.log.error({ err }, "shutdown: failed");
            process.exit(1);
        }
    };
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
    process.on("SIGINT", () => void shutdown("SIGINT"));
}

if (import.meta.main) {
    start().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
