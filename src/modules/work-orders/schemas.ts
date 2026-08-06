import { Type } from "@sinclair/typebox";

export const WorkOrderStateSchema = Type.Union([
	Type.Literal("not_started"),
	Type.Literal("in_progress"),
	Type.Literal("completed"),
	Type.Literal("cancelled"),
]);

export const WorkOrderIdParamsSchema = Type.Object({
	id: Type.Integer({ minimum: 1 }),
});

export const WorkOrderStatusSchema = Type.Object({
	id: Type.Integer(),
	status: Type.String(),
});

export const WorkOrderStatusListSchema = Type.Object({
	data: Type.Array(WorkOrderStatusSchema),
});

export const IncidentCategorySchema = Type.Object({
	id: Type.Integer(),
	category: Type.String(),
});

export const IncidentCategoryListSchema = Type.Object({
	data: Type.Array(IncidentCategorySchema),
});

export const IncidentTypeSchema = Type.Object({
	id: Type.Integer(),
	incident_category_id: Type.Integer(),
	type: Type.String(),
});

export const IncidentTypeListSchema = Type.Object({
	data: Type.Array(IncidentTypeSchema),
});

export const WorkOrderSchema = Type.Object({
	id: Type.Integer(),
	created_at: Type.String({ format: "date-time" }),
	creator_user_id: Type.String(),
	device_id: Type.Integer(),
	incident_type_id: Type.Integer(),
	priority: Type.Integer(),
	state: WorkOrderStateSchema,
	work_order_status_id: Type.Integer(),
});

export const WorkOrderListSchema = Type.Object({
	data: Type.Array(WorkOrderSchema),
});

export const CreateWorkOrderBodySchema = Type.Object({
	created_at: Type.Optional(Type.String({ format: "date-time" })),
	device_id: Type.Integer({ minimum: 1 }),
	incident_type_id: Type.Integer({ minimum: 1 }),
	priority: Type.Integer(),
	state: WorkOrderStateSchema,
	work_order_status_id: Type.Integer({ minimum: 1 }),
});

export const UpdateWorkOrderBodySchema = Type.Partial(
	Type.Object({
		device_id: Type.Integer({ minimum: 1 }),
		incident_type_id: Type.Integer({ minimum: 1 }),
		priority: Type.Integer(),
		state: WorkOrderStateSchema,
		work_order_status_id: Type.Integer({ minimum: 1 }),
	}),
);

export const WorkOrderUpdateSchema = Type.Object({
	id: Type.Integer(),
	work_order_id: Type.Integer(),
	created_at: Type.String({ format: "date-time" }),
	user_id: Type.String(),
	new_priority: Type.Integer(),
	new_state: WorkOrderStateSchema,
	new_work_order_status_id: Type.Integer(),
	description: Type.String(),
});

export const WorkOrderUpdateListSchema = Type.Object({
	data: Type.Array(WorkOrderUpdateSchema),
});

export const CreateWorkOrderUpdateBodySchema = Type.Object({
	new_priority: Type.Integer(),
	new_state: WorkOrderStateSchema,
	new_work_order_status_id: Type.Integer({ minimum: 1 }),
	description: Type.String({ minLength: 1, maxLength: 1024 }),
});

export const WorkOrderUpdateImageSchema = Type.Object({
	id: Type.Integer(),
	work_order_id: Type.Integer(),
	description: Type.String(),
	path: Type.String(),
});

export const WorkOrderUpdateImageListSchema = Type.Object({
	data: Type.Array(WorkOrderUpdateImageSchema),
});

export const CreateWorkOrderUpdateImageBodySchema = Type.Object({
	description: Type.String({ minLength: 1, maxLength: 1024 }),
	path: Type.String({ minLength: 1, maxLength: 255 }),
});
