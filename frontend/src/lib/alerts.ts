import { readGeneralPreferences } from '@/store/preferences.store';

/**
 * The two things the alert preferences actually do.
 *
 * `criticalAlerts` raises a browser notification so a failure is noticed when
 * the window is not in front; `sound` plays a short tone with it. Both are
 * best-effort: permission can be denied, audio can be blocked before the first
 * gesture, and neither failure is worth surfacing — the event is already in the
 * in-app log either way.
 */

let audioContext: AudioContext | null = null;

/** A short two-tone chirp. Synthesised, so there is no asset to ship or 404. */
function playTone(): void {
  try {
    audioContext ??= new AudioContext();
    if (audioContext.state === 'suspended') void audioContext.resume();

    const now = audioContext.currentTime;
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(660, now);
    oscillator.frequency.setValueAtTime(880, now + 0.09);

    /* Ramp rather than switch: an instant cut is an audible click. */
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

    oscillator.connect(gain).connect(audioContext.destination);
    oscillator.start(now);
    oscillator.stop(now + 0.24);
  } catch {
    /* No audio device, or the context was blocked. Nothing to recover. */
  }
}

function showBrowserNotification(text: string): void {
  if (typeof Notification === 'undefined') return;

  const show = (): void => {
    try {
      void new Notification('Savdo', { body: text, tag: 'savdo-alert' });
    } catch {
      /* Some browsers only allow notifications from a service worker. */
    }
  };

  if (Notification.permission === 'granted') {
    show();
    return;
  }
  if (Notification.permission === 'denied') return;

  void Notification.requestPermission().then((permission) => {
    if (permission === 'granted') show();
  });
}

/**
 * Announce an event outside the window, if the user asked for that.
 *
 * Called only for events the app considers critical — a failed sync, a rejected
 * write — never for routine confirmations.
 */
export function raiseCriticalAlert(text: string): void {
  const { criticalAlerts, sound } = readGeneralPreferences();

  if (criticalAlerts) showBrowserNotification(text);
  if (sound) playTone();
}
