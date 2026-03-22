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
  | 'enquiry'
  | 'message'
  | 'user'
  | 'permission'
  | 'contact'
  | 'dashboard'
  | 'inboundmessage'
  | 'qualificationrule'
  | 'internalnote'
  | 'qualificationresult'
  | 'rolepermission'
  | 'all';

export type AppAbility = PureAbility<[Actions, AppSubjects], PrismaQuery>;

export const AppAbility = PureAbility as AbilityClass<AppAbility>;
