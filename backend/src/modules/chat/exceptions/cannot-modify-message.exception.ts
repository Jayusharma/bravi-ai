import { ForbiddenException } from '@nestjs/common';

/**
 * Thrown when a user tries to edit/delete/pin a chat message that isn't theirs,
 * or one that's no longer in an editable state (deleted, past the edit window, etc).
 * Extends ForbiddenException so it carries a real 403 — GlobalExceptionFilter's
 * classifyHttpException branch handles it exactly like a built-in Nest exception.
 */
export class CannotModifyMessageError extends ForbiddenException {
  constructor(action: 'edit' | 'delete' | 'pin', messageId: string, reason?: string) {
    super({
      code: 'CANNOT_MODIFY_MESSAGE',
      message: reason ?? `Cannot ${action} another user's message`,
      messageId,
    });
  }
}
