---
name: storyboard-campaign-operations
description: Operate one Storyboard campaign through its scoped workspace, player-safe views and reveals, roster, cockpit, transcript, music, visual-generation, slideshow and play-mode tools. Use whenever preparing, running, reviewing, organising or generating material for the campaign.
---

# Storyboard campaign operations

You are attached to exactly one Storyboard campaign. Read the campaign id from your Agent identity and substitute it
for `{campaign}` below. Every request requires `Authorization: Bearer $REDLEAF_EXECUTION_TOKEN` and may be sent only
to trusted loopback RedLeaf at `http://127.0.0.1:18804`. Never print, persist or forward the bearer.

## Start with evidence

Use `GET /api/apps/storyboard/campaigns/{campaign}/agent/state` for the bounded operational overview. It includes the
campaign, roster, play mode, cockpit, current reveals, current transcript session, music state, visual state and effective playbooks.
Use the narrower reads when you need detail:

- `GET .../agent/workspace` for schemas and the initial workspace projection.
- `GET .../agent/workspace/entities?types=a,b&query=text&cursor=0&limit=100` for paginated canonical content.
- `GET .../agent/players` for players, attendance and their characters.
- `GET .../agent/reveals` for the current entity visibility state.
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
- Prepare the safe player-facing projection: `PUT .../agent/workspace/entities/{entity}/player-view` with
  `{title,description,imageField?,fieldKeys,expectedUpdatedAt,operationId}`. Only explicitly selected, non-sensitive
  fields can enter this view. Never copy hidden GM notes into its title or description.

Heartbeat discussions are autonomous and read-only for canonical workspace data. During a heartbeat, propose changes
in the heartbeat discussion or use a cockpit proposal. Never delete workspace entities.

## Information, planning, music and visuals

- Submit grounded, reversible cockpit proposals with `POST .../agent/cockpit/proposals`. A reveal proposal uses
  `{entityId,title,summary,evidence,confidence,operationId,action:"reveal",everyone,playerIds}` and requires an existing
  Player view. Accepting it performs the same visibility operation as the Cockpit control.
- In an interactive GM discussion, reveal or hide an entity directly with
  `POST .../agent/workspace/entities/{entity}/visibility` and
  `{everyone,playerIds,visible,operationId}`. `everyone:true` targets all active players; otherwise `playerIds` contains
  Storyboard player-membership ids from the roster. A reveal adds the entity to each recipient's Journal and triggers
  their in-app discovery notice. It does not project the entity into the room.
- During a heartbeat, visibility may change directly only in active play mode when the Information playbook enables
  autonomous drafts. Otherwise create a reveal proposal for GM approval. Hiding follows the same authority rule.
- Find existing music with `POST .../agent/music/find`; find an existing visual with `POST .../agent/visuals/match`.
- In an interactive GM discussion, update the campaign visual identity with `PUT .../agent/visuals/profile`. First read
  the current profile from `GET .../agent/visuals`, then send the complete profile object with the requested changes
  and every unchanged field preserved. This route validates the image workflow and visual settings. The generic
  Workspace update remains intentionally read-only for the underlying system record, and heartbeats cannot use this
  operation.
- Music generation uses `POST .../agent/music/generations`. It produces reviewable candidates and is allowed only
  during active play mode when the music playbook enables autonomous drafts.
- Generate one reusable 16:9 campaign image with `POST .../agent/visuals/images` and
  `{operationId,prompt,title?,confirmed:true}`. Describe only the visible scene; Storyboard applies the saved campaign
  visual identity, campaign image-model workflow, projection composition and negative prompt. The completed image is saved directly
  to the campaign library. Read its exact operation through `GET .../agent/visuals/generations/{operation}` and use
  the returned candidate's `promotedVisual` as the library visual id.
- During active play mode, add a library image to the slideshow with `POST .../agent/visuals/queue` and
  `{visualId,operationId}`, remove one with `POST .../agent/visuals/queue/{queueItemId}/remove`, or show it immediately
  with `POST .../agent/visuals/show` and `{visualId,operationId}`. Queue removal never deletes the reusable image.
- Visual playlists are optional preparation aids. Prefer one-image generation plus direct queue/show commands during
  a live scene.

Music candidates remain drafts and music playback stays under GM control. Visual generation and slideshow mutation
follow the narrower rules above. Do not add/remove players, change roles, expose credentials or rewrite the transcript.

## Working discipline

Distinguish established facts, player discoveries, player beliefs and your proposals. Treat the Player view as the
only authorized player-facing content, regardless of what the canonical GM entity contains. Cite entity ids or transcript
event ids when a recommendation depends on them. Prefer updating existing canonical content over creating duplicates.
Use stable operation ids for every retryable mutation.
