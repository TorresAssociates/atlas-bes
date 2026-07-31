import type { FastifyInstance, LightMyRequestResponse } from "fastify";

export interface TestUserSession {
	id: string;
	cookie: string;
}

function cookieHeaderFrom(response: LightMyRequestResponse): string {
	const header = response.headers["set-cookie"];
	const cookies = Array.isArray(header) ? header : header ? [header] : [];
	return cookies.map((cookie) => cookie.split(";", 1)[0]).join("; ");
}

export async function signUpTestUser(
	app: FastifyInstance,
	input: {
		email: string;
		name: string;
		password?: string;
		client_id: number;
		role_id: number;
	},
): Promise<TestUserSession> {
	const res = await app.inject({
		method: "POST",
		url: "/v1/auth/sign-up/email",
		body: {
			password: input.password ?? "correct-horse-battery-staple",
			...input,
		},
	});

	if (res.statusCode >= 400) {
		throw new Error(
			`failed to sign up test user ${input.email}: ${res.statusCode} ${res.body}`,
		);
	}

	const body = res.json<{ user: { id: string } }>();
	return { id: body.user.id, cookie: cookieHeaderFrom(res) };
}
