import { HTMLAttributes, forwardRef } from 'react';

interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
    fallback: string;
    src?: string | null;
    size?: 'sm' | 'md' | 'lg';
}

const sizeStyles: Record<string, string> = {
    sm: 'h-7 w-7 text-xs',
    md: 'h-9 w-9 text-sm',
    lg: 'h-11 w-11 text-base',
};

export const Avatar = forwardRef<HTMLDivElement, AvatarProps>(
    ({ className = '', fallback, src, size = 'md', ...props }, ref) => {
        const initials = fallback
            .split(' ')
            .map((n) => n[0])
            .join('')
            .toUpperCase()
            .slice(0, 2);

        return (
            <div
                ref={ref}
                className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted font-medium ${sizeStyles[size]} ${className}`}
                {...props}
            >
                {src ? (
                    <img src={src} alt={fallback} className="aspect-square h-full w-full object-cover" />
                ) : (
                    <span className="text-muted-foreground">{initials}</span>
                )}
            </div>
        );
    },
);
Avatar.displayName = 'Avatar';
