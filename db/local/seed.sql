--------------
---- City ----
--------------

INSERT INTO "city" ("id", "state", "name") VALUES
    (1, 'TX', 'College Station'),
    (2, 'TX', 'Bryan')
ON CONFLICT("id")
DO UPDATE SET
    "state" = EXCLUDED."state",
    "name" = EXCLUDED."name";

-- Explicit-id inserts don't advance the identity sequence; move it past the
-- highest seeded id so future inserts don't collide
SELECT setval(pg_get_serial_sequence('"city"', 'id'), (SELECT max("id") FROM "city"));

----------------
---- Client ----
----------------

INSERT INTO "client" ("id", "name") VALUES
    (1, 'Torres & Associates'),
    (2, 'City of Bryan')
ON CONFLICT("id")
DO UPDATE SET
    "name" = EXCLUDED."name";

-- Explicit-id inserts don't advance the identity sequence; move it past the
-- highest seeded id so future inserts don't collide
SELECT setval(pg_get_serial_sequence('"client"', 'id'), (SELECT max("id") FROM "client"));

--------------
---- Role ----
--------------

INSERT INTO "role" ("id", "name", "client_id") VALUES
    (1, 'ADMIN', 1),
    (2, 'TECHNICIAN', 1),
    (3, 'CLIENT_MANAGER', 2),
    (4, 'TECHNICIAN', 2)
ON CONFLICT("id")
DO UPDATE SET
    "name" = EXCLUDED."name",
    "client_id" = EXCLUDED."client_id";

-- Explicit-id inserts don't advance the identity sequence; move it past the
-- highest seeded id so future inserts don't collide
SELECT setval(pg_get_serial_sequence('"role"', 'id'), (SELECT max("id") FROM "role"));

---------------------
---- Permissions ----
---------------------

INSERT INTO "permission" ("id", "name", "description", "assign_role") VALUES
    (1, 'R_CLIENT_DEVICES', 'Can read all flood-warning related devices for their client', TRUE),
    (2, 'W_CLIENT_DEVICES', 'Can write all flood-warning related devices for their client', TRUE),
    (3, 'R_EXTERNAL_DEVICES', 'Can read all flood-warning related devices for all clients', TRUE),
    (4, 'W_EXTERNAL_DEVICES', 'Can write all flood-warning related devices across all clients', TRUE),
    (5, 'R_CLIENT_CONTROL_PANEL', 'Can read all manual overrides on the control panel for their client', TRUE),
    (6, 'W_CLIENT_CONTROL_PANEL', 'Can write manual overrides on the control panel for their client', TRUE),
    (7, 'R_EXTERNAL_CONTROL_PANEL', 'Can read all manual overrides on the control panel for all clients', TRUE),
    (8, 'W_EXTERNAL_CONTROL_PANEL', 'Can write manual overrides on the control panel for all clients', TRUE),
    (9, 'R_CLIENT_USERS', 'Can read all users in their client', TRUE),
    (10, 'W_CLIENT_USERS', 'Can write all users in their client', TRUE),
    (11, 'R_EXTERNAL_USERS', 'Can read all users across all clients', TRUE),
    (12, 'W_EXTERNAL_USERS', 'Can write all users across all clients', TRUE),
    (13, 'R_CLIENTS', 'Can read all clients', TRUE),
    (14, 'W_CLIENTS', 'Can write all clients', TRUE),
    (15, 'EX_CLIENT_ALERT', 'Can send alerts to all manual alert subscribers within his client', TRUE),
    (16, 'EX_EXTERNAL_ALERT', 'Can send alert to all manual alert subscribers across all clients', TRUE),
    (17, 'EX_EMAIL_SUB', 'Can subscribe for email based alerts', TRUE),
    (18, 'EX_TEXT_SUB', 'Can subscribe for text/SMS-based alerts', TRUE),
    (19, 'R_CLIENT_REPORTS', 'Can read all reports for their client', TRUE),
    (20, 'W_CLIENT_REPORTS', 'Can write all reports for their client', TRUE),
    (21, 'R_EXTERNAL_REPORTS', 'Can read all reports for all clients', TRUE),
    (22, 'W_EXTERNAL_REPORTS', 'Can write all reports for all clients', TRUE),
    (23, 'R_CLIENT_LIFT_STATIONS', 'Can read all lift station devices for their client', TRUE),
    (24, 'W_CLIENT_LIFT_STATIONS', 'Can write all lift station devices for their client', TRUE),
    (25, 'R_EXTERNAL_LIFT_STATIONS', 'Can read all lift station devices for all clients', TRUE),
    (26, 'W_EXTERNAL_LIFT_STATIONS', 'Can write all lift station devices for all clients', TRUE),
    (27, 'R_CLIENT_VOTES', 'Can read all votes to all people in their client', TRUE),
    (28, 'W_CLIENT_VOTES', 'Can assign votes to all people in their client', TRUE),
    (29, 'EX_CLIENT_VOTES', 'Can execute and vote on votes for their client', FALSE)
