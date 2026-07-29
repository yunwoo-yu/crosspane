# @crosspane/protocol

Wire protocol types shared by the [crosspane](https://www.npmjs.com/package/crosspane)
hub, its dashboard, and the [@crosspane/agent](https://www.npmjs.com/package/@crosspane/agent)
SDK.

Types and constants only — no runtime code, no dependencies. It ends up inside app
bundles through the agent, so it stays that way deliberately.

```bash
npm install @crosspane/protocol
```

```ts
import type { SessionCapture, SessionEvent, SessionMeta } from '@crosspane/protocol'
```

The same `SessionEvent` shape flows from the agent, through the hub, to the dashboard
and into exported `.crosspane.json` capture files — there is no translation layer in
between. Build your own consumer against these types if you want to pipe sessions
somewhere else.

## License

MIT
