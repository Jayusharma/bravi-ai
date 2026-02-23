import { Injectable } from '@nestjs/common';
import { AbilityBuilder } from '@casl/ability';
import { createPrismaAbility } from '@casl/prisma';
import { PrismaService } from '../../database/prisma.service';
import { AppAbility, Actions, AppSubjects } from './casl.types';
import { AuthUser } from 'src/common/types/auth-user.interface';


@Injectable()
export class CaslAbilityFactory {
  constructor(private prisma: PrismaService) {}

  async createForUser(user: AuthUser): Promise<AppAbility> {
    const { can, cannot, build } = new AbilityBuilder<AppAbility>(
      createPrismaAbility as any,
    );


  
    // Load role permissions from DB
    const rolePermissions = await this.prisma.rolePermission.findMany({
      where: { role: user.role },
      include: { permission: true },
    });

    for (const rp of rolePermissions) {
      const action = rp.permission.action as Actions;
      const subject = this.mapSubject(rp.permission.subject) as AppSubjects;

      console.log(action ,"and", subject)
     
      let conditions = rp.conditions as any;

      if (conditions) {
        conditions = this.resolvePlaceholders(conditions, user);
      }

      if (action === 'manage' && subject === 'all') {
        can('manage', 'all');
        // console.log("done manage all")
      } else {
        can(action, subject, conditions || undefined);
      // console.log("manage conditionally ")
      }
    }
  
    return build();
  }

  private mapSubject(subject: string): string {
    const mapping: Record<string, string> = {
      enquiry: 'Enquiry',
      message: 'Message',
      user: 'User',
      permission: 'Permission',
      dashboard: 'Dashboard',
      all: 'all',
    };

    return mapping[subject] || subject;
  }

  private resolvePlaceholders(conditions: any, user: AuthUser) {
    const resolved = { ...conditions };

    for (const key of Object.keys(resolved)) {
      if (resolved[key] === '$userId') {
        resolved[key] = user.userId;
      }
    }

    return resolved;
  }
}
