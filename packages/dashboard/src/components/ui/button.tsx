import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

/** shadcn 스타일 버튼 — 대시보드 팔레트 토큰 기반 variant */
const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center gap-1 rounded-md border text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-accent text-white hover:bg-accent/85',
        outline: 'border-line bg-panel text-fg hover:border-accent',
        ghost: 'border-line bg-transparent text-fg-muted hover:border-accent hover:text-fg',
        warn: 'border-warn bg-warn/15 text-warn hover:bg-warn/25',
      },
      size: {
        sm: 'h-7 px-2.5',
        md: 'h-9 px-4 text-sm',
        icon: 'h-6 px-1.5 text-[11px] leading-none',
      },
    },
    defaultVariants: { variant: 'outline', size: 'sm' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return (
    <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
