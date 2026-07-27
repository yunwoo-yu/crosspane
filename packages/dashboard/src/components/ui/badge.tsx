import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2 py-px text-[11px] leading-relaxed',
  {
    variants: {
      variant: {
        destructive: 'bg-danger font-semibold text-white',
        outline: 'border border-line text-fg-muted uppercase tracking-wider text-[10px]',
        success: 'bg-emerald-950 text-emerald-400',
      },
    },
    defaultVariants: { variant: 'outline' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
