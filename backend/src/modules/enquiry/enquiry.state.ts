import { EnquiryStatus } from '@prisma/client';

export const ENQUIRY_TRANSITIONS: Record<EnquiryStatus, EnquiryStatus[]> = {
  NEW: [
    EnquiryStatus.OPEN,
    EnquiryStatus.IN_PROGRESS,
    EnquiryStatus.CLOSED_LOST,
  ],

  OPEN: [
    EnquiryStatus.IN_PROGRESS,
    EnquiryStatus.QUOTATION_SENT,
    EnquiryStatus.FOLLOW_UP,
    EnquiryStatus.CONVERTED,
    EnquiryStatus.CLOSED_LOST,
  ],

  IN_PROGRESS: [
    EnquiryStatus.AWAITING_CUSTOMER,
    EnquiryStatus.QUOTATION_SENT,
    EnquiryStatus.FOLLOW_UP,
    EnquiryStatus.CONVERTED,
    EnquiryStatus.CLOSED_LOST,
  ],

  AWAITING_CUSTOMER: [
    EnquiryStatus.IN_PROGRESS,
    EnquiryStatus.FOLLOW_UP,
    EnquiryStatus.STALE,
    EnquiryStatus.CONVERTED,
    EnquiryStatus.CLOSED_LOST,
  ],

  QUOTATION_SENT: [
    EnquiryStatus.IN_PROGRESS,
    EnquiryStatus.FOLLOW_UP,
    EnquiryStatus.AWAITING_CUSTOMER,
    EnquiryStatus.CONVERTED,
    EnquiryStatus.CLOSED_LOST,
  ],

  FOLLOW_UP: [
    EnquiryStatus.IN_PROGRESS,
    EnquiryStatus.AWAITING_CUSTOMER,
    EnquiryStatus.STALE,
    EnquiryStatus.CONVERTED,
    EnquiryStatus.CLOSED_LOST,
  ],

  STALE: [
    EnquiryStatus.IN_PROGRESS,
    EnquiryStatus.OPEN,
    EnquiryStatus.FOLLOW_UP,
    EnquiryStatus.CLOSED_LOST,
  ],

  CONVERTED: [],       // Terminal state — no transitions out
  CLOSED_LOST: [
    EnquiryStatus.OPEN, // Can reopen a lost enquiry
  ],
};