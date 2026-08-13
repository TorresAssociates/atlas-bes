----------------------------------
---- General Salting Function ----
----------------------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE OR REPLACE FUNCTION default_gen_salt()
  RETURNS TEXT AS $$
    BEGIN
      RETURN gen_salt('bf', 6);
    END;
  $$ LANGUAGE plpgsql;

----------------
---- Client ----
----------------

CREATE TABLE IF NOT EXISTS "client" (
    "id" SERIAL NOT NULL UNIQUE,
    "name" VARCHAR(64) NOT NULL,
    "deleted_at" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id")
);

--------------
---- Role ----
--------------

CREATE TABLE IF NOT EXISTS "role" (
    "id" SERIAL NOT NULL UNIQUE,
    "client_id" INT NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "deleted_at" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("client_id") REFERENCES "client"("id")
);

---------------------
---- Better Auth ----
---------------------

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS "user" (
	"id" TEXT NOT NULL UNIQUE,
	"name" TEXT NOT NULL,
	"email" TEXT NOT NULL UNIQUE,
	"email_verified" BOOLEAN NOT NULL,
	"image" TEXT,
	"created_at" TIMESTAMPTZ NOT NULL,
	"updated_at" TIMESTAMPTZ NOT NULL,
    "phone_number" BYTEA, -- ENCRYPTED TEXT--
    "salt" TEXT NOT NULL DEFAULT default_gen_salt(),
    "phone_number_verified" BOOLEAN NOT NULL,
    "client_id" INT NOT NULL,
    "role_id" INT NOT NULL,
    "deleted_at" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("client_id") REFERENCES "client"("id"),
    FOREIGN KEY("role_id") REFERENCES "role"("id")
);
-- ^^ REQURES SECRET IN AWS TO BE ENCRYPTED/DECRYPTED
-- To insert:
-- WITH salt AS (
--   SELECT gen_salt AS val FROM default_gen_salt()
-- )
-- INSERT INTO table (pw, salt) VALUES (pgp_sym_encrypt('SomePassword', CONCAT('SECRET_ENCRYPTION_KEY', (SELECT val FROM salt))), (SELECT val FROM salt));
-- To retrieve:
-- SELECT id, pgp_sym_decrypt(pw, CONCAT('SECRET_ENCRYPTION_KEY', (SELECT salt))) FROM table WHERE "device_id" = $1;
-- SELECT * FROM table WHERE pgp_sym_decrypt(pw, CONCAT('longsecretencryptionkey', (SELECT salt))) = 'SomePassword';

CREATE TABLE IF NOT EXISTS "session" (
    "id" TEXT NOT NULL UNIQUE,
    "user_id" TEXT NOT NULL,
    "token" TEXT NOT NULL UNIQUE,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("user_id") REFERENCES "user"("id")
);

CREATE TABLE IF NOT EXISTS "account" (
    "id" TEXT NOT NULL UNIQUE,
    "user_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "access_token_expires_at" TIMESTAMPTZ,
    "refresh_token_expires_at" TIMESTAMPTZ,
    "scope" TEXT,
    "id_token" TEXT,
    "password" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("user_id") REFERENCES "user"("id")
);

CREATE TABLE IF NOT EXISTS "verification" (
    "id" TEXT NOT NULL UNIQUE,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,
    PRIMARY KEY("id")
);

---------------------
---- User Stuff ----
---------------------

CREATE TABLE IF NOT EXISTS "preference" (
    "id" SERIAL NOT NULL UNIQUE,
    "user_id" TEXT NOT NULL,
    "map_style" TEXT,
    "layers_on_load" JSON,
    "favorite" JSON,
    "theme" TEXT,
    "data_vis_preset" JSON,
    PRIMARY KEY("id"),
    FOREIGN KEY("user_id") REFERENCES "user"("id")
);

CREATE TABLE IF NOT EXISTS "invite" (
    "id" SERIAL NOT NULL UNIQUE,
    "token" VARCHAR(32) UNIQUE,
    "expires_at" TIMESTAMPTZ,
    "sender_user_id" TEXT NOT NULL,
    "client_id" INT,
    "role_id" INT,
    PRIMARY KEY("id"),
    FOREIGN KEY("sender_user_id") REFERENCES "user"("id"),
    FOREIGN KEY("client_id") REFERENCES "client"("id"),
    FOREIGN KEY("role_id") REFERENCES "role"("id")
);

CREATE TABLE IF NOT EXISTS "accepted_invites" (
    "id" SERIAL NOT NULL UNIQUE,
    "accepted_date" TIMESTAMPTZ NOT NULL,
    "invite_id" INT NOT NULL,
    "user_id" TEXT NOT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("invite_id") REFERENCES "invite"("id"),
    FOREIGN KEY("user_id") REFERENCES "user"("id")
);

---------------------
---- Permissions ----
---------------------

CREATE TABLE IF NOT EXISTS "permission" (
    "id" SERIAL NOT NULL UNIQUE,
    "name" VARCHAR(64) NOT NULL UNIQUE,
    "description" TEXT NOT NULL,
    "assign_role" BOOLEAN NOT NULL,
    PRIMARY KEY("id")
);
CREATE INDEX IF NOT EXISTS "permission_hash_index" ON "permission" USING HASH ("id");

