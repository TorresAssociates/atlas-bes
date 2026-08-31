import type { Insertable, Kysely, Selectable, Updateable } from "kysely";
import type { DB } from "@/db/types";

export type WorkOrderRow = Selectable<DB["work_order"]>;
export type WorkOrderStatusRow = Selectable<DB["work_order_status"]>;
export type IncidentCategoryRow = Selectable<DB["incident_category"]>;
export type IncidentTypeRow = Selectable<DB["incident_type"]>;
export type WorkOrderUpdateRow = Selectable<DB["work_order_update"]>;
export type WorkOrderUpdateImageRow = Selectable<DB["work_order_update_image"]>;

type InsertWorkOrderRow = Insertable<DB["work_order"]>;
type UpdateWorkOrderRow = Updateable<DB["work_order"]>;
type InsertWorkOrderUpdateRow = Insertable<DB["work_order_update"]>;
type InsertWorkOrderUpdateImageRow = Insertable<DB["work_order_update_image"]>;

const workOrderColumns = [
	"work_order.id",
	"work_order.name",
	"work_order.created_at",
	"work_order.creator_user_id",
	"work_order.assigned_user_id",
	"work_order.device_id",
	"work_order.incident_type_id",
	"work_order.priority",
	"work_order.state",
	"work_order.work_order_status_id",
] as const;
const workOrderStatusColumns = ["id", "status"] as const;
const incidentCategoryColumns = ["id", "category"] as const;
const incidentTypeColumns = ["id", "incident_category_id", "type"] as const;
const workOrderUpdateColumns = [
	"id",
	"work_order_id",
	"date",
	"user_id",
	"new_priority",
	"new_state",
	"new_work_order_status_id",
	"description",
] as const;
const workOrderUpdateImageColumns = ["id", "work_order_update_id", "description", "path"] as const;

function scopedWorkOrderQuery(db: Kysely<DB>, clientId: number) {
	return db
		.selectFrom("work_order")
		.innerJoin("device", "device.id", "work_order.device_id")
		.innerJoin("device_info", "device_info.device_id", "device.id")
		.innerJoin("gauge_station", "gauge_station.id", "device_info.gauge_station_id")
		.innerJoin(
			"client_gauge_station",
			"client_gauge_station.gauge_station_id",
			"gauge_station.id",
		)
		.select(workOrderColumns)
		.distinct()
		.where("device.archived", "is", null)
		.where("device_info.archived", "is", null)
		.where("gauge_station.archived", "is", null)
		.where("client_gauge_station.client_id", "=", clientId);
}

export function listWorkOrders(db: Kysely<DB>): Promise<WorkOrderRow[]> {
	return db
		.selectFrom("work_order")
		.select(workOrderColumns)
		.orderBy("work_order.id", "asc")
		.execute();
}

export function listWorkOrdersForClient(db: Kysely<DB>, clientId: number): Promise<WorkOrderRow[]> {
	return scopedWorkOrderQuery(db, clientId).orderBy("work_order.id", "asc").execute();
}

export function findWorkOrderById(db: Kysely<DB>, id: number): Promise<WorkOrderRow | undefined> {
	return db
		.selectFrom("work_order")
		.select(workOrderColumns)
		.where("work_order.id", "=", id)
		.executeTakeFirst();
}

export function findWorkOrderByIdForClient(
	db: Kysely<DB>,
	id: number,
	clientId: number,
): Promise<WorkOrderRow | undefined> {
	return scopedWorkOrderQuery(db, clientId).where("work_order.id", "=", id).executeTakeFirst();
}

export function findDeviceById(db: Kysely<DB>, id: number): Promise<{ id: number } | undefined> {
	return db
		.selectFrom("device")
		.select("id")
		.where("id", "=", id)
		.where("archived", "is", null)
		.executeTakeFirst();
}

export function findDeviceByIdForClient(
	db: Kysely<DB>,
	id: number,
	clientId: number,
): Promise<{ id: number } | undefined> {
	return db
		.selectFrom("device")
		.innerJoin("device_info", "device_info.device_id", "device.id")
		.innerJoin("gauge_station", "gauge_station.id", "device_info.gauge_station_id")
		.innerJoin(
			"client_gauge_station",
			"client_gauge_station.gauge_station_id",
			"gauge_station.id",
		)
		.select("device.id")
		.where("device.id", "=", id)
		.where("device.archived", "is", null)
		.where("device_info.archived", "is", null)
		.where("gauge_station.archived", "is", null)
		.where("client_gauge_station.client_id", "=", clientId)
		.executeTakeFirst();
}

