# Trakoo Agent Skill Design

## Goal

Add a consumer-facing Agent Skill that helps application developers integrate and use Trakoo correctly. The skill must be installable from this repository with the `skills` CLI and useful across TypeScript frameworks without duplicating the full documentation site.

## Research Summary

Popular TypeScript projects use three recurring structures:

- Better Auth publishes a broad integration guide plus narrower feature skills in a dedicated repository.
- Vercel AI SDK keeps a focused consumer skill in the main repository and tells agents to verify version-sensitive APIs against installed package documentation and source.
- tRPC and CopilotKit use routers and many specialized skills for larger API surfaces.

Trakoo is compact enough that a routed skill pack would add navigation and maintenance overhead without improving the common integration flow. A focused core skill with on-demand reference files provides the best balance of discoverability, context size, and coverage.

## Package Structure

```text
skills/trakoo/
├── SKILL.md
└── references/
    ├── providers.md
    └── frameworks.md
```

`skills/trakoo/SKILL.md` is the installable entry point discovered by the `skills` CLI. It contains the integration workflow, core invariants, a concise working example, verification guidance, and pointers to the two references.

`references/providers.md` contains the provider capability and dependency matrix, selection guidance, routing patterns, Proxy transport, custom providers, and provider-specific constraints.

`references/frameworks.md` contains framework detection and integration guidance for Next.js, SvelteKit, TanStack Start, Astro, and framework-neutral browser/server TypeScript projects. It focuses on file placement, environment-variable boundaries, navigation tracking, and server lifecycle rather than restating framework documentation.

## Triggering and Scope

The skill should trigger when developers:

- Mention Trakoo or its package entry points.
- Add typed, provider-agnostic analytics to a TypeScript application.
- Configure a Trakoo provider such as PostHog, OpenPanel, Bento, Pirsch, EmitKit, Visitors, or Proxy.
- Define typed events, identify users, route events between providers, or troubleshoot Trakoo client/server integration.

The skill is for applications consuming Trakoo. It does not govern development of the Trakoo repository itself, releases, or changes to Trakoo internals.

## Integration Workflow

When activated, the skill guides the agent through this sequence:

1. Inspect the consuming project to detect its package manager, framework, client/server boundaries, installed Trakoo version, and existing analytics dependencies.
2. Determine whether the integration needs browser tracking, server tracking, or both, and choose providers based on the events and delivery guarantees required.
3. Install `trakoo` and only the optional provider SDKs required by the chosen configuration.
4. Define a central typed event collection before adding tracking calls. Preserve exact event names with `as const satisfies` and pass its type to each analytics factory.
5. Create browser and server analytics modules using their environment-specific entry points. Keep secrets and server providers out of browser bundles.
6. Add tracking at authoritative locations: interactions and navigation in the browser; payments, signups, jobs, and other critical events on the server.
7. Apply lifecycle rules: identify once and reset on logout in the browser; pass user context per server event; await critical server events and flush or shut down before short-lived runtimes exit.
8. Configure multi-provider routing, Proxy delivery, or custom providers only when the application requirements call for them.
9. Run the consuming project’s formatter, type checker, and relevant tests. Resolve type or import failures using the installed package declarations and official Trakoo documentation rather than guessing.

## Core Correctness Rules

- Import shared event types from `trakoo`, browser APIs from `trakoo/client`, server APIs from `trakoo/server`, and providers from `trakoo/providers/client` or `trakoo/providers/server`.
- Do not import server providers, secrets, or server-only environment variables into browser code.
- Keep a single browser analytics instance per session. Treat server analytics as stateless across users.
- Call client `identify()` after authentication and `reset()` on logout.
- Pass user context explicitly to server tracking calls.
- Await critical server events and call `shutdown()` in short-lived/serverless execution paths, preferably from `finally`.
- Use routing rules for provider-specific constraints rather than sending every event and method to every provider.
- Do not invent provider packages or options. Verify version-sensitive details against installed types, source, or official documentation.

## Error Handling

The skill should diagnose common integration failures before proposing broad changes:

- Wrong entry point or client/server code mixed in one module.
- Missing optional provider dependency.
- Event collection type not supplied to an analytics factory.
- Event name or property shape that does not match the typed collection.
- Browser user state not reset after logout.
- Server event not awaited or provider queue not flushed.
- Provider requirements not met, such as Bento lacking an identified email, Pirsch server tracking lacking request context, or Visitors identification without persistence and consent.
- Mutually exclusive provider routing options combined in one configuration.

When the installed package API differs from the repository documentation, the installed package declarations are authoritative for generated code. The agent should explain the version mismatch and avoid silently upgrading unless the user requests it.

## Testing and Evaluation

The skill is a reference/integration skill, so evaluation should use realistic application tasks rather than discipline-pressure scenarios. Before writing the skill, establish baseline agent behavior without it for representative prompts. After writing it, rerun the same prompts with the skill and compare correctness.

Initial scenarios should cover:

1. A Vite or framework-neutral browser app adding typed PostHog tracking and user lifecycle handling.
2. A Next.js application tracking a critical server event while keeping credentials server-only and flushing correctly.
3. A multi-provider setup routing anonymous page views and identified lifecycle events to providers with different requirements.

Objective checks include correct import paths, a typed event collection, environment-safe configuration, required optional dependencies, correct client/server lifecycle behavior, and a verification step. Test artifacts should stay outside the installable skill directory unless they provide ongoing value to maintainers.

## Documentation and Installation

The repository README should gain a short Agent Skill section with the installation command:

```bash
npx skills add multiplehats/trakoo --skill trakoo
```

The section should state that the skill helps coding agents integrate typed Trakoo analytics and link to `skills/trakoo/SKILL.md`. The skill itself links to the official Trakoo documentation for details likely to change.

## Success Criteria

- `npx skills add multiplehats/trakoo --skill trakoo` discovers the skill from the repository layout.
- The `SKILL.md` frontmatter satisfies the Agent Skills specification and clearly triggers for Trakoo consumer integration tasks.
- The main skill stays concise and delegates provider/framework detail to explicit on-demand references.
- Examples use only public exports and valid configuration from the current repository.
- Baseline-versus-skill evaluations show improved correctness for typed events, import boundaries, provider dependencies, and runtime lifecycle.
- Repository formatting and validation checks pass.

## Out of Scope

- Contributor instructions for modifying Trakoo itself.
- A dedicated MCP server or live documentation service.
- Separate installable skills for each provider or framework.
- Automated migration from other analytics libraries.
- Publishing a separate skills repository.
