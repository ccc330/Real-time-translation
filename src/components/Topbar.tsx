import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConnectionStatus } from '@/types';
import { cn } from '@/lib/utils';

interface TopbarProps {
  status: ConnectionStatus;
  mockMode: boolean;
  hasMessages: boolean;
  segment: number;
  onSegmentChange: (value: number) => void;
  onClear: () => void;
}

function statusInfo(status: ConnectionStatus, mockMode: boolean) {
  if (status === 'error') return { dot: 'bg-destructive', label: '连接错误' };
  if (status === 'disconnected') return { dot: 'bg-muted-foreground/40', label: '已断开' };
  if (status === 'connecting' || status === 'connected' || status === 'initializing_gemini')
    return { dot: 'bg-amber-500 animate-pulse', label: '连接中…' };
  if (mockMode) return { dot: 'bg-amber-500', label: '演示模式' };
  return { dot: 'bg-emerald-500', label: '在线' };
}

export function Topbar({
  status,
  mockMode,
  hasMessages,
  segment,
  onSegmentChange,
  onClear,
}: TopbarProps) {
  const s = statusInfo(status, mockMode);

  return (
    <header className="flex h-12 shrink-0 items-center justify-between px-4 md:px-5">
      <div className="flex items-center gap-2.5">
        <span className="text-sm font-medium tracking-tight">实时翻译</span>
        <span className="flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1">
          <span className={cn('size-1.5 rounded-full', s.dot)} />
          <span className="text-[11px] font-medium text-muted-foreground">{s.label}</span>
        </span>
      </div>

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2" title="断句颗粒度：左=短句更跟手（快速/新闻），右=长句更完整（日常对话）">
          <span className="hidden text-[11px] text-muted-foreground/60 sm:inline">断句</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={segment}
            onChange={(e) => onSegmentChange(Number(e.target.value))}
            aria-label="断句颗粒度"
            className="h-1 w-20 cursor-pointer accent-foreground/70 md:w-28"
          />
        </label>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClear}
          disabled={!hasMessages}
          aria-label="清屏"
        >
          <Trash2 className="size-4" />
        </Button>
      </div>
    </header>
  );
}
