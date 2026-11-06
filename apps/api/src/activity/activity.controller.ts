import { Controller, Get, Param, Query } from '@nestjs/common';
import type { ActivityEntry } from '@devtrack/types';
import { listActivityQuerySchema, type ListActivityQuery } from '@devtrack/validators';
import { CurrentUser } from '../common/decorators/auth.decorators';
import type { Paginated } from '../common/http/paginated';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { User } from '../users/users.service';
import { ActivityService } from './activity.service';

/** Architecture §9 — `GET /projects/:id/activity` (optional `taskId` filter, M4 rule 4). */
@Controller()
export class ActivityController {
  constructor(private readonly activity: ActivityService) {}

  @Get('projects/:id/activity')
  list(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) projectId: string,
    @Query(new ZodValidationPipe(listActivityQuerySchema)) query: ListActivityQuery,
  ): Promise<Paginated<ActivityEntry>> {
    return this.activity.list(user.id, projectId, query);
  }
}