ON CONFLICT("id")
DO UPDATE SET
    "name" = EXCLUDED."name",
    "description" = EXCLUDED."description",
    "assign_role" = EXCLUDED."assign_role";

-- Explicit-id inserts don't advance the identity sequence; move it past the
-- highest seeded id so future inserts don't collide
SELECT setval(pg_get_serial_sequence('"permission"', 'id'), (SELECT max("id") FROM "permission"));

--------------------------
---- Role Permissions ----
--------------------------

INSERT INTO "role_permission" ("role_id", "permission_id") VALUES
    -- ADMIN (Torres & Associates, role 1)
    (1, 3),
    (1, 4),
    (1, 7),
    (1, 8),
    (1, 11),
    (1, 12),
    (1, 13),
    (1, 14),
    (1, 16),
    (1, 17),
    (1, 18),
    (1, 21),
    (1, 22),
    (1, 25),
    (1, 26),
    -- TECHNICIAN (Torres & Associates, role 2)
    (2, 3),
    (2, 4),
    (2, 7),
    (2, 8),
    (2, 11),
    (2, 17),
    (2, 18),
    (2, 21),
    (2, 22),
    (2, 25),
    (2, 26),
    -- CLIENT_MANAGER (City of Bryan, role 3)
    (3, 1),
    (3, 2),
    (3, 5),
    (3, 6),
    (3, 9),
    (3, 10),
    (3, 15),
    (3, 17),
    (3, 18),
    (3, 19),
    (3, 20),
    (3, 23),
    (3, 24),
    (3, 27),
    (3, 28),
    -- TECHNICIAN (City of Bryan, role 4)
    (4, 1),
    (4, 2),
    (4, 5),
    (4, 6),
    (4, 15),
    (4, 17),
    (4, 18),
    (4, 19),
    (4, 20)
ON CONFLICT ON CONSTRAINT "role_permission_role_id_permission_id_key"
DO NOTHING;

---------------
---- Alert ----
---------------

INSERT INTO "alert" ("client_id", "type", "level") VALUES
    (NULL, 'overtop', 'gauge_station'),
    (NULL, 'disconnect', 'device'),
    (NULL, 'low_battery', 'device'),
    (NULL, 'felled', 'device'),
    (NULL, 'low_storage', 'device');

-- Explicit-id inserts don't advance the identity sequence; move it past the
-- highest seeded id so future inserts don't collide
SELECT setval(pg_get_serial_sequence('"alert"', 'id'), (SELECT max("id") FROM "alert"));

