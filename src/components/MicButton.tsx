import { Mic, Square, Loader2 } from 'lucide-react';
import { ConnectionStatus } from '@/types';
import { cn } from '@/lib/utils';

interface MicButtonProps {
  isRecording: boolean;
  status: ConnectionStatus;
  onClick: () => void;
}

export function MicButton({ isRecording, status, onClick }: MicButtonProps) {
  const isPending = status === 'connecting' || status === 'connected' || status === 'initializing_gemini';
  const isDisabled = status === 'disconnected' || status === 'error';

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      aria-label={isRecording ? '停止聆听' : '开始聆听'}
      className={cn(
        'relative grid size-16 place-items-center rounded-full border shadow-sm outline-none transition-all',
        'focus-visible:ring-3 focus-visible:ring-ring/50 active:translate-y-px',
        isDisabled && 'cursor-not-allowed border-border bg-muted text-muted-foreground',
        !isDisabled && isRecording && 'border-transparent bg-destructive text-white',
        !isDisabled && !isRecording && 'border-transparent bg-primary text-primary-foreground hover:bg-primary/90',
      )}
    >
      {isRecording && (
        <span className="absolute inset-0 animate-ping rounded-full border border-destructive/40" />
      )}
      {isPending ? (
        <Loader2 className="size-6 animate-spin" />
      ) : isRecording ? (
        <Square className="size-5 fill-current" />
      ) : (
        <Mic className="size-6" />
      )}
    </button>
  );
}
