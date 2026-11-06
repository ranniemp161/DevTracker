import { Global, Module } from '@nestjs/common';
import { EventRecorder } from './event-recorder.service';

/** Global: every business module records activity/notifications/outbox events through it. */
@Global()
@Module({
  providers: [EventRecorder],
  exports: [EventRecorder],
})
export class EventsModule {}
