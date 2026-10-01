import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ItemIcon } from '@/art/ItemIcon';
import { useTone } from '@/art/Scene';
import type { Sfx } from '@/audio/sound';
import { Button } from '@/components/Button';
import { Body, Muted, Sheet } from '@/components/Chrome';
import { api, type Garden, type Plot, type Trade } from '@/lib/api';
import { countOf, ITEMS, itemInfo } from '@/lib/catalog';
import { font } from '@/lib/theme';
import { formatMinutes } from '@/lib/time';

/** Runs a garden action, then updates the garden from its result. */
export type Act = (action: () => Promise<Garden>, sound?: Sfx) => Promise<boolean>;

const TRADEABLE = Object.keys(ITEMS).filter((slug) =>
  ['produce', 'seed', 'cigarette'].includes(ITEMS[slug].kind)
);

const describeTrade = (t: Trade, viewer: 'from' | 'to') => {
  const give = countOf(t.give_item, t.give_qty);
  const want = t.want_item && t.want_qty ? countOf(t.want_item, t.want_qty) : null;
  if (viewer === 'to')
    return want ? `${t.from} offers ${give} for ${want}` : `${t.from} is giving you ${give}`;
  return want ? `${give} to ${t.to}, for ${want}` : `${give} to ${t.to}, as a gift`;
};

