'use client';

import { useState, useEffect, useCallback } from 'react';
import styles from '@/styles/MessageToast.module.css';

export interface ToastMessage {
    id: string;
    contactName: string;
    message: string;
    contactId: string;
    timestamp: Date;
}

interface MessageToastProps {
    toasts: ToastMessage[];
    onDismiss: (id: string) => void;
    onClickToast: (contactId: string) => void;
}

export default function MessageToast({ toasts, onDismiss, onClickToast }: MessageToastProps) {
    // Auto-dismiss after 4 seconds
    useEffect(() => {
        const timers = toasts.map((toast) =>
            setTimeout(() => onDismiss(toast.id), 4000)
        );
        return () => timers.forEach(clearTimeout);
    }, [toasts, onDismiss]);

    if (toasts.length === 0) return null;

    return (
        <div className={styles.toastContainer}>
            {toasts.map((toast) => (
                <div
                    key={toast.id}
                    className={styles.toast}
                    onClick={() => {
                        onClickToast(toast.contactId);
                        onDismiss(toast.id);
                    }}
                >
                    {/* Avatar */}
                    <div className={styles.toastAvatar}>
                        {toast.contactName.charAt(0).toUpperCase()}
                    </div>

                    {/* Content */}
                    <div className={styles.toastContent}>
                        <div className={styles.toastHeader}>
                            <span className={styles.toastName}>{toast.contactName}</span>
                            <span className={styles.toastTime}>now</span>
                        </div>
                        <p className={styles.toastMessage}>{toast.message}</p>
                    </div>

                    {/* Close button */}
                    <button
                        className={styles.toastClose}
                        onClick={(e) => {
                            e.stopPropagation();
                            onDismiss(toast.id);
                        }}
                    >
                        ✕
                    </button>
                </div>
            ))}
        </div>
    );
}
