import { AbilityClass, PureAbility } from '@casl/ability';
import { PrismaQuery } from '@casl/prisma';

export type Actions =
  | 'create'
  | 'read'
  | 'update'
  | 'delete'
  | 'assign'
  | 'merge'
  | 'manage';

export type AppSubjects =
  | 'Enquiry'
  | 'Message'
  | 'User'
  | 'Permission'
  | 'Contact'
  | 'Dashboard'
  | 'InboundMessage'
  | 'QualificationRule'
  | 'InternalNote'
  | 'QualificationResult'
  | 'all';

export type AppAbility = PureAbility<[Actions, AppSubjects], PrismaQuery>;

export const AppAbility = PureAbility as AbilityClass<AppAbility>;
