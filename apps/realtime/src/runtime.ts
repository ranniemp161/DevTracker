import { createDatabase } from '@devtrack/database';
import { loadConfig } from './config.js';
import { createRealtimeServer } from './server.js';

// No dotenv: production values come from the project, tests inject an in-memory database.
const config = loadConfig(process.env);
const { db, pool } = createDatabase(config.DATABASE_URL, {
  onIdleConnectionError: () => console.error('Realtime database idle connection failed'),
});
const realtime = await createRealtimeServer({
  db,
  secret: config.REALTIME_SECRET,
  webOrigin: config.WEB_ORIGIN,
  redisUrl: config.REDIS_URL,
}).catch(async () => {
  await pool.end();
  throw new Error('Realtime server initialization failed');
});

export default realtime.server;
