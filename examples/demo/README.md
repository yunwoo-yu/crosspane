# crosspane demo

A page that generates every kind of event the agent captures — logs, errors,
failed requests, SPA navigations — so you can see the dashboard fill up in seconds.

```bash
pnpm build                      # builds the agent this page loads
node packages/cli/dist/index.js # terminal 1 — the hub, http://localhost:7788
node examples/demo/serve.mjs    # terminal 2 — the demo, http://localhost:7999
```

Open **http://localhost:7999**, click the buttons, and watch them appear in the
dashboard at **http://localhost:7788**.

Click **● start screen recording** to capture the DOM, then open the **Screen** tab in the
dashboard to play it back. (It needs a moment to take the first full snapshot.)

Then try the offline path: click **⤓ export capture file** and drop the downloaded
`.crosspane.json` onto the dashboard — same view, no live connection.

## Recording the README assets

The GIF and screenshot in the root README were produced from this demo:

```bash
pnpm build
node packages/cli/dist/index.js --no-open &
node examples/demo/serve.mjs &

agent-browser --session dash set viewport 1280 720
agent-browser --session dash open http://localhost:7788
agent-browser --session dash record start /tmp/demo.webm
# drive the demo page in a second session, then switch dashboard tabs
agent-browser --session dash record stop

ffmpeg -i /tmp/demo.webm \
  -vf "fps=10,scale=880:-1:flags=lanczos,split[s0][s1];[s0]palettegen=max_colors=96[p];[s1][p]paletteuse=dither=bayer:bayer_scale=4" \
  -loop 0 docs/images/demo.gif
```

Keep it under ~25 seconds and ~250 KB — GitHub serves README images on every page view.

To try it from a phone on the same network, run the hub with `--host 0.0.0.0` and
change `serverUrl` in `index.html` to your machine's LAN address.
