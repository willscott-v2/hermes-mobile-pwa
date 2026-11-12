import { describe, expect, it, vi } from 'vitest';
import { AttachmentResult, PreparedAttachment } from './hermesApi';
import { AttachmentPrepareError, AttachmentUploadError, attachmentSizeError, describeSendFailure, prepareAttachment, uploadPrepared } from './attachments';

const MIB = 1024 * 1024;
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1, 2, 255]);

async function nodeReader(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return `data:${file.type || 'application/octet-stream'};base64,${btoa(String.fromCharCode(...bytes))}`;
}

function prepared(name: string, overrides: Partial<PreparedAttachment> = {}): PreparedAttachment {
  return Object.freeze({ id: `id-${name}`, name, mimeType: 'image/png', size: 3, dataUrl: 'data:image/png;base64,AAAA', ...overrides });
}

describe('prepareAttachment', () => {
  it('captures the exact bytes, name and MIME type once, at selection time', async () => {
    const file = new File([PNG_BYTES], 'IMG_0042.png', { type: 'image/png' });
    const reader = vi.fn(nodeReader);
    const result = await prepareAttachment(file, reader);
    expect(reader).toHaveBeenCalledTimes(1);
    expect(result.name).toBe('IMG_0042.png');
    expect(result.mimeType).toBe('image/png');
    expect(result.size).toBe(PNG_BYTES.length);
    expect(result.dataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(Uint8Array.from(atob(result.dataUrl.split(',')[1]), (char) => char.charCodeAt(0))).toEqual(PNG_BYTES);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it('keeps the original filename exactly, including spaces and unicode', async () => {
    const result = await prepareAttachment(new File([PNG_BYTES], 'Screenshot 2026-10-06 at 9.41.07 PM — final.png', { type: 'image/png' }), nodeReader);
    expect(result.name).toBe('Screenshot 2026-10-06 at 9.41.07 PM — final.png');
  });

  it('gives each prepared attachment its own id', async () => {
    const file = new File([PNG_BYTES], 'a.png', { type: 'image/png' });
    const [a, b] = await Promise.all([prepareAttachment(file, nodeReader), prepareAttachment(file, nodeReader)]);
    expect(a.id).not.toBe(b.id);
  });

  it('names the file and sanitizes browser paths and credentials when the read fails', async () => {
    const file = new File([PNG_BYTES], 'IMG_0043.png', { type: 'image/png' });
    const reader = async () => { throw new Error('NotReadableError at file:///private/var/mobile/Containers/Shared/tmp/IMG_0043.png token=abc123 Bearer sekrit'); };
    const error = await prepareAttachment(file, reader).catch((e) => e);
    expect(error).toBeInstanceOf(AttachmentPrepareError);
    expect(error.fileName).toBe('IMG_0043.png');
    expect(error.message).toContain('Could not attach IMG_0043.png');
    expect(error.message).not.toMatch(/private\/var|Containers|abc123|sekrit/);
  });

  it('survives a non-Error rejection', async () => {
    const file = new File([PNG_BYTES], 'x.png', { type: 'image/png' });
    const error = await prepareAttachment(file, () => Promise.reject('boom')).catch((e) => e);
    expect(error).toBeInstanceOf(AttachmentPrepareError);
    expect(error.message).toContain('Could not attach x.png');
  });

  it('rejects an empty file with a re-select hint instead of attaching nothing', async () => {
    const reader = vi.fn(nodeReader);
    const error = await prepareAttachment(new File([], 'empty.png', { type: 'image/png' }), reader).catch((e) => e);
    expect(error).toBeInstanceOf(AttachmentPrepareError);
    expect(error.message).toMatch(/empty/i);
    expect(error.message).toMatch(/select it again/i);
    expect(reader).not.toHaveBeenCalled();
  });

  it('rejects a read whose payload does not match the file size (truncated snapshot)', async () => {
    const file = new File([PNG_BYTES], 'cut.png', { type: 'image/png' });
    const error = await prepareAttachment(file, async () => 'data:image/png;base64,AAAA').catch((e) => e);
    expect(error).toBeInstanceOf(AttachmentPrepareError);
    expect(error.message).toContain('Could not attach cut.png');
  });

  it('rejects a result that is not a data URL', async () => {
    const file = new File([PNG_BYTES], 'odd.png', { type: 'image/png' });
    const error = await prepareAttachment(file, async () => '').catch((e) => e);
    expect(error).toBeInstanceOf(AttachmentPrepareError);
  });

  it('rejects oversize files before reading them', async () => {
    const big = { name: 'huge.png', type: 'image/png', size: 25 * MIB + 1 } as File;
    const reader = vi.fn(nodeReader);
    const error = await prepareAttachment(big, reader).catch((e) => e);
    expect(error).toBeInstanceOf(AttachmentPrepareError);
    expect(error.message).toContain('25 MB');
    expect(reader).not.toHaveBeenCalled();
  });
});

describe('attachmentSizeError', () => {
  it('allows exactly 25 MiB for images and general files, and rejects one byte more', () => {
    expect(attachmentSizeError('a.png', 'image/png', 25 * MIB)).toBe('');
    expect(attachmentSizeError('a.png', 'image/png', 25 * MIB + 1)).toContain('25 MB');
    expect(attachmentSizeError('a.txt', 'text/plain', 25 * MIB)).toBe('');
    expect(attachmentSizeError('a.txt', 'text/plain', 25 * MIB + 1)).toContain('25 MB');
  });

  it('allows exactly 50 MiB for PDFs, by MIME type or extension, and rejects one byte more', () => {
    expect(attachmentSizeError('a.pdf', 'application/pdf', 50 * MIB)).toBe('');
    expect(attachmentSizeError('a.pdf', 'application/pdf', 50 * MIB + 1)).toContain('50 MB');
    expect(attachmentSizeError('scan.PDF', '', 50 * MIB)).toBe('');
    expect(attachmentSizeError('scan.PDF', '', 50 * MIB + 1)).toContain('50 MB');
  });
});

describe('uploadPrepared', () => {
  const ok = (item: PreparedAttachment): AttachmentResult => ({ name: item.name, kind: 'image', text: `[ref ${item.name}]` });

  it('uploads in order, reports progress, and returns the results', async () => {
    const calls: string[] = [];
    const progress: string[] = [];
    const results = await uploadPrepared('s1', [prepared('a.png'), prepared('b.png')], new Map(), async (_s, item) => { calls.push(item.name); return ok(item); }, (item) => progress.push(item.name));
    expect(calls).toEqual(['a.png', 'b.png']);
    expect(progress).toEqual(['a.png', 'b.png']);
    expect(results.map((r) => r.text)).toEqual(['[ref a.png]', '[ref b.png]']);
  });

  it('passes the live session id and the prepared attachment through untouched', async () => {
    const item = prepared('a.png');
    const attach = vi.fn(async (_s: string, i: PreparedAttachment) => ok(i));
    await uploadPrepared('live-1', [item], new Map(), attach);
    expect(attach).toHaveBeenCalledWith('live-1', item);
  });

  it('does not upload again on retry what already uploaded for the same session', async () => {
    const cache = new Map<string, AttachmentResult>();
    const items = [prepared('a.png'), prepared('b.png')];
    const attach = vi.fn(async (_s: string, item: PreparedAttachment) => {
      if (item.name === 'b.png' && attach.mock.calls.length === 2) throw new Error('socket closed');
      return ok(item);
    });
    const first = await uploadPrepared('s1', items, cache, attach).catch((e) => e);
    expect(first).toBeInstanceOf(AttachmentUploadError);
    expect(first.fileName).toBe('b.png');
    expect(attach).toHaveBeenCalledTimes(2);
    const results = await uploadPrepared('s1', items, cache, attach);
    expect(attach).toHaveBeenCalledTimes(3); // only b.png again
    expect(results.map((r) => r.name)).toEqual(['a.png', 'b.png']);
    await uploadPrepared('s1', items, cache, attach);
    expect(attach).toHaveBeenCalledTimes(3); // submit retry after full upload: no RPCs
  });

  it('uploads again when the live session changed', async () => {
    const cache = new Map<string, AttachmentResult>();
    const attach = vi.fn(async (_s: string, item: PreparedAttachment) => ok(item));
    await uploadPrepared('s1', [prepared('a.png')], cache, attach);
    await uploadPrepared('s2', [prepared('a.png')], cache, attach);
    expect(attach).toHaveBeenCalledTimes(2);
  });

  it('labels a failure as an upload failure with a sanitized reason', async () => {
    const error = await uploadPrepared('s1', [prepared('a.png')], new Map(), async () => { throw new Error('rejected token=abc123'); }).catch((e) => e);
    expect(error).toBeInstanceOf(AttachmentUploadError);
    expect(error.message).toContain('Could not upload a.png');
    expect(error.message).not.toContain('abc123');
  });
});

describe('describeSendFailure', () => {
  it('reports an upload failure as nothing sent and files kept', () => {
    const text = describeSendFailure(new AttachmentUploadError('a.png', 'Could not upload a.png: socket closed'), { attachmentCount: 1, uploadedCount: 0 });
    expect(text.stage).toBe('upload');
    expect(text.banner).toBe('Could not upload a.png: socket closed');
    expect(text.status).toMatch(/Upload failed/);
    expect(text.status).toMatch(/nothing was sent/i);
  });

  it('does not call a submit failure after a successful upload an upload failure', () => {
    const text = describeSendFailure(new Error('Gateway disconnected. token=abc123'), { attachmentCount: 2, uploadedCount: 2 });
    expect(text.stage).toBe('submit');
    expect(text.banner).toContain('Not sent: Gateway disconnected.');
    expect(text.banner).not.toContain('abc123');
    expect(text.status).not.toMatch(/upload failed/i);
    expect(text.status).toMatch(/uploaded/i);
    expect(text.status).toMatch(/not uploaded again|won.t be uploaded again/i);
  });

  it('uses the plain draft message for a text-only submit failure', () => {
    const text = describeSendFailure(new Error('nope'), { attachmentCount: 0, uploadedCount: 0 });
    expect(text.stage).toBe('submit');
    expect(text.status).toBe('Prompt was not sent. Your draft is restored.');
  });
});
