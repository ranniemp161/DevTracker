import { Module } from '@nestjs/common';
import { WorkspacesModule } from '../workspaces/workspaces.module';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';

@Module({
  imports: [WorkspacesModule],
  controllers: [MembersController],
  providers: [MembersService],
})
export class MembersModule {}
