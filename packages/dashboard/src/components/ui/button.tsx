import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

/** shadcn 스타일 버튼 — 대시보드 팔레트 토큰 기반 variant */
const buttonVariants = cva(
  'inline-flex cursor-pointer select-none items-center justify-center gap-1.5 rounded-lg border font-medium text-xs transition-all duration-150 focus-visible:outline-2 focus-visible:outline-accent/70 focus-visible:outline-offset-1 active:scale-[0.96] disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-accent text-white hover:bg-accent/85',
        outline: 'border-line bg-panel-2 text-fg hover:border-accent/60',
        ghost: 'border-transparent bg-transparent text-fg-muted hover:bg-panel-2 hover:text-fg',
        /** 토글 칩/탭의 활성 상태 — 액센트 틴트 */
        active: 'border-accent/40 bg-accent/15 text-accent hover:bg-accent/20',
        warn: 'border-warn/50 bg-warn/15 text-warn hover:bg-warn/25',
      },
      size: {
        sm: 'h-7 px-2.5',
        md: 'h-9 px-4 text-sm',
        icon: 'h-7 px-2 text-[11px] leading-none',
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
