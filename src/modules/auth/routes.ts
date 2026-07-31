import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import { createAuth } from "./auth";
import { initAuth } from "./service";

// Mounted by @fastify/autoload at /v1/auth (dir name + global /v1 prefix).
// better-auth has its own internal router, so this plugin is a thin proxy:
// every /v1/auth/* request is converted to a Fetch Request, handed to
// better-auth, and its Response is copied back. No TypeBox schemas here —
// the routes belong to better-auth, not us — and the route is hidden from
// swagger.
const authRoutes: FastifyPluginAsyncTypebox = async (app) => {
	if (!app.db) {
		app.log.warn("auth module disabled: no database configured");
		return;
	}

	const auth = createAuth(app.config, app.db);
	initAuth(auth);

	app.route({
		method: ["GET", "POST"],
		url: "/*",
		schema: { hide: true },
		handler: async (request, reply) => {
			const url = new URL(request.url, app.config.BETTER_AUTH_URL);

      // Uncomment to block signing up with a POST request
			// if (
			// 	request.method === "POST" &&
			// 	url.pathname.endsWith("/sign-up/email")
			// ) {
			// 	throw app.httpErrors.notFound("open signup is disabled");
			// }

			const headers = new Headers();
			for (const [name, value] of Object.entries(request.headers)) {
				if (typeof value === "string") headers.append(name, value);
				else if (Array.isArray(value))
					for (const v of value) headers.append(name, v);
			}

			const response = await auth.handler(
				new Request(url.toString(), {
					method: request.method,
					headers,
					body: request.body
						? JSON.stringify(request.body)
						: undefined,
				}),
			);

			reply.status(response.status);
			// Set-Cookie must be copied per-value: Headers.forEach folds repeated
			// Set-Cookie headers into one comma-joined string, which browsers
			// misparse when better-auth sets several cookies at once.
			response.headers.forEach((value, name) => {
				if (name !== "set-cookie") reply.header(name, value);
			});
			const setCookies = response.headers.getSetCookie();
			if (setCookies.length > 0) reply.header("set-cookie", setCookies);
			return reply.send(response.body ? await response.text() : null);
		},
	});
};

export default authRoutes;

