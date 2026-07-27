import { useCallback, useRef, useState } from 'react';

export interface ToastItem {
  id: number;
  text: string;
}

const TOAST_DURATION_MS = 2_400;

/** 하단 중앙 토스트 — 액션 피드백용 (자동 소멸, 최대 3개) */
export function useToasts() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const showToast = useCallback((text: string) => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev.slice(-2), { id, text }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, TOAST_DURATION_MS);
  }, []);
  return { toasts, showToast };
}

export function ToastStack({ toasts }: { toasts: ToastItem[] }) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" role="status" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast">
          {toast.text}
        </div>
      ))}
    </div>
  );
}
