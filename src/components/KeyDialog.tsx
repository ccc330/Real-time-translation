import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

interface KeyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  apiKey: string;
  onSave: (key: string) => void;
}

export function KeyDialog({ open, onOpenChange, apiKey, onSave }: KeyDialogProps) {
  const [value, setValue] = useState(apiKey);

  useEffect(() => {
    if (open) setValue(apiKey);
  }, [open, apiKey]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Gemini API Key</DialogTitle>
          <DialogDescription>
            粘贴你自己的 Gemini API Key。仅保存在本浏览器（localStorage），不会上传到任何第三方。留空则使用演示模式。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-2 py-1">
          <Label htmlFor="api-key">API Key</Label>
          <Input
            id="api-key"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="AIza…  /  AQ.…"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSave(value.trim());
            }}
          />
          <p className="text-xs text-muted-foreground">
            在 <span className="font-medium">Google AI Studio</span> 生成，需已开通 Live API 访问权限。
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={() => onSave('')}>
            清除
          </Button>
          <Button onClick={() => onSave(value.trim())}>保存并连接</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
