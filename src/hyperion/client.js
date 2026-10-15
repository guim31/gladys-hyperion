// -----------------------------------------------------------------------------
// One connection to the JSON API of a Hyperion.ng server (TCP, port 19444 by
// default): one JSON object per line in both directions.
//
// Every request carries a `tan` (transaction number) that the server echoes in
// its reply: replies are matched by it. The server also pushes, unasked, the
// `*-update` messages of the subscriptions made by `serverinfo`; they are
// emitted as `update` events. A connection is bound to one instance of the
// server (`instance switchTo`), which is why the hub keeps one per instance.
//
// The protocol is the one of the Hyperion.ng JSON-RPC documentation and of
// dermotduffy/hyperion-py (MIT), which the Home Assistant integration uses.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import net from 'node:net';

export const DEFAULT_PORT = 19444;
export const DEFAULT_TIMEOUT_MS = 5000;
// The origin shown by Hyperion next to the colours and effects we set
// (4 to 20 characters).
export const ORIGIN = 'Gladys';
// A line longer than this is not a Hyperion reply: drop the connection rather
// than buffer without bound (a serverinfo is a few tens of kilobytes).
const MAX_LINE_BYTES = 4 * 1024 * 1024;

/** An error reply of the server, or a failure of the connection. */
export class HyperionError extends Error {
  /**
   * @param {string} message
   * @param {object} [details]
   * @param {string} [details.code] 'auth' (no authorization), 'timeout', 'closed', 'refused'
   * @param {object} [details.reply] the server reply, when there is one
   */
  constructor(message, { code = 'refused', reply } = {}) {
    super(message);
    this.name = 'HyperionError';
    this.code = code;
    this.reply = reply;
  }
}

/** Name of the reply to a request: `authorize` + `login` -> `authorize-login`. */
export const replyCommand = (request) =>
  request.subcommand ? `${request.command}-${request.subcommand}` : request.command;

const isAuthError = (reply) => /authori[sz]/i.test(String(reply?.error ?? ''));

export class HyperionConnection extends EventEmitter {
  /**
   * @param {object} options
   * @param {string} options.host
   * @param {number} [options.port]
   * @param {number} [options.timeoutMs] connection and default reply timeout
   * @param {Function} [options.connect] net.connect (test seam)
   */
  constructor({
    host,
    port = DEFAULT_PORT,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    connect = net.connect,
  }) {
    super();
    this.host = host;
    this.port = port;
    this.timeoutMs = timeoutMs;
    this.connectFn = connect;
    this.socket = null;
    this.buffer = '';
    this.nextTan = 1;
    /** tan -> { command, resolve, reject, timer } */
    this.pending = new Map();
    this.closed = false;
  }

  get connected() {
    return this.socket !== null && !this.closed;
  }