export function findIncidentTypeById(
	db: Kysely<DB>,
	id: number,
): Promise<{ id: number } | undefined> {
	return db.selectFrom("incident_type").select("id").where("id", "=", id).executeTakeFirst();
}

export function findWorkOrderStatusById(
	db: Kysely<DB>,
	id: number,
): Promise<{ id: number } | undefined> {
	return db.selectFrom("work_order_status").select("id").where("id", "=", id).executeTakeFirst();
}

export function insertWorkOrder(
	db: Kysely<DB>,
	workOrder: InsertWorkOrderRow,
): Promise<WorkOrderRow> {
	return db
		.insertInto("work_order")
		.values(workOrder)
		.returning(workOrderColumns)
		.executeTakeFirstOrThrow();
}

export function updateWorkOrder(
	db: Kysely<DB>,
	id: number,
	workOrder: UpdateWorkOrderRow,
): Promise<WorkOrderRow | undefined> {
	return db
		.updateTable("work_order")
		.set(workOrder)
		.where("id", "=", id)
		.returning(workOrderColumns)
		.executeTakeFirst();
}

export function deleteWorkOrder(db: Kysely<DB>, id: number): Promise<WorkOrderRow | undefined> {
	return db
		.deleteFrom("work_order")
		.where("id", "=", id)
		.returning(workOrderColumns)
		.executeTakeFirst();
}

export function listWorkOrderStatuses(db: Kysely<DB>): Promise<WorkOrderStatusRow[]> {
	return db
		.selectFrom("work_order_status")
		.select(workOrderStatusColumns)
		.orderBy("id", "asc")
		.execute();
}

export function listIncidentCategories(db: Kysely<DB>): Promise<IncidentCategoryRow[]> {
	return db
		.selectFrom("incident_category")
		.select(incidentCategoryColumns)
		.orderBy("id", "asc")
		.execute();
}

export function listIncidentTypes(db: Kysely<DB>): Promise<IncidentTypeRow[]> {
	return db
		.selectFrom("incident_type")
		.select(incidentTypeColumns)
		.orderBy("id", "asc")
		.execute();
}

export function listWorkOrderUpdates(
	db: Kysely<DB>,
	workOrderId: number,
): Promise<WorkOrderUpdateRow[]> {
	return db
		.selectFrom("work_order_update")
		.select(workOrderUpdateColumns)
		.where("work_order_id", "=", workOrderId)
		.orderBy("date", "asc")
		.orderBy("id", "asc")
		.execute();
}

export function findWorkOrderUpdateByIdForWorkOrder(
	db: Kysely<DB>,
	id: number,
	workOrderId: number,
): Promise<{ id: number } | undefined> {
	return db
		.selectFrom("work_order_update")
		.select("id")
		.where("id", "=", id)
		.where("work_order_id", "=", workOrderId)
		.executeTakeFirst();
}

export function insertWorkOrderUpdate(
	db: Kysely<DB>,
	update: InsertWorkOrderUpdateRow,
): Promise<WorkOrderUpdateRow> {
	return db
		.insertInto("work_order_update")
		.values(update)
		.returning(workOrderUpdateColumns)
		.executeTakeFirstOrThrow();
}

export function listWorkOrderUpdateImages(
	db: Kysely<DB>,
	workOrderId: number,
): Promise<WorkOrderUpdateImageRow[]> {
	return db
		.selectFrom("work_order_update_image")
		.innerJoin(
			"work_order_update",
			"work_order_update.id",
			"work_order_update_image.work_order_update_id",
		)
		.select([
			"work_order_update_image.id",
			"work_order_update_image.work_order_update_id",
			"work_order_update_image.description",
			"work_order_update_image.path",
		])
		.where("work_order_update.work_order_id", "=", workOrderId)
		.orderBy("work_order_update.date", "asc")
		.orderBy("work_order_update_image.id", "asc")
		.execute();
}

export function insertWorkOrderUpdateImage(
	db: Kysely<DB>,
	image: InsertWorkOrderUpdateImageRow,
): Promise<WorkOrderUpdateImageRow> {
	return db
		.insertInto("work_order_update_image")
		.values(image)
		.returning(workOrderUpdateImageColumns)
		.executeTakeFirstOrThrow();
}
