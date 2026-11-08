import type { AuthUser } from './auth.guard';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      user?: AuthUser;
    }
  }
}

export {};
