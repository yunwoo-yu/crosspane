import { networkInterfaces } from 'node:os';

/** LAN에서 접근 가능한 IPv4 주소 목록 — 에이전트 serverUrl 안내용 */
export function lanAddresses(): string[] {
  const addresses: string[] = [];
  for (const nets of Object.values(networkInterfaces())) {
    for (const net of nets ?? []) {
      if (net.family === 'IPv4' && !net.internal) addresses.push(net.address);
    }
  }
  return addresses.length > 0 ? addresses : ['<your-ip>'];
}
