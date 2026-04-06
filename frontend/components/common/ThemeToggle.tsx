'use client';

import { useSyncExternalStore } from 'react';
import { useTheme } from './ThemeProvider';

/**
 * Dark/Light mode toggle button — matches shadcn style.
 * Cycles through: light → dark → system
 */
export function ThemeToggle() {
    const { theme, resolvedTheme, setTheme } = useTheme();
    const mounted = useSyncExternalStore(
        () => () => {},
        () => true,
        () => false,
    );

    const toggleTheme = () => {
        setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
    };

    return (
        <button
            onClick={toggleTheme}
            className="relative inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
            title={mounted ? `Theme: ${theme} (${resolvedTheme})` : 'Toggle theme'}
        >
            {/* Sun icon — visible in dark mode */}
            <svg
                className="h-4 w-4 rotate-0 scale-100 transition-transform dark:-rotate-90 dark:scale-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2" /><path d="M12 20v2" />
                <path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" />
                <path d="M2 12h2" /><path d="M20 12h2" />
                <path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />
            </svg>
            {/* Moon icon — visible in light mode */}
            <svg
                className="absolute h-4 w-4 rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
            >
                <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
            </svg>
            <span className="sr-only">Toggle theme</span>
        </button>
    );
}
