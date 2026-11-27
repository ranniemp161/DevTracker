import { Module } from '@nestjs/common';
import { ClientUpdatesService } from './client-updates.service';

/** Decision record 0028: emails to clients. No dependencies on tasks or requests. */
@Module({
  providers: [ClientUpdatesService],
  exports: [ClientUpdatesService],
})
export class ClientUpdatesModule {}
