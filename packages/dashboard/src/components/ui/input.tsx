import type { InputHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        'h-7 w-full rounded-md border border-line bg-app px-2.5 font-mono text-xs text-accent',
        'placeholder:text-fg-muted focus:border-accent focus:outline-none',
        className,
      )}
      {...props}
    />
  );
}
