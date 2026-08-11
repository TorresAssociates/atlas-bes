import { afterAll, beforeAll, expect, setDefaultTimeout, test } from "bun:test";
import type { FastifyInstance } from "fastify";
import type { AlertSNSClient } from "@/lib/sns/AlertSNSClient";
import { buildApp } from "@/server";
import { signUpTestUser, type TestUserSession } from "./helpers/auth";
import {
	startTestDatabase,
	stubConfigEnv,
	type TestDatabase,
} from "./helpers/database";

setDefaultTimeout(120_000);

let db: TestDatabase;
let app: FastifyInstance;
let cityManager: TestUserSession;
let admin: TestUserSession;
let gaugeStationId: number;
let deviceId: number;
const snsSubscriptions: Array<{ phoneNumber: string; topic: string }> = [];
const snsUnsubscriptions: Array<{ phoneNumber: string; topic: string }> = [];
const snsDeletedTopics: string[] = [];
const snsMessages: Array<{ topic: string; message: string }> = [];

const fakeAlertSns = {
	getTopicName(
		gaugeName: string,
		deviceSerialNumber: string | null,
		warningType: string,
	) {
		return `${gaugeName}_${deviceSerialNumber ? "Device_" : ""}alert_${warningType}`;
	},
	getAlertMessage(
		gaugeName: string,
		deviceSerialNumber: string | null,
		warningDescription: string,
	) {
		const alertTarget =
			deviceSerialNumber === null ? "" : `(${deviceSerialNumber}) `;
		return `Alert - ${warningDescription} ${alertTarget}at Gauge ${gaugeName}!`;
	},
	async subscribeSms(phoneNumber: string, topic: string) {
		snsSubscriptions.push({ phoneNumber, topic });
		return "arn:test:subscription";
	},
	async unsubscribeSms(phoneNumber: string, topic: string) {
		snsUnsubscriptions.push({ phoneNumber, topic });
	},
	async deleteTopicIfNoSubscriptions(topic: string) {
		snsDeletedTopics.push(topic);
		return true;
	},
	async sendMessage(topic: string, message: string) {
		snsMessages.push({ topic, message });
		return "message-id-test";
	},
} as unknown as AlertSNSClient;

beforeAll(async () => {
	stubConfigEnv();
	db = await startTestDatabase();
	app = await buildApp({
		pool: db.pool,
		logger: false,
		alertSns: fakeAlertSns,
	});

	cityManager = await signUpTestUser(app, {
		email: "alert-city-manager@example.com",
		name: "Alert City Manager",
		client_id: 2,
		role_id: 3,
	});
	admin = await signUpTestUser(app, {
		email: "alert-admin@example.com",
		name: "Alert Admin",
		client_id: 1,
		role_id: 1,
	});

	const phone = await app.inject({
		method: "PATCH",
		url: "/v1/users/me/phone-number",
		headers: { cookie: cityManager.cookie },
		body: { phone_number: "+15555550300" },
	});
	if (phone.statusCode !== 200)
		throw new Error(
			`failed to set phone: ${phone.statusCode} ${phone.body}`,
		);

	const adminPhone = await app.inject({
		method: "PATCH",
		url: "/v1/users/me/phone-number",
		headers: { cookie: admin.cookie },
		body: { phone_number: "+15555550100" },
	});
	if (adminPhone.statusCode !== 200)
		throw new Error(
			`failed to set admin phone: ${adminPhone.statusCode} ${adminPhone.body}`,
		);

	const station = await db.pool.query<{ id: number }>(
		`INSERT INTO gauge_station (name) VALUES ('alert-test-gauge') RETURNING id`,
	);
	gaugeStationId = station.rows[0]!.id;

	await db.pool.query(
		`INSERT INTO gauge_station_info (gauge_station_id, city_id, location, latitude, longitude)
		 VALUES ($1, 2, 'Alert Test Location', 30.6744, -96.37)`,
		[gaugeStationId],
	);
	await db.pool.query(
		`INSERT INTO client_gauge_station (gauge_station_id, client_id) VALUES ($1, 2)`,
		[gaugeStationId],
	);

	const device = await db.pool.query<{ id: number }>(
		`INSERT INTO device (serial_number) VALUES ('alert-test-device') RETURNING id`,
	);
	deviceId = device.rows[0]!.id;
	await db.pool.query(
		`INSERT INTO device_info (device_id, gauge_station_id, type, active)
		 VALUES ($1, $2, 'datalogger', true)`,
		[deviceId, gaugeStationId],
	);
});

afterAll(async () => {
	await app?.close();
	await db?.stop();
});

interface AlertSubscriptionBody {
	id: number;
	user_id: string;
	gauge_station_id: number;
	alert_id: number;
	notification_type: "sms" | "email";
	archived: string | null;
}

interface AlertSubscriptionDetailBody extends AlertSubscriptionBody {
	alert_type: string;
	alert_level: "gauge_station" | "device";
	client_id: number;
	gauge_station_name: string;
}

interface AlertSubscriptionListBody {
	data: AlertSubscriptionDetailBody[];
}

interface DeleteAlertSubscriptionsBody {
	message: string;
	data: AlertSubscriptionBody[];
}

