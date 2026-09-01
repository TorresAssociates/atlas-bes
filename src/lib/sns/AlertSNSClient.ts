import {
	CreateTopicCommand,
	DeleteTopicCommand,
	ListSubscriptionsByTopicCommand,
	ListTopicsCommand,
	PublishCommand,
	SNSClient,
	SubscribeCommand,
	type Subscription,
	type Topic,
	UnsubscribeCommand,
} from "@aws-sdk/client-sns";
import { SNSSubscriptionNotFoundError, SNSTopicNotFoundError, SNSUnknownError } from "./errors";

export interface AlertSNSClientOptions {
	client: SNSClient;
}

export class AlertSNSClient {
	readonly #client: SNSClient;

	constructor(options: AlertSNSClientOptions) {
		this.#client = options.client;
	}

	getTopicName(
		gaugeName: string,
		deviceSerialNumber: string | null,
		warningType: string,
	): string {
		return `${gaugeName}_${deviceSerialNumber ? "Device_" : ""}alert_${warningType}`;
	}

	getManualAlertTopicName(clientId?: string | number): string {
		return clientId === undefined ? "manual_alert" : `${clientId}_manual_alert`;
	}

	getAlertMessage(
		gaugeName: string,
		deviceSerialNumber: string | null,
		warningDescription: string,
	): string {
		const alertTarget = deviceSerialNumber === null ? "" : `(${deviceSerialNumber}) `;
		return `Alert - ${warningDescription} ${alertTarget}at Gauge ${gaugeName}!`;
	}

	async getAllTopics(): Promise<Topic[]> {
		try {
			const topics: Topic[] = [];
			let nextToken: string | undefined;

			do {
				const page = await this.#client.send(
					new ListTopicsCommand({ NextToken: nextToken }),
				);
				if (page.Topics) topics.push(...page.Topics);
				nextToken = page.NextToken;
			} while (nextToken !== undefined);

			return topics;
		} catch (err) {
			throw new SNSUnknownError(err);
		}
	}

	async getTopicArn(topic: string): Promise<string> {
		try {
			const topicList = await this.getAllTopics();
			const match = topicList.find(
				(candidate) => candidate.TopicArn?.split(":").pop() === topic,
			);
			if (!match?.TopicArn) throw new SNSTopicNotFoundError(topic);
			return match.TopicArn;
		} catch (err) {
			if (err instanceof SNSTopicNotFoundError) throw err;
			throw new SNSUnknownError(err);
		}
	}

	async createTopic(topicName: string): Promise<string> {
		const response = await this.#client.send(new CreateTopicCommand({ Name: topicName }));
		if (!response.TopicArn)
			throw new SNSUnknownError(new Error("SNS CreateTopic returned no TopicArn"));
		return response.TopicArn;
	}

	async getOrCreateTopicArn(topicName: string): Promise<string> {
		try {
			return await this.getTopicArn(topicName);
		} catch (err) {
			if (err instanceof SNSTopicNotFoundError) return this.createTopic(topicName);
			throw err;
		}
	}

	async subscribeSms(phoneNumber: string, topic: string): Promise<string | null> {
		const topicArn = await this.getOrCreateTopicArn(topic);
		const response = await this.#client.send(
			new SubscribeCommand({
				Protocol: "sms",
				TopicArn: topicArn,
				Endpoint: formatSmsPhoneNumber(phoneNumber),
				ReturnSubscriptionArn: true,
			}),
		);

		return response.SubscriptionArn ?? null;
	}

	async unsubscribeSms(phoneNumber: string, topic: string): Promise<void> {
		const endpoint = formatSmsPhoneNumber(phoneNumber);
		const subscriptions = await this.getSubscriptionsToTopic(topic);
		const subscription = subscriptions.find((candidate) => candidate.Endpoint === endpoint);
		const subscriptionArn = subscription?.SubscriptionArn;

		if (!subscriptionArn || subscriptionArn === "PendingConfirmation") {
			throw new SNSSubscriptionNotFoundError(endpoint, topic);
		}

		await this.#client.send(new UnsubscribeCommand({ SubscriptionArn: subscriptionArn }));
	}

	async getSubscriptionsToTopic(topic: string): Promise<Subscription[]> {
		const topicArn = await this.getTopicArn(topic);
		const subscriptions: Subscription[] = [];
		let nextToken: string | undefined;

		do {
			const page = await this.#client.send(
				new ListSubscriptionsByTopicCommand({
					TopicArn: topicArn,
					NextToken: nextToken,
				}),
			);
			if (page.Subscriptions) subscriptions.push(...page.Subscriptions);
			nextToken = page.NextToken;
		} while (nextToken !== undefined);

		return subscriptions;
	}

	async deleteTopic(topic: string): Promise<void> {
		try {
			const topicArn = await this.getTopicArn(topic);
			await this.#client.send(new DeleteTopicCommand({ TopicArn: topicArn }));
		} catch (err) {
			if (err instanceof SNSTopicNotFoundError) return;
			throw new SNSUnknownError(err);
		}
	}

	async deleteTopicIfNoSubscriptions(topic: string): Promise<boolean> {
		try {
			const subscriptions = await this.getSubscriptionsToTopic(topic);
			if (subscriptions.length > 0) return false;
			await this.deleteTopic(topic);
			return true;
		} catch (err) {
			if (err instanceof SNSTopicNotFoundError) return false;
			throw new SNSUnknownError(err);
		}
	}

	async sendMessage(topic: string, message: string): Promise<string | undefined> {
		try {
			const topicArn = await this.getTopicArn(topic);
			const response = await this.#client.send(
				new PublishCommand({ TopicArn: topicArn, Message: message }),
			);
			return response.MessageId;
		} catch (err) {
			if (err instanceof SNSTopicNotFoundError) return undefined;
			throw new SNSUnknownError(err);
		}
	}
}

export function createAlertSNSClient(region: string): AlertSNSClient {
	return new AlertSNSClient({ client: new SNSClient({ region }) });
}

export function formatSmsPhoneNumber(phoneNumber: string): string {
	const digits = phoneNumber.replace(/\D/g, "");
	if (digits.length === 10) return `+1${digits}`;
	if (digits.length === 11) return `+${digits}`;
	if (phoneNumber.startsWith("+") && digits.length > 0) return `+${digits}`;
	return phoneNumber;
}
