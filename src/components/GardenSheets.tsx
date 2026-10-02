import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ItemIcon } from '@/art/ItemIcon';
import { useTone } from '@/art/Scene';
import type { Sfx } from '@/audio/sound';
import { Button } from '@/components/Button';
import { Body, Muted, Sheet } from '@/components/Chrome';
import { api, KEEPS_FOR_DAYS, type Garden, type Plot, type Trade } from '@/lib/api';
import { countOf, ITEMS, itemInfo } from '@/lib/catalog';
import { font } from '@/lib/theme';
import { formatMinutes } from '@/lib/time';

/** Runs a garden action, then updates the garden from its result. */
export type Act = (action: () => Promise<Garden>, sound?: Sfx) => Promise<boolean>;

const TRADEABLE = Object.keys(ITEMS).filter((slug) =>
  ['produce', 'seed', 'cigarette'].includes(ITEMS[slug].kind)
);

/** "Bob offers 3 strawberries for 1 carrot", using friends' display names. */
const describeTrade = (t: Trade, viewer: 'from' | 'to', garden: Garden) => {
  const name = (username: string) =>
    garden.neighbours.find((n) => n.username === username)?.display_name ?? username;
  const give = countOf(t.give_item, t.give_qty);
  const want = t.want_item && t.want_qty ? countOf(t.want_item, t.want_qty) : null;
  if (viewer === 'to')
    return want
      ? `${name(t.from)} offers ${give} for ${want}`
      : `${name(t.from)} is giving you ${give}`;
  return want ? `${give} to ${name(t.to)}, for ${want}` : `${give} to ${name(t.to)}, as a gift`;
};

/** Produce first (what people mostly sell), then seeds, then cigarettes. */
const KIND_ORDER = ['produce', 'seed', 'cigarette'];
const byKind = ([a]: [string, number], [b]: [string, number]) =>
  KIND_ORDER.indexOf(itemInfo(a).kind) - KIND_ORDER.indexOf(itemInfo(b).kind);

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
  stacked = false,
  children,
}: {
  slug: string;
  title: string;
  detail?: string;
  /** Put the buttons under the title, for rows with several. */
  stacked?: boolean;
  children?: ReactNode;
}) {
  const tone = useTone();
  const words = (
    <>
      <Text style={{ color: tone.text, fontSize: 15, fontWeight: '600' }}>{title}</Text>
      {detail ? <Muted>{detail}</Muted> : null}
    </>
  );
  return (
    <View style={[styles.row, { borderColor: tone.line }]}>
      <ItemIcon slug={slug} size={40} />
      <View style={styles.rowText}>
        {words}
        {stacked && <View style={styles.rowActionsBelow}>{children}</View>}
      </View>
      {!stacked && <View style={styles.rowActions}>{children}</View>}
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
      <Muted>{`Once it's ripe, pick it within ${KEEPS_FOR_DAYS} days, or it withers.`}</Muted>
    </Sheet>
  );
}

