import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ItemIcon } from '@/art/ItemIcon';
import { useTone } from '@/art/Scene';
import { playSound, type Sfx } from '@/audio/sound';
import { Button } from '@/components/Button';
import { Body, Muted, Sheet } from '@/components/Chrome';
import { FriendProfile } from '@/components/FriendProfile';
import {
  api,
  KEEPS_FOR_DAYS,
  LETTER_MAX,
  PLANTS_PER_BED,
  type Garden,
  type Gardener,
  type Plot,
  type Post,
  type Trade,
} from '@/lib/api';
import { countOf, ITEMS, itemInfo } from '@/lib/catalog';
import { confirm } from '@/lib/confirm';
import { font } from '@/lib/theme';
import { useNow } from '@/hooks/useNow';
import { formatSpan } from '@/lib/time';

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

/** Still growing, and would grow faster for a watering. */
export const isDry = (p: Plot) => !p.watered && !p.ripe && !p.withered;

/** "the tomato", "3 radishes", "2 plants" */
export function plantsLabel(plants: Plot[]) {
  const crops = [...new Set(plants.map((p) => p.crop))];
  if (crops.length > 1) return `${plants.length} plants`;
  const info = itemInfo(crops[0] ?? '');
  if (plants.length === 1) return `the ${info.name.toLowerCase()}`;
  return `${plants.length} ${(info.plural ?? info.name).toLowerCase()}`;
}

export function SeedSheet({
  bed,
  garden,
  act,
  onPlanted,
  onShop,
  onClose,
}: {
  bed: number;
  garden: Garden;
  act: Act;
  onPlanted: () => void;
  onShop: () => void;
  onClose: () => void;
}) {
  const seeds = Object.entries(garden.me.inventory).filter(
    ([slug]) => itemInfo(slug).kind === 'seed'
  );
  const room = PLANTS_PER_BED - garden.me.plots.filter((p) => p.bed === bed).length;
  const plant = async (slug: string, count: number) => {
    const done = await act(async () => {
      let next = await api.plant(bed, slug);
      for (let i = 1; i < count; i++) next = await api.plant(bed, slug);
      return next;
    }, 'pluck');
    if (!done) return;
    onPlanted();
    if (count >= room) onClose();
  };
  return (
    <Sheet title={room > 0 ? `Plant · room for ${room}` : 'This bed is full'} onClose={onClose}>
      {seeds.length === 0 ? (
        <>
          <Body>{"You haven't got any seeds. The shed sells them."}</Body>
          <Button title="Visit the shed" variant="quiet" onPress={onShop} />
        </>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          <Muted>{`One seed makes one plant, and a bed holds ${PLANTS_PER_BED}.`}</Muted>
          {seeds.map(([slug, qty]) => {
            const most = Math.min(qty, room);
            return (
              <Row key={slug} slug={slug} title={itemInfo(slug).name} detail={`You have ${qty}`}>
                <Button title="Plant 1" small disabled={room < 1} onPress={() => plant(slug, 1)} />
                {most > 1 && (
                  <Button
                    title={`Plant ${most}`}
                    small
                    variant="quiet"
                    onPress={() => plant(slug, most)}
                  />
                )}
              </Row>
            );
          })}
        </ScrollView>
      )}
    </Sheet>
  );
}

