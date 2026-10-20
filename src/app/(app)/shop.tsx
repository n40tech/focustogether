import { useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ItemIcon } from '@/art/ItemIcon';
import { Box, Dot } from '@/art/primitives';
import { BLEED, Scene, useTone } from '@/art/Scene';
import { playSound, useAmbience } from '@/audio/sound';
import { ArrangeSheet } from '@/components/ArrangeSheet';
import { Button } from '@/components/Button';
import { ChipIcon, Muted, SceneHeader } from '@/components/Chrome';
import { api, SMOKE_MINUTES, type ItemKind, type Shop, type ShopItem } from '@/lib/api';
import { itemInfo } from '@/lib/catalog';
import { font } from '@/lib/theme';
import { formatHours } from '@/lib/time';
import { useConditions } from '@/weather/useConditions';
import { useGo, useWorld } from '@/world/World';

const SECTIONS: { kind: ItemKind; title: string; note: string }[] = [
  {
    kind: 'vehicle',
    title: 'Getting here',
    note: 'Friends see what you arrive in, in the car park, while you’re in.',
  },
  { kind: 'desk', title: 'For your desk', note: 'Friends see these on your desk in the office.' },
  {
    kind: 'seed',
    title: 'For your allotment',
    note: 'Plant them on a break; they grow in real time, studying or not.',
  },
  { kind: 'cigarette', title: 'For your break', note: 'Smoked in the garden.' },
];

const BACK: Record<string, { href: Href; label: string }> = {
  garden: { href: '/garden', label: 'Back to the garden' },
  payout: { href: '/payout', label: 'Back' },
  index: { href: '/', label: 'Back to the car park' },
};

/** The garden shed: everything you can spend chips on. */
export default function ShedShop() {
  useAmbience('indoors');
  const { from } = useLocalSearchParams<{ from?: string }>();
  const back = BACK[from ?? 'index'] ?? BACK.index;
  const { me, setMe, refresh } = useWorld();
  // Something for your desk, just bought: you put it on your desk straight away.
  const [arranging, setArranging] = useState<string | null>(null);
  const conditions = useConditions();
  const go = useGo();
  const [shop, setShop] = useState<Shop | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    api.getShop().then(setShop, (e: Error) => setError(e.message));
  }, []);

  const buy = useCallback(
    async (item: ShopItem) => {
      setBusy(item.slug);
      setError(null);
      try {
        setShop(await api.buy(item.slug));
        playSound('coin');
        await refresh();
        if (item.kind === 'desk') setArranging(item.slug);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(null);
      }
    },
    [refresh]
  );

  const art = (
    <>
      {/* Inside the shed: plank walls and shelves of things. */}
      <Box x={BLEED.x} y={-400} w={BLEED.w} h={560} c="#cdb595" />
      {Array.from({ length: 40 }, (_, i) => (
        <Box key={`p${i}`} x={-1000 + i * 58} y={-400} w={2} h={560} c="#b89d7b" o={0.6} />
      ))}
      {[40, 90, 140].map((y) => (
        <Box key={y} x={BLEED.x} y={y} w={BLEED.w} h={5} c="#9c8063" />
      ))}
      {Array.from({ length: 36 }, (_, i) => (
        <Box
          key={i}
          x={-200 + (i % 12) * 66 + ((i * 7) % 13)}
          y={16 + Math.floor(i / 12) * 50}
          w={16 + ((i * 5) % 12)}
          h={22}
          c={['#c4836c', '#6d8c78', '#e3c46a', '#8fa3ad', '#b46a9a', '#d9c9b0'][i % 6]}
          r={2}
        />
      ))}
      <Box x={BLEED.x} y={160} w={BLEED.w} h={36} c="#a17a5c" />
      <Box x={BLEED.x} y={196} w={BLEED.w} h={8} c="#7f5f47" />
      <Dot x={300} y={150} d={30} h={14} c="#ebe6dc" />
    </>
  );

  return (
    <Scene conditions={conditions} ground="#cbbfae" art={art} reserve={{ top: 56, bottom: 420 }}>
      <SceneHeader place="Shed" chips={shop?.chips} />
      <Catalogue shop={shop} busy={busy} error={error} onBuy={buy} />
      <Leave label={back.label} onPress={() => go(back.href, null)} />
      {arranging && (
        <ArrangeSheet me={me} setMe={setMe} fresh={arranging} onClose={() => setArranging(null)} />
      )}
    </Scene>
  );
}

