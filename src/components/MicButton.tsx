import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, Loader2, MicOff } from 'lucide-react';
import { ConnectionStatus } from '../types';

interface MicButtonProps {
  isRecording: boolean;
  status: ConnectionStatus;
  onClick: () => void;
}

export const MicButton: React.FC<MicButtonProps> = ({ isRecording, status, onClick }) => {
  const isPending = status === 'connecting' || status === 'connected' || status === 'initializing_gemini';
  const isDisabled = status === 'disconnected' || status === 'error';

  return (
    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40 flex flex-col items-center select-none pointer-events-none">
      {/* Container holding layout structures */}
      <div className="relative pointer-events-auto">
        <AnimatePresence>
          {isRecording && (
            <>
              {/* Pulsing ring 1 */}
              <motion.div
                initial={{ scale: 0.9, opacity: 0.5 }}
                animate={{ scale: 1.8, opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={{ repeat: Infinity, duration: 2.0, ease: 'easeOut' }}
                className="absolute inset-x-0 inset-y-0 rounded-full bg-white/5"
              />
              {/* Pulsing ring 2 */}
              <motion.div
                initial={{ scale: 0.9, opacity: 0.3 }}
                animate={{ scale: 1.4, opacity: 0 }}
                exit={{ opacity: 0 }}
                transition={{ repeat: Infinity, duration: 2.0, delay: 0.7, ease: 'easeOut' }}
                className="absolute inset-x-0 inset-y-0 rounded-full bg-white/10"
              />
            </>
          )}
        </AnimatePresence>

        {/* Outer Circular Frame - Matching design HTML */}
        <div className={`w-24 h-24 rounded-full bg-white/5 backdrop-blur-3xl border border-white/10 flex items-center justify-center shadow-[0_0_80px_rgba(255,255,255,0.05)] transition-all duration-300 ${
          isRecording ? 'border-blue-500/30 shadow-[0_0_100px_rgba(59,130,246,0.15)]' : ''
        }`}>
          {/* Inner Primary Interactive Button */}
          <motion.button
            whileHover={!isDisabled ? { scale: 1.05 } : {}}
            whileTap={!isDisabled ? { scale: 0.95 } : {}}
            onClick={onClick}
            disabled={isDisabled}
            className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-300 shadow-xl border relative z-10 ${
              isDisabled
                ? 'bg-neutral-900 border-neutral-800 text-neutral-600 cursor-not-allowed'
                : isRecording
                ? 'bg-white border-white text-black hover:bg-neutral-100 cursor-pointer'
                : isPending
                ? 'bg-neutral-800 border-neutral-700 text-neutral-400 cursor-wait'
                : 'bg-white border-white text-black hover:bg-neutral-100 cursor-pointer'
            }`}
          >
            {isPending ? (
              <Loader2 className="w-6 h-6 animate-spin stroke-[2]" />
            ) : isRecording ? (
              <Mic className="w-6 h-6 animate-pulse text-black fill-current stroke-[2.5]" />
            ) : isDisabled ? (
              <MicOff className="w-6 h-6 text-neutral-600 stroke-[2.5]" />
            ) : (
              <Mic className="w-6 h-6 text-black stroke-[2.5]" />
            )}
          </motion.button>
        </div>
      </div>
    </div>
  );
};

