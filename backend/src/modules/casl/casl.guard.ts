import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CaslAbilityFactory } from './casl-ability.factory';
import { CHECK_ABILITY_KEY } from './decorators/check-ability.decorator';


@Injectable()
export class CaslGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private caslAbilityFactory: CaslAbilityFactory,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Get the ability check from decorator
    const abilityCheck = this.reflector.get(
      CHECK_ABILITY_KEY,
      context.getHandler(),
    );

    // console.log('casl guard has activated ')
    if (!abilityCheck) {
      // No check defined, allow access
      
      return true;
    }

    // Get user from request (set by AuthGuard)
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    // Create abilities for this user
    const ability = await this.caslAbilityFactory.createForUser(user);
   
    
    // Check if user can perform the action
    const { action, subject, field } = abilityCheck;
    
    
    if (!ability.can(action, subject, field)) {
      throw new ForbiddenException(
        `You don't have permission to ${action} ${subject}`,
      );
    }

    // Store ability in request for later use
    request.ability = ability;
    return true;
  }
}