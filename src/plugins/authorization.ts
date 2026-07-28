import type { FastifyReply, FastifyRequest } from "fastify";

// Permission names from db/local/spec/schema-spec-users.md's permission seed table. Typed as a
// union so a typo'd name is a compile error instead of a permanently-passing
// no-op check.
export type PermissionName =
  | "R_CLIENT_DEVICES"
  | "RW_CLIENT_DEVICES"
  | "R_EXTERNAL_DEVICES"
  | "RW_EXTERNAL_DEVICES"
  | "RW_CLIENT_CONTROL_PANEL"
  | "RW_EXTERNAL_CONTROL_PANEL"
  | "R_CLIENT_USERS"
  | "RW_CLIENT_USERS"
  | "R_EXTERNAL_USERS"
  | "RW_EXTERNAL_USERS"
  | "R_CLIENTS"
  | "RW_CLIENTS"
  | "EX_CLIENT_ALERT"
  | "EX_EXTERNAL_ALERT"
  | "EX_EMAIL_SUB"
  | "EX_TEXT_SUB"
  | "R_CLIENT_REPORTS"
  | "RW_CLIENT_REPORTS"
  | "R_EXTERNAL_REPORTS"
  | "RW_EXTERNAL_REPORTS"
  | "RW_CLIENT_LIFT_STATIONS"
  | "RW_EXTERNAL_LIFT_STATIONS"
  | "RW_CLIENT_VOTES"
  | "EX_CLIENT_VOTES";

/**
 * preHandler factory: `requirePermission("R_CLIENTS")` on every route that
 * needs authorization. Routes wire this now so the auth phase only has to
 * fill in this one function, not edit every route.
 *
 * TODO(auth phase): implement for real —
 *   1. resolve the session via better-auth (`getSession()` seam),
 *   2. load the user's role permissions (role_permission) plus individual
 *      grants (granted_permission),
 *   3. reply 401 with no session, 403 when none of `names` are held.
 * Until then this is a deliberate no-op: every request passes.
 */
export function requirePermission(...names: PermissionName[]) {
  return async (_request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    void names;
  };
}