INSERT INTO "alert_info" ("alert_id", "notification_type", "send_message", "retract_message") VALUES
    (1, 'email', 'FLOOD ALERT: High water likely at ${gauge_station_location} (Gauge Sta. ID: ${gauge_station_name})', 'FLOOD ALERT: High water has receded at ${gauge_station_location} (Gauge Sta. ID: ${gauge_station_name})'),
    (1, 'sms', 'FLOOD ALERT: High water likely at ${gauge_station_location} (Gauge Sta. ID: ${gauge_station_name})', 'FLOOD ALERT: High water has receded at ${gauge_station_location} (Gauge Sta. ID: ${gauge_station_name})'),
    (2, 'email', 'MAINTENANCE ALERT: Disconnected device ${device_serial_number} detected at ${gauge_station_location} (Gauge Sta. ID: ${gauge_station_name})', NULL),
    (2, 'sms', 'MAINTENANCE ALERT: Disconnected device ${device_serial_number} detected at ${gauge_station_location} (Gauge Sta. ID: ${gauge_station_name})', NULL),
    (3, 'email', 'MAINTENANCE ALERT: Low battery voltage detected for device ${device_serial_number} at ${gauge_station_location} (Gauge Sta. ID: ${gauge_station_name})', NULL),
    (3, 'sms', 'MAINTENANCE ALERT: Low battery voltage detected for device ${device_serial_number} at ${gauge_station_location} (Gauge Sta. ID: ${gauge_station_name})', NULL),
    (4, 'email', 'MAINTENANCE ALERT: Tilt threshold exceeded for device ${device_serial_number} at ${gauge_station_location} (Gauge Sta. ID: ${gauge_station_name})', NULL),
    (4, 'sms', 'MAINTENANCE ALERT: Tilt threshold exceeded for device ${device_serial_number} at ${gauge_station_location} (Gauge Sta. ID: ${gauge_station_name})', NULL),
    (5, 'email', 'MAINTENANCE ALERT: Low storage detected for device ${device_serial_number} at ${gauge_station_location} (Gauge Sta. ID: ${gauge_station_name})', NULL),
    (5, 'sms', 'MAINTENANCE ALERT: Low storage detected for device ${device_serial_number} at ${gauge_station_location} (Gauge Sta. ID: ${gauge_station_name})', NULL);

----------------------------------------
---- Universal Measurement Category ----
----------------------------------------

INSERT INTO "universal_measurement_category" ("id", "category") VALUES
    (1, 'input_voltage'),
    (2, 'input_current_draw'),
    (3, 'input_power_draw'),
    (4, 'rssi'),
    (5, 'rsrp'),
    (6, 'rsrq'),
    (7, 'aux_output_state'),
    (8, 'aux_output_source'),
    (9, 'total_storage_used'),
    (10, 'water_level'),
    (11, 'precipitation_increment'),
    (12, 'precipitation_accumulation'),
    (13, 'alignment'),
    (14, 'total_dropped_packets'),
    (15, 'total_dropped_data'),
    (16, 'server_connection_drops'),
    (17, 'network_connection_drops'),
    (18, 'total_connection_failures'),
    (19, 'active_sim_index'),
    (20, 'air_temperature'),
    (21, 'air_pressure'),
    (22, 'relative_humidity'),
    (23, 'water_velocity')
    -- ('TIME_SINCE_OG_TRANSMISSION'),
    -- ('WATER_TEMP'),
    -- ('WATER_CONDUCTANCE'),
    -- ('PRECIPITATION_ACCUMULATION_TOTAL'),
    -- ('RISK_LEVEL'), // Not used anymore
ON CONFLICT("id")
DO UPDATE SET
    "category" = EXCLUDED."category";

-- Explicit-id inserts don't advance the identity sequence; move it past the
-- highest seeded id so future inserts don't collide
SELECT setval(pg_get_serial_sequence('"universal_measurement_category"', 'id'), (SELECT max("id") FROM "universal_measurement_category"));

-----------------------
---- Product/Model ----
-----------------------

INSERT INTO "product" ("id", "hardware_string", "name", "description") VALUES
    (1, 'bfews,1', 'BFEWS Gauge', 'This is the gauge box for the BFEWS flood warning system.'),
    (2, 'bfews,2', 'BFEWS Flasher', 'This is the flaser box for the BFEWS flood warning system.'),
    (3, 'bfews,3', 'BFEWS Camera', 'This is the camera box for the BFEWS flood warning system.'),
    (4, 'brainbox1,0', 'bRainBox Dev', 'This is the development device for the bRainBox.'),
    (5, 'brainbox1,1', 'bRainBox', 'This is the main datalogger device for ATLAS system.'),
    (6, 'rainwatch1,0', 'RainWatch Dev', 'This is the development device used for RainWatch camera development.'),
    (7, 'rainwatch1,1', 'RainWatch', 'This is the main camera device used for the ATLAS system.')
