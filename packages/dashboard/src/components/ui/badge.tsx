import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

const badgeVariants = cva('inline-flex h-4 items-center justify-center rounded-full leading-none', {
  variants: {
    variant: {
      destructive: 'min-w-4 bg-danger px-1.5 font-semibold text-[10px] text-white',
      outline: 'border border-line px-2 text-[10px] text-fg-muted uppercase tracking-wider',
      success: 'bg-emerald-950 px-2 text-[11px] text-emerald-400',
    },
  },
  defaultVariants: { variant: 'outline' },
});

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
