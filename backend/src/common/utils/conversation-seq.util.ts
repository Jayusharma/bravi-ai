// conversation-seq.util.ts — Atomic per-contact message sequence numbers.
// Contact.lastMessageSeq is both the seq generator and the thread watermark — call this
// inside the SAME $transaction as the ConversationMessage insert so a failed insert rolls
// back the increment and never burns a seq number.

import { Prisma } from '@prisma/client';

/** Atomically increments Contact.lastMessageSeq and returns the new value to use as `seq`. */
export async function nextContactSeq(
  tx: Prisma.TransactionClient,
  contactId: string,
): Promise<number> {
  const contact = await tx.contact.update({
    where: { id: contactId },
    data: { lastMessageSeq: { increment: 1 } },
    select: { lastMessageSeq: true },
  });
  return contact.lastMessageSeq;
}
