import { UserRole } from '@prisma/client';

declare global {
  namespace Express {
    interface User {
      userId: string;
      role: UserRole;
    }

    interface Request {
      user?: User;
    }
  }
}
