import { WebSocket } from 'ws';
import type { Lang, Session } from './types';

/**
 * Mock simulation engine for when no key is present.
 * Streams scripted bilingual dialogue with typist-like updates to simulate latency,
 * letting the full client pipeline be exercised with no key/network.
 */
export function startMockInterval(ws: WebSocket): Session {
  let count = 0;
  const mockPhrases: { originalText: string; translatedText: string; originalLang: Lang; targetLang: Lang }[] = [
    { originalText: 'Hello there, welcome to Beijing. How can I help you?', translatedText: '你好，欢迎来到北京。有什么我可以帮您的吗？', originalLang: 'en', targetLang: 'zh' },
    { originalText: '谢谢！我想请问去附近的地铁站怎么走？', translatedText: 'Thank you! Could you please tell me how to get to the nearby subway station?', originalLang: 'zh', targetLang: 'en' },
    { originalText: "Go straight down this street, turn left at the second intersection, and you'll see the entrance.", translatedText: '沿着这条街直走，在第二个路口向左转，您就会看到入口了。', originalLang: 'en', targetLang: 'zh' },
    { originalText: '好的，太感谢了！祝你今天过得愉快！', translatedText: 'Understood, thank you so much! Have a wonderful day!', originalLang: 'zh', targetLang: 'en' },
    { originalText: 'You are welcome. Enjoy your stay here!', translatedText: '别客气。祝您在这里玩得开心！', originalLang: 'en', targetLang: 'zh' },
  ];

  let phraseTimer: NodeJS.Timeout | null = null;
  let incrementTimer: NodeJS.Timeout | null = null;
  let isProcessingSpeech = false;

  const onAudio = () => {
    if (isProcessingSpeech) return;
    isProcessingSpeech = true;

    phraseTimer = setTimeout(() => {
      const phrase = mockPhrases[count % mockPhrases.length];
      count++;

      const turnId = `mock-${Date.now()}`;
      const originalText = phrase.originalText;
      const translatedText = phrase.translatedText;

      let step = 0;
      const originalParts = originalText.length > 25 ? originalText.split(' ') : originalText.split('');
      const translatedParts = translatedText.length > 25 ? translatedText.split(' ') : translatedText.split('');
      const stepsCount = 6;

      incrementTimer = setInterval(() => {
        step++;
        const oJoin = originalText.length > 25 ? ' ' : '';
        const tJoin = translatedText.length > 25 ? ' ' : '';
        const oSlice = originalParts.slice(0, Math.ceil(originalParts.length * (step / stepsCount))).join(oJoin);
        const tSlice = translatedParts.slice(0, Math.ceil(translatedParts.length * (step / stepsCount))).join(tJoin);

        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'transcription',
            id: turnId,
            originalLang: phrase.originalLang,
            targetLang: phrase.targetLang,
            originalText: oSlice,
            translatedText: tSlice,
          }));
        }

        if (step >= stepsCount) {
          if (incrementTimer) clearInterval(incrementTimer);
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'complete', id: turnId }));
          }
          isProcessingSpeech = false;
        }
      }, 400);
    }, 1500);
  };

  return {
    onAudio,
    cleanup: () => {
      if (phraseTimer) clearTimeout(phraseTimer);
      if (incrementTimer) clearInterval(incrementTimer);
    },
  };
}