export function BasketSheet({
  garden,
  act,
  onOffer,
  onSell,
  onClose,
}: {
  garden: Garden;
  act: Act;
  onOffer: (item: string) => void;
  onSell: (item: string) => void;
  onClose: () => void;
}) {
  const tone = useTone();
  const items = Object.entries(garden.me.inventory).filter(([slug]) => TRADEABLE.includes(slug));
  const produce = items.filter(([slug]) => itemInfo(slug).kind === 'produce');
  const other = items.filter(([slug]) => itemInfo(slug).kind !== 'produce');
  const incoming = garden.trades.filter((t) => t.incoming);
  const outgoing = garden.trades.filter((t) => !t.incoming);

  return (
    <Sheet title="Your basket" onClose={onClose}>
      <ScrollView contentContainerStyle={styles.list}>
        {incoming.length > 0 && (
          <Text style={[font.label, { color: tone.muted }]}>Offers for you</Text>
        )}
        {incoming.map((t) => (
          <Row key={t.id} slug={t.give_item} title={describeTrade(t, 'to', garden)} stacked>
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
        {incoming.length > 0 && items.length > 0 && (
          <Text style={[font.label, { color: tone.muted, marginTop: 8 }]}>In your basket</Text>
        )}
        {items.length === 0 && (
          <Body>Your basket is empty. Ripe crops end up here when you harvest them.</Body>
        )}
        {produce.map(([slug, qty]) => (
          <Row key={slug} slug={slug} title={countOf(slug, qty)} stacked>
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
            <Button title="Sell" small variant="quiet" onPress={() => onSell(slug)} />
            <Button title="Offer" small variant="quiet" onPress={() => onOffer(slug)} />
          </Row>
        ))}
        {other.map(([slug, qty]) => (
          <Row key={slug} slug={slug} title={countOf(slug, qty)}>
            <Button title="Sell" small variant="quiet" onPress={() => onSell(slug)} />
            <Button title="Offer" small variant="quiet" onPress={() => onOffer(slug)} />
          </Row>
        ))}
        {outgoing.length > 0 && (
          <Text style={[font.label, { color: tone.muted, marginTop: 8 }]}>
            Waiting for an answer
          </Text>
        )}
        {outgoing.map((t) => (
          <Row key={t.id} slug={t.give_item} title={describeTrade(t, 'from', garden)}>
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
  fixedTo = false,
  act,
  onClose,
}: {
  garden: Garden;
  initialTo?: string;
  initialGive?: string;
  /** You're standing next to them: no need to pick who it's for. */
  fixedTo?: boolean;
  act: Act;
  onClose: () => void;
}) {
  const tone = useTone();
  const mine = Object.entries(garden.me.inventory).filter(([slug]) => TRADEABLE.includes(slug));
  const friends = garden.neighbours;
  const recipient = friends.find((f) => f.username === initialTo);
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
    <Sheet
      title={fixedTo && recipient ? `Offer ${recipient.display_name} a swap` : 'Offer a trade'}
      onClose={onClose}
    >
      <ScrollView contentContainerStyle={styles.list}>
        {!(fixedTo && recipient) && (
          <>
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
          </>
        )}
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

/** Prices to choose from, per item. */
const PRICES = [1, 2, 3, 5, 8, 12, 20, 30, 50];

/**
 * Your market stall: what you've put out for friends to buy while you're both
 * in the garden. Things on the stall are set aside until they sell or you take
 * them back.
 */
export function StallSheet({
  garden,
  initialItem,
  act,
  onClose,
}: {
  garden: Garden;
  initialItem?: string;
  act: Act;
  onClose: () => void;
}) {
  const tone = useTone();
  const stall = garden.me.stall;
  const mine = Object.entries(garden.me.inventory)
    .filter(([slug]) => TRADEABLE.includes(slug))
    .sort(byKind);
  const [item, setItem] = useState<string | undefined>(initialItem ?? mine[0]?.[0]);
  const [qty, setQty] = useState(1);
  const [price, setPrice] = useState(3);
  const have = (item && garden.me.inventory[item]) || 0;

  return (
    <Sheet title="Your stall" onClose={onClose}>
      <ScrollView contentContainerStyle={styles.list}>
        {stall.length === 0 ? (
          <Muted>
            {"Nothing out yet. Friends can buy what you put out when they're standing next to you."}
          </Muted>
        ) : (
          stall.map((l) => (
            <Row key={l.id} slug={l.item} title={countOf(l.item, l.qty)} detail={`${l.price} each`}>
              <Button
                title="Take back"
                small
                variant="ghost"
                onPress={() => act(() => api.unlist(l.id), 'paper')}
              />
            </Row>
          ))
        )}
        <Text style={[font.label, { color: tone.muted, marginTop: 6 }]}>Put something out</Text>
        {mine.length === 0 ? (
          <Muted>Your basket is empty: crops, seeds and cigarettes can go on a stall.</Muted>
        ) : (
          <>
            <View style={styles.choices}>
              {mine.map(([slug, n]) => (
                <Choice
                  key={slug}
                  label={`${itemInfo(slug).name} (${n})`}
                  selected={item === slug}
                  onPress={() => {
                    setItem(slug);
                    setQty(1);
                  }}
                />
              ))}
            </View>
            <View style={styles.inline}>
              <Muted>How many</Muted>
              <Stepper
                value={Math.min(qty, Math.max(1, have))}
                min={1}
                max={Math.max(1, have)}
                onChange={setQty}
              />
            </View>
            <Text style={[font.label, { color: tone.muted }]}>Chips each</Text>
            <View style={styles.choices}>
              {PRICES.map((p) => (
                <Choice
                  key={p}
                  label={String(p)}
                  selected={price === p}
                  onPress={() => setPrice(p)}
                />
              ))}
            </View>
            <Button
              title={item ? `Put out ${countOf(item, Math.min(qty, have))}` : 'Put out'}
              disabled={!item || have < 1}
              onPress={() => {
                if (item) act(() => api.listItem(item, Math.min(qty, have), price), 'paper');
              }}
            />
          </>
        )}
      </ScrollView>
    </Sheet>
  );
}

/** Standing next to a friend: buy from their stall, or offer them a swap. */
export function FriendSheet({
  garden,
  username,
  act,
  onSwap,
  onClose,
}: {
  garden: Garden;
  username: string;
  act: Act;
  onSwap: () => void;
  onClose: () => void;
}) {
  const friend = garden.neighbours.find((n) => n.username === username);
  if (!friend) return null;
  const chips = garden.me.chips;
  return (
    <Sheet title={`${friend.display_name}'s stall`} onClose={onClose}>
      <ScrollView contentContainerStyle={styles.list}>
        {friend.stall.length === 0 ? (
          <Body>{`${friend.display_name} hasn't put anything out.`}</Body>
        ) : (
          friend.stall.map((l) => (
            <Row key={l.id} slug={l.item} title={countOf(l.item, l.qty)} detail={`${l.price} each`}>
              <Button
                title={`Buy 1 · ${l.price}`}
                small
                disabled={chips < l.price}
                onPress={() => act(() => api.buyListing(l.id, 1), 'coin')}
              />
              {l.qty > 1 && (
                <Button
                  title={`All · ${l.qty * l.price}`}
                  small
                  variant="quiet"
                  disabled={chips < l.qty * l.price}
                  onPress={() => act(() => api.buyListing(l.id, l.qty), 'coin')}
                />
              )}
            </Row>
          ))
        )}
        <Muted>{`You have ${chips} chips.`}</Muted>
        <Button title="Offer a swap" variant="quiet" onPress={onSwap} />
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
  rowActionsBelow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 },
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
  inline: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%' },
});
