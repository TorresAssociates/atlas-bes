import type { Kysely } from "kysely";
import type { AlertLevel, DB, NotificationType } from "@/db/types";
import type { AlertSNSClient } from "@/lib/sns/AlertSNSClient";
import { SNSSubscriptionNotFoundError, SNSUnknownError } from "@/lib/sns/errors";
import type { SessionSubject } from "../auth/service";
import { GaugeNotFoundError, getGauge, getGaugeByName } from "../gauges/service";
import type {
	AlertSubscriptionDetailRow,
	AlertSubscriptionForUnsubscribe,
	AlertSubscriptionRow,
	DeviceAlertTarget,
	GaugeStationTarget,
} from "./queries";
import * as queries from "./queries";

export interface AlertSubscriptionAccess {
	canWriteExternalUsers: boolean;
	canWriteClientUsers: boolean;
	canSubscribeSms: boolean;
	canSubscribeEmail: boolean;
	canSendClientAlert: boolean;
	canSendExternalAlert: boolean;
}

export interface SubscribeGaugeAlertInput {
	gauge_station_id?: number;
	gauge_station_name?: string;
	alert_type: string;
	notification_type?: NotificationType;
}

export interface SubscribeDeviceAlertInput {
	device_id?: number;
	serial_number?: string;
	alert_type: string;
	notification_type?: NotificationType;
}

export interface SendTestAlertMessageResponse {
	message: string;
	topic: string;
	message_id: string | null;
}

export interface TestAlertSubscriptionInput {
	phone_number: string;
}

export interface TestAlertSubscriptionResponse {
	message: string;
	topic: string;
	phone_number: string;
}

export type AlertSubscriptionResponse = Omit<AlertSubscriptionRow, "introduced" | "archived"> & {
	introduced: string;
	archived: string | null;
};

export type AlertSubscriptionDetailResponse = Omit<
	AlertSubscriptionDetailRow,
	"introduced" | "archived"
> & {
	introduced: string;
	archived: string | null;
};

export interface DeleteAlertSubscriptionsResponse {
	message: string;
	data: AlertSubscriptionResponse[];
}

export class AlertSubscriptionAccessDeniedError extends Error {
	constructor() {
		super("not allowed to manage that alert subscription");
		this.name = "AlertSubscriptionAccessDeniedError";
	}
}

export class AlertSubscriptionTargetUserNotFoundError extends Error {
	constructor(userId: string) {
		super(`user ${JSON.stringify(userId)} does not exist`);
		this.name = "AlertSubscriptionTargetUserNotFoundError";
	}
}

export class AlertSubscriptionPhoneNumberRequiredError extends Error {
	constructor(userId: string) {
		super(`user ${JSON.stringify(userId)} must have a phone number for SMS alerts`);
		this.name = "AlertSubscriptionPhoneNumberRequiredError";
	}
}

export class AlertSubscriptionNotificationTypeUnsupportedError extends Error {
	constructor(notificationType: NotificationType) {
		super(`notification type ${notificationType} is not supported yet`);
		this.name = "AlertSubscriptionNotificationTypeUnsupportedError";
	}
}

export class AlertSubscriptionTargetNotFoundError extends Error {
	constructor(target: "gauge_station" | "device") {
		super(`${target} does not exist or is not available to the target user's client`);
		this.name = "AlertSubscriptionTargetNotFoundError";
	}
}

export class AlertSubscriptionInputError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "AlertSubscriptionInputError";
	}
}

export class AlertSubscriptionNotFoundError extends Error {
	constructor() {
		super("alert subscription does not exist for that user");
		this.name = "AlertSubscriptionNotFoundError";
	}
}

export class AlertTopicNotFoundError extends Error {
	constructor(topic: string) {
		super(`SNS topic ${JSON.stringify(topic)} does not exist`);
		this.name = "AlertTopicNotFoundError";
	}
}

function toAlertSubscriptionResponse(row: AlertSubscriptionRow): AlertSubscriptionResponse {
	return {
		...row,
		introduced: new Date(row.introduced).toISOString(),
		archived: row.archived === null ? null : new Date(row.archived).toISOString(),
	};
}

function toAlertSubscriptionDetailResponse(
	row: AlertSubscriptionDetailRow,
): AlertSubscriptionDetailResponse {
	return {
		...row,
		introduced: new Date(row.introduced).toISOString(),
		archived: row.archived === null ? null : new Date(row.archived).toISOString(),
	};
}