CREATE TABLE IF NOT EXISTS "role_permission" (
    "id" SERIAL NOT NULL UNIQUE,
    "role_id" INT NOT NULL,
    "permission_id" INT NOT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("role_id") REFERENCES "role"("id"),
    FOREIGN KEY("permission_id") REFERENCES "permission"("id"),
    CONSTRAINT "unique_role_id_permission_id" UNIQUE("role_id", "permission_id")
);

CREATE TABLE IF NOT EXISTS "granted_permission" (
    "id" SERIAL NOT NULL UNIQUE,
    "user_id" TEXT NOT NULL,
    "permission_id" INT NOT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("user_id") REFERENCES "user"("id"),
    FOREIGN KEY("permission_id") REFERENCES "permission"("id"),
    CONSTRAINT "unique_user_id_permission_id" UNIQUE("user_id", "permission_id")
);

--------------
---- City ----
--------------

CREATE TABLE IF NOT EXISTS "city" (
	"id" SERIAL NOT NULL UNIQUE,
    "state" CHAR(2) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    PRIMARY KEY("id")
);

-----------------------
---- Gauge_station ----
-----------------------

CREATE TABLE IF NOT EXISTS "gauge_station" (
    "id" SERIAL NOT NULL UNIQUE,
    "name" VARCHAR(32) NOT NULL UNIQUE,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id")
);
CREATE TABLE IF NOT EXISTS "gauge_station_info" (
    "id" SERIAL NOT NULL UNIQUE,
    "gauge_station_id" INT NOT NULL,
    "city_id" INT NOT NULL,
    "location" VARCHAR(128) NOT NULL,
    "latitude" FLOAT8 NOT NULL,
    "longitude" FLOAT8 NOT NULL,
    "publicly_visible" BOOLEAN NOT NULL DEFAULT TRUE,
    "active" BOOLEAN NOT NULL DEFAULT TRUE,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("gauge_station_id") REFERENCES "gauge_station"("id")
);
CREATE TABLE IF NOT EXISTS "client_gauge_station" (
    "id" SERIAL NOT NULL UNIQUE,
    "gauge_station_id" INT NOT NULL,
    "client_id" INT NOT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("gauge_station_id") REFERENCES "gauge_station"("id"),
    FOREIGN KEY("client_id") REFERENCES "client"("id")
);

----------------
---- Alerts ----
----------------

CREATE TYPE ALERT_LEVEL AS ENUM ('gauge_station','device');
CREATE TABLE IF NOT EXISTS "alert" (
	"id" SERIAL NOT NULL UNIQUE,
    "client_id" INT NOT NULL,
    "type" VARCHAR(16) NOT NULL,
    "level" ALERT_LEVEL NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id")
);
CREATE TABLE IF NOT EXISTS "alert_info" (
    "id" SERIAL NOT NULL UNIQUE,
    "alert_id" INT NOT NULL,
    "send_message" VARCHAR(1024) NOT NULL,
    "retract_message" VARCHAR(1024) NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("alert_id") REFERENCES "alert"("id")
);

CREATE TYPE NOTIFICATION_TYPE AS ENUM ('email', 'sms');
CREATE TABLE IF NOT EXISTS "alert_subscription" (
    "id" SERIAL NOT NULL UNIQUE,
    "user_id" TEXT NOT NULL,
    "gauge_station_id" INT NOT NULL,
    "alert_id" INT NOT NULL,
    "notification_type" NOTIFICATION_TYPE NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("user_id") REFERENCES "user"("id"),
    FOREIGN KEY("gauge_station_id") REFERENCES "gauge_station"("id"),
    FOREIGN KEY("alert_id") REFERENCES "alert"("id")
);

--------------------------------
---- Measurement Categories ----
--------------------------------

CREATE TABLE IF NOT EXISTS "universal_measurement_category" (
	"id" SERIAL NOT NULL UNIQUE,
    "category" VARCHAR(32) NOT NULL UNIQUE,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("category")
);

CREATE TABLE IF NOT EXISTS "measurement_category" (
	"id" SERIAL NOT NULL UNIQUE,
    "category" VARCHAR(16) NOT NULL UNIQUE,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("category")
);

--------------
---- Sims ----
--------------

CREATE TABLE IF NOT EXISTS "sim" (
	"id" SERIAL NOT NULL UNIQUE,
    "iccid" CHAR(20) NOT NULL UNIQUE,
    "provider" VARCHAR(16) NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("iccid")
);
CREATE TABLE IF NOT EXISTS "sim_info" (
	"id" SERIAL NOT NULL UNIQUE,
    "sim_id" INT NOT NULL,
    "imei" CHAR(15) NOT NULL,
    "activated" BOOLEAN NOT NULL,
    "paused" BOOLEAN NOT NULL DEFAULT FALSE,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("sim_id") REFERENCES "sim"("id")
);
CREATE TABLE IF NOT EXISTS "sim_info_hologram" (
	"id" SERIAL NOT NULL UNIQUE,
    "sim_id" INT NOT NULL,
    "device_id" INT NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("sim_id") REFERENCES "sim"("id")
);
CREATE TABLE IF NOT EXISTS "sim_info_emnify" (
	"id" SERIAL NOT NULL UNIQUE,
    "sim_id" INT NOT NULL,
    "bic" CHAR(16) NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("sim_id") REFERENCES "sim"("id")
);

