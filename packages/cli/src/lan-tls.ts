/**
 * `--lan-tls` — 기기가 신뢰하는 인증서로 LAN 허브를 https/wss로 띄운다.
 *
 * 왜 필요한가: 배포된 `https://` 페이지에서 내 노트북 허브를 보려면 지금까지 터널이
 * 필요했다(바이너리 + 계정). 그런데 **막고 있던 것은 "차단"이 아니라 "권한"이었다** —
 * 크롬은 `LocalNetworkAccessPermissionDenied`로 거부하고, `local-network-access`는
 * 카메라·마이크와 같은 권한이라 일반 브라우저에서 상태가 `prompt`다(실측).
 * 그 검사만 끄고 나머지를 그대로 두니 `https://example.com` → `wss://<사설IP>.local-ip.sh`
 * 로 세션과 콘솔이 허브에 도달했다.
 *
 * 남은 조건은 **기기가 신뢰하는 인증서**뿐이고, 그게 이 파일이 해결하는 것이다.
 * 자체 서명은 못 쓴다(Android 7+ 앱은 사용자 설치 CA를 신뢰하지 않는다). 대신
 * `*.local-ip.sh`가 **사설 IP에 TLS를 붙이라고 개인키까지 공개한** Let's Encrypt
 * 와일드카드를 제공한다 — `172-30-1-29.local-ip.sh`가 `172.30.1.29`로 해석된다.
 *
 * **개인키가 공개돼 있다는 뜻은 이 TLS가 기밀성을 주지 않는다는 것이다.** 같은 LAN의
 * 능동적 공격자는 복호화할 수 있다. 그래도 지금보다 나쁘지 않다 — 이 경로가 대체하는 것은
 * 평문 http이고, 세션을 **읽는** 것은 여전히 `?t=` 토큰이 막는다. 얻는 것은 기밀성이
 * 아니라 "브라우저가 요구하는 신뢰된 인증서"다.
 */
import { X509Certificate } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { configPath } from './config.js';

/** 공개 키·인증서를 제공하는 곳 (사설 IP용 와일드카드) */
export const LAN_TLS_ORIGIN = 'https://local-ip.sh';
export const LAN_TLS_DOMAIN = 'local-ip.sh';
/** 만료가 이만큼 남지 않으면 새로 받는다 — 만료된 인증서로 뜨면 조용히 안 붙는다 */
const RENEW_BEFORE_DAYS = 7;

/**
 * `192.168.0.10` → `192-168-0-10.local-ip.sh`.
 *
 * 점을 대시로 바꾸는 이유: 와일드카드 인증서는 **한 레이블만** 덮는다
 * (`*.local-ip.sh`는 `1.2.3.4.local-ip.sh`를 덮지 못한다).
 */
export function lanTlsHostname(ip: string): string {
  return `${ip.replace(/\./g, '-')}.${LAN_TLS_DOMAIN}`;
}

/** PEM에서 만료 시각 — 헤더 파싱 없이 인증서 자체를 읽는다 */
export function certExpiry(pem: string): Date | undefined {
  try {
    return new Date(new X509Certificate(pem).validTo);
  } catch {
    return undefined;
  }
}

/** 캐시된 인증서를 계속 써도 되는지 */
export function isUsable(pem: string, now: Date): boolean {
  const expiry = certExpiry(pem);
  if (expiry === undefined) return false;
  const marginMs = RENEW_BEFORE_DAYS * 24 * 60 * 60 * 1000;
  return expiry.getTime() - now.getTime() > marginMs;
}

export interface LanTlsMaterial {
  cert: string;
  key: string;
  hostname: string;
  /** 이번에 새로 받아왔는지 — 사람에게 알릴 때만 쓴다 */
  fetched: boolean;
}

function cacheDir(): string {
  return join(dirname(configPath()), 'lan-tls');
}

/**
 * 인증서·키를 확보한다. 캐시가 유효하면 그것, 아니면 받아서 캐시한다.
 *
 * 번들하지 않는 이유: 이 인증서는 90일 주기로 갱신된다. 릴리스에 넣으면 곧 **만료된
 * 인증서를 배포**하게 되고, 그러면 사용자는 "왜 안 붙지"를 만나며 원인은 우리 릴리스 날짜다.
 */
export async function ensureLanTls(
  ip: string,
  now = new Date(),
  fetchPem: (url: string) => Promise<string> = fetchText,
): Promise<LanTlsMaterial> {
  const dir = cacheDir();
  const certFile = join(dir, 'cert.pem');
  const keyFile = join(dir, 'key.pem');
  const hostname = lanTlsHostname(ip);

  if (existsSync(certFile) && existsSync(keyFile)) {
    const cert = readFileSync(certFile, 'utf-8');
    if (isUsable(cert, now)) {
      return { cert, key: readFileSync(keyFile, 'utf-8'), hostname, fetched: false };
    }
  }

  const [cert, key] = await Promise.all([
    fetchPem(`${LAN_TLS_ORIGIN}/server.pem`),
    fetchPem(`${LAN_TLS_ORIGIN}/server.key`),
  ]);
  if (!isUsable(cert, now)) {
    throw new Error(`certificate from ${LAN_TLS_ORIGIN} is expired or unreadable`);
  }
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(certFile, cert, { mode: 0o600 });
    writeFileSync(keyFile, key, { mode: 0o600 });
  } catch {
    // 캐시 못 해도 이번 기동은 된다 — 다음 기동에서 다시 받을 뿐이다
  }
  return { cert, key, hostname, fetched: true };
}

/**
 * 이 네트워크에서 그 호스트명이 **우리 IP로** 해석되는지 확인한다.
 *
 * 왜 반드시 확인하는가: 사설 IP를 돌려주는 공개 DNS 응답을 **차단하는 리졸버가 흔하다**
 * (DNS rebinding 방어 — 사내망·일부 공유기의 기본값이다). 그 경우 이름이 해석되지 않거나
 * 엉뚱한 곳을 가리키고, 사용자는 원인 없이 "왜 안 붙지"를 만난다. 이 라이브러리를 쓰는
 * 사람의 네트워크는 내 것과 다르다 — 되는지 확인하고, 안 되면 이유를 말해야 한다.
 */
export async function resolvesToSelf(hostname: string, expectedIp: string): Promise<boolean> {
  try {
    const { lookup } = await import('node:dns/promises');
    const results = await lookup(hostname, { all: true });
    return results.some((entry) => entry.address === expectedIp);
  } catch {
    return false;
  }
}

/** DNS가 막혔을 때 사람에게 줄 설명 — 막다른 길로 두지 않는다 */
export function dnsBlockedMessage(hostname: string, ip: string): string {
  return (
    `--lan-tls could not use ${hostname}: this network's DNS does not resolve it to ${ip}.\n` +
    '  That is usually DNS rebinding protection, which many corporate networks and routers\n' +
    '  enable by default — public DNS answers pointing at private addresses get dropped.\n' +
    '  Options: use a network without that filter, or bring your own certificate with\n' +
    '  --tls-cert / --tls-key, or reach the hub through --tunnel instead.'
  );
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} → HTTP ${response.status}`);
  return response.text();
}
