import { WorkerEntrypoint } from 'cloudflare:workers';
import worker, { readMedia } from './worker.mjs';

export default worker;

// This entrypoint is called internally after the public handler validates the signature.
export class CachedMedia extends WorkerEntrypoint {
  fetch(request) {
    return readMedia(new URL(request.url).pathname, this.env.TASK_MEDIA);
  }
}
