import { EnquiryStatus } from '@prisma/client';

/**
 * Enquiry Finite State Machine (FSM)
 *
 * Defines which status transitions are legal for each state.
 * The service enforces these rules — no shortcuts allowed.
 *
 * Flow:
 *   NEW → OPEN
 *   OPEN → FOLLOW_UP, QUOTATION_SENT, CONVERTED, CLOSED_LOST
 *   FOLLOW_UP → OPEN, QUOTATION_SENT, CONVERTED, CLOSED_LOST
 *   QUOTATION_SENT → FOLLOW_UP, CONVERTED, CLOSED_LOST
 *   CONVERTED → (terminal)
 *   CLOSED_LOST → OPEN (reopen)
 *   IN_PROGRESS → FOLLOW_UP, QUOTATION_SENT, CONVERTED, CLOSED_LOST
 */
export const ENQUIRY_TRANSITIONS: Record<EnquiryStatus, EnquiryStatus[]> = {
  NEW: ['OPEN'],
  OPEN: ['FOLLOW_UP', 'QUOTATION_SENT', 'CONVERTED', 'CLOSED_LOST', 'IN_PROGRESS'],
  IN_PROGRESS: ['FOLLOW_UP', 'QUOTATION_SENT', 'CONVERTED', 'CLOSED_LOST'],
  FOLLOW_UP: ['OPEN', 'QUOTATION_SENT', 'CONVERTED', 'CLOSED_LOST'],
  QUOTATION_SENT: ['FOLLOW_UP', 'CONVERTED', 'CLOSED_LOST'],
  CONVERTED: [], // Terminal state
  CLOSED_LOST: ['OPEN'], // Can reopen
};
