export interface Account { id: string; name: string; avatar: string; canCreate: boolean; csrfToken: string }
export interface Person { id: string; name: string; avatar: string }
export interface Campaign { id: string; name: string; description: string; summary: string; summaryStale: boolean; image: string | null; archived: boolean; revision: number; role: 'gm' | 'player'; playerCount: number; players: Person[] }
export interface Player extends Person { accountId: string; role: 'gm' | 'player'; present: boolean; characters: { id: string; name: string; portrait: string | null }[] }
export interface Operation { id: string; kind: 'image' | 'summary'; state: 'pending' | 'refining' | 'generating' | 'saving' | 'completed' | 'failed'; error: string; refinedPrompt: string; applied: boolean }
export interface MusicStatus { available: boolean; connected: boolean; displayName: string | null; deviceReady: boolean; error: string | null }
export interface MusicPlaylist { id: string; name: string; description: string; trackCount: number }
export interface MusicTrack { id: string; name: string; artist: string; album: string | null; imageUrl: string | null; durationMs: number; uri: string | null; sourceKind: 'spotify' | 'generated'; audioUrl: string | null }
export interface MusicQueueItem { queueId: string; track: MusicTrack }
export interface MusicPage<T> { items: T[]; offset: number; limit: number; total: number; hasMore: boolean }
export interface MusicPlayback { available: boolean; playing: boolean; track: MusicTrack | null; progressMs: number; deviceId: string | null; deviceName: string | null; volumePercent: number; error: string | null }
export interface MusicBrief { title: string; prompt: string; style: string; negativeTags: string; mood: string; energy: string; tempo: string; instruments: string[]; narrativeArc: string; durationSeconds: number; instrumental: true }
export interface MusicCandidate { id: string; title: string; tags: string; durationSeconds: number; audio: string; cover: string | null; promotedTrack: string }
export interface MusicGeneration { id: string; state: 'pending' | 'generating' | 'ingesting' | 'completed' | 'failed'; error: string; creditsConsumed: number; candidates: MusicCandidate[] }
export interface VisualProfile { artDirection: string; negativePrompt: string; defaultIntervalSeconds: number; transition: 'cut' | 'crossfade' }
export interface Visual { id: string; name: string; mood: string; tags: string[]; width: number; height: number; imageUrl: string }
export interface VisualMatch { situation: string; suggestions: Visual[]; quickBrief: VisualBrief }
export interface VisualFrame { title: string; prompt: string; mood: string; tags: string[] }
export interface VisualBrief { title: string; transition: 'cut' | 'crossfade'; intervalSeconds: number; frames: VisualFrame[] }
export interface VisualCandidate extends VisualFrame { id: string; imageUrl: string; promotedVisual: string }
export interface VisualGeneration { id: string; state: 'pending' | 'generating' | 'saving' | 'completed' | 'failed'; error: string; candidates: VisualCandidate[] }
export interface VisualSet { id: string; name: string; description: string; imageCount: number }
export interface VisualQueueItem { queueId: string; visual: Visual }
export interface VisualSession { campaignId: string; revision: number; playing: boolean; blackout: boolean; loop: boolean; intervalSeconds: number; transition: 'cut' | 'crossfade'; current: Visual | null; currentQueueId: string }
export interface TranscriptSession { id: string; name: string; state: 'active' | 'ended'; startedAt: string; endedAt: string | null; startedBy: string; roleplayAnchor: string; roleplayAnchorAt: string }
export interface TranscriptActor { type: 'player' | 'character' | 'gm' | 'npc' | 'agent' | 'system' | 'table'; name: string; id?: string | null; avatar?: string | null; characterId?: string | null }
export interface TranscriptEvent { id: string; sequence: number; irlAt: string; roleplayTime: string; roleplayConfidence: 'explicit' | 'estimated' | 'unknown'; kind: string; channel: 'roleplay' | 'irl' | 'meta'; text: string; actor: TranscriptActor; speakerCluster?: string | null; speakerMapped?: boolean; corrects: string | null; sourceEvent: string | null; durationMs: number; derivationState: string | null; audioUrl: string | null }
export interface TranscriptPage { session: TranscriptSession; events: TranscriptEvent[]; nextCursor: string | null; hasEarlier: boolean }
export class ApiError extends Error { constructor(public code: string, public status: number) { super(code) } }
const messages: Record<string, string> = {
  campaign_changed: 'This campaign changed elsewhere. Your draft is kept. Review the latest saved version before trying again.',
  write_conflict: 'This campaign changed elsewhere. Your draft is kept. Review the latest saved version before trying again.',
  last_game_master: 'A campaign must keep at least one Game Master. Add another GM before changing this membership.',
  game_master_required: 'Only a Game Master can make this change.',
  campaign_access_denied: 'You do not have access to this campaign. Ask its Game Master for access.',
  campaign_creation_not_enabled: 'Campaign creation has not been enabled for your account.',
  generation_queue_full: 'There are already several requests in progress. Please try again shortly.',
  music_service_unavailable: 'The campaign music service is not installed yet.',
  music_service_error: 'The music service could not complete that request. Your queue was not changed.',
  spotify_no_active_device: 'Open Spotify on the device you want to use, start any track once, then try Play again. Your Storyboard queue is unchanged.',
  spotify_playback_restricted: 'Spotify rejected remote playback for this account or device. Open Spotify there once, then try again.',
  music_playlist_empty: 'That playlist is empty. Add a track before enqueuing it.',
  invalid_music_track: 'That Spotify result could not be saved. Search again and retry.',
  invalid_music_queue_item: 'That item could not be added to the session queue.',
  music_brief_invalid: 'The music brief came back malformed. Nothing was generated or charged.',
  music_generation_confirmation_required: 'Confirm the generation before Storyboard submits paid work.',
  music_generation_queue_full: 'Two score generations are already active. Wait for one to finish before starting another.',
  visual_generation_confirmation_required: 'Confirm the visual generation before Storyboard submits the render jobs.',
  visual_generation_queue_full: 'Two visual generations are already active. Wait for one to finish before starting another.',
  visual_set_empty: 'That visual set is empty. Add an image before enqueuing it.',
  visual_queue_empty: 'Add an image or visual set to the projection queue before starting the slideshow.',
  invalid_visual_queue_item: 'Choose either one image or one visual set to enqueue.',
  visual_session_changed: 'The projection changed on another control surface. The latest state has been loaded.',
  workspace_unavailable: 'This campaign does not have a workspace yet.',
  workspace_type_unavailable: 'That entity type is no longer available in this campaign workspace.',
  workspace_parent_invalid: 'That workspace location is no longer available.',
  workspace_entity_read_only: 'This system record is read-only here.',
  workspace_type_read_only: 'System records cannot be created from the campaign workspace.',
  workspace_entity_changed: 'This record changed elsewhere. Your draft is kept; reopen the record to load the latest version.',
  invalid_workspace_query: 'That workspace view could not be loaded. Refresh and try again.',
  account_disabled: 'This account is disabled. Contact the Storyboard administrator.',
  not_found: 'This item is unavailable, or you no longer have access.',
  storyboard_not_configured: 'Storyboard is still being prepared. Please try again later.',
  site_connection_rejected: 'Storyboard’s connection needs attention. Please try again later.',
  site_connection_unavailable: 'Storyboard’s connection is unavailable. Please try again later.',
  request_origin_rejected: 'Your session could not confirm this change. Reload and sign in again if needed.',
}
export function explain(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.status === 401) return 'Your session expired. Sign in with Google to continue.'
    if (messages[cause.code]) return messages[cause.code]
    if (cause.status === 403) return 'Your account does not have permission to do this.'
    if (cause.status === 409) return 'The saved information changed. Your draft is kept; review the latest version.'
    if (cause.status >= 500) return 'Storyboard is temporarily unavailable. Your draft is kept. Please try again.'
  }
  return 'The connection was interrupted. Your draft is kept. Please try again.'
}
export async function api<T>(path: string, csrf = '', method = 'GET', body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch('/api' + path, { method, credentials: 'same-origin', cache: 'no-store', signal, headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) })
  const json = await response.json().catch(() => ({ error: 'storyboard_unavailable' }))
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('storyboard:signout'))
    throw new ApiError(json.error || 'request_failed', response.status)
  }
  return json as T
}
// Remote images are limited to Google's verified avatar hosts. Campaign artwork is scoped media.
export function imageSource(value: string | null | undefined): string | undefined {
  if (!value) return undefined
  if (/^\/api\/campaigns\/[0-9a-f-]{36}\/(?:media\/(?:cover|characters\/[0-9a-f-]{36})|music\/(?:candidates|tracks)\/[0-9a-f-]{36}\/cover|visuals\/(?:images\/[0-9a-f-]{36}|candidates\/[0-9a-f-]{36}\/image))$/i.test(value)) return value
  try { const u = new URL(value); if (u.protocol === 'https:' && (/^lh[3-6]\.googleusercontent\.com$/.test(u.hostname) || u.hostname === 'i.scdn.co') && !u.username && !u.password && !u.port) return u.href } catch { /* Untrusted image URL. */ }
  return undefined
}
