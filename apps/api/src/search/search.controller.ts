import { Controller, Get, Param, Query } from '@nestjs/common';
import type { WorkspaceSearchResponse } from '@devtrack/types';
import { workspaceSearchQuerySchema, type WorkspaceSearchQuery } from '@devtrack/validators';
import { CurrentUser } from '../common/decorators/auth.decorators';
import { UuidParamPipe } from '../common/pipes/uuid-param.pipe';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { User } from '../users/users.service';
import { SearchService } from './search.service';

/** Decision record 0017 — workspace search. */
@Controller()
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get('workspaces/:id/search')
  search(
    @CurrentUser() user: User,
    @Param('id', UuidParamPipe) workspaceId: string,
    @Query(new ZodValidationPipe(workspaceSearchQuerySchema)) query: WorkspaceSearchQuery,
  ): Promise<WorkspaceSearchResponse> {
    return this.searchService.search(user.id, workspaceId, query.q);
  }
}