function Catalogue({
  shop,
  busy,
  error,
  onBuy,
}: {
  shop: Shop | null;
  busy: string | null;
  error: string | null;
  onBuy: (item: ShopItem) => void;
}) {
  const tone = useTone();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.sheetWrap, { bottom: 72 + insets.bottom }]} pointerEvents="box-none">
      <View style={[styles.sheet, { backgroundColor: tone.panel, borderColor: tone.line }]}>
        {!shop ? (
          error ? (
            <Text style={{ color: tone.danger }}>{error}</Text>
          ) : (
            <ActivityIndicator color={tone.muted} />
          )
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {error && <Text style={{ color: tone.danger }}>{error}</Text>}
            {SECTIONS.map(({ kind, title, note }) => (
              <View key={kind} style={styles.section}>
                <Text style={[font.label, { color: tone.muted }]}>{title}</Text>
                <Muted>{note}</Muted>
                {shop.items
                  .filter((i) => i.kind === kind)
                  .map((item) => (
                    <Row
                      key={item.slug}
                      item={item}
                      chips={shop.chips}
                      busy={busy === item.slug}
                      onBuy={() => onBuy(item)}
                    />
                  ))}
              </View>
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

function Row({
  item,
  chips,
  busy,
  onBuy,
}: {
  item: ShopItem;
  chips: number;
  busy: boolean;
  onBuy: () => void;
}) {
  const tone = useTone();
  const oneOff = item.kind === 'vehicle' || item.kind === 'desk';
  const owned = oneOff && item.owned > 0;
  const detail =
    item.kind === 'seed'
      ? `${item.pack_size} seeds, one plant each · ripe in ${formatHours(item.grow_hours ?? 0)}, sooner if watered · ${item.yield === 1 ? 'one' : item.yield} to pick per plant`
      : item.kind === 'cigarette'
        ? `Pack of ${item.pack_size} · each burns for ${SMOKE_MINUTES} minutes`
        : null;
  return (
    <View style={[styles.row, { borderColor: tone.line }]}>
      <ItemIcon slug={item.slug} />
      <View style={styles.rowText}>
        <Text style={{ color: tone.text, fontSize: 15, fontWeight: '600' }}>{item.name}</Text>
        {detail && <Muted>{detail}</Muted>}
        {!oneOff && item.owned > 0 && <Muted>{`You have ${item.owned}`}</Muted>}
      </View>
      {owned ? (
        <Muted>Yours</Muted>
      ) : (
        <View style={styles.buy}>
          <View style={styles.price}>
            <ChipIcon size={11} />
            <Text style={{ color: tone.chip, fontWeight: '600' }}>{item.price}</Text>
          </View>
          <Button
            title="Buy"
            small
            variant="quiet"
            onPress={onBuy}
            disabled={busy || chips < item.price}
            accessibilityLabel={`Buy ${itemInfo(item.slug).name} for ${item.price} chips`}
          />
        </View>
      )}
    </View>
  );
}

function Leave({ label, onPress }: { label: string; onPress: () => void }) {
  const tone = useTone();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.leave, { bottom: 12 + insets.bottom }]}>
      <View style={[styles.leaveInner, { backgroundColor: tone.panel, borderColor: tone.line }]}>
        <Button title={label} variant="ghost" onPress={onPress} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheetWrap: { position: 'absolute', left: 12, right: 12, top: 220, alignItems: 'center' },
  sheet: { flex: 1, width: '100%', maxWidth: 560, borderRadius: 20, borderWidth: 1, padding: 14 },
  list: { gap: 18, paddingBottom: 8 },
  section: { gap: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, gap: 2 },
  buy: { alignItems: 'flex-end', gap: 6 },
  price: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  leave: { position: 'absolute', left: 12, right: 12, alignItems: 'center' },
  leaveInner: { width: '100%', maxWidth: 560, borderRadius: 16, borderWidth: 1 },
});
