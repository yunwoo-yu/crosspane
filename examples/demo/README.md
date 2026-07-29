# crosspane demo

A page that generates every kind of event the agent captures — logs, errors,
failed requests, SPA navigations — so you can see the dashboard fill up in seconds.

```bash
pnpm build   # builds the agent this page loads
pnpm try     # hub on :7788 and this page on :7999, in one terminal
```

Then open <http://localhost:7999> and click the buttons; they show up in the dashboard at
<http://localhost:7788>. Use `pnpm try:lan` instead to reach it from a phone on your Wi-Fi, and
`pnpm hub` / `pnpm demo` if you want them in separate terminals.

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
pnpm try &

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
