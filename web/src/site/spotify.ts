export interface SpotifyWebPlaybackState { paused: boolean; position: number; duration: number }

export interface SpotifyWebPlayer {
  addListener(event: string, listener: (value: any) => void): boolean
  connect(): Promise<boolean>
  disconnect(): void
  activateElement(): Promise<void>
  togglePlay(): Promise<void>
  pause(): Promise<void>
}

interface SpotifyWebPlayerConstructor {
  new(options: { name: string; getOAuthToken: (callback: (token: string) => void) => void; volume: number; enableMediaSession: boolean }): SpotifyWebPlayer
}

declare global {
  interface Window {
    Spotify?: { Player: SpotifyWebPlayerConstructor }
    onSpotifyWebPlaybackSDKReady?: () => void
    __storyboardSpotifyPlayerReady?: boolean
  }
}

let spotifySdkPromise: Promise<void> | null = null

export function spotifyWebPlaybackSdk() {
  if (window.Spotify) return Promise.resolve()
  if (spotifySdkPromise) return spotifySdkPromise
  spotifySdkPromise = new Promise<void>((resolve, reject) => {
    const previous = window.onSpotifyWebPlaybackSDKReady
    const timer = window.setTimeout(() => reject(new Error('spotify_sdk_timeout')), 15000)
    const failed = () => { window.clearTimeout(timer); reject(new Error('spotify_sdk_unavailable')) }
    window.onSpotifyWebPlaybackSDKReady = () => { window.clearTimeout(timer); previous?.(); resolve() }
    const existing = document.querySelector<HTMLScriptElement>('script[data-storyboard-spotify-sdk]')
    if (existing) existing.addEventListener('error', failed, { once: true })
    else {
      const script = document.createElement('script')
      script.src = 'https://sdk.scdn.co/spotify-player.js'
      script.async = true
      script.dataset.storyboardSpotifySdk = ''
      script.addEventListener('error', failed, { once: true })
      document.body.appendChild(script)
    }
  }).catch(error => { spotifySdkPromise = null; throw error })
  return spotifySdkPromise
}
