/**
 * H.264 Annex-B 스트림 파서 — WS로 임의 크기 조각이 오는 바이트 스트림을
 * WebCodecs가 먹을 수 있는 액세스 유닛(프레임 단위) 시퀀스로 재조립한다.
 * DOM/WebCodecs 무관 순수 모듈 (jsdom에서 유닛테스트 가능).
 *
 * 규칙:
 * - 시작 코드(00 00 01 / 00 00 00 01)로 NAL을 나눈다. NAL의 끝은
 *   다음 시작 코드로만 알 수 있으므로 마지막 NAL은 다음 push까지 보류한다
 * - VCL NAL(타입 1 비IDR, 5 IDR) 하나당 액세스 유닛 하나 — 직전의
 *   비VCL NAL(SEI 등)은 그 유닛에 포함시킨다
 * - 키프레임 유닛에는 캐시된 SPS/PPS를 항상 앞에 붙인다 (중간 합류 대비)
 */

const NAL_TYPE_NON_IDR = 1;
const NAL_TYPE_IDR = 5;
const NAL_TYPE_SPS = 7;
const NAL_TYPE_PPS = 8;

export interface H264AccessUnit {
  /** Annex-B 그대로의 액세스 유닛 (시작 코드 포함) */
  data: Uint8Array;
  isKeyframe: boolean;
}

const START_CODE = new Uint8Array([0, 0, 0, 1]);

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

function withStartCode(nal: Uint8Array): Uint8Array {
  return concat([START_CODE, nal]);
}

/** SPS에서 WebCodecs codec 문자열("avc1.PPCCLL")을 만든다 */
export function codecStringFromSps(sps: Uint8Array): string {
  const hex = (value: number) => value.toString(16).padStart(2, '0');
  // sps[0]=NAL 헤더, [1]=profile_idc, [2]=constraint flags, [3]=level_idc
  return `avc1.${hex(sps[1])}${hex(sps[2])}${hex(sps[3])}`;
}

/** 시작 코드 위치: codeStart = 코드 첫 바이트, nalStart = NAL 첫 바이트 */
interface StartCodeMark {
  codeStart: number;
  nalStart: number;
}

function findStartCodes(data: Uint8Array): StartCodeMark[] {
  const marks: StartCodeMark[] = [];
  let i = 0;
  while (i + 3 <= data.length) {
    if (data[i] === 0 && data[i + 1] === 0) {
      if (data[i + 2] === 1) {
        marks.push({ codeStart: i, nalStart: i + 3 });
        i += 3;
        continue;
      }
      if (i + 4 <= data.length && data[i + 2] === 0 && data[i + 3] === 1) {
        marks.push({ codeStart: i, nalStart: i + 4 });
        i += 4;
        continue;
      }
    }
    i += 1;
  }
  return marks;
}

export class H264AnnexBParser {
  private pending: Uint8Array = new Uint8Array(0);
  private sps: Uint8Array | null = null;
  private pps: Uint8Array | null = null;
  /** 현재 유닛에 붙일 비VCL NAL 대기열 (SEI 등) */
  private leadingNals: Uint8Array[] = [];
  /** 누적 중인 액세스 유닛의 슬라이스들 — 한 프레임이 여러 VCL NAL일 수 있다 (Apple 인코더) */
  private currentSlices: Uint8Array[] = [];
  private currentIsKeyframe = false;

  /** 마지막으로 파싱된 SPS 기준 codec 문자열 (SPS 도착 전엔 null) */
  codec: string | null = null;

  /**
   * 스트림 유휴 시 pending의 마지막 NAL을 방출한다 — 마지막 프레임은 다음 시작코드가
   * 와야 완결 판정되므로, 저속 구간에서 최종 프레임이 갇히는 지연(실측 ~360ms)을 없앤다.
   * chunk 경계는 대개 NAL 경계(screenrecord가 프레임 단위로 write)라 안전하고,
   * 드물게 잘린 NAL이면 디코더 에러 → 파이프라인 리셋으로 자가 복구된다.
   */
  flushPending(): H264AccessUnit[] {
    const units: H264AccessUnit[] = [];
    const marks = findStartCodes(this.pending);
    if (marks.length === 1) {
      const nal = this.pending.subarray(marks[0].nalStart);
      if (nal.length >= 2) {
        this.pending = new Uint8Array(0);
        this.consumeNal(nal.slice(), units);
      }
    }
    this.emitCurrent(units); // 누적 중이던 프레임 마감
    return units;
  }

  push(bytes: Uint8Array): H264AccessUnit[] {
    const data = concat([this.pending, bytes]);
    const marks = findStartCodes(data);
    if (marks.length < 2) {
      this.pending = data;
      return [];
    }

    const units: H264AccessUnit[] = [];
    for (let i = 0; i + 1 < marks.length; i++) {
      const nal = data.subarray(marks[i].nalStart, marks[i + 1].codeStart);
      if (nal.length > 0) this.consumeNal(nal, units);
    }
    // 마지막 NAL은 미완 — 그 시작 코드부터 보류
    this.pending = data.slice(marks[marks.length - 1].codeStart);
    return units;
  }

  private consumeNal(nal: Uint8Array, units: H264AccessUnit[]): void {
    const type = nal[0] & 0x1f;
    if (type === NAL_TYPE_SPS) {
      this.emitCurrent(units); // 새 시퀀스 시작 — 누적 중 유닛 마감
      this.sps = nal.slice();
      this.codec = codecStringFromSps(nal);
      return; // 키프레임 유닛에 합쳐 붙인다
    }
    if (type === NAL_TYPE_PPS) {
      this.pps = nal.slice();
      return;
    }
    if (type !== NAL_TYPE_IDR && type !== NAL_TYPE_NON_IDR) {
      this.emitCurrent(units); // 픽처 뒤 비VCL은 다음 유닛 소속
      this.leadingNals.push(nal.slice());
      return;
    }
    // 한 프레임이 여러 슬라이스(VCL NAL)로 올 수 있다(Apple 인코더) —
    // first_mb_in_slice==0(ue(v) 첫 비트 1)이면 새 픽처의 첫 슬라이스다
    const isFirstSlice = (nal[1] & 0x80) !== 0;
    if (isFirstSlice) this.emitCurrent(units);
    this.currentIsKeyframe = this.currentIsKeyframe || type === NAL_TYPE_IDR;
    this.currentSlices.push(nal.slice());
  }

  /** 누적된 슬라이스들을 하나의 액세스 유닛으로 방출한다 */
  private emitCurrent(units: H264AccessUnit[]): void {
    if (this.currentSlices.length === 0) return;
    const parts: Uint8Array[] = [];
    if (this.currentIsKeyframe && this.sps && this.pps) {
      parts.push(withStartCode(this.sps), withStartCode(this.pps));
    }
    for (const leading of this.leadingNals) parts.push(withStartCode(leading));
    this.leadingNals = [];
    for (const slice of this.currentSlices) parts.push(withStartCode(slice));
    units.push({ data: concat(parts), isKeyframe: this.currentIsKeyframe });
    this.currentSlices = [];
    this.currentIsKeyframe = false;
  }
}
