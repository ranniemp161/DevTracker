import { createHmac, randomUUID } from 'node:crypto';
import {
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  and,
  desc,
  eq,
  isNotNull,
  isNull,
  taskAttachments,
  type Database,
} from '@devtrack/database';
import { ErrorCode, type TaskAttachment } from '@devtrack/types';
import type { CreateTaskAttachmentInput } from '@devtrack/validators';
import { AppException } from '../common/errors/app.exception';
import { DATABASE } from '../database/database.module';
import { RateLimitService } from '../rate-limit/rate-limit.service';
import { r2StorageConfig } from '../storage/r2';
import { TaskAccessService } from './task-access.service';

const UPLOAD_SECONDS = 300;
const READ_SECONDS = 900;
const completedKey = (id: string) => `task-media/${id}`;
const pendingKey = (id: string) => `pending-task-media/${id}`;

@Injectable()
export class TaskAttachmentsService {
  private readonly storage = r2StorageConfig();

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly taskAccess: TaskAccessService,
    private readonly rateLimit: RateLimitService,
  ) {}

  async list(userId: string, taskId: string) {
    const { access } = await this.taskAccess.require(userId, taskId);
    const storage = this.storage;
    if (!storage) return { attachments: [], uploadsEnabled: false };

    const rows = await this.db
      .select()
      .from(taskAttachments)
      .where(and(eq(taskAttachments.taskId, taskId), isNotNull(taskAttachments.completedAt)))
      .orderBy(desc(taskAttachments.completedAt));

    const attachments = await Promise.all(
      rows.map(async ({ id, name, contentType, size }): Promise<TaskAttachment> => {
        const key = completedKey(id);
        let url: string;
        if (storage.cdn) {
          const expires = Math.floor(Date.now() / 1000) + READ_SECONDS;
          const signature = createHmac('sha256', storage.cdn.secret)
            .update(`${key}:${expires}`)
            .digest('hex');
          const signed = new URL(`/${key}`, storage.cdn.origin);
          signed.search = new URLSearchParams({ expires: String(expires), signature }).toString();
          url = signed.href;
        } else {
          url = await getSignedUrl(
            storage.client,
            new GetObjectCommand({ Bucket: storage.bucket, Key: key }),
            { expiresIn: READ_SECONDS },
          );
        }
        return { id, name, contentType, size, url };
      }),
    );
    return {
      attachments,
      uploadsEnabled: access.project.status !== 'ARCHIVED',
    };
  }

  async prepare(userId: string, taskId: string, input: CreateTaskAttachmentInput) {
    await this.taskAccess.require(userId, taskId, { write: true });
    const storage = this.requireStorage();
    await this.rateLimit.consume(
      { name: 'task-media:user', limit: 30, windowSeconds: 3600 },
      userId,
    );

    const id = randomUUID();
    const headers = { 'Content-Type': input.contentType, 'If-None-Match': '*' };
    const url = await getSignedUrl(
      storage.client,
      new PutObjectCommand({
        Bucket: storage.bucket,
        Key: pendingKey(id),
        ContentType: input.contentType,
        ContentLength: input.size,
        IfNoneMatch: '*',
      }),
      {
        expiresIn: UPLOAD_SECONDS,
        signableHeaders: new Set(['content-type', 'content-length', 'if-none-match']),
      },
    );

    await this.db.insert(taskAttachments).values({ id, taskId, uploaderId: userId, ...input });
    return { id, url, headers };
  }

  async complete(userId: string, taskId: string, id: string) {
    await this.taskAccess.require(userId, taskId, { write: true });
    const storage = this.requireStorage();
    const attachment = and(
      eq(taskAttachments.id, id),
      eq(taskAttachments.taskId, taskId),
      eq(taskAttachments.uploaderId, userId),
    );
    const [row] = await this.db.select().from(taskAttachments).where(attachment);
    if (!row) throw AppException.notFound('Attachment not found.');
    if (row.completedAt) return { id };

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
      object.ContentLength !== row.size ||
      object.ContentType !== row.contentType ||
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
        ContentType: row.contentType,
        CacheControl: 'private, no-store',
      }),
    );
    await this.db
      .update(taskAttachments)
      .set({ completedAt: new Date() })
      .where(and(attachment, isNull(taskAttachments.completedAt)));
    return { id };
  }

  private requireStorage() {
    if (!this.storage)
      throw new AppException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.SERVICE_UNAVAILABLE,
        'Media uploads are unavailable.',
      );
    return this.storage;
  }
}