----------------
---- Device ----
----------------

CREATE TYPE DEVICE_TYPE AS ENUM ('datalogger','flasher','barrier','camera');
CREATE TABLE IF NOT EXISTS "device" (
	"id" SERIAL NOT NULL UNIQUE,
    "serial_number" VARCHAR(32) NOT NULL UNIQUE,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("serial_number")
);
CREATE TABLE IF NOT EXISTS "device_info" (
	"id" SERIAL NOT NULL UNIQUE,
    "device_id" INT NOT NULL,
    "gauge_station_id" INT NOT NULL,
    "type" DEVICE_TYPE NOT NULL,
    "page_version" VARCHAR(16),
    "activation_date" TIMESTAMPTZ,
    "warranty_end_date" TIMESTAMPTZ,
    "latitude" FLOAT8,
    "longitude" FLOAT8,
    "active" BOOLEAN,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("device_id") REFERENCES "device"("id"),
    FOREIGN KEY("gauge_station_id") REFERENCES "gauge_station"("id")
);
CREATE TABLE IF NOT EXISTS "device_camera_info" (
	"id" SERIAL NOT NULL UNIQUE,
    "device_id" INT NOT NULL,
    "trigger_override" BOOLEAN,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("device_id") REFERENCES "device"("id")
);
CREATE TYPE PROTOCOL_TYPE AS ENUM ('mqtt', 'coap');
CREATE TABLE IF NOT EXISTS "device_networking" (
	"id" SERIAL NOT NULL UNIQUE,
    "device_id" INT NOT NULL,
    "protocol" PROTOCOL_TYPE NOT NULL,
    "api_version" VARCHAR(8) NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("device_id") REFERENCES "device"("id")
);
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS "device_wifi_interface_config" (
	"id" SERIAL NOT NULL UNIQUE,
    "device_id" INT NOT NULL,
    "password" BYTEA NOT NULL, -- ENCRYPTED
    "salt" TEXT NOT NULL DEFAULT default_gen_salt(),
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("device_id") REFERENCES "device"("id")
);
-- ^^ REQURES SECRET IN AWS TO BE ENCRYPTED/DECRYPTED
-- To insert:
-- WITH salt AS (
--   SELECT gen_salt AS val FROM default_gen_salt()
-- )
-- INSERT INTO table (pw, salt) VALUES (pgp_sym_encrypt('SomePassword', CONCAT('SECRET_ENCRYPTION_KEY', (SELECT val FROM salt))), (SELECT val FROM salt));
-- To retrieve:
-- SELECT id, pgp_sym_decrypt(pw, CONCAT('SECRET_ENCRYPTION_KEY', (SELECT salt))) FROM table WHERE "device_id" = $1;
-- SELECT * FROM table WHERE pgp_sym_decrypt(pw, CONCAT('longsecretencryptionkey', (SELECT salt))) = 'SomePassword';

CREATE TABLE IF NOT EXISTS "device_wifi_interface_active" (
	"id" SERIAL NOT NULL UNIQUE,
    "device_id" INT NOT NULL,
    "wifi_active" BOOLEAN NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("device_id") REFERENCES "device"("id")
);
CREATE TABLE IF NOT EXISTS "device_connected" (
	"id" SERIAL NOT NULL UNIQUE,
    "device_id" INT NOT NULL,
    "connected" BOOLEAN NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("device_id") REFERENCES "device"("id")
);
CREATE TABLE IF NOT EXISTS "device_camera_trigger" (
	"id" SERIAL NOT NULL UNIQUE,
    "device_id" INT NOT NULL,
    "triggered" BOOLEAN NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("device_id") REFERENCES "device"("id")
);
CREATE TABLE IF NOT EXISTS "device_sim_active" (
	"id" SERIAL NOT NULL UNIQUE,
    "device_id" INT NOT NULL,
    "active_sim_index" INT NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("device_id") REFERENCES "device"("id")
);
CREATE TABLE IF NOT EXISTS "device_sim" (
	"id" SERIAL NOT NULL UNIQUE,
    "device_id" INT NOT NULL,
    "sim_id" INT NOT NULL,
    "sim_index" INT,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("device_id") REFERENCES "device"("id"),
    FOREIGN KEY("sim_id") REFERENCES "sim"("id")
);
CREATE TABLE IF NOT EXISTS "device_power" (
	"id" SERIAL NOT NULL UNIQUE,
    "device_id" INT NOT NULL,
    "min_voltage" REAL NOT NULL,
    "max_voltage" REAL NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("device_id") REFERENCES "device"("id")
);
CREATE TABLE IF NOT EXISTS "device_connection_quality" (
	"id" SERIAL NOT NULL UNIQUE,
    "device_id" INT NOT NULL,
    "min_rssi" REAL,
    "max_rssi" REAL,
    "min_rsrp" REAL,
    "max_rsrp" REAL,
    "min_rsrq" REAL,
    "max_rsrq" REAL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("device_id") REFERENCES "device"("id")
);
CREATE TABLE IF NOT EXISTS "device_datalogging" (
	"id" SERIAL NOT NULL UNIQUE,
    "device_id" INT NOT NULL,
    "timestep" INT NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("device_id") REFERENCES "device"("id")
);

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS vmq_auth_acl
 (
    "id" SERIAL NOT NULL UNIQUE,
    "device_id" INT NOT NULL,
    "mountpoint" VARCHAR(10) NOT NULL,
    "client_id" VARCHAR(128) NOT NULL,
    "username" VARCHAR(128) NOT NULL,
    "password" VARCHAR(128),
    "publish_acl" JSON,
    "subscribe_acl" JSON,
    CONSTRAINT vmq_auth_acl_primary_key PRIMARY KEY (mountpoint, client_id, username),
    FOREIGN KEY("device_id") REFERENCES "device"("id")
);

