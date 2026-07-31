// Minimal email seam. SES drops in later by swapping this one implementation;
// call sites depend only on the SendEmail signature.

export interface EmailMessage {
	to: string;
	subject: string;
	text: string;
}

export type SendEmail = (message: EmailMessage) => Promise<void>;

export const sendEmail: SendEmail = async (message) => {
	// TODO(email phase): replace with SES (@aws-sdk/client-sesv2).
	// biome-ignore lint/suspicious/noConsole: deliberate stub until SES lands
	console.log(`[email stub] to=${message.to} subject=${message.subject}\n${message.text}`);
};
