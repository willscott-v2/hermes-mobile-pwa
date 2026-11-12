import { AttachmentResult, classifyAttachment, fileToDataUrl, MAX_ATTACHMENT_BYTES, MAX_PDF_ATTACHMENT_BYTES, PreparedAttachment, redactForLog } from './hermesApi';

const MIB = 1024 * 1024;

export class AttachmentPrepareError extends Error {
  constructor(readonly fileName: string, message: string) {
    super(message);
    this.name = 'AttachmentPrepareError';
  }
}

export class AttachmentUploadError extends Error {
  constructor(readonly fileName: string, message: string) {
    super(message);
    this.name = 'AttachmentUploadError';
  }
}

let nextAttachmentId = 0;

// Display-safe file name: basename only, redacted, bounded.
function safeName(name: string): string {
  const base = name.split(/[\\/]/).pop() || 'file';
  const redacted = redactForLog(base);
  return redacted.length > 80 ? `${redacted.slice(0, 77)}…` : redacted;
}

// Browser-visible reason text: no credentials, no local paths or blob URLs, bounded length.
function safeReason(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message || error.name : typeof error === 'string' ? error : '';
  const text = redactForLog(raw)
    .replace(/(?:file:\/\/)?\/(?:private|var|Users|tmp|home|Library|Volumes)\/\S*/g, '[path]')
    .replace(/blob:\S+/g, '[blob]')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return fallback;
  return text.length > 160 ? `${text.slice(0, 157)}…` : text;
}

export function attachmentSizeError(name: string, mimeType: string, size: number): string {
  const pdf = classifyAttachment(name, mimeType) === 'pdf';
  const limit = pdf ? MAX_PDF_ATTACHMENT_BYTES : MAX_ATTACHMENT_BYTES;
  return size > limit ? `too large (limit ${limit / MIB} MB).` : '';
}

// Snapshot the picked file's bytes now. Call this from the input change handler: iOS can revoke the
// File handle shortly after selection, so Send must never read the File again.
export async function prepareAttachment(file: File, readDataUrl: (file: File) => Promise<string> = fileToDataUrl): Promise<PreparedAttachment> {
  const name = safeName(file.name);
  const fail = (reason: string) => new AttachmentPrepareError(name, `Could not attach ${name}: ${reason}`);
  if (file.size === 0) throw fail('the file is empty or the phone stopped sharing it. Select it again.');
  const tooLarge = attachmentSizeError(file.name, file.type, file.size);
  if (tooLarge) throw fail(tooLarge);
  let dataUrl: string;
  try {
    dataUrl = await readDataUrl(file);
  } catch (error) {
    throw fail(safeReason(error, 'the browser could not read the file. Select it again.'));
  }
  const comma = dataUrl.indexOf(',');
  const payloadLength = comma < 0 ? -1 : dataUrl.length - comma - 1;
  if (!dataUrl.startsWith('data:') || payloadLength !== Math.ceil(file.size / 3) * 4) throw fail('the file was only partly read. Select it again.');
  return Object.freeze({ id: `attachment-${++nextAttachmentId}`, name: file.name, mimeType: file.type, size: file.size, dataUrl });
}

// Upload prepared attachments in order. `uploaded` remembers what the gateway already accepted for a
// live session, so retrying a send whose prompt.submit failed does not attach the same files twice.
export async function uploadPrepared(
  sessionId: string,
  items: readonly PreparedAttachment[],
  uploaded: Map<string, AttachmentResult>,
  attach: (sessionId: string, item: PreparedAttachment) => Promise<AttachmentResult>,
  onProgress?: (item: PreparedAttachment) => void,
): Promise<AttachmentResult[]> {
  const results: AttachmentResult[] = [];
  for (const item of items) {
    const key = `${sessionId}\u0000${item.id}`;
    let result = uploaded.get(key);
    if (!result) {
      onProgress?.(item);
      try {
        result = await attach(sessionId, item);
      } catch (error) {
        const name = safeName(item.name);
        throw new AttachmentUploadError(name, `Could not upload ${name}: ${safeReason(error, 'the request failed.')}`);
      }
      uploaded.set(key, result);
    }
    results.push(result);
  }
  return results;
}

export interface SendFailure {
  stage: 'upload' | 'submit';
  banner: string;
  status: string;
}

// Which boundary failed, in words the user can act on. An upload failure and a prompt.submit failure
// after a successful upload are different situations and must not be reported as one.
export function describeSendFailure(error: unknown, context: { attachmentCount: number; uploadedCount: number }): SendFailure {
  if (error instanceof AttachmentUploadError) {
    return { stage: 'upload', banner: error.message, status: `Upload failed (${error.fileName}). File(s) restored in the composer; nothing was sent.` };
  }
  const banner = `Not sent: ${safeReason(error, 'Prompt submit failed.')}`;
  if (context.attachmentCount > 0 && context.uploadedCount > 0) {
    return { stage: 'submit', banner, status: 'File(s) uploaded, but the message was not sent. Your draft and files are restored; tap Send to retry (files are not uploaded again).' };
  }
  return { stage: 'submit', banner, status: context.attachmentCount > 0 ? 'The message was not sent. Your draft and files are restored.' : 'Prompt was not sent. Your draft is restored.' };
}