/** One of your beds, plant by plant, with what can be done there. */
export function BedSheet({
  bed,
  garden,
  act,
  onPlant,
  onClose,
}: {
  bed: number;
  garden: Garden;
  act: Act;
  onPlant: () => void;
  onClose: () => void;
}) {
  const plants = garden.me.plots.filter((p) => p.bed === bed).sort((a, b) => a.spot - b.spot);
  const ripe = plants.filter((p) => p.ripe);
  const withered = plants.filter((p) => p.withered);
  const room = PLANTS_PER_BED - plants.length;
  return (
    <Sheet title={`Bed ${bed + 1} · ${plants.length} of ${PLANTS_PER_BED}`} onClose={onClose}>
      <ScrollView contentContainerStyle={styles.list}>
        {plants.length === 0 && <Body>Nothing growing here yet.</Body>}
        {plants.map((p) => (
          <PlantRow key={p.spot} plant={p} />
        ))}
        <View style={styles.choices}>
          {ripe.length > 0 && (
            <Button
              title={`Pick ${plantsLabel(ripe)}`}
              small
              onPress={() => act(() => api.harvest(bed), 'pluck')}
            />
          )}
          {withered.length > 0 && (
            <Button
              title="Clear what's withered"
              small
              variant="quiet"
              onPress={() => act(() => api.clearBed(bed), 'rustle')}
            />
          )}
          {room > 0 && <Button title="Plant" small variant="quiet" onPress={onPlant} />}
          {garden.me.plots.some(isDry) && (
            <Button
              title="Water"
              small
              variant="quiet"
              onPress={() => act(() => api.water(), 'water')}
            />
          )}
        </View>
        <Muted>
          {`Crops grow in real time, studying or not, and a watered bed grows half as fast again for a day. Once a crop is ripe, pick it within ${KEEPS_FOR_DAYS} days or it withers.`}
        </Muted>
      </ScrollView>
    </Sheet>
  );
}

function PlantRow({ plant }: { plant: Plot }) {
  const tone = useTone();
  const now = useNow(30_000);
  const info = itemInfo(plant.crop);
  const dryIn = plant.dry_at ? Date.parse(plant.dry_at) - now : 0;
  const detail = plant.withered
    ? 'Withered: clear it to plant here again.'
    : plant.ripe
      ? `Ripe: pick it within ${formatSpan(Date.parse(plant.withers_at) - now)}.`
      : `Ripe in about ${formatSpan(Date.parse(plant.ripe_at) - now)}${
          plant.watered && dryIn > 0 ? `, watered for another ${formatSpan(dryIn)}` : ', dry'
        }.`;
  return (
    <View style={[styles.row, { borderColor: tone.line }]}>
      <ItemIcon slug={plant.crop} size={40} />
      <View style={styles.rowText}>
        <Text style={{ color: tone.text, fontSize: 15, fontWeight: '600' }}>
          {plant.yield > 1 ? `${info.name} · gives ${plant.yield}` : info.name}
        </Text>
        <Muted>{detail}</Muted>
        {!plant.ripe && !plant.withered && (
          <View style={[styles.track, { backgroundColor: tone.line }]}>
            <View
              style={[
                styles.fill,
                { width: `${Math.min(1, plant.progress) * 100}%`, backgroundColor: tone.accent },
              ]}
            />
          </View>
        )}
      </View>
    </View>
  );
}

/**
 * The post box: picks up what's waiting for you as you open it, and posts
 * letters to friends. They find them next time they're at the post box.
 */
