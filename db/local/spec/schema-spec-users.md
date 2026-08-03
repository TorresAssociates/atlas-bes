# Schema spec — users, auth, roles, permissions, audit

Derived from `UserSchema.xlsx` (sheet: "User DB Planning"), with all open
questions resolved by decision. **This document is now authoritative** — it
supersedes the spreadsheet where the two differ.

## Global conventions (decided)

| Decision | Value |
|---|---|
| Naming | `snake_case` everywhere, including better-auth tables |
| `user` table name | Stays `user`. It is a PostgreSQL reserved word - always double-quote it as `"user"` |
| Primary keys, auth tables | `text` |
| Primary keys, local serial tables | `SERIAL NOT NULL UNIQUE` plus `PRIMARY KEY("id")` |
| JSON columns | `JSON` |
| Timestamps | `TIMESTAMPTZ` unless the table says otherwise |
| Soft delete columns | `deleted_at TIMESTAMPTZ DEFAULT NULL` for `client`, `role`, and `user` |
| Roles per user | Exactly one. `user.role_id` is `NOT NULL` |
| Per-user extras | `granted_permission` |
| Authorization engine | Database permissions and role assignments are the source of truth |

**better-auth requires field mapping.** Its defaults are camelCase; this schema is snake_case. The better-auth config maps fields such as `emailVerified` -> `email_verified`, `userId` -> `user_id`, `createdAt` -> `created_at`, and `updatedAt` -> `updated_at`.

A trailing `?` in the tables below means the column is nullable.

---

## Support Functions

### `default_gen_salt()`

Returns `gen_salt('bf', 6)` as `TEXT`. Used as the default for salts on encrypted fields.

---

## Tenancy, Roles, And Permissions

### `client`

| Column | Type / constraints | Description |
|---|---|---|
| `id` | SERIAL NOT NULL UNIQUE PRIMARY KEY | Unique identifier for each client |
| `name` | VARCHAR(64) NOT NULL | Name of the client |
| `deleted_at?` | TIMESTAMPTZ DEFAULT NULL | UTC timestamp when this client stopped being active |

Seed data:

| id | name |
|---|---|
| 1 | Torres & Associates |
| 2 | City of Bryan |

### `role`

| Column | Type / constraints | Description |
|---|---|---|
| `id` | SERIAL NOT NULL UNIQUE PRIMARY KEY | Unique identifier for each role |
| `client_id` | INT NOT NULL REFERENCES client(id) | The client this role belongs to |
| `name` | VARCHAR(64) NOT NULL | Name of the role |
| `deleted_at?` | TIMESTAMPTZ DEFAULT NULL | UTC timestamp when this role stopped being active |

Seed data:

| id | name | client_id |
|---|---|---|
| 1 | ADMIN | 1 |
| 2 | TECHNICIAN | 1 |
| 3 | CLIENT_MANAGER | 2 |
| 4 | TECHNICIAN | 2 |

### `permission`

| Column | Type / constraints | Description |
|---|---|---|
| `id` | SERIAL NOT NULL UNIQUE PRIMARY KEY | Unique identifier for a permission |
| `name` | VARCHAR(64) NOT NULL UNIQUE | Name of the permission |
| `description` | TEXT NOT NULL | Description of what the permission does |
| `assign_role` | BOOLEAN NOT NULL | Whether this permission may be attached to a role |

Indexes: hash index on `id`.

Seed data:

