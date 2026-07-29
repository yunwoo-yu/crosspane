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

Then try the offline path: click **⤓ export capture file** and drop the downloaded
`.crosspane.json` onto the dashboard — same view, no live connection.

To try it from a phone on the same network, run the hub with `--host 0.0.0.0` and
change `serverUrl` in `index.html` to your machine's LAN address.
