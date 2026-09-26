import { useEffect, useRef, useState } from 'react';

import { ThemedText } from '@/components/themed-text';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { GOOGLE_CLIENT_ID } from '@/lib/auth';
import { supabase } from '@/lib/supabase';

// Google Identity Services button. Unlike the OAuth redirect through Supabase, Google's prompt
// names this site ("Sign in to baggery.vercel.app") instead of the Supabase project URL.
// Google returns an ID token, which Supabase verifies with signInWithIdToken.

interface GoogleIdentity {
  accounts: {
    id: {
      initialize(config: {
        client_id: string;
        callback: (response: { credential: string }) => void;
        nonce: string;
        use_fedcm_for_button?: boolean;
      }): void;
      renderButton(parent: HTMLElement, options: Record<string, string | number>): void;
    };
  };
}

declare global {
  interface Window {
    google?: GoogleIdentity;
  }
}

const SCRIPT_URL = 'https://accounts.google.com/gsi/client';

function loadScript(): Promise<void> {
  if (window.google?.accounts) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_URL}"]`);
    const script = existing ?? document.createElement('script');
    script.addEventListener('load', () => resolve());
    script.addEventListener('error', () => reject(new Error('Could not load Google sign-in.')));
    if (!existing) {
      script.src = SCRIPT_URL;
      script.async = true;
      document.head.appendChild(script);
    }
  });
}

/** Google gets the SHA-256 of the nonce; Supabase gets the raw nonce and checks they match. */
async function makeNonce(): Promise<{ raw: string; hashed: string }> {
  const raw = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const hashed = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  return { raw, hashed };
}

export function GoogleSignInButton() {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const scheme = useColorScheme();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [nonce] = await Promise.all([makeNonce(), loadScript()]);
        if (cancelled || !container.current || !window.google) return;
        window.google.accounts.id.initialize({
          client_id: GOOGLE_CLIENT_ID,
          nonce: nonce.hashed,
          use_fedcm_for_button: true,
          callback: async ({ credential }) => {
            const { error } = await supabase.auth.signInWithIdToken({
              provider: 'google',
              token: credential,
              nonce: nonce.raw,
            });
            if (error) setError(error.message);
          },
        });
        window.google.accounts.id.renderButton(container.current, {
          type: 'standard',
          theme: scheme === 'dark' ? 'filled_black' : 'outline',
          size: 'large',
          shape: 'pill',
          text: 'signin_with',
          width: Math.min(container.current.offsetWidth || 320, 400),
        });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load Google sign-in.');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scheme]);

  return (
    <>
      {/* colorScheme light: in dark mode, Google's iframe otherwise paints an opaque white box
          around the button (its own color scheme doesn't match the page's). */}
      <div
        ref={container}
        style={{ width: '100%', minHeight: 44, display: 'flex', justifyContent: 'center', colorScheme: 'light' }}
      />
      {error && <ThemedText themeColor="danger">{error}</ThemedText>}
    </>
  );
}
