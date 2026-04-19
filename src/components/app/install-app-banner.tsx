'use client';

import { useEffect, useMemo, useState } from 'react';
import { Download, Share2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

const DISMISS_KEY = 'hamarok_install_banner_dismissed_v1';

function isStandaloneMode(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return window.matchMedia('(display-mode: standalone)').matches || nav.standalone === true;
}

function isIosSafariBrowser(): boolean {
  if (typeof window === 'undefined') return false;
  const ua = window.navigator.userAgent.toLowerCase();
  const isIos = /iphone|ipad|ipod/.test(ua);
  const isSafari = /safari/.test(ua) && !/crios|fxios|edgios|opios|duckduckgo/.test(ua);
  return isIos && isSafari;
}

export default function InstallAppBanner() {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem(DISMISS_KEY) === '1';
  });
  const [standalone] = useState(() => {
    if (typeof window === 'undefined') return false;
    return isStandaloneMode();
  });
  const [iosSafari] = useState(() => {
    if (typeof window === 'undefined') return false;
    return isIosSafariBrowser();
  });
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as BeforeInstallPromptEvent);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    };
  }, []);

  const visible = useMemo(() => {
    if (dismissed || standalone) return false;
    return iosSafari || Boolean(installPrompt);
  }, [dismissed, standalone, iosSafari, installPrompt]);

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  const handleInstall = async () => {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      localStorage.setItem(DISMISS_KEY, '1');
      setDismissed(true);
    }
    setInstallPrompt(null);
  };

  if (!visible) return null;

  return (
    <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+84px)] z-50 rounded-2xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-1)]/95 p-3 shadow-[0_14px_38px_rgba(0,0,0,0.45)] backdrop-blur lg:inset-x-auto lg:right-6 lg:bottom-6 lg:w-[420px]">
      <div className="flex items-start gap-3">
        <div className="rounded-xl border border-[color:var(--stroke-soft)] bg-[color:var(--surface-3)] p-2 text-tier-1">
          {iosSafari ? <Share2 className="size-4" /> : <Download className="size-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-tier-1">Install HamaROK on your Home Screen</p>
          {iosSafari ? (
            <p className="mt-1 text-xs leading-relaxed text-tier-2">
              On iPhone Safari: tap <span className="font-semibold">Share</span>, then choose{' '}
              <span className="font-semibold">Add to Home Screen</span>.
            </p>
          ) : (
            <p className="mt-1 text-xs leading-relaxed text-tier-2">
              Install this app for a full-screen, app-like experience and faster access.
            </p>
          )}
          <div className="mt-3 flex items-center gap-2">
            {!iosSafari && installPrompt ? (
              <Button size="sm" onClick={() => void handleInstall()}>
                Install App
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" onClick={handleDismiss}>
              Not now
            </Button>
          </div>
        </div>
        <Button size="icon" variant="ghost" className="size-7 shrink-0" onClick={handleDismiss}>
          <X className="size-4" />
        </Button>
      </div>
    </div>
  );
}
