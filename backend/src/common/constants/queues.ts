// queues.ts — BullMQ queue names and job type constants. Import from here — never hardcode queue strings.

export const QUEUES = {
  OUTBOUND: 'OUTBOUND_QUEUE',
} as const;

export const JOB_TYPES = {
  EMAIL:     'outbound.email',
  WHATSAPP:  'outbound.whatsapp',
} as const;

export type JobType = (typeof JOB_TYPES)[keyof typeof JOB_TYPES];
