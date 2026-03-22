'use client';

import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useState,
    ReactNode,
} from 'react';

type Theme = 'light' | 'dark' | 'system';

interface ThemeContextValue {
    theme: Theme;
    resolvedTheme: 'light' | 'dark';
    setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = 'enquiry-hub-theme';

/**
 * ThemeProvider — manages dark/light mode with:
 *  - localStorage persistence
 *  - Class-based toggle (adds/removes .dark on <html>)
 *  - System preference detection when set to 'system'
 *  - Prevents FOUC with a blocking script in layout
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
    const [theme, setThemeState] = useState<Theme>('system');
    const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light');

    // Resolve the actual theme (system → light/dark)
    const resolveTheme = useCallback((t: Theme): 'light' | 'dark' => {
        if (t === 'system') {
            return window.matchMedia('(prefers-color-scheme: dark)').matches
                ? 'dark'
                : 'light';
        }
        return t;
    }, []);

    // Apply theme to DOM
    const applyTheme = useCallback(
        (t: Theme) => {
            const resolved = resolveTheme(t);
            const root = document.documentElement;

            root.classList.remove('light', 'dark');
            root.classList.add(resolved);

            setResolvedTheme(resolved);
        },
        [resolveTheme],
    );

    // Initialize on mount
    useEffect(() => {
        const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
        const initial = stored || 'system';
        setThemeState(initial);
        applyTheme(initial);
    }, [applyTheme]);

    // Listen for system preference changes when theme is 'system'
    useEffect(() => {
        if (theme !== 'system') return;

        const mq = window.matchMedia('(prefers-color-scheme: dark)');
        const handler = () => applyTheme('system');
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, [theme, applyTheme]);

    // Set theme
    const setTheme = useCallback(
        (t: Theme) => {
            setThemeState(t);
            localStorage.setItem(STORAGE_KEY, t);
            applyTheme(t);
        },
        [applyTheme],
    );

    return (
        <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
            {children}
        </ThemeContext.Provider>
    );
}

export function useTheme() {
    const context = useContext(ThemeContext);
    if (!context) {
        throw new Error('useTheme must be used within a ThemeProvider');
    }
    return context;
}

/**
 * Script that runs BEFORE React hydrates to prevent FOUC (flash of unstyled content).
 * Add this as a raw <script> in layout.tsx.
 */
export function ThemeScript() {
    const script = `
    (function() {
      try {
        var t = localStorage.getItem('${STORAGE_KEY}') || 'system';
        var d = document.documentElement;
        d.classList.remove('light', 'dark');
        if (t === 'system') {
          d.classList.add(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        } else {
          d.classList.add(t);
        }
      } catch(e) {}
    })();
  `;

    return <script dangerouslySetInnerHTML={{ __html: script }} />;
}
