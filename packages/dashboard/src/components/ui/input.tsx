import type { InputHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-8 w-full rounded-lg border border-line bg-app px-3 font-mono text-fg text-xs transition-colors duration-150',
        'placeholder:text-fg-muted focus:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent/20',
        className,
      )}
      {...props}
    />
  );
}