-----------------
---- Channel ----
-----------------

CREATE TABLE IF NOT EXISTS "channel" (
	"id" SERIAL NOT NULL UNIQUE,
    "device_id" INT NOT NULL,
    "local_id" INT NOT NULL,
    "channel_type_id" INT NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("device_id") REFERENCES "device"("id")
);
CREATE TABLE IF NOT EXISTS "channel_config" (
	"id" SERIAL NOT NULL UNIQUE,
    "channel_id" INT NOT NULL,
    "name" VARCHAR(16) NOT NULL,
    "active" BOOLEAN NOT NULL,
    "category" VARCHAR(16) NOT NULL,
    "units" VARCHAR(16) NOT NULL,
    "scale" REAL NOT NULL,
    "offset" REAL NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("channel_id") REFERENCES "channel"("id")
);
CREATE TABLE IF NOT EXISTS "channel_config_display" (
	"id" SERIAL NOT NULL UNIQUE,
    "channel_id" INT NOT NULL,
    "display_index" INT NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("channel_id") REFERENCES "channel"("id")
);
CREATE TABLE IF NOT EXISTS "channel_error" (
	"id" SERIAL NOT NULL UNIQUE,
    "channel_id" INT NOT NULL,
    "error_id" INT NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("channel_id") REFERENCES "channel"("id")
);
CREATE TYPE INTERNAL_POWER_SENSOR_MEASUREMENT_TYPE AS ENUM ('voltage', 'current', 'power');
CREATE TABLE IF NOT EXISTS "channel_config_internal_power_sensor" (
	"id" SERIAL NOT NULL UNIQUE,
    "channel_id" INT NOT NULL,
    "measurement_type" INTERNAL_POWER_SENSOR_MEASUREMENT_TYPE NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("channel_id") REFERENCES "channel"("id")
);
CREATE TABLE IF NOT EXISTS "channel_config_sdi12" (
	"id" SERIAL NOT NULL UNIQUE,
    "channel_id" INT NOT NULL,
    "address" CHAR(1) NOT NULL,
    "measurement_set" INT NOT NULL,
    "measurement_index" INT NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("channel_id") REFERENCES "channel"("id")
);
CREATE TABLE IF NOT EXISTS "channel_config_accumulation" (
	"id" SERIAL NOT NULL UNIQUE,
    "channel_id" INT NOT NULL,
    "source_local_id" INT NOT NULL,
    "drain_const" REAL NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("channel_id") REFERENCES "channel"("id")
);
CREATE TABLE IF NOT EXISTS "channel_config_tilt" (
	"id" SERIAL NOT NULL UNIQUE,
    "channel_id" INT NOT NULL,
    "alignment_x" REAL,
    "alignment_y" REAL,
    "alignment_z" REAL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("channel_id") REFERENCES "channel"("id")
);

----------------
---- Camera ----
----------------

CREATE TABLE IF NOT EXISTS "camera" (
	"id" SERIAL NOT NULL UNIQUE,
    "device_id" INT NOT NULL,
    "local_id" INT NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("device_id") REFERENCES "device"("id")
);
CREATE TABLE IF NOT EXISTS "camera_config" (
	"id" SERIAL NOT NULL UNIQUE,
    "camera_id" INT NOT NULL,
    "pan" REAL,
    "tilt" REAL,
    "zoom" REAL,
    "selected_preset" INT NOT NULL,
    "boot_time_delay" INT NOT NULL,
    "check_in_time" VARCHAR(17),
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("camera_id") REFERENCES "camera"("id")
);
CREATE TABLE IF NOT EXISTS "camera_config_preset" (
	"id" SERIAL NOT NULL UNIQUE,
    "camera_id" INT NOT NULL,
    "local_preset_id" INT NOT NULL,
    "pan" REAL NOT NULL,
    "tilt" REAL NOT NULL,
    "zoom" REAL NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("camera_id") REFERENCES "camera"("id")
);
CREATE TABLE IF NOT EXISTS "camera_config_rotation" (
	"id" SERIAL NOT NULL UNIQUE,
    "camera_id" INT NOT NULL,
    "rotation" REAL NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("camera_id") REFERENCES "camera"("id")
);

