# ⏰ Part 7: Automation & SLA — Auto-Assignment, Follow-Ups, Stale Detection

> Makes the system proactive instead of reactive. Enquiries get auto-assigned, SLAs are tracked, stale enquiries are detected, and follow-ups are sent automatically.

---

## What This Module Does

| Feature | How It Works |
|---------|-------------|
| **Auto-assignment** | New enquiry → round-robin assign to available staff |
| **SLA tracking** | First-response time monitored, breach alerts if missed |
| **Stale detection** | Cron job checks for enquiries with no activity for X days |
| **Follow-up scheduler** | After replying, auto-schedule a follow-up reminder |
| **Auto-close** | STALE for 14 days → CLOSED_LOST automatically |

---

## File Structure

```
src/modules/automation/
├── automation.module.ts
├── services/
│   ├── auto-assignment.service.ts
│   ├── sla.service.ts
│   ├── stale-detector.service.ts
│   └── followup-scheduler.service.ts
└── listeners/
    └── automation.listeners.ts
```

---

## `src/modules/automation/services/auto-assignment.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { ConfigService } from '@nestjs/config';
import { UserRole, EnquiryStatus } from '@prisma/client';

/**
 * Auto-assigns new enquiries to staff using round-robin.
 *
 * HOW ROUND-ROBIN WORKS:
 *   1. Get all active SALES users
 *   2. Get their current open enquiry counts
 *   3. Assign to the user with the FEWEST open enquiries
 *   4. This naturally load-balances across the team
 *
 * WHY NOT TRUE ROUND-ROBIN (last-assigned tracking)?
 *   Because "fewest open" is better. If User A has 20 open enquiries
 *   and User B has 3, User B should get the next one — even if it's
 *   "User A's turn" in strict round-robin.
 */
@Injectable()
export class AutoAssignmentService {
  private readonly logger = new Logger(AutoAssignmentService.name);
  private readonly enabled: boolean;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    this.enabled = this.config.get('AUTO_ASSIGN_ENABLED', 'true') === 'true';
  }

  /**
   * Assign an enquiry to the least-loaded staff member.
   * Returns the userId of the assigned staff, or null if no one is available.
   */
  async assign(enquiryId: string): Promise<string | null> {
    if (!this.enabled) {
      this.logger.debug('Auto-assignment disabled');
      return null;
    }

    // Get all active sales/manager users
    const activeStaff = await this.prisma.user.findMany({
      where: {
        isActive: true,
        role: { in: [UserRole.SALES, UserRole.MANAGER] },
      },
      select: {
        id: true,
        displayName: true,
        _count: {
          select: {
            assignedEnquiries: {
              where: {
                status: {
                  notIn: [EnquiryStatus.CONVERTED, EnquiryStatus.CLOSED_LOST],
                },
              },
            },
          },
        },
      },
      orderBy: {
        // Prisma doesn't support orderBy on _count directly,
        // so we'll sort in JS
      },
    });

    if (activeStaff.length === 0) {
      this.logger.warn('No active staff available for auto-assignment');
      return null;
    }

    // Sort by fewest open enquiries (load-balanced round-robin)
    activeStaff.sort(
      (a, b) => a._count.assignedEnquiries - b._count.assignedEnquiries,
    );

    const assignTo = activeStaff[0];

    // Assign the enquiry
    await this.prisma.enquiry.update({
      where: { id: enquiryId },
      data: {
        assignedToId: assignTo.id,
        status: EnquiryStatus.OPEN,
        timeline: {
          create: {
            type: 'AUTO_ASSIGNED',
            createdBy: 'SYSTEM',
            metadata: {
              assignedTo: assignTo.id,
              assignedToName: assignTo.displayName,
              reason: `Load-balanced: ${assignTo._count.assignedEnquiries} open enquiries`,
            },
          },
        },
      },
    });

    this.logger.log(
      `🎯 Auto-assigned enquiry ${enquiryId} → ${assignTo.displayName} (${assignTo._count.assignedEnquiries} open)`,
    );

    return assignTo.id;
  }
}
```

---

## `src/modules/automation/services/sla.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EnquiryStatus } from '@prisma/client';

