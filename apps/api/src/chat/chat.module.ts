import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { RateLimitModule } from '../rate-limit/rate-limit.module';
import { ChatController } from './chat.controller';
import { ChatPushController } from './chat-push.controller';
import { ChatPushService } from './chat-push.service';
import { ChatService } from './chat.service';

@Module({
  imports: [ProjectsModule, RateLimitModule],
  controllers: [ChatController, ChatPushController],
  providers: [ChatService, ChatPushService],
  exports: [ChatService, ChatPushService],
})
export class ChatModule {}
