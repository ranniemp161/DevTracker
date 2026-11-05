import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { createDatabase, type Database } from '@devtrack/database';
import { APP_CONFIG, type AppConfig } from '../config/app-config';

/** Drizzle client. Inject with `@Inject(DATABASE) db: Database`. */
export const DATABASE = Symbol('DATABASE');

/** Owns the client and its lifecycle. Tests override this token with an in-memory database. */
export const DATABASE_CONNECTION = Symbol('DATABASE_CONNECTION');
export interface DatabaseConnection {
  db: Database;
  close: () => Promise<void>;
}

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_CONNECTION,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): DatabaseConnection => {
        const { db, pool } = createDatabase(config.databaseUrl);
        return { db, close: () => pool.end() };
      },
    },
    {
      provide: DATABASE,
      inject: [DATABASE_CONNECTION],
      useFactory: (c: DatabaseConnection) => c.db,
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection) {}

  async onApplicationShutdown(): Promise<void> {
    await this.connection.close();
  }
}
