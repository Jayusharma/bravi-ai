import { HTMLAttributes, forwardRef } from 'react';

interface BadgeProps extends HTMLAttributes<HTMLDivElement> {
    variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning';
}

const variantStyles: Record<string, string> = {
    default: 'border-transparent bg-primary text-primary-foreground',
    secondary: 'border-transparent bg-secondary text-secondary-foreground',
    destructive: 'border-transparent bg-destructive text-destructive-foreground',
    outline: 'text-foreground border-border',
    success: 'border-transparent bg-success/15 text-success',
    warning: 'border-transparent bg-warning/15 text-warning',
};

export const Badge = forwardRef<HTMLDivElement, BadgeProps>(
    ({ className = '', variant = 'default', ...props }, ref) => {
        return (
            <div
                ref={ref}
                className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors ${variantStyles[variant] || variantStyles.default} ${className}`}
                {...props}
            />
        );
    }
);
Badge.displayName = 'Badge';
