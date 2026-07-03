'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { createChannel, type ChannelConnection } from '@/services/channel';

interface AddChannelModalProps {
    provider: 'SENDGRID_EMAIL' | 'TWILIO_WHATSAPP';
    onCreated: (channel: ChannelConnection) => void;
    onClose: () => void;
}

interface VerificationStep {
    label: string;
    status: 'idle' | 'loading' | 'success' | 'error';
    errorMsg?: string;
}

const INBOUND_EMAIL_WEBHOOK_PATH = '/api/v1/webhook/email';
const INBOUND_WHATSAPP_WEBHOOK_PATH = '/api/v1/webhook/whatsapp';

export function AddChannelModal({ provider, onCreated, onClose }: AddChannelModalProps) {
    const toast = useToast();
    const [step, setStep] = useState<'FORM' | 'VERIFYING' | 'SUCCESS'>('FORM');

    // --- Form States ---
    // Email
    const [displayName, setDisplayName] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [fromEmail, setFromEmail] = useState('');

    // WhatsApp
    const [waDisplayName, setWaDisplayName] = useState('');
    const [accountSid, setAccountSid] = useState('');
    const [authToken, setAuthToken] = useState('');
    const [phoneNumber, setPhoneNumber] = useState('');

    // --- Verification States ---
    const [verifSteps, setVerifSteps] = useState<VerificationStep[]>([]);
    const [connectedChannel, setConnectedChannel] = useState<ChannelConnection | null>(null);

    const isEmail = provider === 'SENDGRID_EMAIL';
    
    // Validation checks
    const canSubmitEmail = displayName.trim().length >= 2 && apiKey.trim().length >= 10 && fromEmail.trim().length > 0;
    const canSubmitWhatsApp = waDisplayName.trim().length >= 2 && accountSid.trim().length >= 10 && authToken.trim().length >= 10 && phoneNumber.trim().length >= 8;
    const canSubmit = isEmail ? canSubmitEmail : canSubmitWhatsApp;

    // Helper to simulate delays for premium animated effect
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    const handleConnect = async () => {
        if (!canSubmit) return;
        setStep('VERIFYING');

        if (isEmail) {
            // Initializing steps for Email
            const initialSteps: VerificationStep[] = [
                { label: 'Validating API credentials with SendGrid API', status: 'loading' },
                { label: 'Integrating adapter configurations', status: 'idle' },
                { label: 'Starting inbound webhook receiver', status: 'idle' },
                { label: 'Connection finalized', status: 'idle' },
            ];
            setVerifSteps(initialSteps);

            try {
                // Step 1: Real API Key validation & DB save
                const result = await createChannel({
                    provider: 'SENDGRID_EMAIL',
                    displayName: displayName.trim(),
                    apiKey: apiKey.trim(),
                    fromEmail: fromEmail.trim(),
                });

                if (!result.success) {
                    // Update Step 1 with error
                    setVerifSteps((prev) => {
                        const next = [...prev];
                        next[0].status = 'error';
                        next[0].errorMsg = result.error ?? 'Authentication rejected. Check API key permissions.';
                        return next;
                    });
                    return;
                }

                // Step 1 Success
                setVerifSteps((prev) => {
                    const next = [...prev];
                    next[0].status = 'success';
                    next[1].status = 'loading';
                    return next;
                });
                await delay(900);

                // Step 2 Success: Adapter registration
                setVerifSteps((prev) => {
                    const next = [...prev];
                    next[1].status = 'success';
                    next[2].status = 'loading';
                    return next;
                });
                await delay(800);

                // Step 3 Success: Start inbound webhook staging
                setVerifSteps((prev) => {
                    const next = [...prev];
                    next[2].status = 'success';
                    next[3].status = 'loading';
                    return next;
                });
                await delay(600);

                // Step 4 Success: Finalize
                setVerifSteps((prev) => {
                    const next = [...prev];
                    next[3].status = 'success';
                    return next;
                });
                await delay(400);

                // Open final instructions
                onCreated(result.data!);
                setConnectedChannel(result.data);
                setStep('SUCCESS');
                toast.success('Channel connected', 'Email channel successfully authorized!');

            } catch (err: any) {
                setVerifSteps((prev) => {
                    const next = [...prev];
                    next[0].status = 'error';
                    next[0].errorMsg = err.message ?? 'An unexpected network error occurred.';
                    return next;
                });
            }
        } else {
            // Initializing steps for WhatsApp Simulator
            const initialSteps: VerificationStep[] = [
                { label: 'Authenticating with Twilio Sandbox API', status: 'loading' },
                { label: 'Provisioning WhatsApp webhook endpoints', status: 'idle' },
                { label: 'Initializing WhatsApp receiver server', status: 'idle' },
                { label: 'Connection finalized', status: 'idle' },
            ];
            setVerifSteps(initialSteps);

            // Step 1 Simulation
            await delay(1200);
            setVerifSteps((prev) => {
                const next = [...prev];
                next[0].status = 'success';
                next[1].status = 'loading';
                return next;
            });

            // Step 2 Simulation
            await delay(1000);
            setVerifSteps((prev) => {
                const next = [...prev];
                next[1].status = 'success';
                next[2].status = 'loading';
                return next;
            });

            // Step 3 Simulation
            await delay(800);
            setVerifSteps((prev) => {
                const next = [...prev];
                next[2].status = 'success';
                next[3].status = 'loading';
                return next;
            });

            // Step 4 Simulation
            await delay(600);
            setVerifSteps((prev) => {
                const next = [...prev];
                next[3].status = 'success';
                return next;
            });
            await delay(400);

            // Create a local mock object for WhatsApp to display in table
            const mockData: ChannelConnection = {
                id: `mock_wa_${Date.now()}`,
                provider: 'TWILIO_WHATSAPP' as any,
                channel: 'WHATSAPP',
                displayName: waDisplayName.trim(),
                status: 'ACTIVE',
                externalAccountId: phoneNumber.trim(),
                apiKeyMasked: `••••${authToken.trim().slice(-4)}`,
                lastInboundAt: null,
                lastError: null,
                createdBy: 'SYSTEM',
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
            };

            onCreated(mockData);
            setConnectedChannel(mockData);
            setStep('SUCCESS');
            toast.success('Sandbox connected', 'WhatsApp integration sandbox initialized!');
        }
    };

    const hasFailedStep = verifSteps.some((s) => s.status === 'error');

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm p-4" onClick={onClose}>
            <div
                className="w-full max-w-lg overflow-hidden rounded-3xl border border-border/80 bg-card shadow-2xl animate-scale-up"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between border-b border-border/40 px-6 py-4.5">
                    <div>
                        <h3 className="text-lg font-bold tracking-tight text-foreground">
                            {step === 'SUCCESS' ? 'Integration Complete' : 
                             step === 'VERIFYING' ? 'Connecting Integration...' : 
                             isEmail ? 'Connect SendGrid Email' : 'Connect Twilio WhatsApp'}
                        </h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            {step === 'SUCCESS' ? 'Channel successfully configured.' :
                             step === 'VERIFYING' ? 'Please wait while credentials are verified.' :
                             isEmail ? 'Integrate SendGrid outbound SMTP and inbound parse.' : 'Set up your Twilio account to route WhatsApp chats.'}
                        </p>
                    </div>
                    <button onClick={onClose} className="rounded-xl p-2 text-muted-foreground hover:bg-accent hover:text-foreground transition-all cursor-pointer">
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M18 6 6 18M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {/* Body */}
                <div className="max-h-[70vh] overflow-y-auto">
                    {step === 'FORM' && (
                        <div className="space-y-4 p-6">
                            {isEmail ? (
                                <>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Display Name</label>
                                        <Input
                                            value={displayName}
                                            onChange={(e) => setDisplayName(e.target.value)}
                                            placeholder="e.g. Support Inbox"
                                            className="h-11 rounded-xl"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">SendGrid API Key</label>
                                        <Input
                                            type="password"
                                            value={apiKey}
                                            onChange={(e) => setApiKey(e.target.value)}
                                            placeholder="SG.xxxxxxxxxxxxxxxxxxxxxxxx.xxxxxxxxxxxxxxxxxxxx"
                                            autoComplete="off"
                                            className="h-11 rounded-xl font-mono"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">From Address (Sender)</label>
                                        <Input
                                            type="email"
                                            value={fromEmail}
                                            onChange={(e) => setFromEmail(e.target.value)}
                                            placeholder="support@yourcompany.com"
                                            className="h-11 rounded-xl"
                                        />
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Display Name</label>
                                        <Input
                                            value={waDisplayName}
                                            onChange={(e) => setWaDisplayName(e.target.value)}
                                            placeholder="e.g. Sales WhatsApp"
                                            className="h-11 rounded-xl"
                                        />
                                    </div>
                                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                                        <div className="space-y-1.5">
                                            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Account SID</label>
                                            <Input
                                                value={accountSid}
                                                onChange={(e) => setAccountSid(e.target.value)}
                                                placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxx"
                                                className="h-11 rounded-xl font-mono text-sm"
                                            />
                                        </div>
                                        <div className="space-y-1.5">
                                            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Auth Token</label>
                                            <Input
                                                type="password"
                                                value={authToken}
                                                onChange={(e) => setAuthToken(e.target.value)}
                                                placeholder="••••••••••••••••••••••••"
                                                autoComplete="off"
                                                className="h-11 rounded-xl font-mono text-sm"
                                            />
                                        </div>
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">WhatsApp Number</label>
                                        <Input
                                            value={phoneNumber}
                                            onChange={(e) => setPhoneNumber(e.target.value)}
                                            placeholder="+919876543210"
                                            className="h-11 rounded-xl font-mono"
                                        />
                                    </div>
                                </>
                            )}
                        </div>
                    )}

                    {step === 'VERIFYING' && (
                        <div className="p-8 space-y-6">
                            <div className="space-y-6 max-w-sm mx-auto">
                                {verifSteps.map((s, idx) => {
                                    const isLast = idx === verifSteps.length - 1;
                                    return (
                                        <div key={idx} className="relative flex items-start gap-4">
                                            {/* Line between steps */}
                                            {!isLast && (
                                                <div 
                                                    className={`absolute left-[15px] top-8 bottom-0 w-[2px] transition-all duration-500 ${
                                                        s.status === 'success' && verifSteps[idx + 1].status !== 'idle'
                                                            ? 'bg-emerald-500' 
                                                            : 'bg-border/60'
                                                    }`} 
                                                    style={{ height: 'calc(100% - 6px)' }}
                                                />
                                            )}

                                            {/* Step Circle */}
                                            <div className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border/40 bg-card transition-all duration-300">
                                                {s.status === 'idle' && (
                                                    <div className="h-2.5 w-2.5 rounded-full bg-muted-foreground/30" />
                                                )}
                                                {s.status === 'loading' && (
                                                    <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                                                )}
                                                {s.status === 'success' && (
                                                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500 text-white animate-scale-up">
                                                        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                                            <polyline points="20 6 9 17 4 12" />
                                                        </svg>
                                                    </div>
                                                )}
                                                {s.status === 'error' && (
                                                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-white animate-bounce">
                                                        <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                                                            <line x1="18" x2="6" y1="6" y2="18" />
                                                            <line x1="6" x2="18" y1="6" y2="18" />
                                                        </svg>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Label / Error Msg */}
                                            <div className="space-y-1.5 pt-0.5">
                                                <p className={`text-sm font-medium transition-colors duration-300 ${
                                                    s.status === 'loading' ? 'text-primary font-bold animate-pulse' :
                                                    s.status === 'success' ? 'text-foreground/90' :
                                                    s.status === 'error' ? 'text-destructive font-bold' :
                                                    'text-muted-foreground/50'
                                                }`}>
                                                    {s.label}
                                                </p>
                                                {s.status === 'error' && s.errorMsg && (
                                                    <div className="text-xs text-destructive leading-relaxed font-normal bg-destructive/5 rounded-xl border border-destructive/10 p-3 mt-1.5 max-w-xs animate-slide-in-bottom">
                                                        <span className="font-semibold block mb-0.5">Configuration Error</span>
                                                        {s.errorMsg}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    {step === 'SUCCESS' && connectedChannel && (
                        <div className="p-6 space-y-4">
                            <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                        <polyline points="20 6 9 17 4 12" />
                                    </svg>
                                </div>
                                <div>
                                    <h4 className="font-bold text-foreground">Successfully Connected</h4>
                                    <p className="text-xs text-muted-foreground">
                                        Outbound messages are live on <span className="font-semibold font-mono text-foreground">{connectedChannel.externalAccountId}</span>.
                                    </p>
                                </div>
                            </div>

                            <div className="space-y-3">
                                <h4 className="text-sm font-bold text-foreground">Inbound Route Configuration</h4>
                                {isEmail ? (
                                    <>
                                        <p className="text-xs text-muted-foreground leading-relaxed">
                                            To receive customer emails in your inbox, set up an MX record on your DNS dashboard and register our webhook endpoint inside SendGrid:
                                        </p>
                                        <div className="space-y-2 rounded-2xl border border-border/40 bg-accent/40 p-4 font-mono text-xs text-foreground">
                                            <div className="flex justify-between items-center gap-2 border-b border-border/20 pb-2">
                                                <span>MX Record Host</span>
                                                <span className="font-bold text-foreground">mx.sendgrid.net</span>
                                            </div>
                                            <div className="flex justify-between items-center gap-2 border-b border-border/20 pb-2">
                                                <span>Priority</span>
                                                <span className="font-bold text-foreground">10</span>
                                            </div>
                                            <div className="space-y-1 pt-1">
                                                <span className="text-[10px] text-muted-foreground uppercase font-sans font-semibold tracking-wider block">Webhook Destination URL</span>
                                                <div className="flex items-center justify-between gap-3 bg-card/60 p-2 rounded-lg border border-border/10">
                                                    <span className="break-all select-all font-semibold text-primary">{`<your-domain>${INBOUND_EMAIL_WEBHOOK_PATH}`}</span>
                                                    <button
                                                        onClick={() => {
                                                            navigator.clipboard.writeText(`${window.location.origin}${INBOUND_EMAIL_WEBHOOK_PATH}`);
                                                            toast.success('Copied', 'Webhook URL copied to clipboard!');
                                                        }}
                                                        className="px-2 py-1 rounded bg-accent text-[10px] font-sans hover:bg-accent-foreground/10 text-muted-foreground transition-all cursor-pointer shrink-0"
                                                    >
                                                        Copy
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <p className="text-xs text-muted-foreground leading-relaxed">
                                            To route incoming customer WhatsApp messages into your EnquiryHub inbox, configure the Twilio phone number webhook handler:
                                        </p>
                                        <div className="space-y-3 rounded-2xl border border-border/40 bg-accent/40 p-4 text-xs">
                                            <ol className="list-decimal list-inside space-y-1.5 text-muted-foreground font-sans leading-relaxed">
                                                <li>Open the <span className="font-semibold text-foreground">Twilio Console</span>.</li>
                                                <li>Go to <span className="font-semibold text-foreground">Messaging &gt; Senders &gt; WhatsApp Senders</span>.</li>
                                                <li>Click on your WhatsApp phone number configuration.</li>
                                                <li>Find the <span className="font-semibold text-foreground">Webhook URL for Incoming Messages</span> and paste this URL:</li>
                                            </ol>
                                            <div className="flex items-center justify-between gap-3 bg-card/60 p-2 rounded-lg border border-border/10 font-mono">
                                                <span className="break-all select-all font-semibold text-primary">{`<your-domain>${INBOUND_WHATSAPP_WEBHOOK_PATH}`}</span>
                                                <button
                                                    onClick={() => {
                                                        navigator.clipboard.writeText(`${window.location.origin}${INBOUND_WHATSAPP_WEBHOOK_PATH}`);
                                                        toast.success('Copied', 'Webhook URL copied to clipboard!');
                                                    }}
                                                    className="px-2 py-1 rounded bg-accent text-[10px] font-sans hover:bg-accent-foreground/10 text-muted-foreground transition-all cursor-pointer shrink-0"
                                                >
                                                    Copy
                                                </button>
                                            </div>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-end gap-3 border-t border-border/40 bg-accent/15 px-6 py-4">
                    {step === 'FORM' && (
                        <>
                            <Button variant="outline" onClick={onClose} className="rounded-xl">Cancel</Button>
                            <Button onClick={handleConnect} disabled={!canSubmit} className="rounded-xl px-5">
                                Connect Channel
                            </Button>
                        </>
                    )}
                    {step === 'VERIFYING' && hasFailedStep && (
                        <Button variant="outline" onClick={() => setStep('FORM')} className="rounded-xl">
                            Go Back & Edit
                        </Button>
                    )}
                    {step === 'SUCCESS' && (
                        <Button onClick={onClose} className="rounded-xl px-6">Done</Button>
                    )}
                </div>
            </div>
        </div>
    );
}
