import { Controller, Get, Inject } from '@nestjs/common';
import { type Database, sql } from '@devtrack/database';
import { Public } from '../common/decorators/auth.decorators';
import { DATABASE } from '../database/database.module';

@Controller('health')
export class HealthController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Public()
  @Get()
  async check(): Promise<{ status: 'ok' }> {
    await this.db.execute(sql`select 1`);
    return { status: 'ok' };
  }
}
