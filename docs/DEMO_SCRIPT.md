# FlowForge Demo Script

## Demo Goal

Show that FlowForge finds a safe automation boundary instead of turning every
request into an uncontrolled automation.

Milestone 0 is a scaffold demo only. It proves the app shape, pages, shared
types, and mock compile API.

## Opening Line

```text
FlowForge turns messy process descriptions into safe, human-gated automation
blueprints.
```

## Demo Input

Use this process description:

```text
When a customer asks for a refund, classify the reason, detect angry or legal
language, draft a reply, and route high-risk cases to a human.
```

## Walkthrough

1. Open `/`.
2. Explain the product sentence:

```text
Messy process in. Safe automation blueprint out.
```

3. Open `/compiler`.
4. Use the preset refund process or paste the demo input.
5. Click `Compile preview`.
6. Point out that the result is a placeholder compile job.
7. Show the pipeline:

```text
Initialize Compile Job
Mock Signal Scan
Mock Risk Review
Mock Blueprint
```

8. Show the safety boundary:

- classification can be automated
- risk detection can be automated
- drafting can be automated as draft-only output
- external communication needs approval
- sensitive or high-stakes decisions need approval
- real-world execution is blocked in the MVP

9. Show the agent trace and token usage:

- provider calls used: 0
- execution: blocked
- human review: required

## API Demo

With the dev server running:

```bash
curl -X POST http://localhost:3000/api/compile \
  -H "Content-Type: application/json" \
  -d '{"input":"When a customer asks for a refund, classify the reason and draft a reply for human review.","mode":"demo"}'
```

Expected result:

- HTTP 200
- a compile job object
- `status` is `done`
- `token_usage.llm_calls_used` is `0`
- `result.automation_boundary` is `human_approval_required`
- approval gates are present

## Bad Input Demo

```bash
curl -X POST http://localhost:3000/api/compile \
  -H "Content-Type: application/json" \
  -d '{"input":"","mode":"demo"}'
```

Expected result:

- HTTP 400
- message says a process description is required

## What To Say If Asked What Is Real

Real in Milestone 0:

- Nuxt pages
- shared TypeScript types
- local compile API
- typed mock response
- safety boundary documentation

Not real yet:

- scanner tools
- router agent
- workflow architect
- schema validator
- provider calls
- storage
- n8n export
- workflow execution

## Closing Line

```text
FlowForge is useful because it does not automate everything. It finds the
boundary where automation is helpful and human review is still necessary.
```
