import type { Kysely } from "kysely";
import type { DB, WorkOrderState } from "@/db/types";
import type { SessionSubject } from "../auth/service";
import type { WorkOrderRow, WorkOrderUpdateRow } from "./queries";
import * as queries from "./queries";

export interface WorkOrderReadAccess {
	canReadExternal: boolean;
}

export interface WorkOrderWriteAccess {
	canWriteExternal: boolean;
}

export interface CreateWorkOrderInput {
	created_at?: string | Date;
	device_id: number;
	incident_type_id: number;
	priority: number;
	state: WorkOrderState;
	work_order_status_id: number;
}

export interface UpdateWorkOrderInput {
	device_id?: number;
	incident_type_id?: number;
	priority?: number;
	state?: WorkOrderState;
	work_order_status_id?: number;
}

export interface CreateWorkOrderUpdateInput {
	new_priority: number;
	new_state: WorkOrderState;
	new_work_order_status_id: number;
	description: string;
}

export interface CreateWorkOrderUpdateImageInput {
	description: string;
	path: string;
}

export interface WorkOrderResponse {
	id: number;
	created_at: string;
	creator_user_id: string;
	device_id: number;
	incident_type_id: number;
	priority: number;
	state: WorkOrderState;
	work_order_status_id: number;
}

export interface WorkOrderUpdateResponse {
	id: number;
	work_order_id: number;
	created_at: string;
	user_id: string;
	new_priority: number;
	new_state: WorkOrderState;
	new_work_order_status_id: number;
	description: string;
}

export class WorkOrderNotFoundError extends Error {
	constructor(workOrderId: number) {
		super(`work order ${workOrderId} does not exist`);
		this.name = "WorkOrderNotFoundError";
	}
}

export class WorkOrderDeviceNotFoundError extends Error {
	constructor(deviceId: number) {
		super(
			`device ${deviceId} does not exist or is not available to your client`,
		);
		this.name = "WorkOrderDeviceNotFoundError";
	}
}

export class WorkOrderIncidentTypeNotFoundError extends Error {
	constructor(incidentTypeId: number) {
		super(`incident type ${incidentTypeId} does not exist`);
		this.name = "WorkOrderIncidentTypeNotFoundError";
	}
}

export class WorkOrderStatusNotFoundError extends Error {
	constructor(statusId: number) {
		super(`work order status ${statusId} does not exist`);
		this.name = "WorkOrderStatusNotFoundError";
	}
}

export class WorkOrderInUseError extends Error {
	constructor() {
		super("work order is still referenced by updates or images");
		this.name = "WorkOrderInUseError";
	}
}

function isForeignKeyViolation(error: unknown): boolean {
	return (
		typeof error === "object" &&
		error !== null &&
		(error as { code?: unknown }).code === "23503"
	);
}

function toIso(value: Date | string): string {
	return value instanceof Date
		? value.toISOString()
		: new Date(value).toISOString();
}

function toWorkOrderResponse(row: WorkOrderRow): WorkOrderResponse {
	return { ...row, created_at: toIso(row.created_at) };
}

function toWorkOrderUpdateResponse(
	row: WorkOrderUpdateRow,
): WorkOrderUpdateResponse {
	return { ...row, created_at: toIso(row.created_at) };
}

async function findVisibleWorkOrder(
	db: Kysely<DB>,
	id: number,
	session: SessionSubject,
	access: WorkOrderReadAccess | WorkOrderWriteAccess,
): Promise<WorkOrderRow> {
	const canAccessExternal =
		"canReadExternal" in access
			? access.canReadExternal
			: access.canWriteExternal;
	const workOrder = canAccessExternal
		? await queries.findWorkOrderById(db, id)
		: await queries.findWorkOrderByIdForClient(db, id, session.client_id);
	if (!workOrder) throw new WorkOrderNotFoundError(id);
	return workOrder;
}

async function ensureDeviceAccess(
	db: Kysely<DB>,
	session: SessionSubject,
	access: WorkOrderWriteAccess,
	deviceId: number,
): Promise<void> {
	const device = access.canWriteExternal
		? await queries.findDeviceById(db, deviceId)
		: await queries.findDeviceByIdForClient(
				db,
				deviceId,
				session.client_id,
			);
	if (!device) throw new WorkOrderDeviceNotFoundError(deviceId);
}

async function ensureIncidentTypeExists(
	db: Kysely<DB>,
	incidentTypeId: number,
): Promise<void> {
	const incidentType = await queries.findIncidentTypeById(db, incidentTypeId);
	if (!incidentType)
		throw new WorkOrderIncidentTypeNotFoundError(incidentTypeId);
}

async function ensureStatusExists(
	db: Kysely<DB>,
	statusId: number,
): Promise<void> {
	const status = await queries.findWorkOrderStatusById(db, statusId);
	if (!status) throw new WorkOrderStatusNotFoundError(statusId);
}

