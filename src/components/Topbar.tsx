import { Trash2, SlidersHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConnectionStatus } from '@/types';
import { cn } from '@/lib/utils';

interface TopbarProps {
  status: ConnectionStatus;
  mockMode: boolean;
  hasMessages: boolean;
  onOpenSettings: () => void;
  onClear: () => void;
}

function statusInfo(status: ConnectionStatus, mockMode: boolean) {
  if (status === 'error') return { dot: 'bg-destructive', label: '连接错误' };
  if (status === 'disconnected') return { dot: 'bg-muted-foreground/40', label: '已断开' };
  if (status === 'connecting' || status === 'connected' || status === 'initializing_gemini')
    return { dot: 'bg-amber-500 animate-pulse', label: '连接中' };
  if (mockMode) return { dot: 'bg-brand', label: '演示模式' };
  return { dot: 'bg-emerald-500', label: '在线' };
}

export function Topbar({ status, mockMode, hasMessages, onOpenSettings, onClear }: TopbarProps) {
  const s = statusInfo(status, mockMode);

  return (
    <header className="flex h-14 shrink-0 items-center justify-between px-[var(--mbk-margin)]">
      <div className="flex items-center gap-2.5">
        <span className="text-[15px] font-semibold tracking-tight">实时翻译</span>
        <span className="flex items-center gap-1.5 rounded-full bg-card px-2.5 py-1 shadow-soft">
          <span className={cn('size-1.5 rounded-full', s.dot)} />
          <span className="text-[11px] font-medium text-muted-foreground">{s.label}</span>
        </span>
      </div>

      <div className="flex items-center gap-1.5">
        <Button
          variant="ghost"
          size="icon"
          onClick={onClear}
          disabled={!hasMessages}
          aria-label="清屏"
          className="rounded-full"
        >
          <Trash2 className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={onOpenSettings}
          aria-label="设置"
          className="rounded-full"
        >
          <SlidersHorizontal className="size-4" />
        </Button>
      </div>
    </header>
  );
}
