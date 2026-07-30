import { WebSocket } from 'ws';

const s = new WebSocket('ws://127.0.0.1:7805/ws', { origin: 'http://localhost:7805' });
s.on('message', (raw) => {
  const e = JSON.parse(String(raw));
  if (e.type === 'hello')
    console.log('  허브 세션:', e.sessions.map((x) => x.label).join(', ') || '(없음)');
  if (e.type === 'console') console.log('  콘솔:', e.level, '·', String(e.text).slice(0, 70));
});
setTimeout(() => process.exit(0), 2500);