interface TestAlertMessageBody {
	message: string;
	topic: string;
	message_id: string | null;
}

interface TestAlertSubscriptionBody {
	message: string;
	topic: string;
	phone_number: string;
}

test("POST /v1/alerts/subscriptions/user/:userId/gaugeAlerts subscribes a user to a gauge alert", async () => {
	const res = await app.inject({
		method: "POST",
		url: `/v1/alerts/subscriptions/user/${cityManager.id}/gaugeAlerts`,
		headers: { cookie: cityManager.cookie },
		body: { gauge_station_id: gaugeStationId, alert_type: "flood" },
	});

	expect(res.statusCode).toBe(201);
	expect(res.json<AlertSubscriptionBody>()).toEqual(
		expect.objectContaining({
			user_id: cityManager.id,
			gauge_station_id: gaugeStationId,
			notification_type: "sms",
		}),
	);
	expect(snsSubscriptions).toContainEqual({
		phoneNumber: "+15555550300",
		topic: "alert-test-gauge_alert_flood",
	});

	const alert = await db.pool.query<{
		level: string;
		type: string;
		client_id: number;
	}>(`SELECT level::text, type, client_id FROM alert WHERE id = $1`, [
		res.json<AlertSubscriptionBody>().alert_id,
	]);
	expect(alert.rows[0]).toEqual({
		level: "gauge_station",
		type: "flood",
		client_id: 2,
	});
});

test("POST /v1/alerts/subscriptions/user/:userId/gaugeAlerts lets admins subscribe themselves to another client's gauge", async () => {
	const res = await app.inject({
		method: "POST",
		url: `/v1/alerts/subscriptions/user/${admin.id}/gaugeAlerts`,
		headers: { cookie: admin.cookie },
		body: { gauge_station_id: gaugeStationId, alert_type: "adminSelf" },
	});

	expect(res.statusCode).toBe(201);
	expect(res.json<AlertSubscriptionBody>()).toEqual(
		expect.objectContaining({
			user_id: admin.id,
			gauge_station_id: gaugeStationId,
			notification_type: "sms",
		}),
	);
	expect(snsSubscriptions).toContainEqual({
		phoneNumber: "+15555550100",
		topic: "alert-test-gauge_alert_adminSelf",
	});
});

test("POST /v1/alerts/subscriptions/user/:userId/deviceAlerts subscribes a user to a device alert", async () => {
	const res = await app.inject({
		method: "POST",
		url: `/v1/alerts/subscriptions/user/${cityManager.id}/deviceAlerts`,
		headers: { cookie: cityManager.cookie },
		body: { device_id: deviceId, alert_type: "offline" },
	});

	expect(res.statusCode).toBe(201);
	expect(res.json<AlertSubscriptionBody>()).toEqual(
		expect.objectContaining({
			user_id: cityManager.id,
			gauge_station_id: gaugeStationId,
			notification_type: "sms",
		}),
	);
	expect(snsSubscriptions).toContainEqual({
		phoneNumber: "+15555550300",
		topic: "alert-test-gauge_Device_alert_offline",
	});

	const alert = await db.pool.query<{
		level: string;
		type: string;
		client_id: number;
	}>(`SELECT level::text, type, client_id FROM alert WHERE id = $1`, [
		res.json<AlertSubscriptionBody>().alert_id,
	]);
	expect(alert.rows[0]).toEqual({
		level: "device",
		type: "offline",
		client_id: 2,
	});
});

