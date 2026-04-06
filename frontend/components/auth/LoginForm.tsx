'use client';

import { useActionState, useState } from 'react';
import { login } from '@/services/auth/login.service';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ThemeToggle } from '@/components/common';

// ═══════════════════════════════════════════════════════════════════
// Icons (inline SVG — no external deps)
// ═══════════════════════════════════════════════════════════════════

function EyeIcon({ className = '' }: { className?: string }) {
    return (
        <svg className={className} xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
            <circle cx="12" cy="12" r="3" />
        </svg>
    );
}

function EyeOffIcon({ className = '' }: { className?: string }) {
    return (
        <svg className={className} xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49" />
            <path d="M14.084 14.158a3 3 0 0 1-4.242-4.242" />
            <path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143" />
            <path d="m2 2 20 20" />
        </svg>
    );
}

function LockIcon({ className = '' }: { className?: string }) {
    return (
        <svg className={className} xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
    );
}

function UserIcon({ className = '' }: { className?: string }) {
    return (
        <svg className={className} xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
        </svg>
    );
}

function AlertIcon({ className = '' }: { className?: string }) {
    return (
        <svg className={className} xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" x2="12" y1="8" y2="12" />
            <line x1="12" x2="12.01" y1="16" y2="16" />
        </svg>
    );
}

function SpinnerIcon({ className = '' }: { className?: string }) {
    return (
        <svg className={`animate-spin ${className}`} xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a9 9 0 11-6.219-8.56" />
        </svg>
    );
}

// ═══════════════════════════════════════════════════════════════════
// LOGIN FORM COMPONENT
// ═══════════════════════════════════════════════════════════════════

export default function LoginForm() {
    const [showPassword, setShowPassword] = useState(false);

    const [state, formAction, pending] = useActionState(
        async (_prev: { error?: string }, formData: FormData) => {
            const result = await login(formData);
            if (!result.success) {
                return { error: result.error };
            }
            return {};
        },
        {} as { error?: string },
    );

    return (
        <div className="min-h-screen flex items-center justify-center bg-background relative overflow-hidden">
            {/* ── Theme toggle ── */}
            <div className="absolute top-5 right-5 z-20">
                <ThemeToggle />
            </div>

            {/* ── Ambient background orbs ── */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div
                    className="absolute -top-32 -right-32 w-[500px] h-[500px] rounded-full blur-[120px] opacity-[0.07]"
                    style={{ background: 'linear-gradient(135deg, hsl(var(--primary)), hsl(var(--chart-1)))' }}
                />
                <div
                    className="absolute -bottom-32 -left-32 w-[400px] h-[400px] rounded-full blur-[100px] opacity-[0.05]"
                    style={{ background: 'linear-gradient(135deg, hsl(var(--chart-2)), hsl(var(--primary)))' }}
                />
                {/* Subtle grid pattern */}
                <div
                    className="absolute inset-0 opacity-[0.015]"
                    style={{
                        backgroundImage: `radial-gradient(hsl(var(--foreground)) 1px, transparent 1px)`,
                        backgroundSize: '32px 32px',
                    }}
                />
            </div>

            {/* ── Main content ── */}
            <div className="relative z-10 w-full max-w-[420px] px-5">
                {/* Brand header */}
                <div className="text-center mb-8">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary text-primary-foreground text-2xl mb-5 shadow-lg shadow-primary/20 transition-transform hover:scale-105">
                        📩
                    </div>
                    <h1 className="text-2xl font-bold tracking-tight">
                        Welcome back
                    </h1>
                    <p className="text-sm text-muted-foreground mt-1.5">
                        Sign in to Enquiry Hub to continue
                    </p>
                </div>

                {/* Login card */}
                <div className="rounded-xl border bg-card text-card-foreground shadow-xl shadow-black/[0.03] dark:shadow-black/[0.15] backdrop-blur-sm">
                    <div className="p-7">
                        <form action={formAction} className="grid gap-5">
                            {/* Error alert */}
                            {state?.error && (
                                <div className="flex items-start gap-3 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive animate-slide-in-bottom">
                                    <AlertIcon className="shrink-0 mt-0.5" />
                                    <span className="leading-relaxed">{state.error}</span>
                                </div>
                            )}

                            {/* Username field */}
                            <div className="grid gap-2">
                                <label htmlFor="login-username" className="text-sm font-medium leading-none">
                                    Username
                                </label>
                                <div className="relative">
                                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                                        <UserIcon />
                                    </div>
                                    <Input
                                        id="login-username"
                                        name="username"
                                        autoComplete="username"
                                        placeholder="Enter your username"
                                        required
                                        disabled={pending}
                                        className="h-11 pl-10"
                                    />
                                </div>
                            </div>

                            {/* Password field */}
                            <div className="grid gap-2">
                                <label htmlFor="login-password" className="text-sm font-medium leading-none">
                                    Password
                                </label>
                                <div className="relative">
                                    <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                                        <LockIcon />
                                    </div>
                                    <Input
                                        id="login-password"
                                        name="password"
                                        type={showPassword ? 'text' : 'password'}
                                        autoComplete="current-password"
                                        placeholder="••••••••"
                                        required
                                        disabled={pending}
                                        className="h-11 pl-10 pr-11"
                                    />
                                    <button
                                        type="button"
                                        tabIndex={-1}
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                                    >
                                        {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                                    </button>
                                </div>
                            </div>

                            {/* Submit button */}
                            <Button
                                type="submit"
                                className="w-full h-11 mt-1 text-sm font-semibold tracking-wide"
                                disabled={pending}
                            >
                                {pending ? (
                                    <span className="flex items-center gap-2.5">
                                        <SpinnerIcon />
                                        Signing in...
                                    </span>
                                ) : (
                                    'Sign In'
                                )}
                            </Button>
                        </form>
                    </div>
                </div>

                {/* Footer */}
                <p className="text-center text-xs text-muted-foreground/60 mt-8">
                    Enquiry Hub v1.0 &bull; Enterprise Management System
                </p>
            </div>
        </div>
    );
}
