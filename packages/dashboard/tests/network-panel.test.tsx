import { describe, expect, it } from 'vitest';
import { NetworkPanel } from '../src/components/NetworkPanel';
import { MAX_NETWORK_ENTRIES } from '../src/constants';
import type { NetworkEntry, SessionMeta } from '../src/types';
import { fireEvent, render, screen } from './render';

/**
 * 필터 로직 자체는 `network-utils`에서 검증한다. 여기서는 배선과 표시 계약:
 * 실패가 눈에 띄는가, 상세를 펼칠 수 있는가, 숨긴 건수를 밝히는가.
 */

let nextId = 0;
const request = (partial: Partial<NetworkEntry> = {}): NetworkEntry => ({
  id: nextId++,
  sessionId: 's1',
  method: 'GET',
  url: 'https://api.test/items',
  status: 200,
  durationMs: 12,
  initiator: 'fetch',
  ts: 0,
  ...partial,
});

const session = (id: string, label: string): SessionMeta => ({
  id,
  label,
  userAgent: 'ua',
  startedAt: 0,
});

describe('NetworkPanel', () => {
  it('메서드·상태·경로·소요시간을 렌더한다', () => {
    render(<NetworkPanel entries={[request({ status: 201 })]} sessions={[]} />);
    expect(screen.getByText('GET')).toBeTruthy();
    expect(screen.getByText('201')).toBeTruthy();
    expect(screen.getByText('/items')).toBeTruthy();
  });

  it('응답을 못 받은 요청은 ERR로 표시한다 — 웹뷰에서 가장 안 보이는 실패다', () => {
    render(
      <NetworkPanel entries={[request({ status: 0, error: 'net::ERR_BLOCKED' })]} sessions={[]} />,
    );
    expect(screen.getByText('ERR')).toBeTruthy();
  });

  it('요청이 없으면 안내를 보여준다', () => {
    render(<NetworkPanel entries={[]} sessions={[]} />);
    expect(screen.getByText(/No requests yet/)).toBeTruthy();
  });

  it('세션 라벨을 붙인다 (여러 기기를 동시에 볼 때 구분)', () => {
    render(
      <NetworkPanel
        entries={[request({ sessionId: 's1' })]}
        sessions={[session('s1', '결제 웹뷰')]}
      />,
    );
    expect(screen.getByText('결제 웹뷰')).toBeTruthy();
  });

  describe('상세 펼침', () => {
    it('행을 누르면 전체 URL과 에러 사유가 나온다', () => {
      render(
        <NetworkPanel
          entries={[
            request({
              url: 'https://api.test/pay?token=abc',
              status: 0,
              error: 'net::ERR_BLOCKED',
            }),
          ]}
          sessions={[]}
        />,
      );
      expect(screen.queryByText('net::ERR_BLOCKED')).toBeNull();

      fireEvent.click(screen.getByText('/pay?token=abc'));
      expect(screen.getByText('https://api.test/pay?token=abc')).toBeTruthy();
      expect(screen.getByText('net::ERR_BLOCKED')).toBeTruthy();
    });

    it('바디 미리보기와 잘림 표시를 함께 보여준다', () => {
      render(
        <NetworkPanel
          entries={[request({ bodyPreview: '{"error":"upstream"}', bodyTruncated: true })]}
          sessions={[]}
        />,
      );
      fireEvent.click(screen.getByText('/items'));
      expect(screen.getByText(/\{"error":"upstream"\}/)).toBeTruthy();
      expect(screen.getByText(/… \(truncated\)/)).toBeTruthy();
    });

    it('응답 헤더를 key: value로 펼친다', () => {
      render(
        <NetworkPanel
          entries={[request({ responseHeaders: { 'content-type': 'application/json' } })]}
          sessions={[]}
        />,
      );
      fireEvent.click(screen.getByText('/items'));
      expect(screen.getByText(/content-type: application\/json/)).toBeTruthy();
    });

    it('다시 누르면 접힌다', () => {
      render(<NetworkPanel entries={[request({ error: 'boom' })]} sessions={[]} />);
      fireEvent.click(screen.getByText('/items'));
      expect(screen.getByText('boom')).toBeTruthy();
      fireEvent.click(screen.getByText('/items'));
      expect(screen.queryByText('boom')).toBeNull();
    });
  });

  describe('필터 배선', () => {
    it('errors 토글이 실패만 남긴다', () => {
      const entries = [
        request({ url: 'https://api.test/ok', status: 200 }),
        request({ url: 'https://api.test/broken', status: 502 }),
      ];
      render(<NetworkPanel entries={entries} sessions={[]} />);
      expect(screen.getByText('/ok')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'errors' }));
      expect(screen.getByText('/broken')).toBeTruthy();
      expect(screen.queryByText('/ok')).toBeNull();
    });

    it('URL 검색이 목록을 좁힌다', () => {
      const entries = [
        request({ url: 'https://api.test/pay' }),
        request({ url: 'https://api.test/home' }),
      ];
      render(<NetworkPanel entries={entries} sessions={[]} />);

      fireEvent.change(screen.getByLabelText('search requests'), { target: { value: 'pay' } });
      expect(screen.getByText('/pay')).toBeTruthy();
      expect(screen.queryByText('/home')).toBeNull();
    });
  });

  describe('렌더 상한', () => {
    it('상한 이하면 건수만 보여준다', () => {
      render(<NetworkPanel entries={[request(), request()]} sessions={[]} />);
      expect(screen.getByText('2 requests')).toBeTruthy();
    });

    it('상한을 넘으면 최신만 렌더하고 전체 건수를 밝힌다', () => {
      const entries = Array.from({ length: MAX_NETWORK_ENTRIES + 200 }, (_, index) =>
        request({ url: `https://api.test/req${index}` }),
      );
      const { container } = render(<NetworkPanel entries={entries} sessions={[]} />);

      expect(screen.getByText(/of 1,000 requests \(filter to narrow\)/)).toBeTruthy();
      // 헤더 없는 표라 tr 개수 = 렌더된 행 수
      expect(container.querySelectorAll('tbody > tr')).toHaveLength(MAX_NETWORK_ENTRIES);
      expect(screen.queryByText('/req0')).toBeNull();
    });
  });
});
