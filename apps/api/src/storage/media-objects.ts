import { createHmac } from 'node:crypto';
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@devtrack/types';
import { AppException } from '../common/errors/app.exception';
import { r2StorageConfig } from './r2';

const UPLOAD_SECONDS = 300;
const READ_SECONDS = 900;
/**
 * Task and milestone media share these keys (ids are random UUIDs): the CDN Worker serves only
 * `task-media/<uuid>`, and the bucket expires `pending-task-media/` after a day
 * (Docs/task-media-storage.md).
 */
const completedKey = (id: string) => `task-media/${id}`;
const pendingKey = (id: string) => `pending-task-media/${id}`;

export interface MediaFile {
  contentType: string;
  size: number;
}

export interface PreparedUpload {
  id: string;
  url: string;
  headers: Record<string, string>;
}

/**
 * Browser → R2 media uploads (0022, 0030 §5): a presigned PUT to a pending key, then a check
 * of the staged object and a copy to its final key, and signed read URLs.
 */
export class MediaObjects {
  private readonly storage = r2StorageConfig();

  /** Whether media storage is configured at all. */
  get enabled(): boolean {
    return this.storage !== null;
  }

  require() {
    if (!this.storage)
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.SERVICE_UNAVAILABLE,
        'Media uploads are unavailable.',
      );
    return this.storage;
  }

  async presign(id: string, file: MediaFile): Promise<PreparedUpload> {
    const storage = this.require();
    const headers = { 'Content-Type': file.contentType, 'If-None-Match': '*' };
    const url = await getSignedUrl(
      storage.client,
      new PutObjectCommand({
        Bucket: storage.bucket,
        Key: pendingKey(id),
        ContentType: file.contentType,
        ContentLength: file.size,
        IfNoneMatch: '*',
      }),
      {
        expiresIn: UPLOAD_SECONDS,
        signableHeaders: new Set(['content-type', 'content-length', 'if-none-match']),
      },
    );
    return { id, url, headers };
  }

  /** Checks the staged object against what was declared and copies it to its final key. */
  async publish(id: string, file: MediaFile): Promise<void> {
    const storage = this.require();
    const source = pendingKey(id);
    const object = await storage.client
      .send(new HeadObjectCommand({ Bucket: storage.bucket, Key: source }))
      .catch((error: unknown) => {
        if (error instanceof Error && error.name === 'NotFound') {
          throw AppException.validation([
            { path: 'file', message: 'Upload the file before completing the attachment.' },
          ]);
        }
        throw error;
      });
    if (
      object.ContentLength !== file.size ||
      object.ContentType !== file.contentType ||
      !object.ETag
    ) {
      throw AppException.validation([
        { path: 'file', message: 'The uploaded file does not match the attachment.' },
      ]);
    }

    await storage.client.send(
      new CopyObjectCommand({
        Bucket: storage.bucket,
        Key: completedKey(id),
        CopySource: `${storage.bucket}/${source}`,
        CopySourceIfMatch: object.ETag,
        MetadataDirective: 'REPLACE',
        ContentType: file.contentType,
        CacheControl: 'private, no-store',
      }),
    );
  }

  async readUrl(id: string): Promise<string> {
    const storage = this.require();
    const key = completedKey(id);
    if (storage.cdn) {
      const expires = Math.floor(Date.now() / 1000) + READ_SECONDS;
      const signature = createHmac('sha256', storage.cdn.secret)
        .update(`${key}:${expires}`)
        .digest('hex');
      const signed = new URL(`/${key}`, storage.cdn.origin);
      signed.search = new URLSearchParams({ expires: String(expires), signature }).toString();
      return signed.href;
    }
    return getSignedUrl(
      storage.client,
      new GetObjectCommand({ Bucket: storage.bucket, Key: key }),
      { expiresIn: READ_SECONDS },
    );
  }

  async readText(id: string): Promise<string> {
    const storage = this.require();
    const object = await storage.client.send(
      new GetObjectCommand({ Bucket: storage.bucket, Key: completedKey(id) }),
    );
    return (await object.Body?.transformToString('utf-8')) ?? '';
  }

  /** Deletes a published object; the row is the source of truth, so failures are ignored. */
  async remove(id: string): Promise<void> {
    const storage = this.require();
    await storage.client
      .send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: completedKey(id) }))
      .catch(() => undefined);
  }
}
