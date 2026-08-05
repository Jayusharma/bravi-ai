import { redirect } from 'next/navigation';

/**
 * Root Inbox Route (/inbox)
 * Automatically redirects to /inbox/whatsapp.
 */
export default function InboxPage() {
  redirect('/inbox/whatsapp');
}
