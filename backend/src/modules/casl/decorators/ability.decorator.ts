import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AppAbility } from '../casl.types';

// Decorator to inject ability into controller method
export const Ability = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): AppAbility => {
    const request = ctx.switchToHttp().getRequest();
    return request.ability;
  },
);