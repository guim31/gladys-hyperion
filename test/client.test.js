// -----------------------------------------------------------------------------
// The JSON API client on a scripted socket: replies matched by tan, pushed
// updates, error replies, timeouts and closed connections.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { HyperionConnection, replyCommand } from '../src/hyperion/client.js';

/** A socket double: records what is written, lets the test answer. */
function scriptedSocket() {
  const socket = new EventEmitter();
  socket.written = [];
  socket.setEncoding = () => {};
  socket.setKeepAlive = () => {};
  socket.write = (data) => socket.written.push(JSON.parse(data));
  socket.destroy = () => socket.emit('close');
  socket.answer = (message) => socket.emit('data', `${JSON.stringify(message)}\n`);
  return socket;
}

async function connected({ timeoutMs = 200 } = {}) {
  const socket = scriptedSocket();
  const connection = new HyperionConnection({
    host: '192.0.2.10',
    timeoutMs,
    connect: () => {
      setImmediate(() => socket.emit('connect'));
      return socket;
    },
  });
  await connection.open();
  return { socket, connection };
}

test('the reply name of a request', () => {
  assert.equal(replyCommand({ command: 'serverinfo' }), 'serverinfo');
  assert.equal(replyCommand({ command: 'authorize', subcommand: 'login' }), 'authorize-login');
});

test('replies are matched by tan, whatever their order', async () => {
  const { socket, connection } = await connected();
  const first = connection.sysinfo();
  const second = connection.serverinfo(['priorities-update']);
  assert.deepEqual(
    socket.written.map(({ command, tan }) => [command, tan]),
    [
      ['sysinfo', 1],
      ['serverinfo', 2],
    ],
  );
  assert.deepEqual(socket.written[1].subscribe, ['priorities-update']);
  socket.answer({ command: 'serverinfo', success: true, tan: 2, info: { hostname: 'b' } });
  socket.answer({ command: 'sysinfo', success: true, tan: 1, info: { hyperion: { id: 'a' } } });
  assert.deepEqual(await first, { hyperion: { id: 'a' } });
  assert.deepEqual(await second, { hostname: 'b' });
});

test('an older server answering with tan 0 still reaches the request', async () => {
  const { socket, connection } = await connected();
  const reply = connection.setComponent('V4L', false);
  socket.answer({ command: 'componentstate', success: true, tan: 0 });
  assert.equal((await reply).success, true);
});

test('pushed updates and split lines are emitted as updates', async () => {
  const { socket, connection } = await connected();
  const updates = [];
  connection.on('update', (message) => updates.push(message.command));
  const line = JSON.stringify({ command: 'components-update', data: { name: 'ALL' } });
  socket.emit('data', line.slice(0, 10));
  socket.emit('data', `${line.slice(10)}\nnot json\n{"no":"command"}\n`);
  socket.answer({ command: 'priorities-update', data: {}, tan: 0 });
  assert.deepEqual(updates, ['components-update', 'priorities-update']);
});

test('an error reply is an error, an authorization refusal is told apart', async () => {
  const { socket, connection } = await connected();
  const login = connection.login('secret');
  socket.answer({ command: 'authorize-login', success: false, error: 'No Authorization', tan: 1 });
  await assert.rejects(login, { code: 'auth' });
  const effect = connection.setEffect({ priority: 128, name: 'Nope' });
  assert.deepEqual(socket.written[1], {
    command: 'effect',
    priority: 128,
    effect: { name: 'Nope' },
    origin: 'Gladys',
    tan: 2,
  });
  socket.answer({ command: 'effect', success: false, error: 'Effect not found', tan: 2 });
  await assert.rejects(effect, { code: 'refused', message: 'effect: Effect not found' });
});

test('a silent server times out, a closed one rejects what is pending', async () => {
  const { socket, connection } = await connected();
  await assert.rejects(connection.request({ command: 'sysinfo' }, { timeoutMs: 20 }), {
    code: 'timeout',
  });
  const pending = connection.serverinfo();
  socket.destroy();
  await assert.rejects(pending, { code: 'closed' });
  assert.equal(connection.connected, false);
  await assert.rejects(connection.sysinfo(), { code: 'closed' });
});

test('a server that does not accept the connection', async () => {
  const connection = new HyperionConnection({
    host: '192.0.2.10',
    timeoutMs: 20,
    connect: () => scriptedSocket(),
  });
  await assert.rejects(connection.open(), { code: 'timeout' });
  const refused = new HyperionConnection({
    host: '192.0.2.10',
    connect: () => {
      const socket = scriptedSocket();
      setImmediate(() =>
        socket.emit('error', Object.assign(new Error('x'), { code: 'ECONNREFUSED' })),
      );
      return socket;
    },
  });
  await assert.rejects(refused.open(), { code: 'closed', message: 'ECONNREFUSED' });
});

test('a token request waits for the user, and can be withdrawn', async () => {
  const { socket, connection } = await connected();
  const request = connection.requestToken({
    id: 'Ab3dE',
    comment: 'Gladys Assistant',
    timeoutMs: 1000,
  });
  assert.deepEqual(socket.written[0], {
    command: 'authorize',
    subcommand: 'requestToken',
    comment: 'Gladys Assistant',
    id: 'Ab3dE',
    tan: 1,
  });
  socket.answer({ command: 'authorize-requestToken', success: true, tan: 1, info: { token: 't' } });
  assert.equal(await request, 't');
  connection.cancelTokenRequest({ id: 'Ab3dE', comment: 'Gladys Assistant' });
  assert.equal(socket.written[1].accept, false);
});
