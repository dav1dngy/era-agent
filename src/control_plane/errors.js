export class HttpError extends Error {
  constructor(status, message, detail = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.detail = detail;
  }
}

export const bad = (message, detail) => new HttpError(400, message, detail);
export const denied = (message) => new HttpError(403, message);
export const missing = (message) => new HttpError(404, message);
export const conflict = (message) => new HttpError(409, message);
