/**
 * 직렬화 핫패스 벤치 — `node scripts/bench.mjs` (빌드 후).
 *
 * 이 SDK는 사용자 페이지에서 돌기 때문에 핫패스 비용이 채택 장벽이다. 수치를 커밋
 * 메시지에 묻어두지 않고 여기서 언제든 재현한다. 절대값은 Node/V8 기준이라 브라우저와
 * 다르지만(브라우저가 대체로 조금 더 느리다) **경로 간 비율**은 같은 결론을 준다.
 *
 * 읽는 법: `wide object`는 어떤 구현으로도 줄지 않는 바닥이다(V8의 키 열거).
 * 나머지가 회귀하면 `src/serialize.ts`의 경로 선택이 깨진 것이다.
 */
// 번들이 아니라 tsc 산출물을 쓴다 — serializeArgs는 내부 함수라 공개 진입점에 없다
import { serializeArgs } from '../dist/serialize.js';

const BUDGET = 10_000;

const cases = [
  ['tiny            ', { a: 1, b: 'x' }, 2_000],
  ['typical log     ', { user: 'u1', items: 3, ok: true, meta: { t: 1, tags: ['a', 'b'] } }, 2_000],
  ['api resp (100)  ', Array.from({ length: 100 }, (_, i) => ({ id: i, name: `item${i}` })), 500],
  ['api resp (10k)  ', Array.from({ length: 10_000 }, (_, i) => ({ id: i, name: `item${i}` })), 50],
  ['number arr (100k)', Array.from({ length: 100_000 }, (_, i) => i), 50],
  ['long string     ', 'x'.repeat(1_000_000), 500],
  [
    'circular        ',
    (() => {
      const value = { name: 'loop' };
      value.self = value;
      return value;
    })(),
    500,
  ],
  [
    'wide object (50k keys, 바닥)',
    (() => {
      const value = {};
      for (let i = 0; i < 50_000; i++) value[`key_${i}`] = { n: i, s: `value_${i}` };
      return value;
    })(),
    10,
  ],
];

console.log(`직렬화 비용 (예산 ${BUDGET}자)\n`);
for (const [name, value, iterations] of cases) {
  for (let i = 0; i < Math.min(iterations, 20); i++) serializeArgs([value], BUDGET); // 웜업
  const started = process.hrtime.bigint();
  for (let i = 0; i < iterations; i++) serializeArgs([value], BUDGET);
  const us = Number(process.hrtime.bigint() - started) / 1e3 / iterations;
  const shown = us >= 1_000 ? `${(us / 1_000).toFixed(2)} ms` : `${us.toFixed(2)} µs`;
  console.log(`  ${name.padEnd(30)} ${shown.padStart(10)}`);
}
