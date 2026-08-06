import type { Kysely } from "kysely";
import type { DB, SeasonalReportQuestionResponse } from "@/db/types";
import type { SessionSubject } from "../auth/service";
import type { SeasonalReportAnswerRow, SeasonalReportRow } from "./queries";
import * as queries from "./queries";

export interface SeasonalReportReadAccess {
	canReadExternal: boolean;
}

export interface SeasonalReportWriteAccess {
	canWriteExternal: boolean;
}

export interface CreateSeasonalReportInput {
	seasonal_report_type_id: number;
	date?: string | Date;
	device_id: number;
	passed: boolean;
	note: string;
}

export interface UpdateSeasonalReportInput {
	seasonal_report_type_id?: number;
	date?: string | Date;
	device_id?: number;
	passed?: boolean;
	note?: string;
}

export interface CreateSeasonalReportAnswerInput {
	seasonal_report_question_id: number;
	response: SeasonalReportQuestionResponse;
}

export interface CreateSeasonalReportImageInput {
	description: string;
	path: string;
}

export interface SeasonalReportResponse {
	id: number;
	seasonal_report_type_id: number;
	date: string;
	user_id: string;
	device_id: number;
	passed: boolean;
	note: string;
}

export type SeasonalReportAnswerResponse = SeasonalReportAnswerRow;

export class SeasonalReportNotFoundError extends Error {
	constructor(reportId: number) {
		super(`seasonal report ${reportId} does not exist`);
		this.name = "SeasonalReportNotFoundError";
	}
}

export class SeasonalReportDeviceNotFoundError extends Error {
	constructor(deviceId: number) {
		super(`device ${deviceId} does not exist or is not available to your client`);
		this.name = "SeasonalReportDeviceNotFoundError";
	}
}

export class SeasonalReportTypeNotFoundError extends Error {
	constructor(typeId: number) {
		super(`seasonal report type ${typeId} does not exist`);
		this.name = "SeasonalReportTypeNotFoundError";
	}
}

export class SeasonalReportQuestionNotFoundError extends Error {
	constructor(questionId: number) {
		super(`seasonal report question ${questionId} does not exist`);
		this.name = "SeasonalReportQuestionNotFoundError";
	}
}

export class SeasonalReportQuestionMismatchError extends Error {
	constructor(questionId: number, typeId: number) {
		super(`seasonal report question ${questionId} does not belong to report type ${typeId}`);
		this.name = "SeasonalReportQuestionMismatchError";
	}
}

export class SeasonalReportInUseError extends Error {
	constructor() {
		super("seasonal report is still referenced by answers or images");
		this.name = "SeasonalReportInUseError";
	}
}

function isForeignKeyViolation(error: unknown): boolean {
	return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "23503";
}

