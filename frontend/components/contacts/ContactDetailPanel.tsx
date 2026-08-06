'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  getContactDetails,
  updateContact,
  deleteContact,
  addContactChannel,
  deleteContactChannel,
  setContactChannelPrimary,
  getContactEnquiries,
  type ContactDetail,
  type ContactChannel,
  type ContactListItem,
  type ContactEnquiry,
} from '@/services/contact';
import { useToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Avatar } from '@/components/ui/Avatar';
import styles from '@/styles/contacts.module.css';

interface ContactDetailPanelProps {
  contactId: string | null;
  /** The already-known row from the list, rendered immediately while the full fetch resolves in the background. */
  initialData?: ContactListItem | null;
  isOpen: boolean;
  onClose: () => void;
  onUpdate: () => void;
  onDelete: () => void;
}

const URGENCY_LABELS: Record<number, string> = {
  1: 'Very Low',
  2: 'Low',
  3: 'Medium',
  4: 'High',
  5: 'Critical',
};

const CHANNEL_ICONS: Record<string, string> = {
  WHATSAPP: '💬 WhatsApp',
  EMAIL: '📧 Email',
  SMS: '📱 SMS',
};

export function ContactDetailPanel({
  contactId,
  initialData,
  isOpen,
  onClose,
  onUpdate,
  onDelete,
}: ContactDetailPanelProps) {
  const toast = useToast();
  const [contact, setContact] = useState<ContactDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingProfile, setSavingProfile] = useState(false);

  // Profile Edit fields
  const [displayName, setDisplayName] = useState('');
  const [organization, setOrganization] = useState('');
  const [notes, setNotes] = useState('');

  // Add Channel fields
  const [newChannel, setNewChannel] = useState<'WHATSAPP' | 'EMAIL' | 'SMS'>('WHATSAPP');
  const [newIdentifier, setNewIdentifier] = useState('');
  const [addingChannel, setAddingChannel] = useState(false);

  // Enquiries list
  const [enquiries, setEnquiries] = useState<ContactEnquiry[]>([]);
  const [loadingEnquiries, setLoadingEnquiries] = useState(false);

  // Deletion confirm
  const [confirmDelete, setConfirmDelete] = useState(false);

  // Fetches the full profile. When `showLoading` is false (we already have the row's data
  // from the list), this refreshes silently in the background instead of blanking the panel.
  const fetchDetails = async (showLoading: boolean) => {
    if (!contactId) return;
    if (showLoading) setLoading(true);
    try {
      const res = await getContactDetails(contactId);
      setContact(res);
      setDisplayName(res.displayName);
      setOrganization(res.organization || '');
      setNotes(res.notes || '');
    } catch (err: any) {
      toast.error('Error Loading Contact', err.message || 'Something went wrong.');
      if (showLoading) onClose();
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  // Independent lifecycle from the profile fetch — its own loading state, its own failure mode
  const fetchEnquiries = async () => {
    if (!contactId) return;
    try {
      setLoadingEnquiries(true);
      const data = await getContactEnquiries(contactId);
      setEnquiries(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Failed to load contact enquiries:', err);
    } finally {
      setLoadingEnquiries(false);
    }
  };

  useEffect(() => {
    if (isOpen && contactId) {
      const hasInitialData = !!initialData && initialData.id === contactId;
      if (hasInitialData) {
        setContact(initialData!);
        setDisplayName(initialData!.displayName);
        setOrganization(initialData!.organization || '');
        setNotes(initialData!.notes || '');
      }
      fetchDetails(!hasInitialData);
      fetchEnquiries();
      setConfirmDelete(false);
    } else {
      setContact(null);
      setEnquiries([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, contactId]);

  if (!isOpen || !contact) return null;

  // Saves updated profile fields to the database
  const handleSaveProfile = async () => {
    if (!displayName.trim()) {
      toast.error('Validation Error', 'Display Name cannot be empty.');
      return;
    }
    try {
      setSavingProfile(true);
      await updateContact(contact.id, {
        displayName: displayName.trim(),
        organization: organization.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      toast.success('Profile Saved', 'Contact profile updated successfully.');
      onUpdate();
    } catch (err: any) {
      toast.error('Error Saving Profile', err.message || 'Failed to save changes.');
    } finally {
      setSavingProfile(false);
    }
  };

  // Adds a secondary channel to the contact
  const handleAddChannel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newIdentifier.trim()) {
      toast.error('Validation Error', 'Channel identifier is required.');
      return;
    }
    try {
      setAddingChannel(true);
      await addContactChannel(contact.id, {
        channel: newChannel,
        identifier: newIdentifier.trim(),
      });
      toast.success('Channel Added', 'New channel added successfully.');
      setNewIdentifier('');
      fetchDetails(false);
      onUpdate();
    } catch (err: any) {
      toast.error('Error Adding Channel', err.message || 'Failed to add channel.');
    } finally {
      setAddingChannel(false);
    }
  };

  // Removes a channel, ensuring at least one remains
  const handleDeleteChannel = async (channelId: string) => {
    try {
      await deleteContactChannel(contact.id, channelId);
      toast.success('Channel Removed', 'Channel deleted successfully.');
      fetchDetails(false);
      onUpdate();
    } catch (err: any) {
      toast.error('Error Deleting Channel', err.message || 'Failed to delete channel.');
    }
  };

  // Sets a primary contact channel route
  const handleSetPrimary = async (channelId: string) => {
    try {
      await setContactChannelPrimary(contact.id, channelId);
      toast.success('Primary Set', 'Primary contact channel updated.');
      fetchDetails(false);
      onUpdate();
    } catch (err: any) {
      toast.error('Error Setting Primary', err.message || 'Failed to update primary channel.');
    }
  };

  // Handles contact deletion
  const handleDeleteContact = async () => {
    if (contact.hasActiveEnquiry) {
      return; // Safety block
    }
    try {
      await deleteContact(contact.id);
      toast.success('Contact Deleted', 'Contact deleted successfully.');
      onDelete();
      onClose();
    } catch (err: any) {
      toast.error('Error Deleting Contact', err.message || 'Failed to delete contact.');
    }
  };

  return (
    <>
      <div className={styles.drawerOverlay} onClick={onClose} />
      <div className={styles.drawer}>
        <div className={styles.drawerHeader}>
          <h2 className="text-lg font-bold tracking-tight">Contact Profile</h2>
          <button
            onClick={onClose}
            className="rounded-md border border-border bg-card p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className={styles.drawerBody}>
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
              <span className="text-sm">Loading profile details...</span>
            </div>
          ) : (
            <>
              {/* Profile Card */}
              <div className={styles.profileCard}>
                <Avatar fallback={displayName || 'Unknown'} size="lg" />
                <div className={styles.profileMeta}>
                  <h3 className="text-foreground">{displayName || 'Unknown Name'}</h3>
                  <p>{organization || 'No Organization'}</p>
                </div>
              </div>

              {/* Edit Form */}
              <div className={styles.section}>
                <h4 className={styles.sectionTitle}>Profile Details</h4>
                <div className="flex flex-col gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground mb-1">
                      Display Name
                    </label>
                    <Input
                      type="text"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      disabled={savingProfile}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground mb-1">
                      Organization
                    </label>
                    <Input
                      type="text"
                      value={organization}
                      onChange={(e) => setOrganization(e.target.value)}
                      placeholder="Organization / Company"
                      disabled={savingProfile}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-muted-foreground mb-1">
                      Notes
                    </label>
                    <textarea
                      className={styles.drawerTextarea}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Add private staff notes here..."
                      disabled={savingProfile}
                    />
                  </div>
                  <div className="flex justify-end pt-1">
                    <Button
                      className="h-8 text-xs px-3"
                      onClick={handleSaveProfile}
                      disabled={savingProfile || displayName.trim() === ''}
                    >
                      {savingProfile ? 'Saving...' : 'Save Profile'}
                    </Button>
                  </div>
                </div>
              </div>

              {/* Channels List */}
              <div className={styles.section}>
                <h4 className={styles.sectionTitle}>Contact Channels</h4>
                <div className="flex flex-col gap-2">
                  {contact.channels.map((chan) => (
                    <div key={chan.id} className={styles.channelRow}>
                      <div className={styles.channelInfo}>
                        <span>{CHANNEL_ICONS[chan.channel] || chan.channel}</span>
                        <span className="font-mono text-xs">{chan.identifier}</span>
                        {chan.isPrimary && (
                          <Badge variant="success" className={styles.badge}>
                            Primary
                          </Badge>
                        )}
                      </div>
                      <div className={styles.channelActions}>
                        {!chan.isPrimary && (
                          <Button
                            variant="outline"
                            className="h-7 text-xs px-2"
                            onClick={() => handleSetPrimary(chan.id)}
                          >
                            Set Primary
                          </Button>
                        )}
                        <Button
                          variant="destructive"
                          className="h-7 w-7 p-0 flex items-center justify-center"
                          disabled={contact.channels.length <= 1}
                          onClick={() => handleDeleteChannel(chan.id)}
                          title={contact.channels.length <= 1 ? 'Contacts must have at least one channel' : 'Delete Channel'}
                        >
                          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M3 6h18m-2 0v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6m3 0V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                          </svg>
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Add Channel inline form */}
                <form onSubmit={handleAddChannel} className="mt-2 grid grid-cols-3 gap-2 items-end">
                  <div className="col-span-1">
                    <Select
                      value={newChannel}
                      onChange={(e) => setNewChannel(e.target.value as 'WHATSAPP' | 'EMAIL' | 'SMS')}
                      className="h-9 text-xs"
                      disabled={addingChannel}
                    >
                      <option value="WHATSAPP">WhatsApp</option>
                      <option value="EMAIL">Email</option>
                      <option value="SMS">SMS</option>
                    </Select>
                  </div>
                  <div className="col-span-2 flex gap-2">
                    <Input
                      type="text"
                      placeholder={newChannel === 'EMAIL' ? 'email@example.com' : '+91-987...'}
                      value={newIdentifier}
                      onChange={(e) => setNewIdentifier(e.target.value)}
                      className="h-9 text-xs"
                      disabled={addingChannel}
                      required
                    />
                    <Button type="submit" className="h-9 px-3" disabled={addingChannel}>
                      +
                    </Button>
                  </div>
                </form>
              </div>

              {/* Enquiries history list */}
              <div className={styles.section}>
                <h4 className={styles.sectionTitle}>Enquiries ({enquiries.length})</h4>
                {loadingEnquiries ? (
                  <span className="text-xs text-muted-foreground">Loading enquiries...</span>
                ) : enquiries.length === 0 ? (
                  <span className="text-xs text-muted-foreground italic">No associated enquiries.</span>
                ) : (
                  <div className="flex flex-col gap-2">
                    {enquiries.map((enq) => {
                      const isClosed = ['CONVERTED', 'CLOSED_LOST'].includes(enq.status);
                      return (
                        <div key={enq.id} className={styles.enquiryCard}>
                          <div className={styles.enquiryHeader}>
                            <span className={styles.enquiryTitle}>
                              {enq.intent ? enq.intent.replace('_', ' ') : 'General enquiry'}
                            </span>
                            <Badge variant={isClosed ? 'secondary' : 'default'}>
                              {enq.status}
                            </Badge>
                          </div>
                          <div className={styles.enquiryMeta}>
                            <span>Priority: {enq.priority || 5} · Urgency: {URGENCY_LABELS[enq.urgency || 3]}</span>
                            <Link
                              href={`/messaging?contactId=${contact.id}`}
                              className="text-primary font-semibold hover:underline"
                              onClick={onClose}
                            >
                              Go to chat →
                            </Link>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Danger Zone */}
              <div className="border-t border-border pt-4 mt-2">
                <div className={styles.deleteWrapper}>
                  {contact.hasActiveEnquiry && (
                    <span className={styles.tooltip}>
                      Active enquiry exists for this contact. Close the enquiry before deleting.
                    </span>
                  )}
                  {confirmDelete ? (
                    <div className="flex flex-col gap-2 p-3 bg-destructive/10 rounded-lg border border-destructive/20 animate-fade-in">
                      <p className="text-xs font-semibold text-destructive">
                        Are you sure? This will delete the contact and all associated closed enquiries.
                      </p>
                      <div className="flex gap-2 justify-end">
                        <Button
                          variant="outline"
                          className="h-8 px-3 text-xs"
                          onClick={() => setConfirmDelete(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant="destructive"
                          className="h-8 px-3 text-xs"
                          onClick={handleDeleteContact}
                        >
                          Confirm Delete
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <Button
                      variant="destructive"
                      className={`w-full justify-center ${contact.hasActiveEnquiry ? styles.buttonDisabled : ''}`}
                      onClick={() => !contact.hasActiveEnquiry && setConfirmDelete(true)}
                      disabled={contact.hasActiveEnquiry}
                    >
                      Delete Contact
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
