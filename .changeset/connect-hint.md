---
'crosspane': minor
---

The empty dashboard now shows the exact snippet to paste into your app, with the hub's real
address filled in.

Only the hub knows which port it ended up on and which LAN addresses reach it, but the user is
looking at the dashboard. Printing it to the terminal alone is easy to miss — and if the default
port was taken, the hub quietly moved to the next one while the app still pointed at 7788, so
sessions went nowhere and the dashboard sat empty with no explanation. A new `GET /hub-info`
endpoint reports the bound port and reachable addresses, and the empty state renders a
copy-pasteable `initCrosspane({ serverUrl: … })` from it. When the hub is bound to localhost it
also says how to accept sessions from a phone.
