import { describe, expect, it } from 'vitest';
import { serializeArgs, serializeValue } from '../src/serialize';

/**
 * 계약 셋: **예산 안의 출력**, **순환 참조에서도 내용을 잃지 않음**,
 * **큰 배열에서 비용이 크기에 비례하지 않음**. 경로 선택의 실측 근거는
 * `src/serialize.ts` 상단 참조.
 */

describe('serializeValue', () => {
  it('작은 값은 JSON과 같은 모양으로 낸다', () => {
    expect(serializeValue({ a: 1, b: 'x', c: true, d: null }, 1_000).text).toBe(
      '{"a":1,"b":"x","c":true,"d":null}',
    );
    expect(serializeValue([1, 'two', false], 1_000).text).toBe('[1,"two",false]');
  });

  it('작은 값은 잘리지 않았다고 보고한다', () => {
    expect(serializeValue({ a: 1 }, 1_000).truncated).toBe(false);
  });

  it('문자열과 Error는 순회 없이 자른다', () => {
    expect(serializeValue('x'.repeat(50), 10)).toEqual({ text: 'x'.repeat(10), truncated: true });
    const error = new Error('boom');
    expect(serializeValue(error, 1_000).text).toContain('boom');
  });

  it('네이티브 경로는 JSON 의미론을 그대로 따른다', () => {
    // 일반 경로는 JSON.stringify다 — 배열의 undefined·함수는 null, NaN도 null
    expect(serializeValue([undefined, () => {}], 1_000).text).toBe('[null,null]');
    expect(serializeValue({ n: Number.NaN }, 1_000).text).toBe('{"n":null}');
    expect(serializeValue({ a: 1, skip: undefined, fn: () => {} }, 1_000).text).toBe('{"a":1}');
  });

  it('toJSON을 존중한다 (Date)', () => {
    const date = new Date('2026-07-30T00:00:00.000Z');
    expect(serializeValue(date, 1_000).text).toBe('"2026-07-30T00:00:00.000Z"');
  });

  describe('순환 참조 — 재시도가 내용을 살린다', () => {
    it('순환 지점만 표식으로 끊고 나머지는 남긴다', () => {
      // 예전에는 String(arg)로 떨어져 "[object Object]"만 남아 내용을 통째로 잃었다
      const circular: Record<string, unknown> = { name: 'loop' };
      circular.self = circular;
      const { text } = serializeValue(circular, 1_000);
      expect(text).toBe('{"name":"loop","self":"[Circular]"}');
      expect(text).toContain('loop');
    });

    it('순환이 없으면 재시도 경로를 타지 않는다 — 공유 참조가 온전히 남는다', () => {
      // 재시도 경로의 방문 집합은 형제 위치의 같은 참조도 [Circular]로 본다(오탐).
      // 순환이 없는 값은 첫 패스에서 끝나므로 그 오탐에 걸리지 않아야 한다
      const shared = { v: 1 };
      expect(serializeValue({ a: shared, b: shared }, 1_000).text).toBe(
        '{"a":{"v":1},"b":{"v":1}}',
      );
    });

    it('배열 안의 순환도 끊는다', () => {
      const list: unknown[] = [1];
      list.push(list);
      expect(serializeValue(list, 1_000).text).toBe('[1,"[Circular]"]');
    });

    it('던지는 toJSON에도 죽지 않는다', () => {
      const hostile = {
        toJSON() {
          throw new Error('nope');
        },
      };
      expect(() => serializeValue(hostile, 1_000)).not.toThrow();
      expect(serializeValue(hostile, 1_000).text).toBe('[object Object]');
    });
  });

  describe('큰 배열 — 앞쪽만 직렬화한다', () => {
    it('생략된 개수를 밝힌다', () => {
      const large = Array.from({ length: 5_000 }, (_, index) => index);
      const { text, truncated } = serializeValue(large, 100_000);
      expect(truncated).toBe(true);
      expect(text).toContain('… 4500 more items');
      expect(text).toContain('[0,1,2');
    });

    it('상한 이하 배열은 그대로 낸다', () => {
      const small = [1, 2, 3];
      expect(serializeValue(small, 1_000)).toEqual({ text: '[1,2,3]', truncated: false });
    });
  });

  describe('예산', () => {
    it('넓은 객체를 예산에서 자르고 잘렸음을 보고한다', () => {
      const wide: Record<string, number> = {};
      for (let i = 0; i < 5_000; i++) wide[`key${i}`] = i;
      const result = serializeValue(wide, 100);
      expect(result.truncated).toBe(true);
      expect(result.text.length).toBeLessThanOrEqual(100);
    });

    it('거대한 문자열 프로퍼티를 통째로 이스케이프하지 않는다', () => {
      const result = serializeValue({ blob: 'y'.repeat(1_000_000) }, 50);
      expect(result.truncated).toBe(true);
      expect(result.text.length).toBeLessThanOrEqual(50);
    });

    it('예산 0이어도 던지지 않는다', () => {
      expect(() => serializeValue({ a: [1, 2, { b: 'c' }] }, 0)).not.toThrow();
    });
  });
});

describe('serializeArgs', () => {
  it('인자를 공백으로 잇는다', () => {
    expect(serializeArgs(['hello', { a: 1 }, 42], 1_000)).toBe('hello {"a":1} 42');
  });

  it('잘렸으면 잘렸음을 남긴다 — 조용히 버리면 오도한다', () => {
    const result = serializeArgs(['x'.repeat(100)], 20);
    expect(result).toContain('… (truncated)');
    expect(result.startsWith('x'.repeat(20))).toBe(true);
  });

  it('첫 인자가 예산을 다 쓰면 뒤 인자에서 다시 쓰지 않는다', () => {
    const result = serializeArgs(['x'.repeat(100), 'SHOULD_NOT_APPEAR'], 30);
    expect(result).not.toContain('SHOULD_NOT_APPEAR');
    expect(result).toContain('… (truncated)');
  });

  it('인자가 없으면 빈 문자열', () => {
    expect(serializeArgs([], 100)).toBe('');
  });

  it('여러 인자를 이어붙여도 예산을 넘지 않는다 (구분자 포함 회계)', () => {
    for (const budget of [5, 20, 100]) {
      const result = serializeArgs(['a'.repeat(8), { b: 'x'.repeat(20) }, 'c'.repeat(8)], budget);
      expect(result.replace('… (truncated)', '').length).toBeLessThanOrEqual(budget);
    }
  });
});
