import { EnquiryStatus } from '@prisma/client';

export const ENQUIRY_TRANSITIONS: Record< EnquiryStatus,EnquiryStatus[]> = {
    
  NEW: ['OPEN'],
  OPEN: ['QUOTATION_SENT','CLOSED'],
  QUOTATION_SENT: ['CLOSED','OPEN'],
  CLOSED: [],
};
