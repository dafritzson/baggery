// react-dom comes with react-native-web but without its types; these are the functions the app
// uses (lib/zoom.web.ts, components/tooltip-portal.web.tsx).
declare module 'react-dom' {
  import type { ReactNode, ReactPortal } from 'react';

  export function flushSync<R>(fn: () => R): R;
  export function createPortal(children: ReactNode, container: Element): ReactPortal;
}
