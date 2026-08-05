import { type Insertable, type Kysely, type Selectable, sql } from "kysely";
import type { AlertLevel, DB, NotificationType } from "@/db/types";

export type AlertRow = Selectable<DB["alert"]>;
export type AlertSubscriptionRow = Selectable<DB["alert_subscription"]>;
type InsertAlertRow = Insertable<DB["alert"]>;
type InsertAlertSubscriptionRow = Insertable<DB["alert_subscription"]>;

export interface SubscriptionTargetUser {
	id: string;
	client_id: number;
	phone_number: string | null;
}

export interface GaugeStationTarget {
	id: number;
	name: string;
}

export interface DeviceAlertTarget {
	device_id: number;
	serial_number: string;
	gauge_station_id: number;
	gauge_station_name: string;
}

export interface AlertSubscriptionDetailRow extends AlertSubscriptionRow {
	alert_type: string;
	alert_level: AlertLevel;
	client_id: number;
	gauge_station_name: string;
}

export interface AlertSubscriptionForUnsubscribe extends AlertSubscriptionDetailRow {
	phone_number: string | null;
}

const alertColumns = [
	"id",
	"client_id",
	"type",
	"level",
	"introduced",
	"archived",
] as const;
const subscriptionColumns = [
	"id",
	"user_id",
	"gauge_station_id",
	"alert_id",
	"notification_type",
	"introduced",
	"archived",
] as const;

export function findSubscriptionTargetUser(
	db: Kysely<DB>,
	userId: string,
	encryptionKey: string,
): Promise<SubscriptionTargetUser | undefined> {
	return db
		.selectFrom("user")
		.select([
			"id",
			"client_id",
			sql<string | null>`case
				when phone_number is null then null
				else pgp_sym_decrypt(phone_number, concat(${encryptionKey}::text, salt))
			end`.as("phone_number"),
		])
		.where("id", "=", userId)
		.where("deleted_at", "is", null)
		.executeTakeFirst();
}

export function findDeviceAlertTargetForClientById(
	db: Kysely<DB>,
	deviceId: number,
	clientId: number,
): Promise<DeviceAlertTarget | undefined> {
	return deviceAlertTargetQuery(db, clientId)
		.where("device.id", "=", deviceId)
		.executeTakeFirst();
}

export function findDeviceAlertTargetForClientBySerialNumber(
	db: Kysely<DB>,
	serialNumber: string,
	clientId: number,
): Promise<DeviceAlertTarget | undefined> {
	return deviceAlertTargetQuery(db, clientId)
		.where("device.serial_number", "=", serialNumber)
		.executeTakeFirst();
}

function deviceAlertTargetQuery(db: Kysely<DB>, clientId: number) {
	return db
		.selectFrom("device")
		.innerJoin("device_info", "device_info.device_id", "device.id")
		.innerJoin(
			"gauge_station",
			"gauge_station.id",
			"device_info.gauge_station_id",
		)
		.innerJoin(
			"client_gauge_station",
			"client_gauge_station.gauge_station_id",
			"gauge_station.id",
		)
		.select([
			"device.id as device_id",
			"device.serial_number",
			"gauge_station.id as gauge_station_id",
			"gauge_station.name as gauge_station_name",
		])
		.where("device.archived", "is", null)
		.where("device_info.archived", "is", null)
		.where("gauge_station.archived", "is", null)
		.where("client_gauge_station.client_id", "=", clientId)
		.orderBy("device_info.introduced", "desc");
}

export function findActiveAlert(
	db: Kysely<DB>,
	input: { client_id: number; type: string; level: AlertLevel },
): Promise<AlertRow | undefined> {
	return db
		.selectFrom("alert")
		.select(alertColumns)
		.where("client_id", "=", input.client_id)
		.where("type", "=", input.type)
		.where("level", "=", input.level)
		.where("archived", "is", null)
		.executeTakeFirst();
}

export function insertAlert(
	db: Kysely<DB>,
	alert: InsertAlertRow,
): Promise<AlertRow> {
	return db
		.insertInto("alert")
		.values(alert)
		.returning(alertColumns)
		.executeTakeFirstOrThrow();
}

export function findActiveAlertSubscription(
	db: Kysely<DB>,
	input: {
		user_id: string;
		gauge_station_id: number;
		alert_id: number;
		notification_type: NotificationType;
	},
): Promise<AlertSubscriptionRow | undefined> {
	return db
		.selectFrom("alert_subscription")
		.select(subscriptionColumns)
		.where("user_id", "=", input.user_id)
		.where("gauge_station_id", "=", input.gauge_station_id)
		.where("alert_id", "=", input.alert_id)
		.where("notification_type", "=", input.notification_type)
		.where("archived", "is", null)
		.executeTakeFirst();
}

export function insertAlertSubscription(
	db: Kysely<DB>,
	subscription: InsertAlertSubscriptionRow,
): Promise<AlertSubscriptionRow> {
	return db
		.insertInto("alert_subscription")
		.values(subscription)
		.returning(subscriptionColumns)
		.executeTakeFirstOrThrow();
}

export function listActiveAlertSubscriptionsForUser(
	db: Kysely<DB>,
	input: { user_id: string; level: AlertLevel },
): Promise<AlertSubscriptionDetailRow[]> {
	return alertSubscriptionDetailQuery(db)
		.where("alert_subscription.user_id", "=", input.user_id)
		.where("alert.level", "=", input.level)
		.where("alert_subscription.archived", "is", null)
		.orderBy("alert_subscription.id", "asc")
		.execute();
}

export function findActiveAlertSubscriptionsForUnsubscribe(
	db: Kysely<DB>,
	encryptionKey: string,
	input: { user_id: string; level: AlertLevel; subscription_id?: number },
): Promise<AlertSubscriptionForUnsubscribe[]> {
	let query = alertSubscriptionDetailQuery(db)
		.innerJoin("user", "user.id", "alert_subscription.user_id")
		.select([
			sql<string | null>`case
				when "user".phone_number is null then null
				else pgp_sym_decrypt("user".phone_number, concat(${encryptionKey}::text, "user".salt))
			end`.as("phone_number"),
		])
		.where("alert_subscription.user_id", "=", input.user_id)
		.where("alert.level", "=", input.level)
		.where("alert_subscription.archived", "is", null);

	if (input.subscription_id !== undefined) {
		query = query.where(
			"alert_subscription.id",
			"=",
			input.subscription_id,
		);
	}

	return query.orderBy("alert_subscription.id", "asc").execute();
}

function alertSubscriptionDetailQuery(db: Kysely<DB>) {
	return db
		.selectFrom("alert_subscription")
		.innerJoin("alert", "alert.id", "alert_subscription.alert_id")
		.innerJoin(
			"gauge_station",
			"gauge_station.id",
			"alert_subscription.gauge_station_id",
		)
		.select([
			"alert_subscription.id",
			"alert_subscription.user_id",
			"alert_subscription.gauge_station_id",
			"alert_subscription.alert_id",
			"alert_subscription.notification_type",
			"alert_subscription.introduced",
			"alert_subscription.archived",
			"alert.type as alert_type",
			"alert.level as alert_level",
			"alert.client_id",
			"gauge_station.name as gauge_station_name",
		]);
}

export function archiveAlertSubscription(
	db: Kysely<DB>,
	subscriptionId: number,
): Promise<AlertSubscriptionRow> {
	return db
		.updateTable("alert_subscription")
		.set({ archived: sql`now()` })
		.where("id", "=", subscriptionId)
		.where("archived", "is", null)
		.returning(subscriptionColumns)
		.executeTakeFirstOrThrow();
}