ON CONFLICT("id")
DO UPDATE SET
    "hardware_string" = EXCLUDED."hardware_string",
    "name" = EXCLUDED."name",
    "description" = EXCLUDED."description";

-- Explicit-id inserts don't advance the identity sequence; move it past the
-- highest seeded id so future inserts don't collide
SELECT setval(pg_get_serial_sequence('"product"', 'id'), (SELECT max("id") FROM "product"));

INSERT INTO "model" ("id", "product_id", "number", "description") VALUES
    (1, 1, 'DL1', 'The datalogger used for the system that uses a pressure transducer.'),
    (2, 2, 'FL1', 'The flasher for the system.'),
    (3, 1, 'DL2', 'The datalogger variant that was modified to use an ultrasonic sensor.'),
    (4, 3, 'CA1', 'The camera used by the system.'),
    (5, 4, 'BB1', 'The test ATLAS datalogger'),
    (6, 5, 'BB1', 'The stable production version of the ATLAS dataloggers.'),
    (7, 6, 'CA1', 'This is the development model used for the ATLAS cameras.'),
    (8, 7, 'CA1', 'The stable production version of ATLAS cameras.')
ON CONFLICT ON CONSTRAINT "model_product_id_number_key"
DO NOTHING;

-- Explicit-id inserts don't advance the identity sequence; move it past the
-- highest seeded id so future inserts don't collide
SELECT setval(pg_get_serial_sequence('"model"', 'id'), (SELECT max("id") FROM "model"));

INSERT INTO "hardware_version" ("model_id", "version", "date", "note", "source") VALUES
    (1, '1.0.0', '2022-01-01T00:00:00', 'Oringal BFEWS datalogger hardware', ''), -- BFEWS,Datalogger,2,1,0,0
    (2, '1.0.0', '2022-01-01T00:00:00', 'Oringal BFEWS flasher hardware', ''), -- BFEWS,Flasher,3,1,0,0
    (3, '1.0.0', '2023-01-01T00:00:00', 'BFEWS datalogger hardware designed to work with an ultrasonic sensor', ''), -- BFEWS Ultrasonic sensor
    (4, '1.0.0', '2024-01-01T00:00:00', 'BFEWS datalogger hardware designed to work with a camera', ''), -- BFEWS Camera
    (5, '0.0.1', '2024-11-25T00:00:00', 'Initial test box or trying out new design.', ''), -- for the one test box with the mpu6050
    (6, '1.0.0', '2025-02-01 00:00:00', 'Initial design. First 3-5 test circuit boards with issues.', ''), -- for the first 3-5 test ones with circuit board issues
    (6, '1.0.1', '2025-05-01 00:00:00', 'Updated power circuit, sdi12 power control, moved power leds, inverted + debouncing switch. USB to UART chips came DOA and required manual fixing.', ''), -- first batch with non-functional usb ports
    (6, '1.1.0', '2025-09-24T20:21:37.491412', 'Removed USBs with pins for flashing. Fixed debouncing pin terminals. Added low side switch for aux ports. Used the wrong type of mosfet for the aux output had to short aux - to ground to fix.', ''), -- for the second batch just needing the solder to fix the aux out
    (7, '0.0.1', '2026-06-01T00:00:00.000', 'First development version of the new camera for the ATLAS system.', ''),
    (8, '1.0.0', '2026-07-09T14:00:00.000', 'Initial design and deployment of camera for testing with ATLAS.', '')
ON CONFLICT ON CONSTRAINT "hardware_version_model_id_version_key"
DO NOTHING;

