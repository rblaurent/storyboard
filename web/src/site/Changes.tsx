import { useEffect } from 'react'
import { api } from './api'

const eventName = 'storyboard:campaign-changes'
const allTopics = ['visuals', 'music', 'transcript', 'cockpit', 'players', 'play-mode', 'journal']

interface ChangeEnvelope { token: string; topics: string[] }
interface ChangeDetail { campaignId: string; topics: string[] }

export function CampaignChanges({ campaignId }: { campaignId: string }) {
  useEffect(() => {
    let stopped = false
    let token = ''
    let retry: number | undefined
    let controller: AbortController | undefined
    let failures = 0

    const dispatch = (topics: string[]) => window.dispatchEvent(new CustomEvent<ChangeDetail>(eventName, { detail: { campaignId, topics } }))
    const schedule = (delay = 0) => {
      window.clearTimeout(retry)
      retry = window.setTimeout(() => void listen(), delay)
    }
    const listen = async () => {
      if (stopped || document.hidden || controller) return
      const request = new AbortController()
      controller = request
      try {
        const query = token ? `?since=${encodeURIComponent(token)}` : ''
        const value = await api<ChangeEnvelope>(`/campaigns/${campaignId}/changes${query}`, '', 'GET', undefined, request.signal)
        token = value.token
        failures = 0
        if (value.topics.length) dispatch(value.topics)
        if (controller === request) controller = undefined
        schedule()
      } catch {
        const aborted = request.signal.aborted
        if (controller === request) controller = undefined
        if (!aborted && !stopped) {
          failures += 1
          schedule(Math.min(30_000, 1_000 * 2 ** Math.min(failures - 1, 5)))
        } else if (!stopped && !document.hidden) schedule()
      }
    }
    const visibility = () => {
      if (document.hidden) { controller?.abort(); window.clearTimeout(retry) }
      else schedule()
    }
    const safety = window.setInterval(() => { if (!document.hidden) dispatch(allTopics) }, 60_000)
    document.addEventListener('visibilitychange', visibility)
    schedule()
    return () => {
      stopped = true
      controller?.abort()
      window.clearTimeout(retry)
      window.clearInterval(safety)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [campaignId])
  return null
}

export function useCampaignTopic(campaignId: string, topic: string, refresh: () => void) {
  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<ChangeDetail>).detail
      if (detail?.campaignId === campaignId && detail.topics.some(value => value === topic || value === '*' || topic === 'journal' && value.startsWith('journal:'))) refresh()
    }
    window.addEventListener(eventName, changed)
    return () => window.removeEventListener(eventName, changed)
  }, [campaignId, topic, refresh])
}
