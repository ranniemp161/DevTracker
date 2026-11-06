import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { asc, eq, labels, type Database } from '@devtrack/database';
import { ErrorCode, type Label } from '@devtrack/types';
import type { CreateLabelInput, UpdateLabelInput } from '@devtrack/validators';
import { AppException } from '../common/errors/app.exception';
import { isUuid } from '../common/pipes/uuid-param.pipe';
import { DATABASE } from '../database/database.module';
import { isUniqueViolation } from '../database/pg-errors';
import { WorkspaceAccessService } from '../workspaces/workspace-access.service';

type LabelRow = typeof labels.$inferSelect;

const toLabel = (l: LabelRow): Label => ({
  id: l.id,
  workspaceId: l.workspaceId,
  name: l.name,
  color: l.color,
});

const nameTaken = () =>
  new AppException(
    HttpStatus.CONFLICT,
    ErrorCode.LABEL_NAME_TAKEN,
    'A label with this name already exists.',
  );

/**
 * Workspace labels (M3 addition): any member can list and create; Admins/Owner can rename,
 * recolor and delete. Deleting a label detaches it from every task.
 */
@Injectable()
export class LabelsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly access: WorkspaceAccessService,
  ) {}

  async list(userId: string, workspaceId: string): Promise<Label[]> {
    await this.access.require(userId, workspaceId);
    const rows = await this.db
      .select()
      .from(labels)
      .where(eq(labels.workspaceId, workspaceId))
      .orderBy(asc(labels.name));
    return rows.map(toLabel);
  }

  async create(userId: string, workspaceId: string, input: CreateLabelInput): Promise<Label> {
    await this.access.require(userId, workspaceId);
    try {
      const [row] = await this.db
        .insert(labels)
        .values({ workspaceId, ...input })
        .returning();
      return toLabel(row!);
    } catch (err) {
      if (isUniqueViolation(err, 'labels_workspace_name_unique')) throw nameTaken();
      throw err;
    }
  }

  async update(userId: string, labelId: string, input: UpdateLabelInput): Promise<Label> {
    const label = await this.requireLabel(userId, labelId);
    try {
      const [row] = await this.db
        .update(labels)
        .set(input)
        .where(eq(labels.id, label.id))
        .returning();
      return toLabel(row!);
    } catch (err) {
      if (isUniqueViolation(err, 'labels_workspace_name_unique')) throw nameTaken();
      throw err;
    }
  }

  async remove(userId: string, labelId: string): Promise<void> {
    const label = await this.requireLabel(userId, labelId);
    await this.db.delete(labels).where(eq(labels.id, label.id));
  }

  /** Admin/Owner of the label's workspace; everyone else gets 404. */
  private async requireLabel(userId: string, labelId: string): Promise<LabelRow> {
    const [label] = isUuid(labelId)
      ? await this.db.select().from(labels).where(eq(labels.id, labelId)).limit(1)
      : [];
    if (!label) throw AppException.notFound('Label not found.');
    try {
      await this.access.require(userId, label.workspaceId, 'ADMIN');
    } catch (err) {
      if (err instanceof AppException && err.getStatus() === HttpStatus.NOT_FOUND) {
        throw AppException.notFound('Label not found.');
      }
      throw err;
    }
    return label;
  }
}