test("GET /v1/alerts/subscriptions/user/:userId/gaugeAlerts lists gauge alert subscriptions", async () => {
	const created = await app.inject({
		method: "POST",
		url: `/v1/alerts/subscriptions/user/${cityManager.id}/gaugeAlerts`,
		headers: { cookie: cityManager.cookie },
		body: { gauge_station_id: gaugeStationId, alert_type: "listGauge" },
	});
	expect(created.statusCode).toBe(201);

	const res = await app.inject({
		method: "GET",
		url: `/v1/alerts/subscriptions/user/${cityManager.id}/gaugeAlerts`,
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<AlertSubscriptionListBody>().data).toContainEqual(
		expect.objectContaining({
			id: created.json<AlertSubscriptionBody>().id,
			alert_type: "listGauge",
			alert_level: "gauge_station",
			gauge_station_name: "alert-test-gauge",
		}),
	);
});

test("GET /v1/alerts/subscriptions/user/:userId/deviceAlerts lists device alert subscriptions", async () => {
	const created = await app.inject({
		method: "POST",
		url: `/v1/alerts/subscriptions/user/${cityManager.id}/deviceAlerts`,
		headers: { cookie: cityManager.cookie },
		body: { device_id: deviceId, alert_type: "listDevice" },
	});
	expect(created.statusCode).toBe(201);

	const res = await app.inject({
		method: "GET",
		url: `/v1/alerts/subscriptions/user/${cityManager.id}/deviceAlerts`,
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<AlertSubscriptionListBody>().data).toContainEqual(
		expect.objectContaining({
			id: created.json<AlertSubscriptionBody>().id,
			alert_type: "listDevice",
			alert_level: "device",
			gauge_station_name: "alert-test-gauge",
		}),
	);
});

test("DELETE /v1/alerts/subscriptions/user/:userId/gaugeAlerts archives one gauge alert subscription", async () => {
	const created = await app.inject({
		method: "POST",
		url: `/v1/alerts/subscriptions/user/${cityManager.id}/gaugeAlerts`,
		headers: { cookie: cityManager.cookie },
		body: { gauge_station_id: gaugeStationId, alert_type: "delGauge" },
	});
	const subscriptionId = created.json<AlertSubscriptionBody>().id;

	const res = await app.inject({
		method: "DELETE",
		url: `/v1/alerts/subscriptions/user/${cityManager.id}/gaugeAlerts?gaugeSubscriptionId=${subscriptionId}`,
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<DeleteAlertSubscriptionsBody>()).toEqual(
		expect.objectContaining({
			message: "Success",
			data: [
				expect.objectContaining({
					id: subscriptionId,
					archived: expect.any(String),
				}),
			],
		}),
	);
	expect(snsUnsubscriptions).toContainEqual({
		phoneNumber: "+15555550300",
		topic: "alert-test-gauge_alert_delGauge",
	});
	expect(snsDeletedTopics).toContain("alert-test-gauge_alert_delGauge");

	const archived = await db.pool.query<{ archived: Date | null }>(
		`SELECT archived FROM alert_subscription WHERE id = $1`,
		[subscriptionId],
	);
	expect(archived.rows[0]!.archived).toBeInstanceOf(Date);
});

test("DELETE /v1/alerts/subscriptions/user/:userId/deviceAlerts archives device alert subscriptions", async () => {
	const created = await app.inject({
		method: "POST",
		url: `/v1/alerts/subscriptions/user/${cityManager.id}/deviceAlerts`,
		headers: { cookie: cityManager.cookie },
		body: { device_id: deviceId, alert_type: "delDevice" },
	});
	expect(created.statusCode).toBe(201);

	const res = await app.inject({
		method: "DELETE",
		url: `/v1/alerts/subscriptions/user/${cityManager.id}/deviceAlerts`,
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(200);
	const body = res.json<DeleteAlertSubscriptionsBody>();
	expect(body.message).toBe("Success");
	expect(body.data.length).toBeGreaterThanOrEqual(1);
	expect(body.data).toContainEqual(
		expect.objectContaining({
			id: created.json<AlertSubscriptionBody>().id,
			archived: expect.any(String),
		}),
	);
	expect(snsUnsubscriptions).toContainEqual({
		phoneNumber: "+15555550300",
		topic: "alert-test-gauge_Device_alert_delDevice",
	});
	expect(snsDeletedTopics).toContain(
		"alert-test-gauge_Device_alert_delDevice",
	);
});

test("POST /v1/alerts/testMessage sends the monthly test message", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/alerts/testMessage",
		headers: { cookie: admin.cookie },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<TestAlertMessageBody>()).toEqual({
		message: "Success",
		topic: "ATLASTEST",
		message_id: "message-id-test",
	});
	expect(snsMessages).toContainEqual({
		topic: "ATLASTEST",
		message:
			"This is the monthly test of the ATLAS messaging system. No Action Required.",
	});
});

test("POST /v1/alerts/testMessage rejects client alert senders", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/alerts/testMessage",
		headers: { cookie: cityManager.cookie },
	});

	expect(res.statusCode).toBe(403);
});
test("POST /v1/alerts/testMessage/subscriptions subscribes a phone number to ATLASTEST", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/alerts/testMessage/subscriptions",
		headers: { cookie: admin.cookie },
		body: { phone_number: "+15555550400" },
	});

	expect(res.statusCode).toBe(201);
	expect(res.json<TestAlertSubscriptionBody>()).toEqual({
		message: "Success",
		topic: "ATLASTEST",
		phone_number: "+15555550400",
	});
	expect(snsSubscriptions).toContainEqual({
		phoneNumber: "+15555550400",
		topic: "ATLASTEST",
	});
});

test("DELETE /v1/alerts/testMessage/subscriptions unsubscribes a phone number from ATLASTEST", async () => {
	const res = await app.inject({
		method: "DELETE",
		url: "/v1/alerts/testMessage/subscriptions",
		headers: { cookie: admin.cookie },
		body: { phone_number: "+15555550400" },
	});

	expect(res.statusCode).toBe(200);
	expect(res.json<TestAlertSubscriptionBody>()).toEqual({
		message: "Success",
		topic: "ATLASTEST",
		phone_number: "+15555550400",
	});
	expect(snsUnsubscriptions).toContainEqual({
		phoneNumber: "+15555550400",
		topic: "ATLASTEST",
	});
	expect(snsDeletedTopics).toContain("ATLASTEST");
});

test("POST /v1/alerts/testMessage/subscriptions rejects client alert senders", async () => {
	const res = await app.inject({
		method: "POST",
		url: "/v1/alerts/testMessage/subscriptions",
		headers: { cookie: cityManager.cookie },
		body: { phone_number: "+15555550400" },
	});

	expect(res.statusCode).toBe(403);
});
