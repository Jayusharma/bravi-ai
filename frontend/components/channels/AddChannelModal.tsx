'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { createChannel, type ChannelConnection } from '@/services/channel';

interface AddChannelModalProps {
    provider: 'SENDGRID_EMAIL' | 'META_WHATSAPP';
    onCreated: (channel: ChannelConnection) => void;
    onClose: () => void;
}

interface VerificationStep {
    label: string;
    status: 'idle' | 'loading' | 'success' | 'error';
    errorMsg?: string;
}

const INBOUND_EMAIL_WEBHOOK_PATH = '/api/v1/webhook/email';
const INBOUND_META_WEBHOOK_PATH = '/api/v1/webhook/whatsapp/meta'; // Meta's "Callback URL"

export function AddChannelModal({ provider, onCreated, onClose }: AddChannelModalProps) {
    const toast = useToast();
    const [step, setStep] = useState<'FORM' | 'VERIFYING' | 'SUCCESS'>('FORM');

    // --- Form States ---
    // Email
    const [displayName, setDisplayName] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [fromEmail, setFromEmail] = useState('');
    const [verificationKey, setVerificationKey] = useState('');

    // WhatsApp (Meta Cloud API)
    const [metaDisplayName, setMetaDisplayName] = useState('');
    const [phoneNumberId, setPhoneNumberId] = useState('');
    const [accessToken, setAccessToken] = useState('');
    const [verifyToken, setVerifyToken] = useState('');
    const [appSecret, setAppSecret] = useState('');

    // --- Verification States ---
    const [verifSteps, setVerifSteps] = useState<VerificationStep[]>([]);
    const [connectedChannel, setConnectedChannel] = useState<ChannelConnection | null>(null);

    const isEmail = provider === 'SENDGRID_EMAIL';

    // Validation checks
    const canSubmitEmail = displayName.trim().length >= 2 && apiKey.trim().length >= 10 && fromEmail.trim().length > 0;
    const canSubmitMeta = metaDisplayName.trim().length >= 2 && phoneNumberId.trim().length >= 5 && accessToken.trim().length >= 10 && verifyToken.trim().length >= 6;
    const canSubmit = isEmail ? canSubmitEmail : canSubmitMeta;

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
                    verificationKey: verificationKey.trim() || undefined,
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
            // Real Meta Cloud API connection — mirrors the email flow: one real backend call
            // (validates the token against graph.facebook.com + stores encrypted), rest is pacing.
            const initialSteps: VerificationStep[] = [
                { label: 'Validating credentials with Meta Graph API', status: 'loading' },
                { label: 'Encrypting & storing channel credentials', status: 'idle' },
                { label: 'Registering webhook verify token', status: 'idle' },
                { label: 'Connection finalized', status: 'idle' },
            ];
            setVerifSteps(initialSteps);

            try {
                // Step 1: real validation & DB save — backend pings graph.facebook.com with the token
                const result = await createChannel({
                    provider: 'META_WHATSAPP',
                    displayName: metaDisplayName.trim(),
                    phoneNumberId: phoneNumberId.trim(),
                    accessToken: accessToken.trim(),
                    verifyToken: verifyToken.trim(),
                    appSecret: appSecret.trim() || undefined,
                });

                if (!result.success) {
                    setVerifSteps((prev) => {
                        const next = [...prev];
                        next[0].status = 'error';
                        next[0].errorMsg = result.error ?? 'Meta rejected the credentials. Check the Phone Number ID and Access Token.';
                        return next;
                    });
                    return;
                }

                // Steps 2-4: cosmetic pacing, the work already happened server-side
                setVerifSteps((prev) => {
                    const next = [...prev];
                    next[0].status = 'success';
                    next[1].status = 'loading';
                    return next;
                });
                await delay(900);

                setVerifSteps((prev) => {
                    const next = [...prev];
                    next[1].status = 'success';
                    next[2].status = 'loading';
                    return next;
                });
                await delay(800);

                setVerifSteps((prev) => {
                    const next = [...prev];
                    next[2].status = 'success';
                    next[3].status = 'loading';
                    return next;
                });
                await delay(600);

                setVerifSteps((prev) => {
                    const next = [...prev];
                    next[3].status = 'success';
                    return next;
                });
                await delay(400);

                onCreated(result.data!);
                setConnectedChannel(result.data);
                setStep('SUCCESS');
                toast.success('Channel connected', 'WhatsApp (Meta) successfully authorized!');
            } catch (err: any) {
                setVerifSteps((prev) => {
                    const next = [...prev];
                    next[0].status = 'error';
                    next[0].errorMsg = err.message ?? 'An unexpected network error occurred.';
                    return next;
                });
            }
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
                             isEmail ? 'Connect SendGrid Email' : 'Connect WhatsApp (Meta)'}
                        </h3>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            {step === 'SUCCESS' ? 'Channel successfully configured.' :
                             step === 'VERIFYING' ? 'Please wait while credentials are verified.' :
                             isEmail ? 'Integrate SendGrid outbound SMTP and inbound parse.' : 'Connect the official WhatsApp Cloud API from your Meta App.'}
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
                                    <div className="space-y-1.5">
                                        <div className="flex items-center justify-between">
                                            <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Event Webhook Verification Key (Optional)</label>
                                            <span className="text-[10px] text-muted-foreground">SendGrid → Mail Settings → Event Webhooks</span>
                                        </div>
                                        <Input
                                            type="password"
                                            value={verificationKey}
                                            onChange={(e) => setVerificationKey(e.target.value)}
                                            placeholder="MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE..."
                                            autoComplete="off"
                                            className="h-11 rounded-xl font-mono text-xs"
                                        />
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Display Name</label>
                                        <Input
                                            value={metaDisplayName}
                                            onChange={(e) => setMetaDisplayName(e.target.value)}
                                            placeholder="e.g. Sales WhatsApp"
                                            className="h-11 rounded-xl"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Phone Number ID</label>
                                        <Input
                                            value={phoneNumberId}
                                            onChange={(e) => setPhoneNumberId(e.target.value)}
                                            placeholder="112233445566778 (Meta App → WhatsApp → API Setup)"
                                            className="h-11 rounded-xl font-mono text-sm"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Access Token</label>
                                        <Input
                                            type="password"
                                            value={accessToken}
                                            onChange={(e) => setAccessToken(e.target.value)}
                                            placeholder="EAAG••••••••••••••••••••"
                                            autoComplete="off"
                                            className="h-11 rounded-xl font-mono text-sm"
                                        />
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Verify Token <span className="normal-case font-normal">(you invent this — any secret string)</span></label>
                                        <Input
                                            value={verifyToken}
                                            onChange={(e) => setVerifyToken(e.target.value)}
                                            placeholder="e.g. my-webhook-secret-2026"
                                            autoComplete="off"
                                            className="h-11 rounded-xl font-mono text-sm"
                                        />
                                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                                            You&apos;ll paste this same token into Meta&apos;s webhook settings after connecting — Meta uses it to prove it&apos;s talking to your server.
                                        </p>
                                    </div>
                                    <div className="space-y-1.5">
                                        <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">App Secret <span className="normal-case font-normal">(Meta App → App Settings → Basic)</span></label>
                                        <Input
                                            type="password"
                                            value={appSecret}
                                            onChange={(e) => setAppSecret(e.target.value)}
                                            placeholder="e.g. 8f9b2a1c4e7d..."
                                            autoComplete="off"
                                            className="h-11 rounded-xl font-mono text-sm"
                                        />
                                        <p className="text-[11px] text-muted-foreground leading-relaxed">
                                            Used to cryptographically verify incoming webhook payloads (HMAC SHA-256).
                                        </p>
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
                                            One last step, inside your Meta App dashboard: register this webhook so Meta starts pushing incoming WhatsApp messages to EnquiryHub.
                                        </p>
                                        <div className="space-y-3 rounded-2xl border border-border/40 bg-accent/40 p-4 text-xs">
                                            <ol className="list-decimal list-inside space-y-1.5 text-muted-foreground font-sans leading-relaxed">
                                                <li>Open <span className="font-semibold text-foreground">developers.facebook.com</span> → your App.</li>
                                                <li>Go to <span className="font-semibold text-foreground">WhatsApp &gt; Configuration &gt; Webhook</span> → click Edit.</li>
                                                <li>Paste the <span className="font-semibold text-foreground">Callback URL</span> and <span className="font-semibold text-foreground">Verify Token</span> below, then click <span className="font-semibold text-foreground">Verify and Save</span>.</li>
                                                <li>Under Webhook fields, <span className="font-semibold text-foreground">Subscribe to &quot;messages&quot;</span>.</li>
                                            </ol>
                                            <div className="space-y-1 pt-1">
                                                <span className="text-[10px] text-muted-foreground uppercase font-sans font-semibold tracking-wider block">Callback URL</span>
                                                <div className="flex items-center justify-between gap-3 bg-card/60 p-2 rounded-lg border border-border/10 font-mono">
                                                    <span className="break-all select-all font-semibold text-primary">{`<your-domain>${INBOUND_META_WEBHOOK_PATH}`}</span>
                                                    <button
                                                        onClick={() => {
                                                            navigator.clipboard.writeText(`${window.location.origin}${INBOUND_META_WEBHOOK_PATH}`);
                                                            toast.success('Copied', 'Callback URL copied to clipboard!');
                                                        }}
                                                        className="px-2 py-1 rounded bg-accent text-[10px] font-sans hover:bg-accent-foreground/10 text-muted-foreground transition-all cursor-pointer shrink-0"
                                                    >
                                                        Copy
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="space-y-1">
                                                <span className="text-[10px] text-muted-foreground uppercase font-sans font-semibold tracking-wider block">Verify Token (the one you just chose)</span>
                                                <div className="flex items-center justify-between gap-3 bg-card/60 p-2 rounded-lg border border-border/10 font-mono">
                                                    <span className="break-all select-all font-semibold text-primary">{verifyToken}</span>
                                                    <button
                                                        onClick={() => {
                                                            navigator.clipboard.writeText(verifyToken);
                                                            toast.success('Copied', 'Verify token copied to clipboard!');
                                                        }}
                                                        className="px-2 py-1 rounded bg-accent text-[10px] font-sans hover:bg-accent-foreground/10 text-muted-foreground transition-all cursor-pointer shrink-0"
                                                    >
                                                        Copy
                                                    </button>
                                                </div>
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