| id | name | description | assign_role |
|---|---|---|---|
| 1 | R_CLIENT_DEVICES | Can read all flood-warning related devices for their client | TRUE |
| 2 | W_CLIENT_DEVICES | Can write all flood-warning related devices for their client | TRUE |
| 3 | R_EXTERNAL_DEVICES | Can read all flood-warning related devices for all clients | TRUE |
| 4 | W_EXTERNAL_DEVICES | Can write all flood-warning related devices across all clients | TRUE |
| 5 | R_CLIENT_CONTROL_PANEL | Can read all manual overrides on the control panel for their client | TRUE |
| 6 | W_CLIENT_CONTROL_PANEL | Can write manual overrides on the control panel for their client | TRUE |
| 7 | R_EXTERNAL_CONTROL_PANEL | Can read all manual overrides on the control panel for all clients | TRUE |
| 8 | W_EXTERNAL_CONTROL_PANEL | Can write manual overrides on the control panel for all clients | TRUE |
| 9 | R_CLIENT_USERS | Can read all users in their client | TRUE |
| 10 | W_CLIENT_USERS | Can write all users in their client | TRUE |
| 11 | R_EXTERNAL_USERS | Can read all users across all clients | TRUE |
| 12 | W_EXTERNAL_USERS | Can write all users across all clients | TRUE |
| 13 | R_CLIENTS | Can read all clients | TRUE |
| 14 | W_CLIENTS | Can write all clients | TRUE |
| 15 | EX_CLIENT_ALERT | Can send alerts to all manual alert subscribers within his client | TRUE |
| 16 | EX_EXTERNAL_ALERT | Can send alert to all manual alert subscribers across all clients | TRUE |
| 17 | EX_EMAIL_SUB | Can subscribe for email based alerts | TRUE |
| 18 | EX_TEXT_SUB | Can subscribe for text/SMS-based alerts | TRUE |
| 19 | R_CLIENT_REPORTS | Can read all reports for their client | TRUE |
| 20 | W_CLIENT_REPORTS | Can write all reports for their client | TRUE |
| 21 | R_EXTERNAL_REPORTS | Can read all reports for all clients | TRUE |
| 22 | W_EXTERNAL_REPORTS | Can write all reports for all clients | TRUE |
| 23 | R_CLIENT_LIFT_STATIONS | Can read all lift station devices for their client | TRUE |
| 24 | W_CLIENT_LIFT_STATIONS | Can write all lift station devices for their client | TRUE |
| 25 | R_EXTERNAL_LIFT_STATIONS | Can read all lift station devices for all clients | TRUE |
| 26 | W_EXTERNAL_LIFT_STATIONS | Can write all lift station devices for all clients | TRUE |
| 27 | R_CLIENT_VOTES | Can read all votes to all people in their client | TRUE |
| 28 | W_CLIENT_VOTES | Can assign votes to all people in their client | TRUE |
| 29 | EX_CLIENT_VOTES | Can execute and vote on votes for their client | FALSE |

### `role_permission`

| Column | Type / constraints | Description |
|---|---|---|
| `id` | SERIAL NOT NULL UNIQUE PRIMARY KEY | Unique identifier for each role-permission row |
| `role_id` | INT NOT NULL REFERENCES role(id) | The role holding the permission |
| `permission_id` | INT NOT NULL REFERENCES permission(id) | The permission assigned to the role |

Constraints: `UNIQUE("role_id", "permission_id")`.

Seed data:

| role | permission ids |
|---|---|
| 1 — ADMIN (Torres & Associates) | 3, 4, 7, 8, 11, 12, 13, 14, 16, 17, 18, 21, 22, 25, 26 |
| 2 — TECHNICIAN (Torres & Associates) | 3, 4, 7, 8, 11, 17, 18, 21, 22, 25, 26 |
| 3 — CLIENT_MANAGER (City of Bryan) | 1, 2, 5, 6, 9, 10, 15, 17, 18, 19, 20, 23, 24, 27, 28 |
| 4 — TECHNICIAN (City of Bryan) | 1, 2, 5, 6, 15, 17, 18, 19, 20 |

Permission 24 (`EX_CLIENT_VOTES`, `assign_role = FALSE`) is deliberately not
attached to any role.

### `granted_permission`

Permissions granted to an individual user, outside their role.

| Column | Type / constraints | Description |
|---|---|---|
| `id` | SERIAL NOT NULL UNIQUE PRIMARY KEY | Unique identifier for each granted permission row |
| `user_id` | TEXT NOT NULL REFERENCES "user"(id) | The user receiving the grant |
| `permission_id` | INT NOT NULL REFERENCES permission(id) | The granted permission |

Constraints: `UNIQUE("user_id", "permission_id")`.

---

## better-auth Tables

These tables are used by better-auth. The local schema defines them so codegen and tests can run against Postgres.

### `user`

