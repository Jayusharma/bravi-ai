'use client';

import { useState } from 'react';
import { createContact } from '@/services/contact';
import { useToast } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';

interface CreateContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function CreateContactModal({ isOpen, onClose, onSuccess }: CreateContactModalProps) {
  const toast = useToast();
  const [displayName, setDisplayName] = useState('');
  const [organization, setOrganization] = useState('');
  const [notes, setNotes] = useState('');
  const [channel, setChannel] = useState<'WHATSAPP' | 'EMAIL' | 'SMS'>('WHATSAPP');
  const [identifier, setIdentifier] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  // Handles form submission to manually create a new contact
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!displayName.trim() || !identifier.trim()) {
      toast.error('Validation Error', 'Display Name and Identifier are required.');
      return;
    }

    try {
      setLoading(true);
      await createContact({
        displayName: displayName.trim(),
        organization: organization.trim() || undefined,
        notes: notes.trim() || undefined,
        channel,
        identifier: identifier.trim(),
      });
      toast.success('Success', 'Contact created successfully!');
      setDisplayName('');
      setOrganization('');
      setNotes('');
      setIdentifier('');
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error('Error Creating Contact', err.message || 'Something went wrong.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 animate-fade-in">
      <div className="w-full max-w-md overflow-hidden rounded-lg border border-border bg-card shadow-lg p-6 animate-scale-up">
        <div className="flex justify-between items-center pb-4 mb-4 border-b border-border">
          <h3 className="text-lg font-semibold tracking-tight text-foreground">Add New Contact</h3>
          <button
            onClick={onClose}
            className="rounded-md border border-border bg-card p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Display Name *
            </label>
            <Input
              type="text"
              placeholder="e.g. Rahul Sharma"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              disabled={loading}
              required
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Organization
            </label>
            <Input
              type="text"
              placeholder="e.g. Google India"
              value={organization}
              onChange={(e) => setOrganization(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1">
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Channel
              </label>
              <Select
                value={channel}
                onChange={(e) => setChannel(e.target.value as 'WHATSAPP' | 'EMAIL' | 'SMS')}
                disabled={loading}
              >
                <option value="WHATSAPP">WhatsApp</option>
                <option value="EMAIL">Email</option>
                <option value="SMS">SMS</option>
              </Select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Identifier *
              </label>
              <Input
                type="text"
                placeholder={channel === 'EMAIL' ? 'name@example.com' : '+91-9876543210'}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                disabled={loading}
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Notes
            </label>
            <textarea
              className="w-full min-h-[80px] bg-background border border-border rounded-lg p-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition"
              placeholder="Add contact notes, context, or requirements here..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className="flex justify-end gap-3 pt-3 border-t border-border">
            <Button type="button" variant="outline" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button type="submit" variant="default" disabled={loading}>
              {loading ? 'Creating...' : 'Create Contact'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