/**
 * Checks for SLA breaches every 5 minutes.
 *
 * SLA RULES:
 *   1. First Response Time: If slaFirstResponseDue has passed and
 *      firstResponseAt is still null → BREACH
 *   2. Resolution Time: If slaResolutionDue has passed and
 *      status is not CONVERTED/CLOSED_LOST → BREACH
 */
@Injectable()
export class SlaService {
  private readonly logger = new Logger(SlaService.name);

  constructor(private prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_5_MINUTES)
  async checkSlaBreaches(): Promise<void> {
    const now = new Date();

    // ── First Response SLA Breach ──
    // Enquiries where:
    //   - slaFirstResponseDue has passed (it's in the past)
    //   - firstResponseAt is null (no staff has replied yet)
    //   - slaBreachedAt is null (not already marked as breached)
    //   - Status is not closed
    const firstResponseBreaches = await this.prisma.enquiry.findMany({
      where: {
        slaFirstResponseDue: { lte: now },
        firstResponseAt: null,
        slaBreachedAt: null,
        status: {
          notIn: [EnquiryStatus.CONVERTED, EnquiryStatus.CLOSED_LOST],
        },
      },
      select: { id: true, assignedToId: true },
    });

    if (firstResponseBreaches.length > 0) {
      this.logger.warn(
        `🚨 ${firstResponseBreaches.length} enquiries breached first-response SLA`,
      );

      for (const enquiry of firstResponseBreaches) {
        await this.prisma.$transaction([
          this.prisma.enquiry.update({
            where: { id: enquiry.id },
            data: { slaBreachedAt: now },
          }),
          this.prisma.enquiryTimeline.create({
            data: {
              enquiryId: enquiry.id,
              type: 'SLA_BREACHED',
              createdBy: 'SYSTEM',
              metadata: {
                type: 'FIRST_RESPONSE',
                breachedAt: now.toISOString(),
                assignedTo: enquiry.assignedToId,
              },
            },
          }),
        ]);
      }
    }

    // ── Resolution SLA Breach ──
    const resolutionBreaches = await this.prisma.enquiry.findMany({
      where: {
        slaResolutionDue: { lte: now },
        slaBreachedAt: null,
        status: {
          notIn: [EnquiryStatus.CONVERTED, EnquiryStatus.CLOSED_LOST],
        },
      },
      select: { id: true, assignedToId: true },
    });

    if (resolutionBreaches.length > 0) {
      this.logger.warn(
        `🚨 ${resolutionBreaches.length} enquiries breached resolution SLA`,
      );

      for (const enquiry of resolutionBreaches) {
        await this.prisma.$transaction([
          this.prisma.enquiry.update({
            where: { id: enquiry.id },
            data: { slaBreachedAt: now },
          }),
          this.prisma.enquiryTimeline.create({
            data: {
              enquiryId: enquiry.id,
              type: 'SLA_BREACHED',
              createdBy: 'SYSTEM',
              metadata: {
                type: 'RESOLUTION',
                breachedAt: now.toISOString(),
                assignedTo: enquiry.assignedToId,
              },
            },
          }),
        ]);
      }
    }
  }
}
```

---

## `src/modules/automation/services/stale-detector.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { EnquiryStatus } from '@prisma/client';

/**
 * Detects stale enquiries and auto-closes them.
 *
 * RULES:
 *   1. If lastActivityAt is older than SLA_STALE_DAYS (default: 7 days)
 *      AND status is an "active" status → move to STALE
 *   2. If lastActivityAt is older than SLA_AUTO_CLOSE_DAYS (default: 14 days)
 *      AND status is STALE → move to CLOSED_LOST
 *
 * Runs every hour. Not every minute — stale detection isn't urgent.
 */
