/**
 * 예산 한계 직렬화 — 콘솔 훅의 핫패스다. 경로 선택은 전부 실브라우저 실측으로 정했다.
 *
 * - **네이티브 `JSON.stringify` + 예산 replacer**가 기본이다. C++ 구현이라 예산 안에
 *   들어오는 값에서 가장 빠르다(일반적인 로그 0.4~0.8µs). 손으로 쓴 순회 구현으로
 *   바꿔봤더니 같은 입력에서 **3배 느렸다** — 네이티브를 이기려 하지 말 것.
 * - **큰 배열은 앞쪽만** 잘라 넘긴다. 배열은 `length`가 O(1)이라 감지가 공짜인데
 *   효과는 크다: 1만 항목 497→64µs, 10만 항목 6074→24µs(**250배**).
 *   API 응답을 통째로 로그하는 흔한 패턴이 정확히 이 경우다.
 * - **순환 참조는 재시도로** 처리한다. 첫 패스가 TypeError로 죽으면 방문 집합을 든
 *   replacer로 한 번 더 돈다. 예전에는 `String(arg)`("[object Object]")로 떨어져
 *   객체 내용을 통째로 잃었다.
 *
 * 넓은 평범한 객체(키 5만)는 어떤 구현으로도 ~7ms가 바닥이다 — `Object.keys` 자체가
 * 4.6ms고 `JSON.stringify`도 내부에서 같은 열거를 한다. 여기에 더 최적화를 시도하지 말 것.
 */

/** 이 개수를 넘는 배열은 앞쪽만 직렬화한다 — 예산을 채우기에 충분한 양 */
const ARRAY_HEAD = 500;

export interface SerializeResult {
  text: string;
  /** 예산 때문에 무언가 생략됐는지 — 호출부가 사용자에게 밝히는 데 쓴다 */
  truncated: boolean;
}

export function serializeValue(value: unknown, budget: number): SerializeResult {
  // 문자열·Error는 구조 순회가 없다 — 자르기만 하면 된다
  if (typeof value === 'string') return clip(value, budget);
  if (value instanceof Error) return clip(value.stack ?? value.message, budget);

  if (Array.isArray(value) && value.length > ARRAY_HEAD) {
    const head = stringify(value.slice(0, ARRAY_HEAD), budget);
    return { text: `${head.text} … ${value.length - ARRAY_HEAD} more items`, truncated: true };
  }
  return stringify(value, budget);
}

function stringify(value: unknown, budget: number): SerializeResult {
  let used = 0;
  /**
   * 예산을 넘긴 값은 생략한다 — 버려질 메가바이트를 먼저 만들지 않기 위해.
   * (출력은 잘리지만 순회는 계속된다. 넓은 객체의 열거 비용은 피할 수 없다 — 위 주석 참조)
   */
  const budgeted = (_key: string, item: unknown): unknown => {
    if (used > budget) return undefined;
    used += typeof item === 'string' ? item.length + 2 : 8; // 구분자 포함 근사
    return item;
  };

  try {
    return finish(JSON.stringify(value, budgeted), value, used, budget);
  } catch {
    // 순환 참조. 방문 집합을 들고 한 번 더 — 흔한 경로가 아니라 두 번 도는 비용을
    // 감수할 만하고, 그 대가로 객체 내용을 살린다
    used = 0;
    const seen = new WeakSet<object>();
    try {
      const json = JSON.stringify(value, (key, item) => {
        if (typeof item === 'object' && item !== null) {
          // 형제 위치의 같은 참조도 여기 걸린다(오탐). 순환 때문에 아무것도 못 보는 것보다는 낫다
          if (seen.has(item)) return '[Circular]';
          seen.add(item);
        }
        return budgeted(key, item);
      });
      return finish(json, value, used, budget);
    } catch {
      return clip(String(value), budget); // toJSON이 던지는 등 — 최소한 타입은 남긴다
    }
  }
}

/** JSON.stringify 결과를 예산에 맞춰 마감한다. undefined는 직렬화 불가 값(함수·심볼) */
function finish(
  json: string | undefined,
  value: unknown,
  used: number,
  budget: number,
): SerializeResult {
  if (json === undefined) return clip(String(value), budget);
  return json.length > budget
    ? { text: json.slice(0, budget), truncated: true }
    : { text: json, truncated: used > budget };
}

function clip(text: string, budget: number): SerializeResult {
  return text.length <= budget
    ? { text, truncated: false }
    : { text: text.slice(0, budget), truncated: true };
}

/** 콘솔 인자 목록 → 로그 한 줄. 잘렸으면 잘렸음을 남긴다(조용히 버리면 오도한다) */
export function serializeArgs(args: unknown[], budget: number): string {
  const parts: string[] = [];
  let truncated = false;
  let remaining = budget;
  for (const arg of args) {
    // 남은 예산만 넘긴다 — 첫 인자가 예산을 다 써도 뒤 인자에서 다시 쓰지 않는다
    const result = serializeValue(arg, Math.max(0, remaining));
    truncated = truncated || result.truncated;
    parts.push(result.text);
    remaining -= result.text.length + 1;
    if (remaining <= 0) {
      truncated = truncated || parts.length < args.length;
      break;
    }
  }
  // 최종 클램프는 두지 않는다: 각 인자에 남은 예산을 주고 구분자까지 차감하므로
  // 이어붙인 길이는 항상 예산 이하다. `remaining` 회계를 바꾸면 이 불변식을 다시 확인할 것
  const text = parts.join(' ');
  return truncated ? `${text}… (truncated)` : text;
}
