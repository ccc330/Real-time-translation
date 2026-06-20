import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Segmented, type SegmentedOption } from '@/components/ui/segmented';
import type { TranslationProvider, TranslationProviderOption } from '@/types';
import { CircleHelp } from 'lucide-react';
import { SEGMENT_DELAY_MAX_MS, SEGMENT_DELAY_MIN_MS, SEGMENT_DELAY_STEP_MS } from '@/segment';

interface SettingsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  segment: number;
  onSegmentChange: (value: number) => void;
  translateProvider: TranslationProvider;
  translateProviders: TranslationProviderOption[];
  onTranslateProviderChange: (value: TranslationProvider) => void;
  sttModel: string | null;
  translateModel: string | null;
  mock: boolean;
}

const FALLBACK_PROVIDERS: TranslationProviderOption[] = [
  { id: 'mimo', label: '小米 MiMo UltraSpeed', model: 'mimo-v2.5-pro-ultraspeed', configured: false },
  { id: 'deepseek', label: 'DeepSeek V4 Flash', model: 'deepseek-v4-flash', configured: false },
];

const prettyTranslateModel = (m: string | null): string => {
  if (!m) return '—';
  if (m.startsWith('mimo')) return 'MiMo UltraSpeed';
  if (m.startsWith('deepseek')) return 'DeepSeek V4 Flash';
  if (m === 'soniox-builtin') return 'Soniox 内置';
  return m;
};

const shortProviderName = (id: TranslationProvider): string =>
  id === 'mimo' ? 'MiMo' : 'DeepSeek';

const providerTag = (provider: TranslationProviderOption): string => {
  if (provider.id === 'mimo') return 'UltraSpeed';
  if (provider.id === 'deepseek') return 'V4 Flash';
  return provider.model;
};

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between rounded-2xl bg-muted px-4 py-3.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-foreground">{value}</span>
    </div>
  );
}

export function SettingsPanel({
  open,
  onOpenChange,
  segment,
  onSegmentChange,
  translateProvider,
  translateProviders,
  onTranslateProviderChange,
  sttModel,
  translateModel,
  mock,
}: SettingsPanelProps) {
  const providerOptions = translateProviders.length ? translateProviders : FALLBACK_PROVIDERS;
  const selectedProvider = providerOptions.find((p) => p.id === translateProvider);
  const selectedModel = selectedProvider?.model ?? translateModel;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-5 rounded-3xl bg-card p-5 shadow-soft-lg ring-0 sm:max-w-md">
        <DialogTitle className="text-[13px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70">
          设置
        </DialogTitle>

        <div className="rounded-2xl bg-muted px-4 py-3.5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-muted-foreground">断句颗粒度</span>
            <CircleHelp className="size-3.5 shrink-0 text-muted-foreground/45" aria-hidden="true" />
          </div>

          <div className="mb-1.5 flex justify-between text-[12px] text-muted-foreground">
            <span>Faster</span>
            <span>Smarter</span>
          </div>
          <Slider
            value={[segment]}
            min={SEGMENT_DELAY_MIN_MS}
            max={SEGMENT_DELAY_MAX_MS}
            step={SEGMENT_DELAY_STEP_MS}
            onValueChange={(v) => onSegmentChange(v[0])}
            aria-label="断句颗粒度"
            aria-valuetext={`${segment} 毫秒`}
          />
        </div>

        <div className="rounded-2xl bg-muted px-4 py-3.5">
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <span className="text-sm font-medium text-foreground">翻译引擎</span>
            <span className="truncate text-[12px] text-muted-foreground">
              {prettyTranslateModel(selectedModel)}
            </span>
          </div>

          <Segmented
            ariaLabel="翻译引擎"
            value={translateProvider}
            onChange={onTranslateProviderChange}
            options={providerOptions.map((provider): SegmentedOption<TranslationProvider> => ({
              value: provider.id,
              label: shortProviderName(provider.id),
              sublabel: provider.configured ? providerTag(provider) : '未配置 Key',
            }))}
          />

          {!selectedProvider?.configured && (
            <p className="mt-2 text-[11px] text-muted-foreground/70">
              当前引擎未配置 Key 时，会回退到 Soniox 内置翻译。
            </p>
          )}
        </div>

        <Row label="语音识别" value={mock ? '演示模式' : (sttModel ?? '—')} />
      </DialogContent>
    </Dialog>
  );
}
