import type { Insertable, Kysely, Selectable, Updateable } from "kysely";
import type { DB } from "@/db/types";

export type SeasonalReportRow = Selectable<DB["seasonal_report"]>;
export type SeasonalReportAnswerRow = Selectable<DB["seasonal_report_answer"]>;
export type SeasonalReportImageRow = Selectable<DB["seasonal_report_image"]>;
export type SeasonalReportQuestionRow = Selectable<DB["seasonal_report_question"]>;
export type SeasonalReportQuestionCategoryRow = Selectable<DB["seasonal_report_question_category"]>;
export type SeasonalReportTypeRow = Selectable<DB["seasonal_report_type"]>;
export type SeasonalReportTypeQuestionRow = Selectable<DB["seasonal_report_type_question"]>;

type InsertSeasonalReportRow = Insertable<DB["seasonal_report"]>;
type UpdateSeasonalReportRow = Updateable<DB["seasonal_report"]>;
type InsertSeasonalReportAnswerRow = Insertable<DB["seasonal_report_answer"]>;
type InsertSeasonalReportImageRow = Insertable<DB["seasonal_report_image"]>;

const seasonalReportColumns = [
	"seasonal_report.id",
	"seasonal_report.seasonal_report_type_id",
	"seasonal_report.date",
	"seasonal_report.user_id",
	"seasonal_report.device_id",
	"seasonal_report.passed",
	"seasonal_report.note",
] as const;
const answerColumns = [
	"id",
	"seasonal_report_id",
	"seasonal_report_question_id",
	"response",
] as const;
const imageColumns = ["id", "seasonal_report_id", "description", "path"] as const;
const questionColumns = [
	"id",
	"seasonal_report_question_category_id",
	"question_text",
	"is_critical",
	"expected_response",
] as const;
const categoryColumns = ["id", "category"] as const;
const typeColumns = ["id", "report_type"] as const;

function scopedReportQuery(db: Kysely<DB>, clientId: number) {
	return db
		.selectFrom("seasonal_report")
		.innerJoin("device", "device.id", "seasonal_report.device_id")
		.innerJoin("device_info", "device_info.device_id", "device.id")
		.innerJoin("gauge_station", "gauge_station.id", "device_info.gauge_station_id")
		.innerJoin(
			"client_gauge_station",
			"client_gauge_station.gauge_station_id",
			"gauge_station.id",
		)
		.select(seasonalReportColumns)
		.distinct()
		.where("device.archived", "is", null)
		.where("device_info.archived", "is", null)
		.where("gauge_station.archived", "is", null)
		.where("client_gauge_station.client_id", "=", clientId);
}

export function listSeasonalReports(db: Kysely<DB>): Promise<SeasonalReportRow[]> {
	return db
		.selectFrom("seasonal_report")
		.select(seasonalReportColumns)
		.orderBy("seasonal_report.id", "asc")
		.execute();
}

export function listSeasonalReportsForClient(
	db: Kysely<DB>,
	clientId: number,
): Promise<SeasonalReportRow[]> {
	return scopedReportQuery(db, clientId).orderBy("seasonal_report.id", "asc").execute();
}

export function findSeasonalReportById(
	db: Kysely<DB>,
	id: number,
): Promise<SeasonalReportRow | undefined> {
	return db
		.selectFrom("seasonal_report")
		.select(seasonalReportColumns)
		.where("seasonal_report.id", "=", id)
		.executeTakeFirst();
}