INSERT INTO "firmware_version" ("model_id", "version", "date", "note", "source") VALUES
    (1, '1.0.0', '2022-01-01T00:00:00', 'Oringal BFEWS datalogger firmware', ''),
    (2, '1.0.0', '2022-01-01T00:00:00', 'Oringal BFEWS flasher firmware', ''),
    (3, '1.0.0', '2023-01-01T00:00:00', 'BFEWS datalogger firmware modified to work with an ultrasonic sensor', ''),
    (4, '1.0.0', '2024-01-01T00:00:00', 'BFEWS datalogger firmware modified to work with a camera', ''),
    (5, '0.0.1', '2024-11-25T00:00:00', 'Initial test box firmware', ''),
    (6, '0.1.1', '2025-05-01T00:00:00', 'Release firmware', ''),
    (6, '0.1.2', '2025-07-01T14:58:46.91862', 'BMA253 channel fix', ''),
    (6, '0.1.3', '2025-07-17T20:25:02.594662', 'Launch SDI12 Fix', ''),
    (6, '0.1.4', '2025-07-25T14:30:46.525895', 'Added SDI12 CLI and fixed BMA253 wakeup', ''),
    (6, '0.2.0', '2025-08-14T15:47:05.004939', 'Added support for barrier arm/pulse output. Added dynamic memory guards to launched task functions, single pulse for aux output, fixed updated SDI12 measurement taking', ''),
    (6, '0.2.1', '2025-09-23T13:19:15.555919', 'Wifi interface rebuild to stop crashing. Added 100ms wait before loop.', ''),
    (6, '0.3.0', '2025-10-31T13:47:20.451136', 'MQTT API 3.0 used. Improved SDI12 stability. Added sensor error reporting. Setup framework for better startup.', ''),
    (6, '0.3.1', '2025-11-18T23:04:56.10524', 'Fixed alerting when null was returned. Improved SDI12 consistency and wifi stability. Fixed flashing manual control levels.', ''),
    (6, '0.3.2', '2025-12-12T22:39:16.677327', 'Fixed accumulationOverTime. Added aux button control on init. Updated MQTT library and made more reliable and DNS library.', ''),
    (6, '0.3.3', '2026-01-22T22:22:09.869737', 'Beta Version: added hardware UART sdi12, addressed memory issues, fixed multi-monitored code support', ''),
    (6, '0.3.4', '2026-02-11T22:09:15.546974', 'Testing Version: improved stability of the wifi interface', ''),
    (6, '0.3.5', '2026-07-08T16:02:55.806395', 'Testing Version: New MQTT library (should fix corrupted packets)', ''),
    (7, '0.0.1', '2026-06-01T00:00:00.000', 'Initial firmware for testing the camera.', ''),
    (8, '1.0.0', '2026-07-09T14:00:00.000', 'Initial firmware working with the ATLAS including basic flooded car detection.', '')
ON CONFLICT ON CONSTRAINT "firmware_version_model_id_version_key"
DO NOTHING;

---------------------------
---- Audit Log Actions ----
---------------------------

INSERT INTO "audit_log_action" ("id", "action_id", "action_text") VALUES
    (1, 'WIFI_ON',	'Wifi On'),
    (2, 'WIFI_OFF',	'Wifi Off'),
    (3, 'MAN_OVERTOP_ON',	'Triggered Manual Overtop'),
    (4, 'MAN_OVERTOP_OFF',	'Untriggered Manual Overtop'),
    (5, 'PING',	'Pinged Device'),
    (6, 'MAN_MEASURE',	'Manual Measurement'),
    (7, 'MAN_FLASHER_ON',	'Manual Activation of Flasher'),
    (8, 'MAN_FLASHER_OFF',	'Manual Deactivation of Flasher'),
    (9, 'REQ_IMAGE',	'Manual Request of Image'),
    (10, 'REQ_VIDEO',	'Manual Request of Video'),
    (11, 'SET_CAMERA_PRESET',	'Manual setting of the Camera Preset'),
    (12, 'BARRIER_ARM_OPEN',	'Manual Opening Barrier Arm'),
    (13, 'BARRIER_ARM_CLOSED',	'Manual Closing of Barrier Arm'),
    (14, 'INIT_DEVICE',	'Intialization of a New Device'),
    (15, 'REGISTER_DEVICE',	'Registering a New Device'),
    (16, 'UPDATE_DEVICE_CONFIG',	'Updating/Editing Device''s Config'),
    (17, 'INVITE_USER',	'Inviting a new User'),
    (18, 'DELETE_INVITE_USER',	'Deleting an invite for a new User'),
    (19, 'DELETE_USER',	'Deleting a User'),
    (20, 'UPDATE_USER',	'Updating/Editing a User''s Config'),
    (21, 'CREATE_ROLE',	'Create a new role'),
    (22, 'UPDATE_ROLE_PERMISSIONS',	'Updating the permissions tied to a role'),
    (23, 'DELETE_ROLE',	'Deleting a role')
