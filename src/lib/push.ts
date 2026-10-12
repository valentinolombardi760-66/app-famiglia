import { supabase } from './supabase'

const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

export type PushState = 'unsupported' | 'denied' | 'off' | 'on'

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && Boolean(vapidPublicKey)
}

export async function currentPushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported'
  if (Notification.permission === 'denied') return 'denied'
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  return sub ? 'on' : 'off'
}

/** Asks permission, subscribes this phone and saves the subscription for `memberId`. */
export async function enablePush(memberId: string): Promise<PushState> {
  if (!pushSupported()) return 'unsupported'
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off'

  const reg = await navigator.serviceWorker.ready
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey!),
    }))
  const json = sub.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert(
    { member_id: memberId, endpoint: sub.endpoint, p256dh: json.keys!.p256dh, auth: json.keys!.auth },
    { onConflict: 'endpoint' },
  )
  if (error) throw error
  return 'on'
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration()
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
  await sub.unsubscribe()
}

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}