| Column | Type / constraints | Description |
|---|---|---|
| `id` | TEXT NOT NULL UNIQUE PRIMARY KEY | Unique identifier for each user |
| `name` | TEXT NOT NULL | User display name |
| `email` | TEXT NOT NULL UNIQUE | User email address for login |
| `email_verified` | BOOLEAN NOT NULL | Whether the user's email is verified |
| `image?` | TEXT | User image URL |
| `created_at` | TIMESTAMPTZ NOT NULL | When the user account was created |
| `updated_at` | TIMESTAMPTZ NOT NULL | When the user account was updated |
| `phone_number?` | BYTEA | pgcrypto ciphertext for the user's phone number |
| `salt` | TEXT NOT NULL DEFAULT default_gen_salt() | Salt concatenated with the encryption key for encrypted user fields |
| `phone_number_verified` | BOOLEAN NOT NULL | Whether the user's phone number is verified |
| `client_id` | INT NOT NULL REFERENCES client(id) | The client this user belongs to |
| `role_id` | INT NOT NULL REFERENCES role(id) | The user's single role |
| `deleted_at?` | TIMESTAMPTZ DEFAULT NULL | UTC timestamp when this user stopped being active |

`phone_number`, `salt`, `phone_number_verified`, `client_id`, `role_id`, and `deleted_at` are deliberate extensions to better-auth's default user model.

### `session`

| Column | Type / constraints | Description |
|---|---|---|
| `id` | TEXT NOT NULL UNIQUE PRIMARY KEY | Unique identifier for each session |
| `user_id` | TEXT NOT NULL REFERENCES "user"(id) | The user this session belongs to |
| `token` | TEXT NOT NULL UNIQUE | Unique session token |
| `expires_at` | TIMESTAMPTZ NOT NULL | When the session expires |
| `ip_address?` | TEXT | IP address of the device |
| `user_agent?` | TEXT | User agent information |
| `created_at` | TIMESTAMPTZ NOT NULL | When the session was created |
| `updated_at` | TIMESTAMPTZ NOT NULL | When the session was updated |

### `account`

| Column | Type / constraints | Description |
|---|---|---|
| `id` | TEXT NOT NULL UNIQUE PRIMARY KEY | Unique identifier for each account |
| `user_id` | TEXT NOT NULL REFERENCES "user"(id) | The user this account belongs to |
| `account_id` | TEXT NOT NULL | Provider account ID, or user ID for credential accounts |
| `provider_id` | TEXT NOT NULL | Provider identifier |
| `access_token?` | TEXT | Provider access token |
| `refresh_token?` | TEXT | Provider refresh token |
| `access_token_expires_at?` | TIMESTAMPTZ | When the access token expires |
| `refresh_token_expires_at?` | TIMESTAMPTZ | When the refresh token expires |
| `scope?` | TEXT | Provider scope |
| `id_token?` | TEXT | Provider ID token |
| `password?` | TEXT | Credential password hash |
| `created_at` | TIMESTAMPTZ NOT NULL | When the account was created |
| `updated_at` | TIMESTAMPTZ NOT NULL | When the account was updated |

### `verification`

| Column | Type / constraints | Description |
|---|---|---|
| `id` | TEXT NOT NULL UNIQUE PRIMARY KEY | Unique identifier for each verification row |
| `identifier` | TEXT NOT NULL | Verification identifier |
| `value` | TEXT NOT NULL | Verification value |
| `expires_at` | TIMESTAMPTZ NOT NULL | When the verification expires |
| `created_at` | TIMESTAMPTZ NOT NULL | When the verification was created |
| `updated_at` | TIMESTAMPTZ NOT NULL | When the verification was updated |

---

## Preferences

### `preference`

| Column | Type / constraints | Description |
|---|---|---|
| `id` | SERIAL NOT NULL UNIQUE PRIMARY KEY | Unique identifier for each preference row |
| `user_id` | TEXT NOT NULL REFERENCES "user"(id) | The user these preferences belong to |
| `map_style?` | TEXT | Map style to render |
| `layers_on_load?` | JSON | Layers shown on map load |
| `favorite?` | JSON | Favorite UI items |
| `theme?` | TEXT | Preferred theme |
| `data_vis_preset?` | JSON | Data visualizer presets |

