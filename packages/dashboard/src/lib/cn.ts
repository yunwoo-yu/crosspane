import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** 조건부 클래스 조합 + Tailwind 충돌 병합 (shadcn 관례) */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
