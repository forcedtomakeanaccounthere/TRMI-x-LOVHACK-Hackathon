import type { AuthUser } from "@linkroom/shared";

declare global {
  namespace Express {
    interface Request {
      // Set by requireAuth / optionalAuth.
      user?: AuthUser;
      accessToken?: string;
    }
  }
}

export {};
