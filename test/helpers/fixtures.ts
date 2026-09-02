import type pg from "pg";

/**
 * Seeds the gauge-station/device/channel fixture world that several test
 * suites hardcode ids and serial numbers against. These rows used to live in
 * db/local/seed.sql; the seed now only carries production reference data, so
 * tests create their own fixtures here.
 *
 * Layout (ids are explicit because tests assert against them):
 *   gauge_station 1 "bryan-test-gauge"            -> client 2 (City of Bryan)
 *   gauge_station 2 "college-station-test-gauge"  -> client 1 (Torres)
 *   device 1 "bryan-test-device"           on station 1, channels 1 (Stage), 2 (Rain)
 *   device 2 "college-station-test-device" on station 2, channels 3 (Stage), 4 (Battery)
 */
export async function seedDeviceFixtures(pool: pg.Pool): Promise<void> {
	// pg runs multi-statement strings via the simple query protocol, so the
	// whole fixture set applies in one round trip.
	await pool.query(`
		INSERT INTO "gauge_station" ("id", "name") VALUES
		    (1, 'bryan-test-gauge'),
		    (2, 'college-station-test-gauge');
		SELECT setval(pg_get_serial_sequence('"gauge_station"', 'id'), (SELECT max("id") FROM "gauge_station"));

		INSERT INTO "gauge_station_info" ("id", "gauge_station_id", "city_id", "location", "latitude", "longitude") VALUES
		    (1, 1, 2, 'Bryan Alert Test Gauge', 30.6744, -96.3700),
		    (2, 2, 1, 'College Station Alert Test Gauge', 30.6279, -96.3344);
		SELECT setval(pg_get_serial_sequence('"gauge_station_info"', 'id'), (SELECT max("id") FROM "gauge_station_info"));

		INSERT INTO "client_gauge_station" ("id", "gauge_station_id", "client_id") VALUES
		    (1, 1, 2),
		    (2, 2, 1);
		SELECT setval(pg_get_serial_sequence('"client_gauge_station"', 'id'), (SELECT max("id") FROM "client_gauge_station"));

		INSERT INTO "device" ("id", "serial_number") VALUES
		    (1, 'bryan-test-device'),
		    (2, 'college-station-test-device');
		SELECT setval(pg_get_serial_sequence('"device"', 'id'), (SELECT max("id") FROM "device"));

		INSERT INTO "device_info" ("id", "device_id", "gauge_station_id", "type", "active", "latitude", "longitude") VALUES
		    (1, 1, 1, 'gauge', TRUE, 30.6744, -96.3700),
		    (2, 2, 2, 'gauge', TRUE, 30.6279, -96.3344);
		SELECT setval(pg_get_serial_sequence('"device_info"', 'id'), (SELECT max("id") FROM "device_info"));

		INSERT INTO "channel" ("id", "device_id", "local_id", "channel_type_id") VALUES
		    (1, 1, 1, 1),
		    (2, 1, 2, 1),
		    (3, 2, 1, 1),
		    (4, 2, 2, 1);
		SELECT setval(pg_get_serial_sequence('"channel"', 'id'), (SELECT max("id") FROM "channel"));

		INSERT INTO "channel_config" ("id", "channel_id", "name", "active", "category", "units", "scale", "offset") VALUES
		    (1, 1, 'Stage', TRUE, 'water', 'ft', 1, 0),
		    (2, 2, 'Rain', TRUE, 'rain', 'in', 1, 0),
		    (3, 3, 'Stage', TRUE, 'water', 'ft', 1, 0),
		    (4, 4, 'Battery', TRUE, 'power', 'V', 1, 0);
		SELECT setval(pg_get_serial_sequence('"channel_config"', 'id'), (SELECT max("id") FROM "channel_config"));

		INSERT INTO "channel_config_display" ("id", "channel_id", "display_index") VALUES
		    (1, 1, 1),
		    (2, 2, 2),
		    (3, 3, 1),
		    (4, 4, 2);
		SELECT setval(pg_get_serial_sequence('"channel_config_display"', 'id'), (SELECT max("id") FROM "channel_config_display"));

		INSERT INTO "channel_config_internal_power_sensor" ("id", "channel_id", "measurement_type") VALUES
		    (1, 4, 'voltage');
		SELECT setval(pg_get_serial_sequence('"channel_config_internal_power_sensor"', 'id'), (SELECT max("id") FROM "channel_config_internal_power_sensor"));

		INSERT INTO "channel_config_sdi12" ("id", "channel_id", "address", "measurement_set", "measurement_index") VALUES
		    (1, 1, '0', 0, 0),
		    (2, 3, '0', 0, 0);
		SELECT setval(pg_get_serial_sequence('"channel_config_sdi12"', 'id'), (SELECT max("id") FROM "channel_config_sdi12"));

		INSERT INTO "channel_config_accumulation" ("id", "channel_id", "source_local_id", "drain_const") VALUES
		    (1, 2, 1, 0);
		SELECT setval(pg_get_serial_sequence('"channel_config_accumulation"', 'id'), (SELECT max("id") FROM "channel_config_accumulation"));
	`);
}