function toIso(value: Date | string): string {
	return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toSeasonalReportResponse(row: SeasonalReportRow): SeasonalReportResponse {
	return { ...row, date: toIso(row.date) };
}

async function findVisibleReport(
	db: Kysely<DB>,
	id: number,
	session: SessionSubject,
	access: SeasonalReportReadAccess | SeasonalReportWriteAccess,
): Promise<SeasonalReportRow> {
	const canAccessExternal = "canReadExternal" in access ? access.canReadExternal : access.canWriteExternal;
	const report = canAccessExternal
		? await queries.findSeasonalReportById(db, id)
		: await queries.findSeasonalReportByIdForClient(db, id, session.client_id);
	if (!report) throw new SeasonalReportNotFoundError(id);
	return report;
}

async function ensureDeviceAccess(
	db: Kysely<DB>,
	session: SessionSubject,
	access: SeasonalReportWriteAccess,
	deviceId: number,
): Promise<void> {
	const device = access.canWriteExternal
		? await queries.findDeviceById(db, deviceId)
		: await queries.findDeviceByIdForClient(db, deviceId, session.client_id);
	if (!device) throw new SeasonalReportDeviceNotFoundError(deviceId);
}

async function ensureTypeExists(db: Kysely<DB>, typeId: number): Promise<void> {
	const type = await queries.findSeasonalReportTypeById(db, typeId);
	if (!type) throw new SeasonalReportTypeNotFoundError(typeId);
}

async function ensureQuestionBelongsToType(
	db: Kysely<DB>,
	questionId: number,
	typeId: number,
): Promise<void> {
	const question = await queries.findQuestionById(db, questionId);
	if (!question) throw new SeasonalReportQuestionNotFoundError(questionId);
	const link = await queries.findTypeQuestion(db, typeId, questionId);
	if (!link) throw new SeasonalReportQuestionMismatchError(questionId, typeId);
}

export async function listSeasonalReports(
	db: Kysely<DB>,
	session: SessionSubject,
	access: SeasonalReportReadAccess,
): Promise<SeasonalReportResponse[]> {
	const rows = access.canReadExternal
		? await queries.listSeasonalReports(db)
		: await queries.listSeasonalReportsForClient(db, session.client_id);
	return rows.map(toSeasonalReportResponse);
}

export async function getSeasonalReport(
	db: Kysely<DB>,
	id: number,
	session: SessionSubject,
	access: SeasonalReportReadAccess,
): Promise<SeasonalReportResponse> {
	return toSeasonalReportResponse(await findVisibleReport(db, id, session, access));
}

export async function createSeasonalReport(
	db: Kysely<DB>,
	session: SessionSubject,
	access: SeasonalReportWriteAccess,
	input: CreateSeasonalReportInput,
): Promise<SeasonalReportResponse> {
	await ensureTypeExists(db, input.seasonal_report_type_id);
	await ensureDeviceAccess(db, session, access, input.device_id);

	return toSeasonalReportResponse(
		await queries.insertSeasonalReport(db, {
			seasonal_report_type_id: input.seasonal_report_type_id,
			date: input.date ?? new Date(),
			user_id: session.user_id,
			device_id: input.device_id,
			passed: input.passed,
			note: input.note,
		}),
	);
}

export async function updateSeasonalReport(
	db: Kysely<DB>,
	id: number,
	session: SessionSubject,
	access: SeasonalReportWriteAccess,
	input: UpdateSeasonalReportInput,
): Promise<SeasonalReportResponse> {
	await findVisibleReport(db, id, session, access);
	if (input.seasonal_report_type_id !== undefined) await ensureTypeExists(db, input.seasonal_report_type_id);
	if (input.device_id !== undefined) await ensureDeviceAccess(db, session, access, input.device_id);

	const updated = await queries.updateSeasonalReport(db, id, input);
	if (!updated) throw new SeasonalReportNotFoundError(id);
	return toSeasonalReportResponse(updated);
}

export async function deleteSeasonalReport(
	db: Kysely<DB>,
	id: number,
	session: SessionSubject,
	access: SeasonalReportWriteAccess,
): Promise<void> {
	await findVisibleReport(db, id, session, access);
	try {
		const deleted = await queries.deleteSeasonalReport(db, id);
		if (!deleted) throw new SeasonalReportNotFoundError(id);
	} catch (error) {
		if (isForeignKeyViolation(error)) throw new SeasonalReportInUseError();
		throw error;
	}
}

export function listQuestionCategories(db: Kysely<DB>) {
	return queries.listQuestionCategories(db);
}

export function listQuestions(db: Kysely<DB>) {
	return queries.listQuestions(db);
}

export function listTypes(db: Kysely<DB>) {
	return queries.listTypes(db);
}

export async function listTypeQuestions(db: Kysely<DB>, typeId: number) {
	await ensureTypeExists(db, typeId);
	return queries.listTypeQuestions(db, typeId);
}

export async function listAnswers(
	db: Kysely<DB>,
	id: number,
	session: SessionSubject,
	access: SeasonalReportReadAccess,
) {
	await findVisibleReport(db, id, session, access);
	return queries.listAnswers(db, id);
}

export async function createAnswer(
	db: Kysely<DB>,
	id: number,
	session: SessionSubject,
	access: SeasonalReportWriteAccess,
	input: CreateSeasonalReportAnswerInput,
): Promise<SeasonalReportAnswerResponse> {
	const report = await findVisibleReport(db, id, session, access);
	await ensureQuestionBelongsToType(db, input.seasonal_report_question_id, report.seasonal_report_type_id);
	return queries.insertAnswer(db, {
		seasonal_report_id: id,
		seasonal_report_question_id: input.seasonal_report_question_id,
		response: input.response,
	});
}

export async function listImages(
	db: Kysely<DB>,
	id: number,
	session: SessionSubject,
	access: SeasonalReportReadAccess,
) {
	await findVisibleReport(db, id, session, access);
	return queries.listImages(db, id);
}

export async function createImage(
	db: Kysely<DB>,
	id: number,
	session: SessionSubject,
	access: SeasonalReportWriteAccess,
	input: CreateSeasonalReportImageInput,
) {
	await findVisibleReport(db, id, session, access);
	return queries.insertImage(db, {
		seasonal_report_id: id,
		description: input.description,
		path: input.path,
	});
}
