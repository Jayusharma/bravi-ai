'use client';

import { useState, useTransition } from 'react';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table';
import { PermissionGate } from '@/components/auth';
import { useToast } from '@/components/ui/Toast';
import { handleResult, handleVoidResult } from '@/lib/error';
import {
    deleteChannel,
    updateChannelStatus,
    type ChannelConnection,
} from '@/services/channel';
import { ChannelToggle } from './ChannelToggle';
import { AddChannelModal } from './AddChannelModal';

interface ChannelsClientProps {
    initialData: ChannelConnection[];
}

function formatDate(iso: string | null): string {
    if (!iso) return 'Never';
    return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function providerLabel(provider: ChannelConnection['provider']): string {
    if (provider === 'SENDGRID_EMAIL') return 'Email — SendGrid';
    if (provider === 'META_WHATSAPP') return 'WhatsApp — Meta Cloud API';
    if (provider === 'TWILIO_WHATSAPP') return 'WhatsApp — Twilio';
    return provider;
}

export function ChannelsClient({ initialData }: ChannelsClientProps) {
    const toast = useToast();
    const [, startTransition] = useTransition();

    const [channels, setChannels] = useState<ChannelConnection[]>(initialData);
    const [selectedProvider, setSelectedProvider] = useState<'SENDGRID_EMAIL' | 'META_WHATSAPP' | 'TWILIO_WHATSAPP' | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);

    const hasEmail = channels.some((c) => c.channel === 'EMAIL' && c.status === 'ACTIVE');
    const hasMeta = channels.some((c) => c.provider === 'META_WHATSAPP' && c.status === 'ACTIVE');

    const handleToggle = (channel: ChannelConnection) => {
        const nextStatus = channel.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
        setBusyId(channel.id);
        startTransition(async () => {
            const result = await updateChannelStatus(channel.id, nextStatus);
            setBusyId(null);
            const data = handleResult(result, toast, {
                successMessage: nextStatus === 'ACTIVE' ? 'Channel turned on.' : 'Channel turned off.',
                errorTitle: 'Toggle failed',
            });
            if (!data) return;
            setChannels((prev) => prev.map((c) => (c.id === data.id ? data : c)));
        });
    };

    const handleDelete = (channel: ChannelConnection) => {
        if (!window.confirm(`Remove "${channel.displayName}"? This disconnects the channel entirely.`)) return;
        setBusyId(channel.id);
        startTransition(async () => {
            const result = await deleteChannel(channel.id);
            setBusyId(null);
            if (!handleVoidResult(result, toast, { successMessage: 'Channel removed.', errorTitle: 'Delete failed' })) return;
            setChannels((prev) => prev.filter((c) => c.id !== channel.id));
        });
    };

    return (
        <div className="space-y-8">
            {/* Header */}
            <div>
                <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-br from-foreground via-foreground/90 to-foreground/75 bg-clip-text text-transparent">
                    Channels
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                    Connect where enquiries come in from. Turn a channel off to stop sending and receiving on it.
                </p>
            </div>

            {/* Available Integrations Section */}
            <div className="space-y-4">
                <h2 className="text-lg font-bold tracking-tight text-foreground">Available Integrations</h2>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                    {/* SendGrid Email Card */}
                    <div className="relative flex items-center justify-between overflow-hidden rounded-2xl border border-border/40 bg-card/65 p-5 backdrop-blur-md transition-all hover:border-border/80 hover:bg-card/80 shadow-sm group">
                        <div className="flex items-start gap-4">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent/50 p-2 border border-border/20">
                                <img src="/gmail.png" alt="Email" className="h-8 w-8 object-contain" />
                            </div>
                            <div className="space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="font-bold text-foreground">Email (SendGrid)</h3>
                                    {hasEmail ? (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                            Connected
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center rounded-full bg-muted/60 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                                            Not Configured
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-muted-foreground max-w-sm leading-relaxed">
                                    Send automated qualification flows, outreach, and receive inbound leads via SendGrid parse hook.
                                </p>
                            </div>
                        </div>
                        <PermissionGate action="create" subject="channelconnection">
                            <button
                                onClick={() => setSelectedProvider('SENDGRID_EMAIL')}
                                className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary transition-all hover:bg-primary hover:text-primary-foreground group-hover:scale-105 cursor-pointer shadow-sm"
                                title="Connect Email"
                            >
                                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 5v14M5 12h14" />
                                </svg>
                            </button>
                        </PermissionGate>
                    </div>

                    {/* WhatsApp Card */}
                    <div className="relative flex items-center justify-between overflow-hidden rounded-2xl border border-border/40 bg-card/65 p-5 backdrop-blur-md transition-all hover:border-border/80 hover:bg-card/80 shadow-sm group">
                        <div className="flex items-start gap-4">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent/50 p-2 border border-border/20">
                                <img src="/whatsapp.png" alt="WhatsApp" className="h-8 w-8 object-contain" />
                            </div>
                            <div className="space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="font-bold text-foreground">WhatsApp (Twilio)</h3>
                                    <span className="inline-flex items-center rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                                        Simulator Sandbox
                                    </span>
                                </div>
                                <p className="text-xs text-muted-foreground max-w-sm leading-relaxed">
                                    Interact within WhatsApp 24h customer window and trigger pre-approved notification templates.
                                </p>
                            </div>
                        </div>
                        <PermissionGate action="create" subject="channelconnection">
                            <button
                                onClick={() => setSelectedProvider('TWILIO_WHATSAPP')}
                                className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary transition-all hover:bg-primary hover:text-primary-foreground group-hover:scale-105 cursor-pointer shadow-sm"
                                title="Launch WhatsApp Simulator"
                            >
                                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 5v14M5 12h14" />
                                </svg>
                            </button>
                        </PermissionGate>
                    </div>

                    {/* WhatsApp Meta Cloud API Card — the REAL WhatsApp connection */}
                    <div className="relative flex items-center justify-between overflow-hidden rounded-2xl border border-border/40 bg-card/65 p-5 backdrop-blur-md transition-all hover:border-border/80 hover:bg-card/80 shadow-sm group">
                        <div className="flex items-start gap-4">
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent/50 p-2 border border-border/20">
                                <img src="/whatsapp.png" alt="WhatsApp" className="h-8 w-8 object-contain" />
                            </div>
                            <div className="space-y-1">
                                <div className="flex flex-wrap items-center gap-2">
                                    <h3 className="font-bold text-foreground">WhatsApp (Meta)</h3>
                                    {hasMeta ? (
                                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                            Connected
                                        </span>
                                    ) : (
                                        <span className="inline-flex items-center rounded-full bg-muted/60 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                                            Not Configured
                                        </span>
                                    )}
                                </div>
                                <p className="text-xs text-muted-foreground max-w-sm leading-relaxed">
                                    Official WhatsApp Cloud API — send &amp; receive customer messages directly through Meta, no middleman.
                                </p>
                            </div>
                        </div>
                        <PermissionGate action="create" subject="channelconnection">
                            <button
                                onClick={() => setSelectedProvider('META_WHATSAPP')}
                                className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/15 text-primary transition-all hover:bg-primary hover:text-primary-foreground group-hover:scale-105 cursor-pointer shadow-sm"
                                title="Connect WhatsApp (Meta)"
                            >
                                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 5v14M5 12h14" />
                                </svg>
                            </button>
                        </PermissionGate>
                    </div>
                </div>
            </div>

            {/* Connected Channels List */}
            <div className="space-y-4">
                <h2 className="text-lg font-bold tracking-tight text-foreground">Connected Connections</h2>
                {channels.length === 0 ? (
                    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-card/40 py-16 text-center">
                        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-accent text-muted-foreground">
                            <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M21 8V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-2" />
                                <path d="M22 12h-6a2 2 0 0 0 0 4h4" />
                            </svg>
                        </div>
                        <p className="text-sm font-medium">No channels connected yet</p>
                        <p className="mt-1 text-sm text-muted-foreground">Click a provider card above to start integrating.</p>
                    </div>
                ) : (
                    <div className="rounded-2xl border border-border/30 bg-card/45 backdrop-blur-md overflow-hidden">
                        <Table>
                            <TableHeader>
                                <TableRow>
                                    <TableHead>Channel / Identity</TableHead>
                                    <TableHead>Provider</TableHead>
                                    <TableHead>Status</TableHead>
                                    <TableHead>Last Inbound</TableHead>
                                    <TableHead className="text-right">Active State</TableHead>
                                    <TableHead className="w-12" />
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {channels.map((c) => (
                                    <TableRow key={c.id} className={`${busyId === c.id ? 'opacity-60' : ''} transition-all`}>
                                        <TableCell>
                                            <div className="flex items-center gap-3">
                                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/40 p-1.5 border border-border/20">
                                                    <img 
                                                        src={c.channel === 'EMAIL' ? '/gmail.png' : '/whatsapp.png'} 
                                                        alt={c.channel} 
                                                        className="h-6 w-6 object-contain" 
                                                    />
                                                </div>
                                                <div>
                                                    <div className="font-semibold text-foreground leading-tight">{c.displayName}</div>
                                                    <div className="text-xs text-muted-foreground mt-0.5 font-mono">{c.externalAccountId}</div>
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-sm font-medium text-muted-foreground">{providerLabel(c.provider)}</TableCell>
                                        <TableCell>
                                            <Badge variant={c.status === 'ACTIVE' ? 'success' : 'secondary'}>
                                                {c.status === 'ACTIVE' ? 'Active' : 'Disabled'}
                                            </Badge>
                                            {c.lastError ? (
                                                <div className="mt-1.5 text-xs text-destructive flex items-center gap-1" title={c.lastError}>
                                                    <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                        <circle cx="12" cy="12" r="10" />
                                                        <line x1="12" x2="12" y1="8" y2="12" />
                                                        <line x1="12" x2="12.01" y1="16" y2="16" />
                                                    </svg>
                                                    {c.lastError}
                                                </div>
                                            ) : null}
                                        </TableCell>
                                        <TableCell className="text-sm text-muted-foreground">{formatDate(c.lastInboundAt)}</TableCell>
                                        <TableCell className="text-right">
                                            <PermissionGate action="update" subject="channelconnection">
                                                <div className="inline-block align-middle">
                                                    <ChannelToggle
                                                        checked={c.status === 'ACTIVE'}
                                                        disabled={busyId === c.id}
                                                        onChange={() => handleToggle(c)}
                                                    />
                                                </div>
                                            </PermissionGate>
                                        </TableCell>
                                        <TableCell>
                                            <PermissionGate action="delete" subject="channelconnection">
                                                <button
                                                    onClick={() => handleDelete(c)}
                                                    disabled={busyId === c.id}
                                                    className="rounded-xl p-2 text-muted-foreground transition-all hover:bg-destructive/10 hover:text-destructive cursor-pointer disabled:pointer-events-none"
                                                    aria-label="Remove channel"
                                                >
                                                    <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                        <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0-1 14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2L4 6h16z" />
                                                    </svg>
                                                </button>
                                            </PermissionGate>
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                )}
            </div>

            {selectedProvider ? (
                <AddChannelModal
                    provider={selectedProvider}
                    onCreated={(channel) => setChannels((prev) => [channel, ...prev])}
                    onClose={() => setSelectedProvider(null)}
                />
            ) : null}
        </div>
    );
}
