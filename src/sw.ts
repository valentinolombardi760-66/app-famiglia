/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

declare const self: ServiceWorkerGlobalScope

cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// New versions take over right away, so everyone gets fixes without reinstalling.
self.addEventListener('install', () => void self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

interface PushPayload {
  title: string
  body: string
  tag?: string
  url?: string
}

self.addEventListener('push', (event) => {
  const data: PushPayload = event.data?.json() ?? { title: 'OnlyFam.ly', body: '' }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      icon: 'icons/icon-192.png',
      badge: 'icons/badge-96.png',
      data: { url: data.url ?? './' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url ?? './', self.registration.scope).href
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      const open = windows.find((w) => w.url.startsWith(self.registration.scope))
      if (open) {
        await open.focus()
        await open.navigate(target)
      } else {
        await self.clients.openWindow(target)
      }
    })(),
  )
})
