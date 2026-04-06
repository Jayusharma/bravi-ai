'use client';

import { useState, createContext, useContext, useCallback, useRef, type ReactNode } from 'react';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
    id: string;
    type: ToastType;
    title: string;
    description?: string;
    duration?: number;
    dismissing?: boolean;
}

interface ToastContextValue {
    toasts: Toast[];
    addToast: (toast: Omit<Toast, 'id'>) => void;
    removeToast: (id: string) => void;
    success: (title: string, description?: string) => void;
    error: (title: string, description?: string) => void;
    warning: (title: string, description?: string) => void;
    info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

// ═══════════════════════════════════════════════════════════════════
// PROVIDER
// ═══════════════════════════════════════════════════════════════════

const MAX_TOASTS = 5;

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);
    const timerMap = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

    const removeToast = useCallback((id: string) => {
        setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, dismissing: true } : t)));
        setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== id));
            const timer = timerMap.current.get(id);
            if (timer) {
                clearTimeout(timer);
                timerMap.current.delete(id);
            }
        }, 200);
    }, []);

    const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
        const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const duration = toast.duration ?? (toast.type === 'error' ? 8000 : 5000);

        setToasts((prev) => {
            const updated = [...prev, { ...toast, id }];
            return updated.length > MAX_TOASTS ? updated.slice(-MAX_TOASTS) : updated;
        });

        const timer = setTimeout(() => removeToast(id), duration);
        timerMap.current.set(id, timer);
    }, [removeToast]);

    const success = useCallback(
        (title: string, description?: string) => addToast({ type: 'success', title, description }),
        [addToast],
    );
    const error = useCallback(
        (title: string, description?: string) => addToast({ type: 'error', title, description, duration: 8000 }),
        [addToast],
    );
    const warning = useCallback(
        (title: string, description?: string) => addToast({ type: 'warning', title, description }),
        [addToast],
    );
    const info = useCallback(
        (title: string, description?: string) => addToast({ type: 'info', title, description }),
        [addToast],
    );

    return (
        <ToastContext.Provider value={{ toasts, addToast, removeToast, success, error, warning, info }}>
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
    return context;
}

// ═══════════════════════════════════════════════════════════════════
// ICONS
// ═══════════════════════════════════════════════════════════════════

const ICONS: Record<ToastType, ReactNode> = {
    success: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
    ),
    error: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
        </svg>
    ),
    warning: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
    ),
    info: (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
        </svg>
    ),
};

// ═══════════════════════════════════════════════════════════════════
// TOAST CONTAINER — Bottom-right notification stack
// ═══════════════════════════════════════════════════════════════════

function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
    if (toasts.length === 0) return null;

    return (
        <div className="toast-container" aria-live="polite" aria-label="Notifications">
            {toasts.map((toast) => (
                <div
                    key={toast.id}
                    className={`toast-item toast-${toast.type} ${toast.dismissing ? 'toast-exit' : 'toast-enter'}`}
                    role="alert"
                >
                    <div className="toast-accent-bar" />
                    <div className="toast-body">
                        <span className="toast-icon">{ICONS[toast.type]}</span>
                        <div className="toast-text">
                            <p className="toast-title">{toast.title}</p>
                            {toast.description ? (
                                <p className="toast-desc">{toast.description}</p>
                            ) : null}
                        </div>
                        <button
                            onClick={() => onDismiss(toast.id)}
                            className="toast-dismiss"
                            aria-label="Dismiss"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M18 6 6 18" />
                                <path d="m6 6 12 12" />
                            </svg>
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}
