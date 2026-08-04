import { googleFetch } from './google.js';
import { buildMimeMessage, toBase64Url, type Attachment } from './mime.js';

const GMAIL_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

export interface GmailProfile {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
}

export function getProfile(accountId: number): Promise<GmailProfile> {
  return googleFetch<GmailProfile>(accountId, `${GMAIL_BASE}/profile`);
}

export interface SendMessageInput {
  from: string;
  fromName?: string;
  to: string;
  toName?: string;
  subject: string;
  html: string;
  replyTo?: string;
  attachments?: Attachment[];
}

export interface SendMessageResult {
  id: string;
  threadId: string;
  labelIds?: string[];
}

/**
 * Sends one message through the Gmail API (`users.messages.send`).
 * SMTP is deliberately not used — the API gives us message IDs, OAuth-only auth,
 * and no app-password requirement.
 */
export async function sendMessage(accountId: number, input: SendMessageInput): Promise<SendMessageResult> {
  const raw = toBase64Url(buildMimeMessage(input));
  return googleFetch<SendMessageResult>(accountId, `${GMAIL_BASE}/messages/send`, {
    method: 'POST',
    body: { raw },
  });
}

/**
 * Sends a message to the connected address itself — used by the "Send test email"
 * button so users can verify the whole pipeline before a bulk run.
 */
export async function sendTestMessage(
  accountId: number,
  input: Omit<SendMessageInput, 'to' | 'toName'> & { to?: string },
): Promise<SendMessageResult> {
  return sendMessage(accountId, { ...input, to: input.to ?? input.from });
}
