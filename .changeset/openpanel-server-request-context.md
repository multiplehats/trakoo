---
"trakoo": minor
---

Forward the caller's IP and user agent on OpenPanel server events

A server event carries the server's own IP and user agent, so OpenPanel attributed every one of them to the datacenter rather than to the caller, and geo and device were unusable. `OpenPanelServerProvider` now promotes `context.server.ip` and `context.server.userAgent` (falling back to `context.device`) to the `openpanel-client-ip` and `user-agent` headers OpenPanel resolves them from.

Attribution is per event rather than per client, so a single long-lived provider stays correct across concurrent requests — OpenPanel's own server integrations build a client per request and mutate its headers, which a shared provider cannot do safely. The IP is sent as a header only; a `device.ip` passed in context is no longer stored as an event property.
