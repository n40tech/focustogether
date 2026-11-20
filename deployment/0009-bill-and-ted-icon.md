# 0009 · A new icon: two friends under the office clock

**What this update brings:**

- a new icon: two friends, chest up, under the office clock. By day they're
  on the office wall, looking up at the clock;
- on iPhones in dark mode, a dark icon: midnight, and one of them is telling
  a ghost story by torchlight;
- a favicon that's just the clock. It turns to midnight when the browser is
  in dark mode;
- on Android, the themed (one-colour) icon is the clock and the two of them.

No migrations, and nobody's data changes.

---

## 1. Merge

Merging deploys the web app (GitHub Actions). Then:

- [ ] In a private window, the tab shows the clock at ten past ten. Switch the
      computer to dark mode: it shows midnight on dark slate.
- [ ] A newly added home-screen icon shows the two of them under the clock. An
      icon already on a home screen may keep the old picture until it's
      removed and added again.

## 2. Native builds (only if you make one)

The iOS dark icon and Android's icons only reach phones in a new native build
(`app.json` points at them). Nothing needs doing for the web.

- [ ] On an iPhone in dark mode, the icon shows the ghost story.
- [ ] On Android with themed icons on, the icon is the clock and two
      silhouettes.