ON CONFLICT("id")
DO UPDATE SET
    "action_id" = EXCLUDED."action_id",
    "action_text" = EXCLUDED."action_text";

-- Explicit-id inserts don't advance the identity sequence; move it past the
-- highest seeded id so future inserts don't collide
SELECT setval(pg_get_serial_sequence('"audit_log_action"', 'id'), (SELECT max("id") FROM "audit_log_action"));

---------------------------
---- Incident Category ----
---------------------------

INSERT INTO "incident_category" ("id", "category") VALUES
    (1, 'power'),
    (2, 'signal'),
    (3, 'physical'),
    (4, 'other')
ON CONFLICT("id")
DO UPDATE SET
    "category" = EXCLUDED."category";

-- Explicit-id inserts don't advance the identity sequence; move it past the
-- highest seeded id so future inserts don't collide
SELECT setval(pg_get_serial_sequence('"incident_category"', 'id'), (SELECT max("id") FROM "incident_category"));

-----------------------
---- Incident Type ----
-----------------------

INSERT INTO "incident_type" ("id", "incident_category_id", "type") VALUES
    (1, 1, 'no_power'),
    (2, 1, 'low_power'),
    (3, 1, 'high_power'),
    (4, 1, 'intermittent_power'),
    (5, 1, 'other_power'),
    (6, 2, 'no_signal'),
    (7, 2, 'low_signal'),
    (8, 2, 'high_signal'),
    (9, 2, 'intermittent_signal'),
    (10, 2, 'other_signal'),
    (11, 3, 'physical_damage'),
    (12, 3, 'physical_obstruction'),
    (13, 3, 'spider_infestation'),
    (14, 3, 'other_physical'),
    (15, 4, 'other')
ON CONFLICT("id")
DO UPDATE SET
    "type" = EXCLUDED."type",
    "incident_category_id" = EXCLUDED."incident_category_id";


-- Explicit-id inserts don't advance the identity sequence; move it past the
-- highest seeded id so future inserts don't collide
SELECT setval(pg_get_serial_sequence('"incident_type"', 'id'), (SELECT max("id") FROM "incident_type"));

---------------------------
---- Work Order Status ----
---------------------------

INSERT INTO "work_order_status" ("id","status") VALUES
    (1,'ready'),
    (2,'investigate'),
    (3,'unassigned'),
    (4,'orderparts'),
    (5,'shipping'),
    (6,'wiring'),
    (7, 'done')
ON CONFLICT("id")
DO UPDATE SET
    "status" = EXCLUDED."status";

-- Explicit-id inserts don't advance the identity sequence; move it past the
-- highest seeded id so future inserts don't collide
SELECT setval(pg_get_serial_sequence('"work_order_status"', 'id'), (SELECT max("id") FROM "work_order_status"));

-------------------------------------------
---- Seasonal Report Question Category ----
-------------------------------------------
INSERT INTO "seasonal_report_question_category" ("id", "category") VALUES
    (1, 'power_management'),
    (2, 'sensor_performance'),
    (3, 'apparatus_conditions')
ON CONFLICT("id")
DO UPDATE SET
    "category" = EXCLUDED."category";

-- Explicit-id inserts don't advance the identity sequence; move it past the
-- highest seeded id so future inserts don't collide
SELECT setval(pg_get_serial_sequence('"seasonal_report_question_category"', 'id'), (SELECT max("id") FROM "seasonal_report_question_category"));

------------------------------
---- Seasonal Report Type ----
------------------------------
INSERT INTO "seasonal_report_type" ("id", "report_type") VALUES
    (1, 'seasonalReportV1')
