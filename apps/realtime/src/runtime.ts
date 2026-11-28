import { createDatabase } from '@devtrack/database';
import { loadConfig } from './config.js';
import { createRealtimeServer } from './server.js';

/** CPU this process has used so far, in milliseconds. */
const cpuMs = () => {
  const { user, system } = process.cpuUsage();
  return Math.round((user + system) / 1000);
};

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

/** One JSON line on stdout (info level in the Vercel logs; `no-console` allows only warn/error). */
const logInfo = (fields: Record<string, unknown>) =>
  process.stdout.write(`${JSON.stringify(fields)}\n`);

// Instance-level cost signals for the Vercel logs (no user data): how much CPU a new instance
// spends before it can accept sockets, and whether later connections reuse a warm instance.

logInfo({ msg: 'realtime.instance_ready', cpuMs: cpuMs() });
let connections = 0;
realtime.io.on('connection', () => {
  connections++;
  logInfo({
    msg: 'realtime.connection',
    instanceConnections: connections,
    instanceUptimeS: Math.round(process.uptime()),
    instanceCpuMs: cpuMs(),
  });
});

export default realtime.server;
