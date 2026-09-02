import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import type { FastifyReply, FastifyRequest } from "fastify";
import { SNSSubscriptionNotFoundError } from "@/lib/sns/errors";
import {
	getRequestSession,
	listRequestPermissions,
	requirePermission,
	requireSession,
} from "@/plugins/authorization";
import { HttpErrorSchema } from "@/schemas";
import {
	AlertSubscriptionDeleteSchema,
	AlertSubscriptionListSchema,
	AlertSubscriptionSchema,
	AlertSubscriptionUserParamsSchema,
	DeleteDeviceAlertSubscriptionQuerySchema,
	DeleteGaugeStationAlertSubscriptionQuerySchema,
	DeviceAlertSubscriptionBodySchema,
	GaugeStationAlertSubscriptionBodySchema,
	SendTestAlertMessageResponseSchema,
	TestAlertSubscriptionBodySchema,
	TestAlertSubscriptionResponseSchema,
} from "./schemas";
import {
	AlertSubscriptionAccessDeniedError,
	AlertSubscriptionInputError,
	AlertSubscriptionNotFoundError,
	AlertSubscriptionNotificationTypeUnsupportedError,
	AlertSubscriptionPhoneNumberRequiredError,
	AlertSubscriptionTargetNotFoundError,
	AlertSubscriptionTargetUserNotFoundError,
	AlertTopicNotFoundError,
	deleteDeviceAlertSubscriptions,
	deleteGaugeStationAlertSubscriptions,
	listDeviceAlertSubscriptions,
	listGaugeStationAlertSubscriptions,
	type SubscribeDeviceAlertInput,
	type SubscribeGaugeStationAlertInput,
	sendTestAlertMessage,
	subscribeDeviceAlert,
	subscribeGaugeStationAlert,
	subscribeToTestAlertTopic,
	type TestAlertSubscriptionInput,
	unsubscribeFromTestAlertTopic,
} from "./service";

type AlertSubscriptionParams = { userId: string };
type GaugeStationAlertRequest = FastifyRequest<{
	Params: AlertSubscriptionParams;
	Body: SubscribeGaugeStationAlertInput;
}>;
type DeviceAlertRequest = FastifyRequest<{
	Params: AlertSubscriptionParams;
	Body: SubscribeDeviceAlertInput;
}>;
type AlertSubscriptionUserRequest = FastifyRequest<{
	Params: AlertSubscriptionParams;
}>;
type DeleteGaugeStationAlertRequest = FastifyRequest<{
	Params: AlertSubscriptionParams;
	Querystring: { gaugeStationSubscriptionId?: number };
}>;
type DeleteDeviceAlertRequest = FastifyRequest<{
	Params: AlertSubscriptionParams;
	Querystring: { gaugeStationSubscriptionId?: number };
}>;
type TestAlertSubscriptionRequest = FastifyRequest<{
	Body: TestAlertSubscriptionInput;
}>;

