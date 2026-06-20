/**
 * Lightweight assert-based checks for the pure logic units.
 * Run with: npx tsx scripts/check-logic.ts
 * No test framework — this is the project convention (see CLAUDE.md).
 */
import { detectLang, mergeTranscript, resolveLang } from '../src/server/textUtils';

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

// --- resolveLang ---
eq(resolveLang('zh', ''), 'zh', 'resolveLang: zh tag');
eq(resolveLang('cmn', ''), 'zh', 'resolveLang: cmn -> zh');
eq(resolveLang('en-US', ''), 'en', 'resolveLang: en-US -> en');
eq(resolveLang(undefined, '你好世界'), 'zh', 'resolveLang: no tag falls back to detectLang');
eq(resolveLang('xx', 'hello'), 'en', 'resolveLang: unknown tag falls back to detectLang');

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
