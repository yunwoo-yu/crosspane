# @crosspane/agent-replay

Optional screen-recording plugin for [@crosspane/agent](https://www.npmjs.com/package/@crosspane/agent).
Records the DOM with [rrweb](https://github.com/rrweb-io/rrweb) so you can see what the
screen looked like, not just what it logged.

**This is a separate package on purpose.** rrweb is tens of times larger than the core
agent (~2.5 KB gzipped). Keeping it out of the core means teams who only need console and
network data pay nothing for screen recording.

## Install

```bash
npm install @crosspane/agent @crosspane/agent-replay
```

## Use

```ts
import { initCrosspane } from '@crosspane/agent'
import { startScreenRecording } from '@crosspane/agent-replay'

const agent = initCrosspane({ label: 'checkout webview', serverUrl: 'http://192.168.0.10:7788' })
const recording = startScreenRecording(agent)

// later, if you want to stop early
recording.stop()
```

Screen frames ride the same session timeline as logs and network entries — one connection,
one session, correctly ordered. They are included in `.crosspane.json` exports too, so a
capture file replays the screen alongside the console.

Open the **Screen** tab in the dashboard to play it back.

## Without a bundler

`dist/crosspane-agent-replay.esm.js` (~57 KB gzipped) is a prebuilt single file. It keeps
`@crosspane/agent` external on purpose — the page must reuse the agent instance it already
loaded, otherwise a second agent appears and the timeline splits.

```html
<script type="module">
  import { initCrosspane } from 'https://unpkg.com/@crosspane/agent/dist/crosspane-agent.esm.js'
  import { startScreenRecording } from 'https://unpkg.com/@crosspane/agent-replay/dist/crosspane-agent-replay.esm.js'
  startScreenRecording(initCrosspane({ label: 'kiosk' }))
</script>
```

## Options

```ts
startScreenRecording(agent, {
  checkoutEveryNms?: number    // full re-snapshot interval (default: 20000)
  maskAllInputs?: boolean      // default: true
  blockSelector?: string       // elements to omit entirely, e.g. '.sensitive'
  maskTextSelector?: string    // elements whose text is masked
})
```

Recording follows the core agent's gating: if the agent is disabled, this does nothing.

## Privacy

DOM recording captures **all text on screen** by definition. Input values are masked by
default; anything else you consider sensitive needs `blockSelector` or `maskTextSelector`.
Treat capture files containing screen data as you would a screen recording of the user's
session.

## Known limits (inherent to DOM recording)

- **`<canvas>` and `<video>` content is not captured** — the elements are recorded, their
  pixels are not.
- **Cross-origin iframes** cannot be read, so only the container is recorded.
- **Assets are re-fetched at playback time.** Fonts, images and stylesheets behind an
  intranet or an authenticated URL will not resolve on the machine doing the replay.
- **Pages with very high mutation rates** (large virtualized lists, animation loops) can
  slow down noticeably while recording.

If pixel-accurate visuals matter more than these trade-offs, a remote inspector or a plain
screen recording is the better tool.

## License

MIT
