/**
 * Lightweight assert-based checks for the pure logic units.
 * Run with: npx tsx scripts/check-logic.ts
 * No test framework — this is the project convention (see CLAUDE.md).
 */
import { detectLang, mergeTranscript, endsAtClauseBoundary } from '../src/server/textUtils';

let passed = 0;
let failed = 0;

function eq<T>(actual: T, expected: T, label: string) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passed++;
  } else {
    failed++;
    console.error(`✗ ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`);
  }
}

// --- detectLang ---
eq(detectLang('Hello world'), 'en', 'detectLang: latin -> en');
eq(detectLang('你好世界'), 'zh', 'detectLang: cjk -> zh');
eq(detectLang('你好 world from 北京 今天 天气 很好'), 'zh', 'detectLang: cjk-dominant mix -> zh');
eq(detectLang(''), 'en', 'detectLang: empty -> en (default)');

// --- mergeTranscript ---
eq(mergeTranscript('', 'hello'), 'hello', 'merge: empty existing');
eq(mergeTranscript('hello', ''), 'hello', 'merge: empty incoming');
eq(mergeTranscript('hello', 'hello world'), 'hello world', 'merge: incoming extends (prefix)');
eq(mergeTranscript('hello world', 'world'), 'hello world', 'merge: existing already contains tail');
eq(mergeTranscript('the quick', 'quick brown fox'), 'the quick brown fox', 'merge: overlap stitch');
eq(mergeTranscript('abc', 'def'), 'abcdef', 'merge: no overlap -> concat');

// --- endsAtClauseBoundary ---
eq(endsAtClauseBoundary('你好。'), true, 'clause: chinese full stop');
eq(endsAtClauseBoundary('Hello,'), true, 'clause: comma');
eq(endsAtClauseBoundary('How are you?'), true, 'clause: question mark');
eq(endsAtClauseBoundary('still talking'), false, 'clause: mid-sentence -> false');
eq(endsAtClauseBoundary('done. '), true, 'clause: trailing space tolerated');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
