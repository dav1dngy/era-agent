import { EventEmitter } from 'node:events';

export function createClient(url) {
  const emitter = new EventEmitter();
  emitter.url = url;
  emitter.on('error', () => {});
  return emitter;
}

export const RETRY_LIMIT = 3;
