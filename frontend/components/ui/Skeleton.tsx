import { forwardRef, HTMLAttributes } from 'react';

export const Skeleton = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
    ({ className = '', ...props }, ref) => (
        <div
            ref={ref}
            className={`animate-pulse rounded-md bg-muted ${className}`}
            {...props}
        />
    ),
);
Skeleton.displayName = 'Skeleton';
