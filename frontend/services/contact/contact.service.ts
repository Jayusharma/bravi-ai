'use server';

import { apiClient } from '@/lib/api-client';
import { API } from '@/lib/endpoints';

export interface ContactChannel {
  id: string;
  channel: 'WHATSAPP' | 'EMAIL' | 'SMS';
  identifier: string;
  isPrimary: boolean;
  isVerified: boolean;
  createdAt: string;
}

export interface ContactListItem {
  id: string;
  displayName: string;
  organization: string | null;
  notes: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  createdAt: string;
  updatedAt: string;
  channels: ContactChannel[];
  hasActiveEnquiry: boolean;
  _count: {
    enquiries: number;
    inboundMessages: number;
  };
}

export interface ContactListResponse {
  data: ContactListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface ContactDetail extends ContactListItem {}

export interface ContactStats {
  total: number;
  newThisMonth: number;
  engaged: number;
  unassigned: number;
  newThisMonthTrend: number;
}

export interface ContactEnquiry {
  id: string;
  status: string;
  intent: string | null;
  priority: number | null;
  urgency: number | null;
}

// Fetches real header metrics for the contacts list (no client-side fabrication)
export async function getContactStats(): Promise<ContactStats> {
  return apiClient<ContactStats>(API.CONTACT.STATS);
}

// Fetches a paginated list of contacts with optional search query
export async function getContacts(filters?: {
  search?: string;
  page?: number;
  limit?: number;
  channel?: string;
  status?: string;
}): Promise<ContactListResponse> {
  return apiClient<ContactListResponse>(API.CONTACT.LIST, {
    params: {
      search: filters?.search,
      page: filters?.page,
      limit: filters?.limit,
      channel: filters?.channel,
      status: filters?.status,
    },
  });
}

// Retrieves details of a contact by their ID
export async function getContactDetails(id: string): Promise<ContactDetail> {
  return apiClient<ContactDetail>(API.CONTACT.DETAIL(id));
}

// Manually creates a new contact with their first channel
export async function createContact(data: {
  displayName: string;
  organization?: string;
  notes?: string;
  channel: 'WHATSAPP' | 'EMAIL' | 'SMS';
  identifier: string;
}): Promise<ContactDetail> {
  return apiClient<ContactDetail>(API.CONTACT.CREATE, {
    method: 'POST',
    body: data,
  });
}

// Updates basic profile details of a contact
export async function updateContact(
  id: string,
  data: {
    displayName?: string;
    organization?: string;
    notes?: string;
  },
): Promise<ContactDetail> {
  return apiClient<ContactDetail>(API.CONTACT.UPDATE(id), {
    method: 'PATCH',
    body: data,
  });
}

// Deletes a contact if they have no active enquiries
export async function deleteContact(id: string): Promise<void> {
  return apiClient<void>(API.CONTACT.DELETE(id), {
    method: 'DELETE',
  });
}

// Registers an additional contact channel (phone/email)
export async function addContactChannel(
  id: string,
  data: {
    channel: 'WHATSAPP' | 'EMAIL' | 'SMS';
    identifier: string;
    isPrimary?: boolean;
  },
): Promise<ContactChannel> {
  return apiClient<ContactChannel>(API.CONTACT.ADD_CHANNEL(id), {
    method: 'POST',
    body: data,
  });
}

// Removes a channel from a contact
export async function deleteContactChannel(id: string, channelId: string): Promise<void> {
  return apiClient<void>(API.CONTACT.REMOVE_CHANNEL(id, channelId), {
    method: 'DELETE',
  });
}

// Designates a channel as the primary contact channel
export async function setContactChannelPrimary(id: string, channelId: string): Promise<void> {
  return apiClient<void>(API.CONTACT.SET_PRIMARY(id, channelId), {
    method: 'PATCH',
  });
}

// Fetches all enquiries associated with a contact
export async function getContactEnquiries(contactId: string): Promise<ContactEnquiry[]> {
  return apiClient<ContactEnquiry[]>(API.CONTACT.ENQUIRIES(contactId));
}

// Deletes multiple contacts in a bulk operation
export async function deleteContactsBulk(ids: string[]): Promise<void> {
  return apiClient<void>(API.CONTACT.DELETE_BULK, {
    method: 'DELETE',
    body: { ids },
  });
}
