'use client';

import {
    createContext,
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

export function ThemeProvider({ children }: { children: ReactNode }) {
    const [theme, setTheme] = useState<Theme>(() => {
        if (typeof window === 'undefined') {
            return 'system';
        }

        const stored = window.localStorage.getItem(STORAGE_KEY);
        return stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
    });
    const [systemTheme, setSystemTheme] = useState<'light' | 'dark'>(() => {
        if (typeof window === 'undefined') {
            return 'light';
        }

        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    });
    const resolvedTheme = theme === 'system' ? systemTheme : theme;

    useEffect(() => {
        const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
        const syncSystemTheme = () => {
            setSystemTheme(mediaQuery.matches ? 'dark' : 'light');
        };

        mediaQuery.addEventListener('change', syncSystemTheme);
        return () => mediaQuery.removeEventListener('change', syncSystemTheme);
    }, []);

    useEffect(() => {
        const root = document.documentElement;
        root.classList.remove('light', 'dark');
        root.classList.add(resolvedTheme);
    }, [resolvedTheme]);

    const updateTheme = (value: Theme) => {
        setTheme(value);
        localStorage.setItem(STORAGE_KEY, value);
    };

    return (
        <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme: updateTheme }}>
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