@Injectable()
export class StaleDetectorService {
  private readonly logger = new Logger(StaleDetectorService.name);
  private readonly staleDays: number;
  private readonly autoCloseDays: number;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    this.staleDays = this.config.get<number>('SLA_STALE_DAYS', 7);
    this.autoCloseDays = this.config.get<number>('SLA_AUTO_CLOSE_DAYS', 14);
  }

  @Cron(CronExpression.EVERY_HOUR)
  async detectStale(): Promise<void> {
    const now = new Date();
    const staleThreshold = new Date(
      now.getTime() - this.staleDays * 24 * 60 * 60 * 1000,
    );
    const autoCloseThreshold = new Date(
      now.getTime() - this.autoCloseDays * 24 * 60 * 60 * 1000,
    );

    // Active statuses that CAN become stale
    const activeStatuses: EnquiryStatus[] = [
      EnquiryStatus.OPEN,
      EnquiryStatus.IN_PROGRESS,
      EnquiryStatus.AWAITING_CUSTOMER,
      EnquiryStatus.QUOTATION_SENT,
      EnquiryStatus.FOLLOW_UP,
    ];

    // ── Step 1: Mark stale enquiries ──
    const staleEnquiries = await this.prisma.enquiry.findMany({
      where: {
        status: { in: activeStatuses },
        lastActivityAt: { lte: staleThreshold },
      },
      select: { id: true, status: true },
    });

    if (staleEnquiries.length > 0) {
      this.logger.log(`🕸️ ${staleEnquiries.length} enquiries going stale`);

      for (const enquiry of staleEnquiries) {
        await this.prisma.$transaction([
          this.prisma.enquiry.update({
            where: { id: enquiry.id },
            data: { status: EnquiryStatus.STALE },
          }),
          this.prisma.enquiryTimeline.create({
            data: {
              enquiryId: enquiry.id,
              type: 'STALE_DETECTED',
              fromStatus: enquiry.status,
              toStatus: EnquiryStatus.STALE,
              createdBy: 'SYSTEM',
              metadata: {
                reason: `No activity for ${this.staleDays} days`,
              },
            },
          }),
        ]);
      }
    }

    // ── Step 2: Auto-close stale enquiries ──
    const autoCloseEnquiries = await this.prisma.enquiry.findMany({
      where: {
        status: EnquiryStatus.STALE,
        lastActivityAt: { lte: autoCloseThreshold },
      },
      select: { id: true },
    });

    if (autoCloseEnquiries.length > 0) {
      this.logger.log(`🔒 Auto-closing ${autoCloseEnquiries.length} stale enquiries`);

      for (const enquiry of autoCloseEnquiries) {
        await this.prisma.$transaction([
          this.prisma.enquiry.update({
            where: { id: enquiry.id },
            data: {
              status: EnquiryStatus.CLOSED_LOST,
              lostReason: `Auto-closed: no activity for ${this.autoCloseDays} days`,
            },
          }),
          this.prisma.enquiryTimeline.create({
            data: {
              enquiryId: enquiry.id,
              type: 'CLOSED',
              fromStatus: EnquiryStatus.STALE,
              toStatus: EnquiryStatus.CLOSED_LOST,
              createdBy: 'SYSTEM',
              metadata: {
                reason: `Auto-closed after ${this.autoCloseDays} days of inactivity`,
              },
            },
          }),
        ]);
      }
    }
  }
}
```

---

## `src/modules/automation/services/followup-scheduler.service.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/database/prisma.service';
import { Cron, CronExpression } from '@nestjs/schedule';
import { EnquiryStatus } from '@prisma/client';

/**
 * Schedules and processes follow-up reminders.
 *
 * HOW IT WORKS:
 *   1. When an enquiry moves to QUOTATION_SENT, AWAITING_CUSTOMER, or FOLLOW_UP
 *      a follow-up check is expected
 *   2. This cron job runs every 30 minutes
 *   3. It checks for enquiries in FOLLOW_UP status that need attention
 *   4. Creates timeline entries to alert staff
 *
 * In a more advanced version, this could auto-send follow-up messages
 * via the outbound pipeline. For now, it creates reminders.
 */
