---
"trakoo": minor
"@trakoo/openpanel": minor
---

Server analytics supports groups, such as the company or workspace a user acts for. `group(type, id, traits?, { userId? })` creates or updates a group and adds the user to it, and `track()`'s `groups` option attributes an event to its groups by type (`{ company: "acme" }`). Providers opt in by implementing the new optional `group` method; routing calls it `"group"`, and a provider routed with `pii: false` receives the group's traits without personal keys such as `name`. A group type or id that is not a non-empty string fails validation with `invalid_options`.

`@trakoo/openpanel`'s server provider upserts the OpenPanel group (named by its `name` trait, or its id), assigns the profile to it, and sends each event's group ids as OpenPanel's `groups`, without keeping any group on the shared client between requests.
