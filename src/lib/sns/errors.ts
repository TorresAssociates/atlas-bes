export class SNSTopicNotFoundError extends Error {
	constructor(topic?: string) {
		super(
			topic === undefined
				? "SNS topic does not exist"
				: `SNS topic ${JSON.stringify(topic)} does not exist`,
		);
		this.name = "SNSTopicNotFoundError";
	}
}

export class SNSUnknownError extends Error {
	constructor(cause: unknown) {
		super("unknown SNS error", { cause });
		this.name = "SNSUnknownError";
	}
}

export class SNSSubscriptionNotFoundError extends Error {
	constructor(endpoint: string, topic: string) {
		super(`${endpoint} is not subscribed to SNS topic ${JSON.stringify(topic)}`);
		this.name = "SNSSubscriptionNotFoundError";
	}
}