-------------------------
---- Camera Triggers ----
-------------------------

CREATE TABLE IF NOT EXISTS "device_camera_accumulation_trigger" (
    "id" SERIAL NOT NULL UNIQUE,
    "device_id" INT NOT NULL,
    "camera_id" INT NOT NULL,
    "accumulation_time" INT NOT NULL,
    "trigger_amount" REAL NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("device_id") REFERENCES "device"("id"),
    FOREIGN KEY("camera_id") REFERENCES "camera"("id")
);
CREATE TABLE IF NOT EXISTS "device_camera_accumulation_trigger_active" (
    "id" SERIAL NOT NULL UNIQUE,
    "device_id" INT NOT NULL,
    "camera_id" INT NOT NULL,
    "active" BOOLEAN NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("device_id") REFERENCES "device"("id"),
    FOREIGN KEY("camera_id") REFERENCES "camera"("id")
);

-------------------------
---- Data Collection ----
-------------------------

CREATE TABLE IF NOT EXISTS "measurement_record" (
	"id" BIGSERIAL NOT NULL UNIQUE,
    "date" TIMESTAMPTZ NOT NULL,
    "channel_id" INT NOT NULL,
    "value" REAL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("channel_id") REFERENCES "channel"("id")
);

CREATE TABLE IF NOT EXISTS "camera_data_record" (
	"id" BIGSERIAL NOT NULL UNIQUE,
    "date" TIMESTAMPTZ NOT NULL,
    "camera_id" INT NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("camera_id") REFERENCES "camera"("id")
);
CREATE TABLE IF NOT EXISTS "camera_capture_data" (
	"id" SERIAL NOT NULL UNIQUE,
    "camera_data_record_id" BIGINT NOT NULL,
    "path" VARCHAR(255) NOT NULL,
    "file_type" VARCHAR(255) NOT NULL,
    "is_tagged" BOOLEAN NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("camera_data_record_id") REFERENCES "camera_data_record"("id")
);
CREATE TABLE IF NOT EXISTS "camera_detection_data" (
	"id" SERIAL NOT NULL UNIQUE,
    "camera_data_record_id" BIGINT NOT NULL,
    "object" VARCHAR(255) NOT NULL,
    "present_duration" REAL NOT NULL,
    "confidence" REAL NOT NULL,
    "stalled" BOOLEAN NOT NULL,
    "water_level" INT NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("camera_data_record_id") REFERENCES "camera_data_record"("id")
);

-----------------------
---- Latest Tables ----
-----------------------

CREATE TABLE IF NOT EXISTS "latest_measurement_record" (
	"id" BIGSERIAL NOT NULL UNIQUE,
    "date" TIMESTAMPTZ NOT NULL,
    "channel_id" INT NOT NULL UNIQUE,
    "value" REAL,
    PRIMARY KEY("id"),
    FOREIGN KEY("channel_id") REFERENCES "channel"("id")
);

-- Insert the latest record entered if able (DATE NOT ACCOUNTED FOR)
-- CREATE OR REPLACE FUNCTION "insert_latest_measurement"()
--     RETURNS TRIGGER AS $$
--         BEGIN
--             IF (NEW."date" IS NULL)
--             INSERT INTO "latest_measurement_record" ("date", "channel_id", "value") VALUES
--             (NEW."date", NEW."channel_id", NEW."value")
--             ON CONFLICT ("channel_id") DO 
--                 UPDATE SET
--                 "date" = NEW."date",
--                 "value" = NEW."value";
--             RETURN NEW;
--         END;
--     $$ LANGUAGE plpgsql;

-- Insert the latest record (BY DATE) to the latest records / replace the newest one
CREATE OR REPLACE FUNCTION "f_insert_latest_measurement"()
    RETURNS TRIGGER AS $$
        BEGIN
            IF(NEW."date" > (SELECT date FROM "latest_measurement_record" WHERE "channel_id" = NEW."channel_id")) THEN
                UPDATE "latest_measurement_record" SET 
                    "date" = NEW."date",
                    "value" = NEW."value"
                WHERE "channel_id" = NEW."channel_id";
            ELSE
                INSERT INTO "latest_measurement_record" ("date", "channel_id", "value") VALUES
                    (NEW."date", NEW."channel_id", NEW."value")
                ON CONFLICT ("channel_id")
                DO NOTHING;
            END IF;
            RETURN NEW;
        END;
    $$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER "t_insert_latest_measurement" 
    AFTER INSERT ON "measurement_record"
    FOR EACH ROW
    EXECUTE FUNCTION "f_insert_latest_measurement"();

---------------------------
---- Timestep Modifier ----
---------------------------