export function PostSheet({
  friends,
  onPickedUp,
  onPosted,
  onClose,
}: {
  friends: Gardener[];
  onPickedUp: () => void;
  onPosted: (to: string) => void;
  onClose: () => void;
}) {
  const tone = useTone();
  const [post, setPost] = useState<Post | null>(null);
  const [writing, setWriting] = useState(false);
  const [to, setTo] = useState(friends[0]?.username);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.pickUpPost().then(
      (p) => {
        setPost(p);
        if (p.letters.some((l) => l.read_at === p.server_now)) {
          playSound('paper');
          onPickedUp();
        }
      },
      (e) => setError(e instanceof Error ? e.message : String(e))
    );
  }, [onPickedUp]);

  const send = async () => {
    if (!to || !body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      setPost(await api.sendLetter(to, body));
      setBody('');
      setWriting(false);
      playSound('paper');
      onPosted(to);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const name = (username: string) =>
    friends.find((f) => f.username === username)?.display_name ?? username;

  return (
    <Sheet title="Post box" onClose={onClose}>
      <View style={styles.choices}>
        <Choice
          label={post ? `Letters for you (${post.letters.length})` : 'Letters for you'}
          selected={!writing}
          onPress={() => setWriting(false)}
        />
        <Choice label="Write a letter" selected={writing} onPress={() => setWriting(true)} />
      </View>
      {writing ? (
        friends.length === 0 ? (
          <Body>Add friends on the Friends board, and you can write to them here.</Body>
        ) : (
          <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
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
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder={to ? `Dear ${name(to)},` : 'Dear…'}
              placeholderTextColor={tone.muted}
              multiline
              maxLength={LETTER_MAX}
              style={[
                styles.letterInput,
                { color: tone.text, borderColor: tone.line, backgroundColor: tone.raised },
              ]}
            />
            <Muted>
              {`${body.length} of ${LETTER_MAX}. It waits in the post box until ${to ? name(to) : 'they'} next comes by.`}
            </Muted>
            <Button
              title={to ? `Post it to ${name(to)}` : 'Post it'}
              onPress={send}
              disabled={busy || !to || !body.trim()}
            />
          </ScrollView>
        )
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {!post && !error && <Muted>Opening the post box…</Muted>}
          {post && post.letters.length === 0 && (
            <Body>{"Nothing for you yet. Friends' letters wait here until you pick them up."}</Body>
          )}
          {post?.letters.map((l) => (
            <View key={l.id} style={[styles.letter, { borderColor: tone.line }]}>
              <Text style={{ color: tone.muted, fontSize: 12 }}>
                {`From ${l.from_name} · ${when(l.sent_at)}${l.read_at === post.server_now ? ' · new' : ''}`}
              </Text>
              <Text style={{ color: tone.text, fontSize: 15, lineHeight: 21 }}>{l.body}</Text>
            </View>
          ))}
          {post && post.sent.length > 0 && (
            <Text style={[font.label, { color: tone.muted, marginTop: 8 }]}>Sent</Text>
          )}
          {post?.sent.slice(0, 5).map((l) => (
            <Muted key={l.id}>
              {`To ${l.to_name}, ${when(l.sent_at)}: ${l.read_at ? 'picked up' : 'waiting in the post box'}.`}
            </Muted>
          ))}
        </ScrollView>
      )}
      {error && <Text style={{ color: tone.danger, fontSize: 13 }}>{error}</Text>}
    </Sheet>
  );
}

/** "today, 14:05", "3 Oct" */
function when(iso: string) {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today
    ? `today, ${d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** The bins: throw away crops, seeds and cigarettes you don't want. */
export function BinSheet({
  garden,
  act,
  onClose,
}: {
  garden: Garden;
  act: Act;
  onClose: () => void;
}) {
  const items = Object.entries(garden.me.inventory)
    .filter(([slug]) => TRADEABLE.includes(slug))
    .sort(byKind);
  const binAll = async (slug: string, qty: number) => {
    const ok = await confirm(
      `Throw away ${countOf(slug, qty)}?`,
      "Once they're in the bin they're gone.",
      'Throw away'
    );
    if (ok) act(() => api.binItem(slug, qty), 'bin');
  };
  return (
    <Sheet title="The bins" onClose={onClose}>
      <ScrollView contentContainerStyle={styles.list}>
        {items.length === 0 ? (
          <Body>{"Your basket's empty: there's nothing to throw away."}</Body>
        ) : (
          items.map(([slug, qty]) => (
            <Row key={slug} slug={slug} title={countOf(slug, qty)}>
              <Button
                title="Bin 1"
                small
                variant="quiet"
                onPress={() => act(() => api.binItem(slug, 1), 'bin')}
              />
              {qty > 1 && (
                <Button title="Bin all" small variant="ghost" onPress={() => binAll(slug, qty)} />
              )}
            </Row>
          ))
        )}
        <Muted>{"Crops, seeds and cigarettes you don't want. Nothing comes back out."}</Muted>
      </ScrollView>
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
            ? 'Add some friends on the Friends board first.'
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
  const tone = useTone();
  const friend = garden.neighbours.find((n) => n.username === username);
  if (!friend) return null;
  const chips = garden.me.chips;
  return (
    <Sheet title={friend.display_name} onClose={onClose}>
      <ScrollView contentContainerStyle={styles.list}>
        <FriendProfile username={friend.username} />
        <Text style={[font.label, { color: tone.muted }]}>Stall</Text>
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
  track: { height: 6, borderRadius: 3, overflow: 'hidden', marginTop: 4 },
  fill: { height: '100%' },
  letter: { gap: 4, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  letterInput: {
    minHeight: 110,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    lineHeight: 21,
    textAlignVertical: 'top',
  },
});
