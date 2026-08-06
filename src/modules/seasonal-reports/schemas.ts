import { Type } from "@sinclair/typebox";

export const SeasonalReportQuestionResponseSchema = Type.Union([
	Type.Literal("no"),
	Type.Literal("yes"),
	Type.Literal("unknown"),
]);

export const SeasonalReportIdParamsSchema = Type.Object({
	id: Type.Integer({ minimum: 1 }),
});

export const SeasonalReportTypeIdParamsSchema = Type.Object({
	id: Type.Integer({ minimum: 1 }),
});

export const SeasonalReportQuestionCategorySchema = Type.Object({
	id: Type.Integer(),
	category: Type.String(),
});

export const SeasonalReportQuestionCategoryListSchema = Type.Object({
	data: Type.Array(SeasonalReportQuestionCategorySchema),
});

export const SeasonalReportQuestionSchema = Type.Object({
	id: Type.Integer(),
	seasonal_report_question_category_id: Type.Integer(),
	question_text: Type.String(),
	is_critical: Type.Boolean(),
	expected_response: SeasonalReportQuestionResponseSchema,
});

export const SeasonalReportQuestionListSchema = Type.Object({
	data: Type.Array(SeasonalReportQuestionSchema),
});

export const SeasonalReportTypeSchema = Type.Object({
	id: Type.Integer(),
	report_type: Type.String(),
});

export const SeasonalReportTypeListSchema = Type.Object({
	data: Type.Array(SeasonalReportTypeSchema),
});

export const SeasonalReportTypeQuestionSchema = Type.Object({
	id: Type.Integer(),
	seasonal_report_type_id: Type.Integer(),
	seasonal_report_question_id: Type.Integer(),
});

export const SeasonalReportTypeQuestionListSchema = Type.Object({
	data: Type.Array(SeasonalReportTypeQuestionSchema),
});

export const SeasonalReportSchema = Type.Object({
	id: Type.Integer(),
	seasonal_report_type_id: Type.Integer(),
	date: Type.String({ format: "date-time" }),
	user_id: Type.String(),
	device_id: Type.Integer(),
	passed: Type.Boolean(),
	note: Type.String(),
});

export const SeasonalReportListSchema = Type.Object({
	data: Type.Array(SeasonalReportSchema),
});

export const CreateSeasonalReportBodySchema = Type.Object({
	seasonal_report_type_id: Type.Integer({ minimum: 1 }),
	date: Type.Optional(Type.String({ format: "date-time" })),
	device_id: Type.Integer({ minimum: 1 }),
	passed: Type.Boolean(),
	note: Type.String({ minLength: 1, maxLength: 1024 }),
});

export const UpdateSeasonalReportBodySchema = Type.Partial(
	Type.Object({
		seasonal_report_type_id: Type.Integer({ minimum: 1 }),
		date: Type.String({ format: "date-time" }),
		device_id: Type.Integer({ minimum: 1 }),
		passed: Type.Boolean(),
		note: Type.String({ minLength: 1, maxLength: 1024 }),
	}),
);

export const SeasonalReportAnswerSchema = Type.Object({
	id: Type.Integer(),
	seasonal_report_id: Type.Integer(),
	seasonal_report_question_id: Type.Integer(),
	response: SeasonalReportQuestionResponseSchema,
});

export const SeasonalReportAnswerListSchema = Type.Object({
	data: Type.Array(SeasonalReportAnswerSchema),
});

export const CreateSeasonalReportAnswerBodySchema = Type.Object({
	seasonal_report_question_id: Type.Integer({ minimum: 1 }),
	response: SeasonalReportQuestionResponseSchema,
});

export const SeasonalReportImageSchema = Type.Object({
	id: Type.Integer(),
	seasonal_report_id: Type.Integer(),
	description: Type.String(),
	path: Type.String(),
});

export const SeasonalReportImageListSchema = Type.Object({
	data: Type.Array(SeasonalReportImageSchema),
});

export const CreateSeasonalReportImageBodySchema = Type.Object({
	description: Type.String({ minLength: 1, maxLength: 1024 }),
	path: Type.String({ minLength: 1, maxLength: 255 }),
});
