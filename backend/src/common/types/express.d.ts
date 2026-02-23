import { UserRole } from '@prisma/client';
import { AppAbility } from 'src/modules/casl/casl.types';
declare global {
  namespace Express {
    interface User {
      userId: string;
      role: UserRole;
    }

    interface Request {
      user?: User;
      ability: AppAbility;
    }
  }
}