const alertRoutes: FastifyPluginAsyncTypebox = async (app) => {
	const getDb = () => {
		if (!app.db) throw app.httpErrors.serviceUnavailable("database is not configured");
		return app.db;
	};

	app.setErrorHandler((err, _request, reply) => {
		if (err instanceof AlertSubscriptionAccessDeniedError) return reply.forbidden(err.message);
		if (err instanceof AlertSubscriptionTargetUserNotFoundError)
			return reply.notFound(err.message);
		if (err instanceof AlertSubscriptionTargetNotFoundError) return reply.notFound(err.message);
		if (err instanceof AlertSubscriptionNotFoundError) return reply.notFound(err.message);
		if (err instanceof AlertTopicNotFoundError) return reply.notFound(err.message);
		if (err instanceof SNSSubscriptionNotFoundError) return reply.notFound(err.message);
		if (err instanceof AlertSubscriptionPhoneNumberRequiredError)
			return reply.badRequest(err.message);
		if (err instanceof AlertSubscriptionNotificationTypeUnsupportedError) {
			return reply.badRequest(err.message);
		}
		if (err instanceof AlertSubscriptionInputError) return reply.badRequest(err.message);
		return reply.send(err);
	});

	async function subscriptionAccess(request: FastifyRequest) {
		const permissions = await listRequestPermissions(request);
		return {
			canWriteExternalUsers: permissions.includes("W_EXTERNAL_USERS"),
			canWriteClientUsers: permissions.includes("W_CLIENT_USERS"),
			canSubscribeSms: permissions.includes("EX_TEXT_SUB"),
			canSubscribeEmail: permissions.includes("EX_EMAIL_SUB"),
			canSendClientAlert: permissions.includes("EX_CLIENT_ALERT"),
			canSendExternalAlert: permissions.includes("EX_EXTERNAL_ALERT"),
		};
	}

	async function routeContext(request: FastifyRequest) {
		const session = await getRequestSession(request);
		if (!session) throw app.httpErrors.unauthorized("authentication required");
		return {
			db: getDb(),
			sns: app.alertSns,
			encryptionKey: app.config.ENCRYPTION_KEY,
			session,
			access: await subscriptionAccess(request),
		};
	}

	const testMessagePostHandler = async (request: FastifyRequest) => {
		const context = await routeContext(request);
		return sendTestAlertMessage(context.sns);
	};

	const testAlertSubscribeHandler = async (
		request: TestAlertSubscriptionRequest,
		reply: FastifyReply,
	) => {
		const context = await routeContext(request);
		const subscription = await subscribeToTestAlertTopic(context.sns, request.body);
		return reply.code(201).send(subscription);
	};

	const testAlertUnsubscribeHandler = async (request: TestAlertSubscriptionRequest) => {
		const context = await routeContext(request);
		return unsubscribeFromTestAlertTopic(context.sns, request.body);
	};

	const gaugeStationPostHandler = async (request: GaugeStationAlertRequest, reply: FastifyReply) => {
		const context = await routeContext(request);
		const subscription = await subscribeGaugeStationAlert(
			context.db,
			context.sns,
			context.encryptionKey,
			context.session,
			context.access,
			request.params.userId,
			request.body,
		);
		return reply.code(201).send(subscription);
	};

	const devicePostHandler = async (request: DeviceAlertRequest, reply: FastifyReply) => {
		const context = await routeContext(request);
		const subscription = await subscribeDeviceAlert(
			context.db,
			context.sns,
			context.encryptionKey,
			context.session,
			context.access,
			request.params.userId,
			request.body,
		);
		return reply.code(201).send(subscription);
	};

	const gaugeStationGetHandler = async (request: AlertSubscriptionUserRequest) => {
		const context = await routeContext(request);
		return {
			data: await listGaugeStationAlertSubscriptions(
				context.db,
				context.encryptionKey,
				context.session,
				context.access,
				request.params.userId,
			),
		};
	};

	const deviceGetHandler = async (request: AlertSubscriptionUserRequest) => {
		const context = await routeContext(request);
		return {
			data: await listDeviceAlertSubscriptions(
				context.db,
				context.encryptionKey,
				context.session,
				context.access,
				request.params.userId,
			),
		};
	};

	const gaugeStationDeleteHandler = async (request: DeleteGaugeStationAlertRequest) => {
		const context = await routeContext(request);
		return deleteGaugeStationAlertSubscriptions(
			context.db,
			context.sns,
			context.encryptionKey,
			context.session,
			context.access,
			request.params.userId,
			request.query.gaugeStationSubscriptionId,
		);
	};

	const deviceDeleteHandler = async (request: DeleteDeviceAlertRequest) => {
		const context = await routeContext(request);
		return deleteDeviceAlertSubscriptions(
			context.db,
			context.sns,
			context.encryptionKey,
			context.session,
			context.access,
			request.params.userId,
			request.query.gaugeStationSubscriptionId,
		);
	};

	app.post(
		"/testMessage",
		{
			preHandler: requirePermission("EX_EXTERNAL_ALERT"),
			schema: {
				tags: ["alerts"],
				response: {
					200: SendTestAlertMessageResponseSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		testMessagePostHandler,
	);

	app.post(
		"/testMessage/subscriptions",
		{
			preHandler: requirePermission("EX_EXTERNAL_ALERT"),
			schema: {
				tags: ["alerts"],
				body: TestAlertSubscriptionBodySchema,
				response: {
					201: TestAlertSubscriptionResponseSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
				},
			},
		},
		testAlertSubscribeHandler,
	);

	app.delete(
		"/testMessage/subscriptions",
		{
			preHandler: requirePermission("EX_EXTERNAL_ALERT"),
			schema: {
				tags: ["alerts"],
				body: TestAlertSubscriptionBodySchema,
				response: {
					200: TestAlertSubscriptionResponseSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		testAlertUnsubscribeHandler,
	);

	app.get(
		"/subscriptions/user/:userId/gaugeStationAlerts",
		{
			preHandler: requireSession(),
			schema: {
				tags: ["alerts"],
				params: AlertSubscriptionUserParamsSchema,
				response: {
					200: AlertSubscriptionListSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		gaugeStationGetHandler,
	);

	app.post(
		"/subscriptions/user/:userId/gaugeStationAlerts",
		{
			preHandler: requireSession(),
			schema: {
				tags: ["alerts"],
				params: AlertSubscriptionUserParamsSchema,
				body: GaugeStationAlertSubscriptionBodySchema,
				response: {
					201: AlertSubscriptionSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		gaugeStationPostHandler,
	);

	app.delete(
		"/subscriptions/user/:userId/gaugeStationAlerts",
		{
			preHandler: requireSession(),
			schema: {
				tags: ["alerts"],
				params: AlertSubscriptionUserParamsSchema,
				querystring: DeleteGaugeStationAlertSubscriptionQuerySchema,
				response: {
					200: AlertSubscriptionDeleteSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		gaugeStationDeleteHandler,
	);

	app.get(
		"/subscriptions/user/:userId/deviceAlerts",
		{
			preHandler: requireSession(),
			schema: {
				tags: ["alerts"],
				params: AlertSubscriptionUserParamsSchema,
				response: {
					200: AlertSubscriptionListSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		deviceGetHandler,
	);

	app.post(
		"/subscriptions/user/:userId/deviceAlerts",
		{
			preHandler: requireSession(),
			schema: {
				tags: ["alerts"],
				params: AlertSubscriptionUserParamsSchema,
				body: DeviceAlertSubscriptionBodySchema,
				response: {
					201: AlertSubscriptionSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		devicePostHandler,
	);

	app.delete(
		"/subscriptions/user/:userId/deviceAlerts",
		{
			preHandler: requireSession(),
			schema: {
				tags: ["alerts"],
				params: AlertSubscriptionUserParamsSchema,
				querystring: DeleteDeviceAlertSubscriptionQuerySchema,
				response: {
					200: AlertSubscriptionDeleteSchema,
					400: HttpErrorSchema,
					401: HttpErrorSchema,
					403: HttpErrorSchema,
					404: HttpErrorSchema,
				},
			},
		},
		deviceDeleteHandler,
	);
};

export default alertRoutes;
