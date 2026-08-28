import type { Auth } from "./auth";

// The ONLY surface other code may depend on.
// Everything outside src/modules/auth uses getSession() and SessionSubject, never better-auth internals,
// so auth can later become a separate TypeScript service without touching consumers.

export interface SessionSubject {
	user_id: string;
	client_id: number;
	role_id: number;
}

// Structural header type so this file stays free of Fastify imports; a FastifyRequest satisfies it.
export interface RequestLike {
	headers: Record<string, string | string[] | undefined>;
}

export interface CreateInvitedEmailPasswordUserInput {
	email: string;
	name: string;
	password: string;
	client_id: number;
	role_id: number;
}

interface ATLASAuthUser {
	id: string;
	client_id: number;
	role_id: number;
}

interface ATLASAuthSession {
	user: ATLASAuthUser;
}

interface ATLASSignUpEmailInput {
	body: {
		email: string;
		name: string;
		password: string;
		client_id: number;
		role_id: number;
	};
}

interface ATLASSignUpEmailResult {
	user: {
		id: string;
	};
}

let auth: Auth | null = null;

/** Called once by routes.ts when the module is registered. */
export function initAuth(instance: Auth): void {
	auth = instance;
}

export async function getSession(request: RequestLike): Promise<SessionSubject | null> {
	if (!auth) return null;

	const headers = new Headers();
	for (const [name, value] of Object.entries(request.headers)) {
		if (typeof value === "string") headers.append(name, value);
		else if (Array.isArray(value)) for (const v of value) headers.append(name, v);
	}

	const session = (await auth.api.getSession({ headers })) as ATLASAuthSession | null;
	if (!session) return null;

	return {
		user_id: session.user.id,
		client_id: session.user.client_id,
		role_id: session.user.role_id,
	};
}

export async function createInvitedEmailPasswordUser(
	input: CreateInvitedEmailPasswordUserInput,
): Promise<string> {
	if (!auth) throw new Error("auth is not initialized");

	const signUpEmail = auth.api.signUpEmail as (
		input: ATLASSignUpEmailInput,
	) => Promise<ATLASSignUpEmailResult>;

	const result = await signUpEmail({
		body: {
			email: input.email,
			name: input.name,
			password: input.password,
			client_id: input.client_id,
			role_id: input.role_id,
		},
	});

	return result.user.id;
}
