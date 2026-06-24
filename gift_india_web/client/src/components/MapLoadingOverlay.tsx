import { Loader2 } from 'lucide-react';

export function MapLoadingOverlay({
  message,
  step,
  totalSteps,
}: {
  message: string;
  step?: number;
  totalSteps?: number;
}) {
  const progress =
    step != null && totalSteps != null && totalSteps > 0 ? Math.round((step / totalSteps) * 100) : null;

  return (
    <div
      className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 rounded-xl border bg-[#eef4fb]/94 backdrop-blur-sm"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <Loader2 className="h-9 w-9 animate-spin text-[#24345b]" aria-hidden />
      <div className="space-y-2 text-center">
        <p className="text-sm font-semibold text-slate-700">{message}</p>
        {step != null && totalSteps != null && (
          <p className="text-xs text-slate-500">
            Step {step} of {totalSteps}
          </p>
        )}
      </div>
      {progress != null && (
        <div className="h-1.5 w-48 overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full bg-[#24345b] transition-[width] duration-500 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}