export async function listWorkOrders(
	db: Kysely<DB>,
	session: SessionSubject,
	access: WorkOrderReadAccess,
): Promise<WorkOrderResponse[]> {
	const rows = access.canReadExternal
		? await queries.listWorkOrders(db)
		: await queries.listWorkOrdersForClient(db, session.client_id);
	return rows.map(toWorkOrderResponse);
}

export async function getWorkOrder(
	db: Kysely<DB>,
	id: number,
	session: SessionSubject,
	access: WorkOrderReadAccess,
): Promise<WorkOrderResponse> {
	return toWorkOrderResponse(
		await findVisibleWorkOrder(db, id, session, access),
	);
}

export async function createWorkOrder(
	db: Kysely<DB>,
	session: SessionSubject,
	access: WorkOrderWriteAccess,
	input: CreateWorkOrderInput,
): Promise<WorkOrderResponse> {
	await ensureDeviceAccess(db, session, access, input.device_id);
	await ensureIncidentTypeExists(db, input.incident_type_id);
	await ensureStatusExists(db, input.work_order_status_id);

	return toWorkOrderResponse(
		await queries.insertWorkOrder(db, {
			created_at: input.created_at ?? new Date(),
			creator_user_id: session.user_id,
			device_id: input.device_id,
			incident_type_id: input.incident_type_id,
			priority: input.priority,
			state: input.state,
			work_order_status_id: input.work_order_status_id,
		}),
	);
}

export async function updateWorkOrder(
	db: Kysely<DB>,
	id: number,
	session: SessionSubject,
	access: WorkOrderWriteAccess,
	input: UpdateWorkOrderInput,
): Promise<WorkOrderResponse> {
	await findVisibleWorkOrder(db, id, session, access);
	if (input.device_id !== undefined)
		await ensureDeviceAccess(db, session, access, input.device_id);
	if (input.incident_type_id !== undefined)
		await ensureIncidentTypeExists(db, input.incident_type_id);
	if (input.work_order_status_id !== undefined)
		await ensureStatusExists(db, input.work_order_status_id);

	const updated = await queries.updateWorkOrder(db, id, input);
	if (!updated) throw new WorkOrderNotFoundError(id);
	return toWorkOrderResponse(updated);
}

export async function deleteWorkOrder(
	db: Kysely<DB>,
	id: number,
	session: SessionSubject,
	access: WorkOrderWriteAccess,
): Promise<void> {
	await findVisibleWorkOrder(db, id, session, access);
	try {
		const deleted = await queries.deleteWorkOrder(db, id);
		if (!deleted) throw new WorkOrderNotFoundError(id);
	} catch (error) {
		if (isForeignKeyViolation(error)) throw new WorkOrderInUseError();
		throw error;
	}
}

export function listWorkOrderStatuses(db: Kysely<DB>) {
	return queries.listWorkOrderStatuses(db);
}

export function listIncidentCategories(db: Kysely<DB>) {
	return queries.listIncidentCategories(db);
}

export function listIncidentTypes(db: Kysely<DB>) {
	return queries.listIncidentTypes(db);
}

export async function listWorkOrderUpdates(
	db: Kysely<DB>,
	id: number,
	session: SessionSubject,
	access: WorkOrderReadAccess,
): Promise<WorkOrderUpdateResponse[]> {
	await findVisibleWorkOrder(db, id, session, access);
	return (await queries.listWorkOrderUpdates(db, id)).map(
		toWorkOrderUpdateResponse,
	);
}

export async function createWorkOrderUpdate(
	db: Kysely<DB>,
	id: number,
	session: SessionSubject,
	access: WorkOrderWriteAccess,
	input: CreateWorkOrderUpdateInput,
): Promise<WorkOrderUpdateResponse> {
	await findVisibleWorkOrder(db, id, session, access);
	await ensureStatusExists(db, input.new_work_order_status_id);

	return db.transaction().execute(async (trx) => {
		const update = await queries.insertWorkOrderUpdate(trx, {
			work_order_id: id,
			created_at: new Date(),
			user_id: session.user_id,
			new_priority: input.new_priority,
			new_state: input.new_state,
			new_work_order_status_id: input.new_work_order_status_id,
			description: input.description,
		});
		await queries.updateWorkOrder(trx, id, {
			priority: input.new_priority,
			state: input.new_state,
			work_order_status_id: input.new_work_order_status_id,
		});
		return toWorkOrderUpdateResponse(update);
	});
}

export async function listWorkOrderUpdateImages(
	db: Kysely<DB>,
	id: number,
	session: SessionSubject,
	access: WorkOrderReadAccess,
) {
	await findVisibleWorkOrder(db, id, session, access);
	return { data: await queries.listWorkOrderUpdateImages(db, id) };
}

export async function createWorkOrderUpdateImage(
	db: Kysely<DB>,
	id: number,
	session: SessionSubject,
	access: WorkOrderWriteAccess,
	input: CreateWorkOrderUpdateImageInput,
) {
	await findVisibleWorkOrder(db, id, session, access);
	return queries.insertWorkOrderUpdateImage(db, {
		work_order_id: id,
		description: input.description,
		path: input.path,
	});
}