async function resolveTargetUser(
	db: Kysely<DB>,
	encryptionKey: string,
	session: SessionSubject,
	access: AlertSubscriptionAccess,
	targetUserId: string,
) {
	const user = await queries.findSubscriptionTargetUser(db, targetUserId, encryptionKey);
	if (!user) throw new AlertSubscriptionTargetUserNotFoundError(targetUserId);

	if (access.canWriteExternalUsers) return user;
	if (access.canWriteClientUsers && user.client_id === session.client_id) return user;
	if (session.user_id === targetUserId) return user;

	throw new AlertSubscriptionAccessDeniedError();
}

function resolveNotificationType(input: {
	notification_type?: NotificationType;
}): NotificationType {
	return input.notification_type ?? "sms";
}

function ensureNotificationPermission(
	access: AlertSubscriptionAccess,
	notificationType: NotificationType,
): void {
	if (notificationType === "sms" && access.canSubscribeSms) return;
	if (notificationType === "email" && access.canSubscribeEmail) return;
	throw new AlertSubscriptionAccessDeniedError();
}

async function findOrCreateAlert(
	db: Kysely<DB>,
	input: { client_id: number; type: string; level: AlertLevel },
) {
	return (await queries.findActiveAlert(db, input)) ?? (await queries.insertAlert(db, input));
}

async function findOrCreateSubscription(
	db: Kysely<DB>,
	input: {
		user_id: string;
		gauge_station_id: number;
		alert_id: number;
		notification_type: NotificationType;
	},
): Promise<AlertSubscriptionRow> {
	return (
		(await queries.findActiveAlertSubscription(db, input)) ??
		(await queries.insertAlertSubscription(db, input))
	);
}

async function subscribeSmsIfNeeded(
	sns: AlertSNSClient,
	phoneNumber: string | null,
	topicName: string,
	targetUserId: string,
): Promise<void> {
	if (phoneNumber === null) throw new AlertSubscriptionPhoneNumberRequiredError(targetUserId);
	try {
		await sns.subscribeSms(phoneNumber, topicName);
	} catch (err) {
		throw new SNSUnknownError(err);
	}
}

export async function subscribeGaugeAlert(
	db: Kysely<DB>,
	sns: AlertSNSClient,
	encryptionKey: string,
	session: SessionSubject,
	access: AlertSubscriptionAccess,
	targetUserId: string,
	input: SubscribeGaugeAlertInput,
): Promise<AlertSubscriptionResponse> {
	const notificationType = resolveNotificationType(input);
	ensureNotificationPermission(access, notificationType);
	const user = await resolveTargetUser(db, encryptionKey, session, access, targetUserId);

	const gaugeStation = await resolveGaugeStation(db, input, {
		clientId: user.client_id,
		canReadExternal: session.user_id === user.id && access.canSendExternalAlert,
	});
	if (notificationType === "sms") {
		await subscribeSmsIfNeeded(
			sns,
			user.phone_number,
			sns.getTopicName(gaugeStation.name, null, input.alert_type),
			targetUserId,
		);
	} else {
		throw new AlertSubscriptionNotificationTypeUnsupportedError(notificationType);
	}

	const alert = await findOrCreateAlert(db, {
		client_id: user.client_id,
		type: input.alert_type,
		level: "gauge_station",
	});

	return toAlertSubscriptionResponse(
		await findOrCreateSubscription(db, {
			user_id: user.id,
			gauge_station_id: gaugeStation.id,
			alert_id: alert.id,
			notification_type: notificationType,
		}),
	);
}

export async function subscribeDeviceAlert(
	db: Kysely<DB>,
	sns: AlertSNSClient,
	encryptionKey: string,
	session: SessionSubject,
	access: AlertSubscriptionAccess,
	targetUserId: string,
	input: SubscribeDeviceAlertInput,
): Promise<AlertSubscriptionResponse> {
	const notificationType = resolveNotificationType(input);
	ensureNotificationPermission(access, notificationType);
	const user = await resolveTargetUser(db, encryptionKey, session, access, targetUserId);
	const device = await resolveDeviceAlertTarget(db, input, user.client_id);

	if (notificationType === "sms") {
		await subscribeSmsIfNeeded(
			sns,
			user.phone_number,
			sns.getTopicName(device.gauge_station_name, device.serial_number, input.alert_type),
			targetUserId,
		);
	} else {
		throw new AlertSubscriptionNotificationTypeUnsupportedError(notificationType);
	}

	const alert = await findOrCreateAlert(db, {
		client_id: user.client_id,
		type: input.alert_type,
		level: "device",
	});

	return toAlertSubscriptionResponse(
		await findOrCreateSubscription(db, {
			user_id: user.id,
			gauge_station_id: device.gauge_station_id,
			alert_id: alert.id,
			notification_type: notificationType,
		}),
	);
}