@Injectable()
export class FollowupSchedulerService {
  private readonly logger = new Logger(FollowupSchedulerService.name);

  constructor(private prisma: PrismaService) {}

  @Cron(CronExpression.EVERY_30_MINUTES)
  async processFollowups(): Promise<void> {
    const now = new Date();
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Find enquiries in FOLLOW_UP or AWAITING_CUSTOMER that haven't
    // had any activity in 24+ hours
    const needsFollowUp = await this.prisma.enquiry.findMany({
      where: {
        status: {
          in: [EnquiryStatus.FOLLOW_UP, EnquiryStatus.AWAITING_CUSTOMER],
        },
        lastActivityAt: { lte: twentyFourHoursAgo },
      },
      include: {
        contact: {
          select: { displayName: true },
        },
        assignedTo: {
          select: { id: true, displayName: true },
        },
        // Check if we already sent a follow-up reminder today
        timeline: {
          where: {
            type: 'FOLLOWUP_SCHEDULED',
            createdAt: { gte: twentyFourHoursAgo },
          },
          take: 1,
        },
      },
    });

    // Filter out ones that already got a reminder today
    const unremindered = needsFollowUp.filter(
      (e) => e.timeline.length === 0,
    );

    if (unremindered.length > 0) {
      this.logger.log(
        `📅 ${unremindered.length} enquiries need follow-up reminders`,
      );

      for (const enquiry of unremindered) {
        await this.prisma.enquiryTimeline.create({
          data: {
            enquiryId: enquiry.id,
            type: 'FOLLOWUP_SCHEDULED',
            createdBy: 'SYSTEM',
            metadata: {
              reason: 'No activity for 24+ hours',
              contactName: enquiry.contact.displayName,
              assignedTo: enquiry.assignedTo?.displayName || 'Unassigned',
            },
          },
        });
      }
    }
  }
}
```

---

## `src/modules/automation/listeners/automation.listeners.ts`

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { AutoAssignmentService } from '../services/auto-assignment.service';
import { ContactService } from '../../contact/contact.service';

/**
 * Listens for system events and triggers automation actions.
 */
@Injectable()
export class AutomationListeners {
  private readonly logger = new Logger(AutomationListeners.name);

  constructor(
    private autoAssignment: AutoAssignmentService,
    private contactService: ContactService,
  ) {}

  /**
   * When a new enquiry is created → auto-assign it.
   */
  @OnEvent('enquiry.created')
  async onEnquiryCreated(payload: {
    enquiryId: string;
    contactId: string;
    intent?: string;
    priority?: number;
  }): Promise<void> {
    this.logger.log(`🎯 Auto-assigning enquiry ${payload.enquiryId}`);
    await this.autoAssignment.assign(payload.enquiryId);
  }

  /**
   * When AI extracts a contact name → update the Contact if name is "Unknown".
   */
  @OnEvent('contact.name.extracted')
  async onContactNameExtracted(payload: {
    contactId: string;
    name: string;
  }): Promise<void> {
    await this.contactService.updateNameIfUnknown(payload.contactId, payload.name);
  }
}
```

---

## `src/modules/automation/automation.module.ts`

```typescript
import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AutoAssignmentService } from './services/auto-assignment.service';
import { SlaService } from './services/sla.service';
import { StaleDetectorService } from './services/stale-detector.service';
import { FollowupSchedulerService } from './services/followup-scheduler.service';
import { AutomationListeners } from './listeners/automation.listeners';
import { ContactModule } from '../contact/contact.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ContactModule,
  ],
  providers: [
    AutoAssignmentService,
    SlaService,
    StaleDetectorService,
    FollowupSchedulerService,
    AutomationListeners,
  ],
  exports: [AutoAssignmentService],
})
export class AutomationModule {}
```

---

**Continue to [Part 8: Webhooks, Testing & API Reference →](./PART8_WEBHOOKS_TESTING.md)**