CREATE TABLE IF NOT EXISTS "timestep_modifier" (
	"id" SERIAL NOT NULL UNIQUE,
    "device_id" INT NOT NULL,
    "local_id" INT NOT NULL,
    "type_id" INT NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("device_id") REFERENCES "device"("id")
);
CREATE TABLE IF NOT EXISTS "timestep_modifier_config" (
	"id" SERIAL NOT NULL UNIQUE,
    "timestep_modifier_id" INT NOT NULL,
    "priority" INT NOT NULL,
    "min_timestep" INT NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("timestep_modifier_id") REFERENCES "timestep_modifier"("id")
);
CREATE TABLE IF NOT EXISTS "timestep_modifier_config_activity" (
	"id" SERIAL NOT NULL UNIQUE,
    "timestep_modifier_id" INT NOT NULL,
    "active" BOOLEAN NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("timestep_modifier_id") REFERENCES "timestep_modifier"("id")
);
CREATE TABLE IF NOT EXISTS "channel_timestep_modifier" (
	"id" SERIAL NOT NULL UNIQUE,
    "timestep_modifier_id" INT NOT NULL,
    "channel_id" INT NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("timestep_modifier_id") REFERENCES "timestep_modifier"("id"),
    FOREIGN KEY("channel_id") REFERENCES "channel"("id")
);
CREATE TABLE IF NOT EXISTS "timestep_modifier_config_delta_value" (
	"id" SERIAL NOT NULL UNIQUE,
    "timestep_modifier_id" INT NOT NULL,
    "delta_value" REAL NOT NULL,
    "min_change" REAL NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("timestep_modifier_id") REFERENCES "timestep_modifier"("id")
);
CREATE TABLE IF NOT EXISTS "timestep_modifier_config_range" (
	"id" SERIAL NOT NULL UNIQUE,
    "timestep_modifier_id" INT NOT NULL,
    "min_value" REAL NOT NULL,
    "max_value" REAL NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("timestep_modifier_id") REFERENCES "timestep_modifier"("id")
);
CREATE TABLE IF NOT EXISTS "timestep_modifier_config_gradient" (
	"id" SERIAL NOT NULL UNIQUE,
    "timestep_modifier_id" INT NOT NULL,
    "begin_value" REAL NOT NULL,
    "end_value" REAL NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("timestep_modifier_id") REFERENCES "timestep_modifier"("id")
);

-----------------------
---- Alert Monitor ----
-----------------------

CREATE TABLE IF NOT EXISTS "alert_monitor" (
	"id" SERIAL NOT NULL UNIQUE,
    "device_id" INT NOT NULL,
    "local_id" INT NOT NULL,
    "type_id" INT NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("device_id") REFERENCES "device"("id")
);
CREATE TABLE IF NOT EXISTS "alert_monitor_config" (
	"id" SERIAL NOT NULL UNIQUE,
    "alert_monitor_id" INT NOT NULL,
    "priority" INT NOT NULL,
    "alert_id" INT NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("alert_monitor_id") REFERENCES "alert_monitor"("id"),
    FOREIGN KEY("alert_id") REFERENCES "alert"("id")
);
CREATE TABLE IF NOT EXISTS "alert_monitor_config_activity" (
	"id" SERIAL NOT NULL UNIQUE,
    "alert_monitor_id" INT NOT NULL,
    "active" BOOLEAN NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("alert_monitor_id") REFERENCES "alert_monitor"("id")
);
CREATE TABLE IF NOT EXISTS "channel_alert_monitor" (
	"id" SERIAL NOT NULL UNIQUE,
    "alert_monitor_id" INT NOT NULL,
    "channel_id" INT NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("alert_monitor_id") REFERENCES "alert_monitor"("id"),
    FOREIGN KEY("channel_id") REFERENCES "channel"("id")
);
CREATE TABLE IF NOT EXISTS "alert_monitor_config_range" (
	"id" SERIAL NOT NULL UNIQUE,
    "alert_monitor_id" INT NOT NULL,
    "min_value" REAL NOT NULL,
    "max_value" REAL NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("alert_monitor_id") REFERENCES "alert_monitor"("id")
);

----------------------------
---- Risk Level Monitor ----
----------------------------

CREATE TABLE IF NOT EXISTS "risk_level_monitor" (
	"id" SERIAL NOT NULL UNIQUE,
    "device_id" INT NOT NULL,
    "local_id" INT NOT NULL,
    "type_id" INT NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("device_id") REFERENCES "device"("id")
);
CREATE TABLE IF NOT EXISTS "risk_level_monitor_config" (
	"id" SERIAL NOT NULL UNIQUE,
    "risk_level_monitor_id" INT NOT NULL,
    "priority" INT NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("risk_level_monitor_id") REFERENCES "risk_level_monitor"("id")
);
-- CREATE TABLE IF NOT EXISTS "risk_level_monitor_config_activity" (
-- 	"id" SERIAL NOT NULL UNIQUE,
--     "risk_level_monitor_id" INT NOT NULL,
--     "active" BOOLEAN NOT NULL,
--     "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
--     "archived" TIMESTAMPTZ DEFAULT NULL,
--     PRIMARY KEY("id"),
--     FOREIGN KEY("risk_level_monitor_id") REFERENCES "risk_level_monitor"("id")
-- );
CREATE TABLE IF NOT EXISTS "channel_risk_level_monitor" (
	"id" SERIAL NOT NULL UNIQUE,
    "risk_level_monitor_id" INT NOT NULL,
    "channel_id" INT NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("risk_level_monitor_id") REFERENCES "risk_level_monitor"("id"),
    FOREIGN KEY("channel_id") REFERENCES "channel"("id")
);
CREATE TABLE IF NOT EXISTS "risk_level_monitor_config_range" (
	"id" SERIAL NOT NULL UNIQUE,
    "risk_level_monitor_id" INT NOT NULL,
    "min_value" REAL NOT NULL,
    "max_value" REAL NOT NULL,
    "risk_level" REAL NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("risk_level_monitor_id") REFERENCES "risk_level_monitor"("id")
);
CREATE TABLE IF NOT EXISTS "risk_level_monitor_config_gradient" (
	"id" SERIAL NOT NULL UNIQUE,
    "risk_level_monitor_id" INT NOT NULL,
    "begin_value" REAL NOT NULL,
    "end_value" REAL NOT NULL,
    "begin_risk_level" REAL NOT NULL,
    "end_risk_level" REAL NOT NULL,
    "introduced" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    "archived" TIMESTAMPTZ DEFAULT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("risk_level_monitor_id") REFERENCES "risk_level_monitor"("id")
);

