# FlowForge Bootstrap Commands

## Install

```bash
npm install
```

## Start Development Server

```bash
npm run dev
```

Default Nuxt URL:

```text
http://localhost:3000
```

If port 3000 is busy, Nuxt will choose another port. Use the URL printed by the
dev server.

## Open Pages

```text
/
/compiler
```

## Test Placeholder API

```bash
curl -X POST http://localhost:3000/api/compile \
  -H "Content-Type: application/json" \
  -d '{"input":"When a customer asks for a refund, classify the request and draft a reply for human review.","mode":"demo"}'
```

Expected:

- compile job JSON
- zero provider calls
- approval gates included
- real-world execution blocked

## Test Validation

```bash
curl -X POST http://localhost:3000/api/compile \
  -H "Content-Type: application/json" \
  -d '{"input":"","mode":"demo"}'
```

Expected:

- HTTP 400
- process description validation error

## Build Check

```bash
npm run build
```

This is a stronger check than Milestone 0 strictly needs, but it verifies that
Nuxt can compile the app and shared types.

## Milestone 0 Environment

No environment variables are required to run Milestone 0.

Future provider keys may be added to `.env`, but they are intentionally unused
until provider integration milestones.
