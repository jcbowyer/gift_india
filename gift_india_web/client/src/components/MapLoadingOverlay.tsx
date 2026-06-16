import { Loader2 } from 'lucide-react';

export function MapLoadingOverlay({ message }: { message: string }) {
  return (
    <div
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-xl border bg-[#eef4fb]/92 backdrop-blur-[1px]"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <Loader2 className="h-8 w-8 animate-spin text-[#1a2332]" aria-hidden />
      <p className="text-sm font-medium text-slate-600">{message}</p>
    </div>
  );
}
