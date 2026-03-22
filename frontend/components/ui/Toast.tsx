'use client';

import { useEffect, useState, createContext, useContext, useCallback, ReactNode } from 'react';

// ═══════════════════════════════════════════════════════════════════
// TOAST TYPES
// ═══════════════════════════════════════════════════════════════════

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
    id: string;
    type: ToastType;
    title: string;
    description?: string;
    duration?: number; // ms, default 5000
}

interface ToastContextValue {
    toasts: Toast[];
    addToast: (toast: Omit<Toast, 'id'>) => void;
    removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// ═══════════════════════════════════════════════════════════════════
// TOAST PROVIDER
// ═══════════════════════════════════════════════════════════════════

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
        const id = Math.random().toString(36).slice(2, 9);
        setToasts((prev) => [...prev, { ...toast, id }]);

        // Auto-dismiss
        const duration = toast.duration ?? 5000;
        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id));
        }, duration);
    }, []);

    const removeToast = useCallback((id: string) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    return (
        <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
            {children}
            <ToastContainer toasts={toasts} onDismiss={removeToast} />
        </ToastContext.Provider>
    );
}

// ═══════════════════════════════════════════════════════════════════
// HOOK
// ═══════════════════════════════════════════════════════════════════

export function useToast() {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }

    return {
        toast: context.addToast,
        success: (title: string, description?: string) =>
            context.addToast({ type: 'success', title, description }),
        error: (title: string, description?: string) =>
            context.addToast({ type: 'error', title, description, duration: 8000 }),
        warning: (title: string, description?: string) =>
            context.addToast({ type: 'warning', title, description }),
        info: (title: string, description?: string) =>
            context.addToast({ type: 'info', title, description }),
    };
}

// ═══════════════════════════════════════════════════════════════════
// TOAST CONTAINER (rendered at bottom-right)
// ═══════════════════════════════════════════════════════════════════

const TOAST_STYLES: Record<ToastType, { bg: string; border: string; icon: string }> = {
    success: {
        bg: 'bg-emerald-50 dark:bg-emerald-950/50',
        border: 'border-emerald-200 dark:border-emerald-800',
        icon: '✓',
    },
    error: {
        bg: 'bg-red-50 dark:bg-red-950/50',
        border: 'border-red-200 dark:border-red-800',
        icon: '✗',
    },
    warning: {
        bg: 'bg-amber-50 dark:bg-amber-950/50',
        border: 'border-amber-200 dark:border-amber-800',
        icon: '⚠',
    },
    info: {
        bg: 'bg-blue-50 dark:bg-blue-950/50',
        border: 'border-blue-200 dark:border-blue-800',
        icon: 'ℹ',
    },
};

const ICON_COLORS: Record<ToastType, string> = {
    success: 'text-emerald-600 dark:text-emerald-400',
    error: 'text-red-600 dark:text-red-400',
    warning: 'text-amber-600 dark:text-amber-400',
    info: 'text-blue-600 dark:text-blue-400',
};

function ToastContainer({
    toasts,
    onDismiss,
}: {
    toasts: Toast[];
    onDismiss: (id: string) => void;
}) {
    if (toasts.length === 0) return null;

    return (
        <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm w-full pointer-events-none">
            {toasts.map((toast) => {
                const style = TOAST_STYLES[toast.type];
                const iconColor = ICON_COLORS[toast.type];

                return (
                    <div
                        key={toast.id}
                        className={`pointer-events-auto rounded-lg border ${style.border} ${style.bg} p-4 shadow-lg animate-in slide-in-from-right-5 fade-in duration-200`}
                        role="alert"
                    >
                        <div className="flex items-start gap-3">
                            <span className={`text-sm font-bold mt-0.5 ${iconColor}`}>
                                {style.icon}
                            </span>
                            <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium">{toast.title}</p>
                                {toast.description && (
                                    <p className="text-xs text-muted-foreground mt-0.5">{toast.description}</p>
                                )}
                            </div>
                            <button
                                onClick={() => onDismiss(toast.id)}
                                className="text-muted-foreground hover:text-foreground text-sm shrink-0"
                            >
                                ✕
                            </button>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
