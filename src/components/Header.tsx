import React from 'react';
import { ConnectionStatus } from '../types';
import { Trash2, ShieldAlert, Sparkles } from 'lucide-react';

interface HeaderProps {
  status: ConnectionStatus;
  mockMode: boolean;
  onClear: () => void;
  hasMessages: boolean;
}

export const Header: React.FC<HeaderProps> = ({ status, mockMode, onClear, hasMessages }) => {
  const getStatusDisplay = () => {
    switch (status) {
      case 'disconnected':
        return { label: 'Disconnected', color: 'bg-neutral-700' };
      case 'connecting':
        return { label: 'Connecting...', color: 'bg-amber-500 animate-pulse' };
      case 'connected':
        return { label: 'Handshaking', color: 'bg-blue-500 animate-pulse' };
      case 'initializing_gemini':
        return { label: 'Setting up AI...', color: 'bg-purple-500 animate-pulse' };
      case 'ready':
        return { label: 'System Live', color: 'bg-blue-500' };
      case 'error':
        return { label: 'Session Error', color: 'bg-rose-500' };
      default:
        return { label: 'Offline', color: 'bg-neutral-800' };
    }
  };

  const currentStatus = getStatusDisplay();

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/5 bg-[#0a0a0a]/80 backdrop-blur-md transition-colors select-none">
      <div className="max-w-7xl mx-auto px-8 h-14 flex items-center justify-between">
        {/* Brand Block */}
        <div className="flex items-center space-x-3">
          <div className="w-5 h-5 rounded-full bg-white/10 flex items-center justify-center">
            <Sparkles className="w-3 h-3 text-white" />
          </div>
          <div className="flex flex-col">
            <h1 className="text-xs font-bold tracking-[0.15em] text-white uppercase">
              实时中英翻译
            </h1>
            <span className="text-[9px] font-mono text-neutral-500 uppercase tracking-widest leading-none mt-0.5">
              Dual Stream v1.2
            </span>
          </div>
        </div>

        {/* Sync & Connection Hub */}
        <div className="flex items-center space-x-4">
          {mockMode && (
            <div className="hidden sm:flex items-center space-x-1.5 px-3 py-1 rounded-full bg-amber-500/5 border border-amber-500/10">
              <ShieldAlert className="w-3 h-3 text-amber-500" />
              <span className="text-[10px] font-mono text-amber-500/80 uppercase tracking-widest">
                Mock Engine
              </span>
            </div>
          )}

          {/* Connection Pill */}
          <div className="flex items-center space-x-2 px-3 py-1 rounded-full bg-white/[0.02] border border-white/5">
            <span className={`w-1.5 h-1.5 rounded-full ${currentStatus.color}`} />
            <span className="text-[9px] font-mono font-bold tracking-widest uppercase text-neutral-400">
              {currentStatus.label}
            </span>
          </div>

          {/* Trash Clear Button */}
          <button
            onClick={onClear}
            disabled={!hasMessages}
            className={`p-2 rounded-full transition-all duration-200 ${
              hasMessages
                ? 'text-neutral-500 hover:text-white hover:bg-white/5 cursor-pointer active:scale-95'
                : 'text-neutral-800 cursor-not-allowed'
            }`}
            title="清空翻译历史 / Clear Feed"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {mockMode && (
        <div className="sm:hidden block w-full bg-amber-500/5 py-1.5 px-8 border-t border-white/5 text-center">
          <p className="text-[9px] font-mono text-amber-500/80 uppercase tracking-widest flex items-center justify-center space-x-1.5">
            <ShieldAlert className="w-3 h-3" />
            <span>Mock Engine (No API Key)</span>
          </p>
        </div>
      )}
    </header>
  );
};

