// react-dom comes with react-native-web but without its types; this is the one function the
// app uses (lib/zoom.web.ts).
declare module 'react-dom' {
  export function flushSync<R>(fn: () => R): R;
}
