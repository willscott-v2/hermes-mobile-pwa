// Visual-viewport layout math for the app shell (see docs/PWA-ISSUES-2026-11-19.md).
//
// With the iOS software keyboard up, the layout viewport keeps `window.innerHeight` while
// `window.visualViewport` shrinks AND can pan inside the layout viewport (offsetTop > 0):
// iOS pans to reveal the focused field, and again while the user drags. A shell that is
// only sized to the visual viewport, but still anchored at layout y=0, leaves the bottom
// `offsetTop` px of the visible region showing bare body background. The shell therefore
// has to follow the pan as well as the resize.

export interface ViewportLike {
  height: number;
  offsetTop: number;
}

export interface ViewportLayoutInput {
  innerHeight: number;
  viewport: ViewportLike | null | undefined;
}

export interface ViewportLayoutVars {
  '--visual-viewport-height': string;
  '--visual-viewport-offset-top': string;
  '--keyboard-inset-bottom': string;
  hasKeyboard: boolean;
}

const px = (value: number) => `${Math.max(0, Math.round(value))}px`;

export function viewportLayoutVars({ innerHeight, viewport }: ViewportLayoutInput): ViewportLayoutVars {
  const viewportHeight = viewport && Number.isFinite(viewport.height) && viewport.height > 0 ? viewport.height : innerHeight;
  const rawOffset = viewport && Number.isFinite(viewport.offsetTop) ? viewport.offsetTop : 0;
  // The visual viewport can never sit below the layout viewport; clamp defensively so a
  // bad reading cannot push the shell off-screen or create a scroll range of its own.
  const offsetTop = Math.min(Math.max(0, rawOffset), Math.max(0, innerHeight - viewportHeight));
  const keyboardInset = Math.max(0, innerHeight - viewportHeight - offsetTop);
  const hasKeyboard = keyboardInset > 80 || (viewport ? viewportHeight < innerHeight * 0.78 : false);
  return {
    '--visual-viewport-height': px(viewportHeight),
    '--visual-viewport-offset-top': px(offsetTop),
    '--keyboard-inset-bottom': px(keyboardInset),
    hasKeyboard,
  };
}
