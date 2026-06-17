import React, { useEffect, useRef } from 'react';
import { TranslationMessage } from '../types';
import { motion, AnimatePresence } from 'motion/react';
import { Languages, Volume2, Sparkles } from 'lucide-react';

interface TranslationPanelProps {
  lang: 'en' | 'zh';
  messages: TranslationMessage[];
  activeId: string | null;
  hoveredId: string | null;
  onHoverId: (id: string | null) => void;
  isTranslating: boolean;
  panelTitle: string;
  panelSub: string;
}

export const TranslationPanel: React.FC<TranslationPanelProps> = ({
  lang,
  messages,
  activeId,
  hoveredId,
  onHoverId,
  isTranslating,
  panelTitle,
  panelSub
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  // Auto-scroll to center the active or latest transcription
  useEffect(() => {
    if (endRef.current) {
      endRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'start'
      });
    }
  }, [messages, activeId, isTranslating]);

  const getPanelText = (msg: TranslationMessage) => {
    if (lang === 'en') {
      return msg.originalLang === 'en' ? msg.originalText : msg.translatedText;
    } else {
      return msg.originalLang === 'zh' ? msg.originalText : msg.translatedText;
    }
  };

  const isOriginal = (msg: TranslationMessage) => {
    return msg.originalLang === lang;
  };

  return (
    <div className={`flex-1 flex flex-col min-h-0 bg-[#0a0a0a] overflow-hidden relative select-none ${
      lang === 'en' 
        ? 'border-b border-white/5 bg-gradient-to-t from-transparent to-white/[0.02]' 
        : 'bg-gradient-to-b from-transparent to-white/[0.01]'
    }`}>
      
      {/* Elegant Header Band */}
      <div className="absolute top-6 left-8 z-10 flex items-center space-x-4 pointer-events-none select-none">
        <span className="text-[10px] font-bold tracking-[0.21em] text-neutral-500 uppercase">
          {lang === 'en' ? 'English' : '中文'}
        </span>
      </div>

      {/* Decorative light bars - Top English side, ambient waves on bottom */}
      <div className="absolute top-6 right-8 z-10 pointer-events-none">
        {lang === 'en' && (
          <div className="flex items-center space-x-1.5 opacity-60">
            <div className={`w-1 h-3 bg-blue-500/40 rounded-full ${isTranslating ? 'animate-bounce' : ''}`}></div>
            <div className={`w-1 h-5 bg-blue-500 rounded-full ${isTranslating ? 'animate-bounce [animation-delay:0.2s]' : ''}`}></div>
            <div className={`w-1 h-2 bg-blue-500/30 rounded-full ${isTranslating ? 'animate-bounce [animation-delay:0.4s]' : ''}`}></div>
          </div>
        )}
      </div>

      {/* Bubble Feed Container */}
      <div 
        ref={containerRef}
        className="flex-grow overflow-y-auto px-8 sm:px-14 pt-[30vh] pb-[50vh] space-y-8 scrollbar-none scroll-smooth scroll-pt-[25vh]"
      >
        <AnimatePresence initial={false}>
          {messages.length === 0 && !activeId && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.45 }}
              exit={{ opacity: 0 }}
              className="h-full flex flex-col items-center justify-center text-center p-8 select-none"
            >
              <div className="p-4 rounded-full bg-white/[0.02] border border-white/5 text-neutral-600 mb-4">
                <Languages className="w-6 h-6 stroke-[1.25]" />
              </div>
              <p className="text-sm font-light tracking-wide text-neutral-400">
                {lang === 'en' ? 'Tap microphone below to speak...' : '点按下方的麦克风开始说话...'}
              </p>
            </motion.div>
          )}

          {messages.map((msg, idx) => {
            const text = getPanelText(msg);
            if (!text) return null;

            const original = isOriginal(msg);
            const isHovered = hoveredId === msg.id;
            
            const isActive = msg.id === activeId;
            const isLatest = idx === messages.length - 1 && !activeId;
            const isCurrent = isActive || isLatest;
            
            // Calculate distance to create depth scale
            const distance = messages.length - 1 - idx;

            // Compute dynamic styles based on depth
            // distance 0: Current speaking or latest
            // distance 1: Previous sentence
            // distance 2+: Even older
            const depthOpacity = isCurrent ? 1 : distance === 1 ? 0.5 : distance === 2 ? 0.25 : 0.15;
            const depthScale = isCurrent ? 1 : distance === 1 ? 0.9 : distance === 2 ? 0.8 : 0.7;

            return (
              <motion.div
                key={msg.id}
                ref={isCurrent ? endRef : null}
                layout
                initial={{ opacity: 0, y: 30, scale: 0.9 }}
                animate={{ opacity: depthOpacity, scale: depthScale, y: 0 }}
                exit={{ opacity: 0, scale: 0.8, y: -20 }}
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                onMouseEnter={() => onHoverId(msg.id)}
                onMouseLeave={() => onHoverId(null)}
                className={`flex flex-col w-full text-center origin-bottom py-2 cursor-default ${
                  isCurrent ? 'mb-4' : 'mb-0'
                }`}
              >
                <div className="max-w-4xl mx-auto px-4 relative">
                  <p className={`transition-colors duration-500 ease-in-out select-text leading-snug tracking-tight font-sans ${
                    isCurrent 
                      ? 'text-3xl sm:text-4xl md:text-4.5xl lg:text-5xl text-white font-light drop-shadow-md' 
                      : 'text-xl sm:text-2xl md:text-3xl text-neutral-400 font-extralight'
                  }`}>
                    {lang === 'zh' ? `“${text}”` : `"${text}"`}
                    {isActive && (
                      <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500 animate-pulse ml-3 mb-1" style={{boxShadow: '0 0 10px rgba(59, 130, 246, 0.5)'}}></span>
                    )}
                  </p>
                  
                  {isActive && (
                    <motion.div 
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      className="flex items-center justify-center space-x-2 mt-4 opacity-50"
                    >
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-blue-500"></span>
                      </span>
                      <span className="text-[9px] font-mono tracking-[0.3em] text-blue-400 uppercase">STREAMING</span>
                    </motion.div>
                  )}
                </div>

                {/* Micro Metadata Indicator (shows language side / timestamp on hover) */}
                <motion.div 
                  initial={{ opacity: 0 }}
                  animate={{ opacity: isHovered && !isActive ? 1 : 0 }}
                  className="flex items-center justify-center space-x-3 mt-3 transition-opacity"
                >
                  <span className="text-[9px] font-mono tracking-[0.2em] text-neutral-500 uppercase">
                    {original ? 'ORIGINAL' : 'TRANSLATED'}
                  </span>
                  <span className="w-1 h-1 rounded-full bg-neutral-800"></span>
                  <span className="text-[9px] font-mono text-neutral-600 uppercase">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </motion.div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
};

