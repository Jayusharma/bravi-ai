import { SetMetadata } from '@nestjs/common';

export const CHECK_ABILITY_KEY = 'check_ability';

export interface AbilityCheck {
  action: string;
  subject: string;
  field?: string;
}

// Decorator to check abilities on routes
export const CheckAbility = (abilityCheck: AbilityCheck) =>

  SetMetadata(CHECK_ABILITY_KEY, abilityCheck);

