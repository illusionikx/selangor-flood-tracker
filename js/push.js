// Web Push, browser side. Deferred: ui.js loads it when a reader turns notifications on, and app.js
// loads it on landing when they already have. The server half is pushSend() in push.php.

import { PREFS } from './state.js';
import { askJson } from './ask.js';

const API = 'api.php?push=';

/* The VAPID public key arrives base64url and `subscribe()` wants bytes. */
const bytes = s => Uint8Array.from(
  atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4)), c => c.charCodeAt(0));

const post = (mode, doc, opts = {}) =>
  askJson(API + mode, { method: 'POST', body: JSON.stringify(doc), ...opts });

const current = async () => (await navigator.serviceWorker.ready).pushManager.getSubscription();

async function subscribe() {
  const { key } = await askJson(API + 'key', { ms: 15000 });
  if (!key) throw new Error('Notifications are not set up on the server.');
  return (await navigator.serviceWorker.ready).pushManager.subscribe(
    { userVisibleOnly: true, applicationServerKey: bytes(key) });
}

/* What the server last accepted. A sync that would post the same document does nothing, so a burst of
   unrelated preference writes costs no request. */
let posted = '';
async function send(sub) {
  const body = {
    sub: sub.toJSON(), favs: PREFS.favs || [], ignored: PREFS.ignored || [],
    // The four thresholds alone. The master flag stays on the phone, so flipping it posts nothing new.
    on: Object.fromEntries(['favWarn', 'favDanger', 'anyWarn', 'anyDanger'].map(k => [k, !!PREFS.push?.[k]])),
  };
  const text = JSON.stringify(body);
  if (text === posted) return;
  await post('1', body, { tries: 2, ms: 15000 });
  posted = text;
}

/* Turn notifications on. Returns false when the reader declines the browser's question, and the
   caller puts the switch back. Anything else that goes wrong throws, and the caller says so. */
export async function pushOn() {
  if (await Notification.requestPermission() !== 'granted') return false;
  await send(await current() || await subscribe());
  return true;
}

/* Turn them off. The browser unsubscribes even when the server cannot be reached: a push service
   answers 410 for a dead subscription, and the server deletes the row on its next send. */
export async function pushOff() {
  const sub = await current();
  if (!sub) return;
  posted = '';
  try {
    await post('1', { sub: null, endpoint: sub.endpoint, on: {}, favs: [], ignored: [] }, { tries: 2, ms: 15000 });
  } finally {
    await sub.unsubscribe();
  }
}

/* Keep the server's copy of the switches and the two lists current. Runs on landing and after a
   change. A browser that lost the subscription while permission still stands gets a new one. */
export async function pushSync() {
  if (!PREFS.push?.on || Notification.permission !== 'granted') return;
  await send(await current() || await subscribe());
}

/* One message to this phone alone, through the server, to prove the whole path works. */
export async function pushTest() {
  const sub = await current();
  if (!sub) throw new Error('This phone is not subscribed.');
  await post('test', { sub: sub.toJSON(), on: {}, favs: [], ignored: [] }, { tries: 1, ms: 20000 });
}

/* A reader clears a list one row at a time, and every row is a save(). Wait for them to stop. */
let wait;
document.addEventListener('prefs', () => {
  clearTimeout(wait);
  wait = setTimeout(() => pushSync().catch(() => {}), 2000);
});
