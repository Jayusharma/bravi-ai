 
 
 export function canSendMessage(
    actor: { userId: string; role: string },
    enquiry: { assignedToId: string | null },
  ) {
    if (actor.role === 'ADMIN') return true;
    if (enquiry.assignedToId === actor.userId) return true;
    return false;
  }
  