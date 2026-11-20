import { ScrollViewStyleReset } from 'expo-router/html';
import type { PropsWithChildren } from 'react';

import { BACKDROP, tones } from '@/lib/theme';

const DESCRIPTION =
  'A calm study game for friends: study at your desk, earn chips, and spend your breaks in a shared garden.';

/** Shows behind the browser's bars until a scene paints its own (see Scene). */
const PAGE_BACKGROUND = `html, body { background-color: ${BACKDROP}; }`;

/**
 * The page every web route is built into. It's rendered in Node when the site
 * is built, so no browser APIs here. As Expo's default, plus the icons, the
 * web app manifest, the name a phone shows on its home screen, and what a
 * shared link's preview says.
 */
export default function Root({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta httpEquiv="X-UA-Compatible" content="IE=edge" />
        {/* viewport-fit=cover lets the page run under an iPhone's notch and
            home bar. The app keeps its controls clear of them with the
            safe-area insets. */}
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, shrink-to-fit=no, viewport-fit=cover"
        />
        <meta name="description" content={DESCRIPTION} />
        <meta property="og:title" content="Focus Together" />
        <meta property="og:description" content={DESCRIPTION} />
        {/* The browser's bar matches the beta banner across the top. */}
        <meta name="theme-color" content={tones.night.raised} />
        <meta name="apple-mobile-web-app-title" content="Focus Together" />
        {/* ?v= changes with the icon, so browsers and phones fetch the new
            one instead of keeping theirs (see scripts/icons.mjs). */}
        <link rel="manifest" href="/manifest.json?v=4" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png?v=4" />
        {/* The clock: an SVG that turns to midnight in dark mode, and a PNG
            for browsers that can't show an SVG icon. */}
        <link rel="icon" href="/favicon.png?v=4" sizes="48x48" />
        <link rel="icon" href="/favicon.svg?v=4" type="image/svg+xml" />
        <ScrollViewStyleReset />
        <style dangerouslySetInnerHTML={{ __html: PAGE_BACKGROUND }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