`map_style` and `theme` are `text` for now. Converting them to Postgres enums
remains a possible future change; validate allowed values at the API boundary
with TypeBox in the meantime.

---

## Invitations

Flow: a client manager creates a reusable invite, supplying the role new users will receive. One or more invitees may receive a link containing `https://<app>/invite?token=<token>`. Clicking it opens the signup page. The invite carries the client and role; acceptance supplies the account email and creates the account with that role directly. A NULL `expires_at` means the invite is a permalink.

### `invite`

| Column | Type / constraints | Description |
|---|---|---|
| `id` | SERIAL NOT NULL UNIQUE PRIMARY KEY | Unique identifier for invites |
| `token?` | VARCHAR(32) UNIQUE | Invite token with 12 characters. Soft-deleted invites set this to NULL |
| `expires_at?` | TIMESTAMPTZ | When the invite expires. NULL means permalink |
| `sender_user_id` | TEXT NOT NULL REFERENCES "user"(id) | The user who created or sent the invite |
| `client_id?` | INT REFERENCES client(id) | Client assigned to accepted users. Set to NULL if the client is soft-deleted |
| `role_id?` | INT REFERENCES role(id) | Role assigned to accepted users. Set to NULL if the role is soft-deleted |

### `accepted_invites`

| Column | Type / constraints | Description |
|---|---|---|
| `id` | SERIAL NOT NULL UNIQUE PRIMARY KEY | Unique identifier for the acceptance record |
| `accepted_date` | TIMESTAMPTZ NOT NULL | When the invite was accepted |
| `invite_id` | INT NOT NULL REFERENCES invite(id) | The invite that was accepted |
| `user_id` | TEXT NOT NULL REFERENCES "user"(id) | The user created by accepting the invite |

---

## Device Table Used By Audit Logs

### `device`

| Column | Type / constraints | Description |
|---|---|---|
| `id` | SERIAL NOT NULL UNIQUE PRIMARY KEY | Unique device identifier |
| `serial_number` | TEXT NOT NULL | Device serial number |
| `introduced` | TIMESTAMPTZ NOT NULL DEFAULT NOW() | When this device row became active |
| `archived?` | TIMESTAMPTZ DEFAULT NULL | When this device row stopped being active |

---

## Audit Logging

### `audit_log_action`

The type of action a user performed on the system.

| Column | Type / constraints | Description |
|---|---|---|
| `id` | SERIAL NOT NULL UNIQUE PRIMARY KEY | Unique action row identifier |
| `action_id` | TEXT NOT NULL | Stable machine key |
| `action_text` | TEXT NOT NULL | Human-readable label |

Indexes: hash index on `id`.

Seed data:

| id | action_id | action_text |
|---|---|---|
| 1 | WIFI_ON | Wifi On |
| 2 | WIFI_OFF | Wifi Off |
| 3 | MAN_OVERTOP_ON | Triggered Manual Overtop |
| 4 | MAN_OVERTOP_OFF | Untriggered Manual Overtop |
| 5 | PING | Pinged Device |
| 6 | MAN_MEASURE | Manual Measurement |
| 7 | MAN_FLASHER_ON | Manual Activation of Flasher |
| 8 | MAN_FLASHER_OFF | Manual Deactivation of Flasher |
| 9 | REQ_IMAGE | Manual Request of Image |
| 10 | REQ_VIDEO | Manual Request of Video |
| 11 | SET_CAMERA_PRESET | Manual setting of the Camera Preset |
| 12 | BARRIER_ARM_OPEN | Manual Opening Barrier Arm |
| 13 | BARRIER_ARM_CLOSED | Manual Closing of Barrier Arm |
| 14 | INIT_DEVICE | Initialization of a New Device |
| 15 | REGISTER_DEVICE | Registering a New Device |
| 16 | UPDATE_DEVICE_CONFIG | Updating/Editing Device's Config |
| 17 | DELETE_USER | Deleting a User |
| 18 | UPDATE_USER | Updating/Editing a User's Config |
| 19 | CREATE_ROLE | Create a new role |
| 20 | UPDATE_ROLE_PERMISSIONS | Updating the permissions tied to a role |
| 21 | DELETE_ROLE | Deleting a role |
| 22 | UPDATE_ROLE_PERMISSIONS | Updating the permissions tied to a role |
| 23 | DELETE_ROLE | Deleting a role |

