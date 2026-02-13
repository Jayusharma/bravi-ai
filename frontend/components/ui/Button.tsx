import { ButtonHTMLAttributes, forwardRef } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'default' | 'outline' | 'ghost' | 'destructive';
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className = '', variant = 'default', ...props }, ref) => {
        const baseStyles = "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 h-10 px-4 py-2 cursor-pointer";

        let variantStyles = "";
        if (variant === 'default') variantStyles = "bg-primary text-primary-foreground hover:bg-primary/90";
        else if (variant === 'destructive') variantStyles = "bg-destructive text-destructive-foreground hover:bg-destructive/90";
        else if (variant === 'outline') variantStyles = "border border-input bg-background hover:bg-accent hover:text-accent-foreground";
        else if (variant === 'ghost') variantStyles = "hover:bg-accent hover:text-accent-foreground";

        return (
            <button
                ref={ref}
                className={`${baseStyles} ${variantStyles} ${className}`}
                {...props}
            />
        );
    }
);
Button.displayName = "Button";
