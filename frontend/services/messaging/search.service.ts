'use server';

import { apiClient } from '@/lib/api-client';
import { API } from '@/lib/endpoints';

export interface SearchContact {
  id: string;
  displayName: string;
  organization: string | null;
  channels: Array<{ channel: string; identifier: string; isPrimary: boolean }>;
  enquiries: Array<{ id: string; status: string }>;
}

export interface SearchMessage {
  id: string;
  content: string;
  direction: string;
  channel: string;
  createdAt: string;
  enquiry: {
    id: string;
    status: string;
    contact: { id: string; displayName: string };
  };
  sentByUser: { id: string; displayName: string | null; userName: string } | null;
}

export interface SearchResult {
  contacts: SearchContact[];
  messages: SearchMessage[];
}

/** Unified search: contacts + messages. If contactId provided, scopes messages to that contact. */
export async function searchUnified(q: string, contactId?: string, limit = 20): Promise<SearchResult> {
  return apiClient<SearchResult>(API.SEARCH.QUERY, {
    params: { q, ...(contactId ? { contactId } : {}), limit },
  });
}