-------------------
---- Audit Log ----
-------------------

CREATE TABLE IF NOT EXISTS "audit_log_action" (
    "id" SERIAL NOT NULL UNIQUE,
    "action_id" TEXT NOT NULL,
    "action_text" TEXT NOT NULL,
    PRIMARY KEY("id")
);
CREATE INDEX IF NOT EXISTS "audit_log_action_hash_index" ON "audit_log_action" USING HASH ("id");

CREATE TABLE IF NOT EXISTS "control_audit_log" (
    "id" SERIAL NOT NULL UNIQUE,
    "date" TIMESTAMPTZ NOT NULL,
    "log_action_id" INT NOT NULL,
    "device_id" INT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("log_action_id") REFERENCES "audit_log_action"("id"),
    FOREIGN KEY("device_id") REFERENCES "device"("id"),
    FOREIGN KEY("actor_user_id") REFERENCES "user"("id")
);
CREATE TABLE IF NOT EXISTS "user_audit_log" (
    "id" SERIAL NOT NULL UNIQUE,
    "date" TIMESTAMPTZ NOT NULL,
    "log_action_id" INT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "target_user_id" TEXT NOT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("log_action_id") REFERENCES "audit_log_action"("id"),
    FOREIGN KEY("actor_user_id") REFERENCES "user"("id"),
    FOREIGN KEY("target_user_id") REFERENCES "user"("id")
);
CREATE TABLE IF NOT EXISTS "role_permissions_audit_log" (
    "id" SERIAL NOT NULL UNIQUE,
    "date" TIMESTAMPTZ NOT NULL,
    "log_action_id" INT NOT NULL,
    "actor_user_id" TEXT NOT NULL,
    "role_name" TEXT NOT NULL,
    "permission_id" INT,
    "added" BOOLEAN NOT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("log_action_id") REFERENCES "audit_log_action"("id"),
    FOREIGN KEY("actor_user_id") REFERENCES "user"("id"),
    FOREIGN KEY("permission_id") REFERENCES "permission"("id")
);

----------------------
---- IAM Settings ----
----------------------

CREATE TABLE IF NOT EXISTS "work_order_status" (
    "id" SERIAL NOT NULL UNIQUE,
    "status" TEXT NOT NULL UNIQUE,
    PRIMARY KEY("id")
);

CREATE TABLE IF NOT EXISTS "incident_category" (
    "id" SERIAL NOT NULL UNIQUE,
    "category" TEXT NOT NULL UNIQUE,
    PRIMARY KEY("id")
);

CREATE TABLE IF NOT EXISTS "incident_type" (
    "id" SERIAL NOT NULL UNIQUE,
    "incident_category_id" INT NOT NULL,
    "type" TEXT NOT NULL UNIQUE,
    PRIMARY KEY("id"),
    FOREIGN KEY("incident_category_id") REFERENCES "incident_category"("id")
);

--------------------
---- Work Order ----
--------------------

CREATE TYPE WORK_ORDER_STATE AS ENUM ('not_started','in_progress', 'completed', 'cancelled');
CREATE TABLE IF NOT EXISTS "work_order" (
    "id" SERIAL NOT NULL UNIQUE,
    "created_at" TIMESTAMPTZ NOT NULL,
    "creator_user_id" TEXT NOT NULL,
    "device_id" INT NOT NULL,
    "incident_type_id" INT NOT NULL,
    "priority" INT NOT NULL,
    "state" WORK_ORDER_STATE NOT NULL,
    "work_order_status_id" INT NOT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("creator_user_id") REFERENCES "user"("id"),
    FOREIGN KEY("device_id") REFERENCES "device"("id"),
    FOREIGN KEY("incident_type_id") REFERENCES "incident_type"("id"),
    FOREIGN KEY("work_order_status_id") REFERENCES "work_order_status"("id")
);

CREATE TABLE IF NOT EXISTS "work_order_update" (
    "id" SERIAL NOT NULL UNIQUE,
    "work_order_id" INT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL,
    "user_id" TEXT NOT NULL,
    "new_priority" INT NOT NULL,
    "new_state" WORK_ORDER_STATE NOT NULL,
    "new_work_order_status_id" INT NOT NULL,
    "description" VARCHAR(1024) NOT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("work_order_id") REFERENCES "work_order"("id"),
    FOREIGN KEY("user_id") REFERENCES "user"("id"),
    FOREIGN KEY("new_work_order_status_id") REFERENCES "work_order_status"("id")
);

