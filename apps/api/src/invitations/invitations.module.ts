import { Module } from '@nestjs/common';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { InvitationsController } from './invitations.controller';
import { InvitationsService } from './invitations.service';

@Module({
  imports: [WorkspacesModule, RateLimitModule],
  controllers: [InvitationsController],
  providers: [InvitationsService],
})
export class InvitationsModule {}