export function findSeasonalReportByIdForClient(
	db: Kysely<DB>,
	id: number,
	clientId: number,
): Promise<SeasonalReportRow | undefined> {
	return scopedReportQuery(db, clientId).where("seasonal_report.id", "=", id).executeTakeFirst();
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

export function findSeasonalReportTypeById(
	db: Kysely<DB>,
	id: number,
): Promise<{ id: number } | undefined> {
	return db
		.selectFrom("seasonal_report_type")
		.select("id")
		.where("id", "=", id)
		.executeTakeFirst();
}

export function findQuestionById(db: Kysely<DB>, id: number): Promise<{ id: number } | undefined> {
	return db
		.selectFrom("seasonal_report_question")
		.select("id")
		.where("id", "=", id)
		.executeTakeFirst();
}

export function findTypeQuestion(
	db: Kysely<DB>,
	typeId: number,
	questionId: number,
): Promise<{ id: number } | undefined> {
	return db
		.selectFrom("seasonal_report_type_question")
		.select("id")
		.where("seasonal_report_type_id", "=", typeId)
		.where("seasonal_report_question_id", "=", questionId)
		.executeTakeFirst();
}

export function insertSeasonalReport(
	db: Kysely<DB>,
	report: InsertSeasonalReportRow,
): Promise<SeasonalReportRow> {
	return db
		.insertInto("seasonal_report")
		.values(report)
		.returning(seasonalReportColumns)
		.executeTakeFirstOrThrow();
}

export function updateSeasonalReport(
	db: Kysely<DB>,
	id: number,
	report: UpdateSeasonalReportRow,
): Promise<SeasonalReportRow | undefined> {
	return db
		.updateTable("seasonal_report")
		.set(report)
		.where("id", "=", id)
		.returning(seasonalReportColumns)
		.executeTakeFirst();
}

export function deleteSeasonalReport(
	db: Kysely<DB>,
	id: number,
): Promise<SeasonalReportRow | undefined> {
	return db
		.deleteFrom("seasonal_report")
		.where("id", "=", id)
		.returning(seasonalReportColumns)
		.executeTakeFirst();
}

export function listQuestionCategories(
	db: Kysely<DB>,
): Promise<SeasonalReportQuestionCategoryRow[]> {
	return db
		.selectFrom("seasonal_report_question_category")
		.select(categoryColumns)
		.orderBy("id", "asc")
		.execute();
}

export function listQuestions(db: Kysely<DB>): Promise<SeasonalReportQuestionRow[]> {
	return db
		.selectFrom("seasonal_report_question")
		.select(questionColumns)
		.orderBy("id", "asc")
		.execute();
}

export function listTypes(db: Kysely<DB>): Promise<SeasonalReportTypeRow[]> {
	return db.selectFrom("seasonal_report_type").select(typeColumns).orderBy("id", "asc").execute();
}

export function listTypeQuestions(
	db: Kysely<DB>,
	typeId: number,
): Promise<SeasonalReportQuestionRow[]> {
	return db
		.selectFrom("seasonal_report_type_question")
		.innerJoin(
			"seasonal_report_question",
			"seasonal_report_question.id",
			"seasonal_report_type_question.seasonal_report_question_id",
		)
		.select(questionColumns.map((column) => `seasonal_report_question.${column}` as const))
		.where("seasonal_report_type_question.seasonal_report_type_id", "=", typeId)
		.orderBy("seasonal_report_question.id", "asc")
		.execute();
}

export function listAnswers(db: Kysely<DB>, reportId: number): Promise<SeasonalReportAnswerRow[]> {
	return db
		.selectFrom("seasonal_report_answer")
		.select(answerColumns)
		.where("seasonal_report_id", "=", reportId)
		.orderBy("id", "asc")
		.execute();
}

export function insertAnswer(
	db: Kysely<DB>,
	answer: InsertSeasonalReportAnswerRow,
): Promise<SeasonalReportAnswerRow> {
	return db
		.insertInto("seasonal_report_answer")
		.values(answer)
		.returning(answerColumns)
		.executeTakeFirstOrThrow();
}

export function listImages(db: Kysely<DB>, reportId: number): Promise<SeasonalReportImageRow[]> {
	return db
		.selectFrom("seasonal_report_image")
		.select(imageColumns)
		.where("seasonal_report_id", "=", reportId)
		.orderBy("id", "asc")
		.execute();
}

export function insertImage(
	db: Kysely<DB>,
	image: InsertSeasonalReportImageRow,
): Promise<SeasonalReportImageRow> {
	return db
		.insertInto("seasonal_report_image")
		.values(image)
		.returning(imageColumns)
		.executeTakeFirstOrThrow();
}