CREATE TABLE IF NOT EXISTS "work_order_update_image" (
    "id" SERIAL NOT NULL UNIQUE,
    "work_order_id" INT NOT NULL,
    "description" VARCHAR(1024) NOT NULL,
    "path" VARCHAR(255) NOT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("work_order_id") REFERENCES "work_order"("id")
);

-------------------------
---- Seasonal Report ----
-------------------------

CREATE TABLE IF NOT EXISTS "seasonal_report_question_category" (
    "id" SERIAL NOT NULL UNIQUE,
    "category" TEXT NOT NULL,
    PRIMARY KEY("id")
);

CREATE TYPE SEASONAL_REPORT_QUESTION_RESPONSE AS ENUM ('no','yes', 'unknown');
CREATE TABLE IF NOT EXISTS "seasonal_report_question" (
    "id" SERIAL NOT NULL UNIQUE,
    "seasonal_report_question_category_id" INT NOT NULL,
    "question_text" TEXT NOT NULL,
    "is_critical" BOOLEAN NOT NULL,
    "expected_response" SEASONAL_REPORT_QUESTION_RESPONSE NOT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("seasonal_report_question_category_id") REFERENCES "seasonal_report_question_category"("id")
);

CREATE TABLE IF NOT EXISTS "seasonal_report_type" (
    "id" SERIAL NOT NULL UNIQUE,
    "report_type" TEXT NOT NULL,
    PRIMARY KEY("id")
);

CREATE TABLE IF NOT EXISTS "seasonal_report_type_question" (
    "id" SERIAL NOT NULL UNIQUE,
    "seasonal_report_type_id" INT NOT NULL,
    "seasonal_report_question_id" INT NOT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("seasonal_report_type_id") REFERENCES "seasonal_report_type"("id"),
    FOREIGN KEY("seasonal_report_question_id") REFERENCES "seasonal_report_question"("id"),
    CONSTRAINT "unique_seasonal_report_type_id_seasonal_report_question_id" UNIQUE("seasonal_report_type_id", "seasonal_report_question_id")
);

CREATE TABLE IF NOT EXISTS "seasonal_report" (
    "id" SERIAL NOT NULL UNIQUE,
    "seasonal_report_type_id" INT NOT NULL,
    "date" TIMESTAMPTZ NOT NULL,
    "user_id" TEXT NOT NULL,
    "device_id" INT NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "note" VARCHAR(1024) NOT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("seasonal_report_type_id") REFERENCES "seasonal_report_type"("id"),
    FOREIGN KEY("user_id") REFERENCES "user"("id"),
    FOREIGN KEY("device_id") REFERENCES "device"("id")
);

CREATE TABLE IF NOT EXISTS "seasonal_report_answer" (
    "id" SERIAL NOT NULL UNIQUE,
    "seasonal_report_id" INT NOT NULL,
    "seasonal_report_question_id" INT NOT NULL,
    "response" SEASONAL_REPORT_QUESTION_RESPONSE NOT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("seasonal_report_id") REFERENCES "seasonal_report"("id"),
    FOREIGN KEY("seasonal_report_question_id") REFERENCES "seasonal_report_question"("id")
);

CREATE TABLE IF NOT EXISTS "seasonal_report_image" (
    "id" SERIAL NOT NULL UNIQUE,
    "seasonal_report_id" INT NOT NULL,
    "description" VARCHAR(1024) NOT NULL,
    "path" VARCHAR(255) NOT NULL,
    PRIMARY KEY("id"),
    FOREIGN KEY("seasonal_report_id") REFERENCES "seasonal_report"("id")
);

--------------------------
---- Asset Management ----
--------------------------

CREATE TABLE IF NOT EXISTS "asset_type" (
    "id" SERIAL NOT NULL UNIQUE,
    "owner_client_id" INT NOT NULL,
    "name" VARCHAR(32) NOT NULL,
    "lifespan" INT,
    "current_value" MONEY,
    "point_of_sale" VARCHAR(255),
    "is_deprecated" BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY("id"),
    FOREIGN KEY("owner_client_id") REFERENCES "client"("id")
);

CREATE TABLE IF NOT EXISTS "asset" (
    "id" SERIAL NOT NULL UNIQUE,
    "asset_type_id" INT NOT NULL,
    "serial_number" VARCHAR(32),
    "creation_date" TIMESTAMPTZ NOT NULL,
    "deploy_date" TIMESTAMPTZ,
    "eos_date" TIMESTAMPTZ,
    "cost" MONEY,
    "gauge_station_id" INT,
    PRIMARY KEY("id"),
    FOREIGN KEY("asset_type_id") REFERENCES "asset_type"("id"),
    FOREIGN KEY("gauge_station_id") REFERENCES "gauge_station"("id"),
    CONSTRAINT "unique_asset_type_id_serial_number" UNIQUE("asset_type_id", "serial_number")
);