  /** Open the TCP connection. */
  open() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = this.connectFn({ host: this.host, port: this.port });
      const fail = (err) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          socket.destroy();
          reject(err);
        }
      };
      const timer = setTimeout(
        () => fail(new HyperionError('connection timed out', { code: 'timeout' })),
        this.timeoutMs,
      );
      socket.setEncoding('utf8');
      socket.once('connect', () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        this.socket = socket;
        socket.setKeepAlive(true, 30_000);
        socket.on('data', (chunk) => this.onData(chunk));
        socket.on('close', () => this.onClose());
        socket.on('error', () => {
          // 'close' follows: the pending requests are rejected there.
        });
        resolve(this);
      });
      socket.once('error', (err) =>
        fail(new HyperionError(err.code ?? err.message, { code: 'closed' })),
      );
    });
  }

  close() {
    if (this.socket) {
      this.socket.destroy();
    }
    this.onClose();
  }

  onClose() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    for (const [tan, entry] of this.pending) {
      clearTimeout(entry.timer);
      this.pending.delete(tan);
      entry.reject(new HyperionError('connection closed', { code: 'closed' }));
    }
    this.emit('close');
  }

  onData(chunk) {
    this.buffer += chunk;
    if (this.buffer.length > MAX_LINE_BYTES) {
      this.close();
      return;
    }
    let newline = this.buffer.indexOf('\n');
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) {
        this.onLine(line);
      }
      newline = this.buffer.indexOf('\n');
    }
  }

  onLine(line) {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return; // not JSON: ignored, like hyperion-py
    }
    if (!message || typeof message !== 'object' || typeof message.command !== 'string') {
      return;
    }
    const entry = this.findPending(message);
    if (entry) {
      this.pending.delete(entry.tan);
      clearTimeout(entry.timer);
      entry.resolve(message);
      return;
    }
    this.emit('update', message);
  }

  findPending(message) {
    if (Number.isInteger(message.tan) && this.pending.has(message.tan)) {
      return { tan: message.tan, ...this.pending.get(message.tan) };
    }
    // Older servers answer a malformed request with tan 0 (hyperion.ng#1001):
    // give the reply to the oldest request of the same command.
    if (!message.tan) {
      for (const [tan, entry] of this.pending) {
        if (entry.command === message.command) {
          return { tan, ...entry };
        }
      }
    }
    return null;
  }

  /**
   * Send a request and wait for its reply.
   * @param {object} request e.g. { command: 'serverinfo' }
   * @param {object} [options]
   * @param {number} [options.timeoutMs]
   * @returns {Promise<object>} the reply (success: true)
   * @throws {HyperionError} an error reply, a timeout, a closed connection
   */
  async request(request, { timeoutMs = this.timeoutMs } = {}) {
    if (!this.connected) {
      throw new HyperionError('not connected', { code: 'closed' });
    }
    const tan = this.nextTan;
    this.nextTan = this.nextTan >= 0x7fffffff ? 1 : this.nextTan + 1;
    const command = replyCommand(request);
    const reply = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(tan);
        reject(new HyperionError(`no reply to ${command}`, { code: 'timeout' }));
      }, timeoutMs);
      this.pending.set(tan, { command, resolve, reject, timer });
      this.socket.write(`${JSON.stringify({ ...request, tan })}\n`);
    });
    if (reply.success === false) {
      throw new HyperionError(`${command}: ${reply.error ?? 'refused'}`, {
        code: isAuthError(reply) ? 'auth' : 'refused',
        reply,
      });
    }
    return reply;
  }

  // --- The commands the integration uses -------------------------------------

  /** True when this connection must log in before anything else. */
  async tokenRequired() {
    const reply = await this.request({ command: 'authorize', subcommand: 'tokenRequired' });
    return reply.info?.required === true;
  }

  login(token) {
    return this.request({ command: 'authorize', subcommand: 'login', token });
  }

  /**
   * Ask for a new token: Hyperion shows the request in its web interface and
   * replies once the user accepted or denied it (or after its own timeout).
   * @returns {Promise<string>} the token
   */
  async requestToken({ id, comment, timeoutMs }) {
    const reply = await this.request(
      { command: 'authorize', subcommand: 'requestToken', comment, id },
      { timeoutMs },
    );
    const token = reply.info?.token;
    if (typeof token !== 'string' || token === '') {
      throw new HyperionError('no token in the reply', { code: 'refused' });
    }
    return token;
  }

  /** Withdraw a token request still waiting in the Hyperion interface. */
  cancelTokenRequest({ id, comment }) {
    if (this.connected) {
      this.socket.write(
        `${JSON.stringify({ command: 'authorize', subcommand: 'requestToken', comment, id, accept: false })}\n`,
      );
    }
  }

  async sysinfo() {
    const reply = await this.request({ command: 'sysinfo' });
    return reply.info ?? {};
  }

  switchTo(instance) {
    return this.request({ command: 'instance', subcommand: 'switchTo', instance });
  }

  startInstance(instance) {
    return this.request({ command: 'instance', subcommand: 'startInstance', instance });
  }

  /**
   * The full state of the instance of this connection, optionally subscribing
   * to its changes.
   * @param {string[]} [subscribe]
   */
  async serverinfo(subscribe) {
    const request = { command: 'serverinfo' };
    if (subscribe) {
      request.subscribe = subscribe;
    }
    const reply = await this.request(request);
    return reply.info ?? {};
  }

  setColor({ priority, rgb, durationMs }) {
    const request = { command: 'color', priority, color: rgb, origin: ORIGIN };
    if (durationMs > 0) {
      request.duration = durationMs;
    }
    return this.request(request);
  }

  setEffect({ priority, name, durationMs }) {
    const request = { command: 'effect', priority, effect: { name }, origin: ORIGIN };
    if (durationMs > 0) {
      request.duration = durationMs;
    }
    return this.request(request);
  }

  clear(priority) {
    return this.request({ command: 'clear', priority });
  }

  setComponent(component, state) {
    return this.request({ command: 'componentstate', componentstate: { component, state } });
  }

  setAdjustment(adjustment) {
    return this.request({ command: 'adjustment', adjustment });
  }
}