ON CONFLICT("id")
DO UPDATE SET
    "report_type" = EXCLUDED."report_type";

-- Explicit-id inserts don't advance the identity sequence; move it past the
-- highest seeded id so future inserts don't collide
SELECT setval(pg_get_serial_sequence('"seasonal_report_type"', 'id'), (SELECT max("id") FROM "seasonal_report_type"));

----------------------------------
---- Seasonal Report Question ----
----------------------------------

INSERT INTO "seasonal_report_question" ("id", "seasonal_report_question_category_id", "question_text", "is_critical", "expected_response") VALUES
    (1, 1, 'Is solar panel rated for at least 65 Watts?', FALSE, 'yes'),
    (2, 1, '"Solar panel voltage into sunsaver (N/A if sun is setting, between 17 and 20 V)"', TRUE, 'yes'),
    (3, 1, 'Is battery voltage above 12 volts?', FALSE, 'yes'),
    (4, 1, 'Continuity Check?', TRUE, 'yes'),
    (5, 1, 'Is green status indicator light on?', TRUE, 'yes'),
    (6, 1, 'Is solar panel visibly clean?', FALSE, 'yes'),
    (7, 1, 'Does solar panel get ample sunlight?', TRUE, 'yes'),
    (8, 2, 'Pressure Transducer Perform?', TRUE, 'yes'),
    (9, 2, 'Rain bucket perform?', TRUE, 'yes'),
    (10, 2, 'Temperature pressure humidity readings register on ATLASRainTM?', TRUE, 'yes'),
    (11, 3, 'Is pole upright and level?', TRUE, 'yes'),
    (12, 3, 'Is rain bucket upright and level?', TRUE, 'yes'),
    (13, 3, 'Poles appear structurally stable', TRUE, 'yes'),
    (14, 3, 'Signs of corrosion on pole, conduit, cabinet box, etc.?', FALSE, 'no'),
    (15, 3, 'Is the buried conduit exposed where it shouldn''t be?', TRUE, 'no'),
    (16, 3, 'PT sensor appear dry and 1.5 ft above flowline?', TRUE, 'yes'),
    (17, 3, 'Has Rainbucket been cleaned for leaves and bird droppings?', FALSE, 'yes'),
    (18, 3, 'Has pressure transducer been wiped and cleaned?', FALSE, 'yes'),
    (19, 3, 'Are there signs of vandalism?', TRUE, 'no'),
    (20, 3, 'Are there signs of pest infestation?', TRUE, 'no'),
    (21, 3, 'Has pest control been established?', TRUE, 'yes'),
    (22, 3, 'Is there noticeable debris in channel near PT placement?', FALSE, 'no'),
    (23, 3, 'Has debris been cleared?', TRUE, 'yes')
ON CONFLICT("id")
DO UPDATE SET
    "seasonal_report_question_category_id" = EXCLUDED."seasonal_report_question_category_id",
    "question_text" = EXCLUDED."question_text",
    "is_critical" = EXCLUDED."is_critical",
    "expected_response" = EXCLUDED."expected_response";

-- Explicit-id inserts don't advance the identity sequence; move it past the
-- highest seeded id so future inserts don't collide
SELECT setval(pg_get_serial_sequence('"seasonal_report_question"', 'id'), (SELECT max("id") FROM "seasonal_report_question"));

---------------------------------------
---- Seasonal Report Type Question ----
---------------------------------------

INSERT INTO "seasonal_report_type_question" ("seasonal_report_type_id", "seasonal_report_question_id") VALUES
    (1,1),
    (1,2),
    (1,3),
    (1,4),
    (1,5),
    (1,6),
    (1,7),
    (1,8),
    (1,9),
    (1,10),
    (1,11),
    (1,12),
    (1,13),
    (1,14),
    (1,15),
    (1,16),
    (1,17),
    (1,18),
    (1,19),
    (1,20),
    (1,21),
    (1,22),
    (1,23)
ON CONFLICT ON CONSTRAINT "seasonal_report_type_question_seasonal_report_type_id_seaso_key"
DO NOTHING;