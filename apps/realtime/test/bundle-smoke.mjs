import assert from 'node:assert/strict';
import { io } from 'socket.io-client';

// Synthetic settings only. This smoke test must never read the root .env.
Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: 'postgres://unused:unused@127.0.0.1:1/unused',
  REALTIME_SECRET: 'bundle-test-secret-at-least-32-characters',
  WEB_ORIGIN: 'https://example.test',
});
delete process.env.REDIS_URL;
const { default: server } = await import('../api/v1/realtime/socket.mjs');
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const socket = io(`http://127.0.0.1:${server.address().port}`, {
  path: '/api/v1/realtime/socket',
  transports: ['websocket'],
  auth: { token: 'fake' },
  reconnection: false,
  autoConnect: false,
});
const timeout = setTimeout(() => {
  console.error('Bundle handshake timed out');
  process.exit(1);
}, 10_000);
try {
  let connected = false;
  socket.once('connect', () => {
    connected = true;
  });
  const error = await new Promise((resolve, reject) => {
    socket.once('realtime.error', resolve);
    socket.once('connect_error', reject);
    socket.connect();
  });
  assert.equal(connected, true);
  assert.deepEqual(error, { code: 'UNAUTHENTICATED' });
} finally {
  clearTimeout(timeout);
  socket.disconnect();
  await new Promise((resolve) => server.close(resolve));
}