const TEST_ALERT_TOPIC = "ATLASTEST";
const TEST_ALERT_MESSAGE =
	"This is the monthly test of the ATLAS messaging system. No Action Required.";

export async function sendTestAlertMessage(
	sns: AlertSNSClient,
): Promise<SendTestAlertMessageResponse> {
	try {
		const messageId = await sns.sendMessage(TEST_ALERT_TOPIC, TEST_ALERT_MESSAGE);
		if (messageId === undefined) throw new AlertTopicNotFoundError(TEST_ALERT_TOPIC);
		return {
			message: "Success",
			topic: TEST_ALERT_TOPIC,
			message_id: messageId,
		};
	} catch (err) {
		if (err instanceof AlertTopicNotFoundError) throw err;
		throw new SNSUnknownError(err);
	}
}

export async function subscribeToTestAlertTopic(
	sns: AlertSNSClient,
	input: TestAlertSubscriptionInput,
): Promise<TestAlertSubscriptionResponse> {
	try {
		await sns.subscribeSms(input.phone_number, TEST_ALERT_TOPIC);
		return {
			message: "Success",
			topic: TEST_ALERT_TOPIC,
			phone_number: input.phone_number,
		};
	} catch (err) {
		throw new SNSUnknownError(err);
	}
}

export async function unsubscribeFromTestAlertTopic(
	sns: AlertSNSClient,
	input: TestAlertSubscriptionInput,
): Promise<TestAlertSubscriptionResponse> {
	try {
		await sns.unsubscribeSms(input.phone_number, TEST_ALERT_TOPIC);
		await sns.deleteTopicIfNoSubscriptions(TEST_ALERT_TOPIC);
		return {
			message: "Success",
			topic: TEST_ALERT_TOPIC,
			phone_number: input.phone_number,
		};
	} catch (err) {
		if (err instanceof SNSSubscriptionNotFoundError) throw err;
		throw new SNSUnknownError(err);
	}
}

export async function listGaugeAlertSubscriptions(
	db: Kysely<DB>,
	encryptionKey: string,
	session: SessionSubject,
	access: AlertSubscriptionAccess,
	targetUserId: string,
): Promise<AlertSubscriptionDetailResponse[]> {
	const user = await resolveTargetUser(db, encryptionKey, session, access, targetUserId);
	return (
		await queries.listActiveAlertSubscriptionsForUser(db, {
			user_id: user.id,
			level: "gauge_station",
		})
	).map(toAlertSubscriptionDetailResponse);
}

export async function listDeviceAlertSubscriptions(
	db: Kysely<DB>,
	encryptionKey: string,
	session: SessionSubject,
	access: AlertSubscriptionAccess,
	targetUserId: string,
): Promise<AlertSubscriptionDetailResponse[]> {
	const user = await resolveTargetUser(db, encryptionKey, session, access, targetUserId);
	return (
		await queries.listActiveAlertSubscriptionsForUser(db, {
			user_id: user.id,
			level: "device",
		})
	).map(toAlertSubscriptionDetailResponse);
}

export async function deleteGaugeAlertSubscriptions(
	db: Kysely<DB>,
	sns: AlertSNSClient,
	encryptionKey: string,
	session: SessionSubject,
	access: AlertSubscriptionAccess,
	targetUserId: string,
	subscriptionId?: number,
): Promise<DeleteAlertSubscriptionsResponse> {
	return deleteAlertSubscriptions(
		db,
		sns,
		encryptionKey,
		session,
		access,
		targetUserId,
		"gauge_station",
		subscriptionId,
	);
}

export async function deleteDeviceAlertSubscriptions(
	db: Kysely<DB>,
	sns: AlertSNSClient,
	encryptionKey: string,
	session: SessionSubject,
	access: AlertSubscriptionAccess,
	targetUserId: string,
	subscriptionId?: number,
): Promise<DeleteAlertSubscriptionsResponse> {
	return deleteAlertSubscriptions(
		db,
		sns,
		encryptionKey,
		session,
		access,
		targetUserId,
		"device",
		subscriptionId,
	);
}

