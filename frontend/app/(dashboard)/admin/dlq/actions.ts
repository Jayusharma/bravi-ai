'use server';

import { apiClient } from '@/lib/api-client';

export interface DlqEntry {
  id: string;
  conversationMessageId: string;
  jobName: string;
  lastError: string;
  attemptCount: number;
  createdAt: string;
  resolvedAt: string | null;
}

export interface DlqResponse {
  items: DlqEntry[];
  total: number;
  page: number;
  limit: number;
}

export async function fetchDlqAction(): Promise<DlqResponse> {
  return apiClient<DlqResponse>('/outbound/dlq');
}

export async function retryDlqAction(id: string): Promise<void> {
  await apiClient(`/outbound/dlq/${id}/retry`, { method: 'POST' });
}

export async function discardDlqAction(id: string): Promise<void> {
  await apiClient(`/outbound/dlq/${id}`, { method: 'DELETE' });
}