### `control_audit_log`

| Column | Type / constraints | Description |
|---|---|---|
| `id` | SERIAL NOT NULL UNIQUE PRIMARY KEY | Unique log row identifier |
| `date` | TIMESTAMPTZ NOT NULL | When the action occurred |
| `log_action_id` | INT NOT NULL REFERENCES audit_log_action(id) | What action was performed |
| `device_id` | INT NOT NULL REFERENCES device(id) | The device acted upon |
| `actor_user_id` | TEXT NOT NULL REFERENCES "user"(id) | The user who performed the action |

### `user_audit_log`

User management actions.

| Column | Type / constraints | Description |
|---|---|---|
| `id` | SERIAL NOT NULL UNIQUE PRIMARY KEY | Unique log row identifier |
| `date` | TIMESTAMPTZ NOT NULL | When the action occurred |
| `log_action_id` | INT NOT NULL REFERENCES audit_log_action(id) | What action was performed |
| `actor_user_id` | TEXT NOT NULL REFERENCES "user"(id) | The user who performed the action |
| `target_user_id` | TEXT NOT NULL REFERENCES "user"(id) | The user the action was performed on |

### `roles_perms_audit_log`

Role and permission changes.

| Column | Type / constraints | Description |
|---|---|---|
| `id` | SERIAL NOT NULL UNIQUE PRIMARY KEY | Unique log row identifier |
| `date` | TIMESTAMPTZ NOT NULL | When the action occurred |
| `log_action_id` | INT NOT NULL REFERENCES audit_log_action(id) | What action was performed |
| `actor_user_id` | TEXT NOT NULL REFERENCES "user"(id) | The user who performed the action |
| `role_name` | TEXT NOT NULL | The role name affected |
| `permission_id?` | INT REFERENCES permission(id) | The permission affected |
| `added` | BOOLEAN NOT NULL | TRUE if permission was added, FALSE if removed |

---

## Voting — not designed

The source sheet lists voting as outstanding work:

- Voting for alerts to be sent
- How to track all users in a given client who need to vote?
- How to track actual progress of votes
- Need a table tracking the voting event itself (expiration time, start time, etc.)
- Need a table tracking whether a given user is a voter

Permissions `W_CLIENT_VOTES` (23) and `EX_CLIENT_VOTES` (24) exist for this.

🚫 **No voting tables are defined. Do not invent them.**

---

## Dependency order

Tables must be created in this order:

1. `client`
2. `role` -> client
3. `user` -> client, role
4. `session`, `account`, `verification` -> user
5. `preference` -> user
6. `invite` -> user, client, role
7. `accepted_invites` -> invite, user
8. `permission`
9. `role_permission` -> role, permission
10. `granted_permission` -> user, permission
11. `device`
12. `audit_log_action`
13. `control_audit_log` -> audit_log_action, device, user
14. `user_audit_log` -> audit_log_action, user
15. `role_permissions_audit_log` -> audit_log_action, user, permission

---

## Current Deletion Rules In The API

| Entity | Behavior |
|---|---|
| User | Soft delete by setting `user.deleted_at` |
| Invite | Soft delete by setting `invite.token = NULL` and `invite.expires_at = now()` |
| Role | Soft delete by setting `role.deleted_at`; blocked while any user still has that role; matching invite `role_id` values are set to NULL |
| Client | Soft delete by setting `client.deleted_at`; blocked while any active role still belongs to the client; matching invite `client_id` values are set to NULL |

---

## Notes

- `schema.sql` contains many non-user-domain tables beyond this document. This spec tracks the user/auth/roles/permissions/preferences/invites/audit slice only.
- Client names and role names are not unique in `schema.sql`.
- `accepted_invites` has no uniqueness constraint in `schema.sql`.
- Nullable invite `client_id` and `role_id` are deliberate so historical invite records can survive client/role soft deletion.