async function deleteAlertSubscriptions(
	db: Kysely<DB>,
	sns: AlertSNSClient,
	encryptionKey: string,
	session: SessionSubject,
	access: AlertSubscriptionAccess,
	targetUserId: string,
	level: AlertLevel,
	subscriptionId?: number,
): Promise<DeleteAlertSubscriptionsResponse> {
	const user = await resolveTargetUser(db, encryptionKey, session, access, targetUserId);
	const subscriptions = await queries.findActiveAlertSubscriptionsForUnsubscribe(
		db,
		encryptionKey,
		{
			user_id: user.id,
			level,
			subscription_id: subscriptionId,
		},
	);

	if (subscriptionId !== undefined && subscriptions.length === 0)
		throw new AlertSubscriptionNotFoundError();

	let wasNotSubscribed = false;
	const archived: AlertSubscriptionResponse[] = [];
	for (const subscription of subscriptions) {
		if (subscription.notification_type === "sms") {
			await unsubscribeSmsIfNeeded(sns, subscription, user.id).catch((err) => {
				if (err instanceof SNSSubscriptionNotFoundError) {
					wasNotSubscribed = true;
					return;
				}
				throw err;
			});
		}
		archived.push(
			toAlertSubscriptionResponse(
				await queries.archiveAlertSubscription(db, subscription.id),
			),
		);
	}

	return {
		message: wasNotSubscribed
			? "User not subscribed on AWS on at least 1 topic requested"
			: "Success",
		data: archived,
	};
}

async function unsubscribeSmsIfNeeded(
	sns: AlertSNSClient,
	subscription: AlertSubscriptionForUnsubscribe,
	targetUserId: string,
): Promise<void> {
	if (subscription.phone_number === null)
		throw new AlertSubscriptionPhoneNumberRequiredError(targetUserId);
	const deviceSerialNumber = subscription.alert_level === "device" ? "device" : null;
	const topicName = sns.getTopicName(
		subscription.gauge_station_name,
		deviceSerialNumber,
		subscription.alert_type,
	);
	try {
		await sns.unsubscribeSms(subscription.phone_number, topicName);
		await sns.deleteTopicIfNoSubscriptions(topicName);
	} catch (err) {
		if (err instanceof SNSSubscriptionNotFoundError) throw err;
		throw new SNSUnknownError(err);
	}
}

async function resolveGaugeStation(
	db: Kysely<DB>,
	input: SubscribeGaugeAlertInput,
	options: { clientId: number; canReadExternal: boolean },
): Promise<GaugeStationTarget> {
	const targetSession: SessionSubject = {
		user_id: "",
		client_id: options.clientId,
		role_id: 0,
	};
	const access = {
		canReadExternal: options.canReadExternal,
		canViewInactive: true,
	};

	try {
		const gauge =
			input.gauge_station_id !== undefined
				? await getGauge(db, input.gauge_station_id, targetSession, access)
				: input.gauge_station_name !== undefined
					? await getGaugeByName(db, input.gauge_station_name, targetSession, access)
					: null;

		if (!gauge) {
			throw new AlertSubscriptionInputError(
				"gauge_station_id or gauge_station_name is required",
			);
		}

		return { id: gauge.id, name: gauge.name };
	} catch (error) {
		if (error instanceof GaugeNotFoundError) {
			throw new AlertSubscriptionTargetNotFoundError("gauge_station");
		}
		throw error;
	}
}

async function resolveDeviceAlertTarget(
	db: Kysely<DB>,
	input: SubscribeDeviceAlertInput,
	clientId: number,
): Promise<DeviceAlertTarget> {
	if (input.device_id !== undefined) {
		const device = await queries.findDeviceAlertTargetForClientById(
			db,
			input.device_id,
			clientId,
		);
		if (!device) throw new AlertSubscriptionTargetNotFoundError("device");
		return device;
	}

	if (input.serial_number !== undefined) {
		const device = await queries.findDeviceAlertTargetForClientBySerialNumber(
			db,
			input.serial_number,
			clientId,
		);
		if (!device) throw new AlertSubscriptionTargetNotFoundError("device");
		return device;
	}

	throw new AlertSubscriptionInputError("device_id or serial_number is required");
}