function Choice({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const tone = useTone();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[
        styles.choice,
        {
          borderColor: selected ? tone.accent : tone.line,
          backgroundColor: selected ? tone.accent : tone.raised,
        },
      ]}
    >
      <Text
        style={{ color: selected ? tone.accentText : tone.text, fontSize: 13, fontWeight: '600' }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Stepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  const tone = useTone();
  return (
    <View style={styles.stepper}>
      <Button
        title="−"
        variant="quiet"
        small
        onPress={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
      />
      <Text
        style={{
          color: tone.text,
          fontSize: 16,
          minWidth: 28,
          textAlign: 'center',
          fontVariant: ['tabular-nums'],
        }}
      >
        {value}
      </Text>
      <Button
        title="+"
        variant="quiet"
        small
        onPress={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
      />
    </View>
  );
}

function Row({
  slug,
  title,
  detail,
  children,
}: {
  slug: string;
  title: string;
  detail?: string;
  children?: ReactNode;
}) {
  const tone = useTone();
  return (
    <View style={[styles.row, { borderColor: tone.line }]}>
      <ItemIcon slug={slug} size={40} />
      <View style={styles.rowText}>
        <Text style={{ color: tone.text, fontSize: 15, fontWeight: '600' }}>{title}</Text>
        {detail ? <Muted>{detail}</Muted> : null}
      </View>
      <View style={styles.rowActions}>{children}</View>
    </View>
  );
}

export function SeedSheet({
  bed,
  garden,
  act,
  onShop,
  onClose,
}: {
  bed: number;
  garden: Garden;
  act: Act;
  onShop: () => void;
  onClose: () => void;
}) {
  const seeds = Object.entries(garden.me.inventory).filter(
    ([slug]) => itemInfo(slug).kind === 'seed'
  );
  return (
    <Sheet title="Plant something" onClose={onClose}>
      {seeds.length === 0 ? (
        <>
          <Body>{"You haven't got any seeds. The shed sells them."}</Body>
          <Button title="Visit the shed" variant="quiet" onPress={onShop} />
        </>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {seeds.map(([slug, qty]) => (
            <Row key={slug} slug={slug} title={itemInfo(slug).name} detail={`You have ${qty}`}>
              <Button
                title="Plant"
                small
                onPress={async () => {
                  if (await act(() => api.plant(bed, slug), 'pluck')) onClose();
                }}
              />
            </Row>
          ))}
        </ScrollView>
      )}
    </Sheet>
  );
}

export function BedSheet({ plot, onClose }: { plot: Plot; onClose: () => void }) {
  const tone = useTone();
  const share = Math.min(1, plot.growth_min / plot.grow_min);
  return (
    <Sheet title={itemInfo(plot.crop).name} onClose={onClose}>
      <Body>
        {`${formatMinutes(plot.growth_min * 60_000)} of ${formatMinutes(plot.grow_min * 60_000)} of study so far.`}
      </Body>
      <View style={[styles.track, { backgroundColor: tone.line }]}>
        <View style={[styles.fill, { width: `${share * 100}%`, backgroundColor: tone.accent }]} />
      </View>
      <Muted>
        {plot.watered
          ? 'Watered: it grows while you study.'
          : "It's dry, so it's paused. Water it before your next session."}
      </Muted>
    </Sheet>
  );
}

export function BasketSheet({
  garden,
  act,
  onOffer,
  onClose,
}: {
  garden: Garden;
  act: Act;
  onOffer: (item: string) => void;
  onClose: () => void;
}) {
  const tone = useTone();
  const items = Object.entries(garden.me.inventory).filter(([slug]) => TRADEABLE.includes(slug));
  const produce = items.filter(([slug]) => itemInfo(slug).kind === 'produce');
  const other = items.filter(([slug]) => itemInfo(slug).kind !== 'produce');
  const outgoing = garden.trades.filter((t) => !t.incoming);

  return (
    <Sheet title="Your basket" onClose={onClose}>
      <ScrollView contentContainerStyle={styles.list}>
        {items.length === 0 && (
          <Body>Your basket is empty. Ripe crops end up here when you harvest them.</Body>
        )}
        {produce.map(([slug, qty]) => (
          <Row key={slug} slug={slug} title={countOf(slug, qty)}>
            <Button
              title="Eat"
              small
              variant="quiet"
              onPress={() => act(() => api.eat(slug), 'munch')}
            />
            <Button
              title="Save seeds"
              small
              variant="quiet"
              onPress={() => act(() => api.saveSeeds(slug), 'pluck')}
            />
            <Button title="Offer" small variant="quiet" onPress={() => onOffer(slug)} />
          </Row>
        ))}
        {other.map(([slug, qty]) => (
          <Row key={slug} slug={slug} title={countOf(slug, qty)}>
            <Button title="Offer" small variant="quiet" onPress={() => onOffer(slug)} />
          </Row>
        ))}
        {outgoing.length > 0 && (
          <Text style={[font.label, { color: tone.muted, marginTop: 8 }]}>
            Waiting for an answer
          </Text>
        )}
        {outgoing.map((t) => (
          <Row key={t.id} slug={t.give_item} title={describeTrade(t, 'from')}>
            <Button
              title="Withdraw"
              small
              variant="ghost"
              onPress={() => act(() => api.cancelTrade(t.id), 'paper')}
            />
          </Row>
        ))}
      </ScrollView>
    </Sheet>
  );
}

export function TradeSheet({
  garden,
  initialTo,
  initialGive,
  act,
  onClose,
}: {
  garden: Garden;
  initialTo?: string;
  initialGive?: string;
  act: Act;
  onClose: () => void;
}) {
  const tone = useTone();
  const mine = Object.entries(garden.me.inventory).filter(([slug]) => TRADEABLE.includes(slug));
  const friends = garden.neighbours;
  const [to, setTo] = useState(initialTo ?? friends[0]?.username);
  const [give, setGive] = useState(initialGive ?? mine[0]?.[0]);
  const [giveQty, setGiveQty] = useState(1);
  const [want, setWant] = useState<string | null>(null);
  const [wantQty, setWantQty] = useState(1);
  const have = (give && garden.me.inventory[give]) || 0;

  if (friends.length === 0 || mine.length === 0) {
    return (
      <Sheet title="Offer a trade" onClose={onClose}>
        <Body>
          {friends.length === 0
            ? 'Add some friends on the noticeboard first.'
            : 'You need something to offer: crops, seeds or cigarettes.'}
        </Body>
      </Sheet>
    );
  }

  return (
    <Sheet title="Offer a trade" onClose={onClose}>
      <ScrollView contentContainerStyle={styles.list}>
        <Text style={[font.label, { color: tone.muted }]}>To</Text>
        <View style={styles.choices}>
          {friends.map((f) => (
            <Choice
              key={f.username}
              label={f.display_name}
              selected={to === f.username}
              onPress={() => setTo(f.username)}
            />
          ))}
        </View>
        <Text style={[font.label, { color: tone.muted }]}>You give</Text>
        <View style={styles.choices}>
          {mine.map(([slug]) => (
            <Choice
              key={slug}
              label={itemInfo(slug).name}
              selected={give === slug}
              onPress={() => {
                setGive(slug);
                setGiveQty(1);
              }}
            />
          ))}
        </View>
        <Stepper value={giveQty} min={1} max={Math.max(1, have)} onChange={setGiveQty} />
        <Text style={[font.label, { color: tone.muted }]}>You ask for</Text>
        <View style={styles.choices}>
          <Choice label="Nothing (a gift)" selected={want === null} onPress={() => setWant(null)} />
          {TRADEABLE.filter((slug) => slug !== give).map((slug) => (
            <Choice
              key={slug}
              label={itemInfo(slug).name}
              selected={want === slug}
              onPress={() => setWant(slug)}
            />
          ))}
        </View>
        {want && <Stepper value={wantQty} min={1} max={99} onChange={setWantQty} />}
        <Muted>{'What you offer is set aside until they answer, or until you withdraw it.'}</Muted>
        <Button
          title={want ? 'Send offer' : 'Send gift'}
          disabled={!to || !give}
          onPress={async () => {
            if (!to || !give) return;
            if (
              await act(
                () => api.offerTrade(to, give, giveQty, want, want ? wantQty : null),
                'paper'
              )
            )
              onClose();
          }}
        />
      </ScrollView>
    </Sheet>
  );
}

export function OffersSheet({
  garden,
  act,
  onClose,
}: {
  garden: Garden;
  act: Act;
  onClose: () => void;
}) {
  const incoming = garden.trades.filter((t) => t.incoming);
  return (
    <Sheet title="Offers for you" onClose={onClose}>
      <ScrollView contentContainerStyle={styles.list}>
        {incoming.length === 0 && <Body>No offers waiting.</Body>}
        {incoming.map((t) => (
          <Row key={t.id} slug={t.give_item} title={describeTrade(t, 'to')}>
            <Button
              title="Accept"
              small
              onPress={() => act(() => api.respondTrade(t.id, true), 'coin')}
            />
            <Button
              title="Decline"
              small
              variant="ghost"
              onPress={() => act(() => api.respondTrade(t.id, false), 'paper')}
            />
          </Row>
        ))}
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { gap: 10, paddingBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  rowText: { flex: 1, gap: 2 },
  rowActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 6,
    maxWidth: 230,
  },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  choice: { paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, borderWidth: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%' },
});
