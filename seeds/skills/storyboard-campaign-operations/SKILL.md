---
name: storyboard-campaign-operations
description: Operate one Storyboard campaign through its scoped workspace, roster, cockpit, transcript, music, visual and play-mode tools. Use whenever preparing, running, reviewing, organising or generating material for the campaign.
---

# Storyboard campaign operations

You are attached to exactly one Storyboard campaign. Read the campaign id from your Agent identity and substitute it
for `{campaign}` below. Every request requires `Authorization: Bearer $REDLEAF_EXECUTION_TOKEN` and may be sent only
to trusted loopback RedLeaf at `http://127.0.0.1:18804`. Never print, persist or forward the bearer.

## Start with evidence

Use `GET /api/apps/storyboard/campaigns/{campaign}/agent/state` for the bounded operational overview. It includes the
campaign, roster, play mode, cockpit, current transcript session, music state, visual state and effective playbooks.
Use the narrower reads when you need detail:

- `GET .../agent/workspace` for schemas and the initial workspace projection.
- `GET .../agent/workspace/entities?types=a,b&query=text&cursor=0&limit=100` for paginated canonical content.
- `GET .../agent/players` for players, attendance and their characters.
- `GET .../agent/transcript/sessions` and `GET .../agent/transcript/sessions/{session}/events?limit=200`.
- `GET .../agent/music` and `GET .../agent/music/generations/{operation}`.
- `GET .../agent/visuals` and `GET .../agent/visuals/generations/{operation}`.
- `GET .../agent/playbooks` before autonomous or creative work.

Do not call generic RedLeaf entity, search, discussion, filesystem or application APIs. The scoped tools deliberately
hide sensitive fields and prevent access to another campaign.

## Workspace content

In a normal GM discussion, you may create or revision-check update typed campaign content when the GM asks you to do
so. Use the schema returned by the workspace read and preserve field types.

- Create: `POST .../agent/workspace/entities` with `{typeSlug,name,parent?,data}`.
- Update: `PUT .../agent/workspace/entities/{entity}` with `{name,data,expectedUpdatedAt}`.

Heartbeat discussions are autonomous and read-only for canonical workspace data. During a heartbeat, propose changes
in the heartbeat discussion or use a cockpit proposal. Never delete workspace entities.

## Planning, music and visuals

- Submit grounded, reversible cockpit proposals with `POST .../agent/cockpit/proposals`.
- Find existing music with `POST .../agent/music/find`; find an existing visual with `POST .../agent/visuals/match`.
- Media generation uses `POST .../agent/music/generations` and `POST .../agent/visuals/generations`. The server allows
  it only during active play mode when the corresponding playbook enables autonomous drafts, and applies cooldown and
  idempotency rules. Read generation status through the matching detail endpoint.

Generated candidates are drafts. Do not promote them into canonical libraries, alter queues, start playback or change
the player projection. Those are explicit GM actions. Do not add/remove players, change roles, expose credentials or
rewrite the transcript.

## Working discipline

Distinguish established facts, player discoveries, player beliefs and your proposals. Cite entity ids or transcript
event ids when a recommendation depends on them. Prefer updating existing canonical content over creating duplicates.
Use stable operation ids for every retryable mutation.
