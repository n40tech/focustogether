import { useState } from 'react';

import { Tip, useTips } from '@/components/Tip';
import { phoneToAddTo, useInstall, type Phone } from '@/lib/homeScreen';

const STEPS: Record<Phone, string> = {
  iphone:
    'Add Focus Together to your home screen, to open it like an app: in Safari, tap ••• by the address bar (or the Share button), then Share, Add to Home Screen and Add. Open it from there and arrive with your username and password.',
  android:
    'Add Focus Together to your home screen, to open it like an app: in Chrome, tap ⋮ at the top right, then Add to home screen, then Install.',
};

/** True for a new player on a phone's browser who hasn't added it to the home screen yet. */
export function useHomeScreenTip(newPlayer: boolean) {
  const [phone] = useState(phoneToAddTo);
  const tips = useTips();
  return newPlayer && phone !== null && !tips.has('home_screen');
}

/** How to add Focus Together to this phone's home screen. On Android, Chrome may do it in a tap. */
export function HomeScreenTip() {
  const [phone] = useState(phoneToAddTo);
  const install = useInstall();
  const tips = useTips();
  if (!phone) return null;
  if (install)
    return (
      <Tip
        id="home_screen"
        action={{
          title: 'Add',
          onPress: () => install().then((added) => added && tips.done('home_screen')),
        }}
      >
        Add Focus Together to your home screen, to open it like an app.
      </Tip>
    );
  return <Tip id="home_screen">{STEPS[phone]}</Tip>;
}
