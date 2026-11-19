---
name: funai-spend-wisely
description: Keep FunAI spending predictable. Use before any paid FunAI MCP call that may cost more than a few cents (video, long audio, batches, premium models, Tools, templates, renders), when the person asks what something costs or how many credits they have, and when a FunAI tool reports insufficient credits, spend_cap_exceeded or grant_inactive. Covers estimate_cost, get_credit_balance, the per-connection spending limit, Connected apps, and what to say when credits run out.
license: MIT
---

# Spend FunAI credits wisely

FunAI bills per generation. Over an OAuth connection it spends the person's FunAI credits
($1 = 10,000 credits) at studio prices. With an API key it spends the developer API
balance instead. The person should never be surprised by a charge.

## Before a paid call

1. Know the price. `list_models` shows each model's price per run in credits and US
   dollars. `estimate_cost` gives the exact figure for a specific run, using the same pricing
   path as the real charge. Give it the `workflow`, and `duration` for per-second video models
   or `char_count` for speech.
2. Tell the person the price in dollars (and credits if they use credits), for the whole
   request: multiply by the number of outputs or clips.
3. Wait for a clear yes before anything expensive: all video, long audio, renders, batches,
   `output_count` above 1, or any single run over about $0.50.
4. If cost matters, offer a cheaper model by name next to the one they asked for.

Free tools need no confirmation: `list_models`, `get_model_schema`, `estimate_cost`,
`get_credit_balance`, `list_tools`, `list_templates`, `get_job_status`, `list_generations`,
`editor_sessions`, `editor_commands`, `render_status`, and `upload_file` (free, but uses storage).

## Checking the balance

`get_credit_balance` shows the credits of the connected account. Check it before a large job,
and compare it with the estimate.

## Never pay twice

- Paid calls are billed once and never retried by the server. Do not retry one yourself
  after a timeout or a lost answer: check `list_generations` or `get_job_status` first.
- `cancel_job` is free while a job is queued. Once the provider has started, stopping costs
  the full price and the result still arrives. Ask the person before passing
  `accept_charge: true`.

## When money stops a call

- **Insufficient credits** (a tool error saying so): tell the person how much the run needs
  and what `get_credit_balance` shows. Offer a cheaper model. For more credits, they can see
  plans and credit packs at https://funai.art/pricing. Mention it once, as information. Do not
  push a purchase and never try to buy anything for them.
- **`spend_cap_exceeded`**: the connection reached the spending limit the person chose when
  they connected ($5, $10, $25 or $50 per 30 days, or no limit). Paid calls stop until the
  30-day window rolls over or they raise the limit in FunAI under Studio > Settings >
  Connected apps. Free tools keep working.
- **`grant_inactive`**: the connection was just disconnected. The client will ask them to
  sign in again.
- **`insufficient_scope`**: the person did not allow that permission (for example
  `generate` or `editor`) when connecting. They can reconnect and allow it.

## Connected apps

Studio > Settings > Connected apps lists every assistant connected to the person's FunAI
account, with its permissions, spending limit and last use. They can change the limit or
disconnect there; a disconnect takes effect within a minute. A connection lasts 90 days and
then asks for approval again.
