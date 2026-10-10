import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import Reanimated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useStyles } from '../theme';

const PAD = 11; // horizontal content padding (each cell adds 5 more)
const EDGE = 90; // distance from the top/bottom edge that starts auto-scroll
const MAX_SPEED = 16; // px per frame
const SWAP_DELAY = 120; // ms between reorders, so the masonry can settle

// Two-column masonry grid (virtualized with FlashList) whose cards can be dragged.
// Hold a card to pick it up: a floating copy follows the finger, the other cards
// make room as it moves, and the list auto-scrolls near the edges. The grid only
// claims touches while a drag is active, so normal scrolling is unaffected.
// `extraData` re-renders the visible cards when something they show changes (e.g. selection).
export default function DraggableMasonry({
  data,
  keyExtractor,
  renderCard,
  onReorder,
  paddingBottom,
  ListEmptyComponent,
  extraData,
}) {
  const styles = useStyles(makeStyles);
  const listRef = useRef(null);
  const containerRef = useRef(null);
  const [order, setOrder] = useState(null); // ids while dragging, otherwise null
  const [drag, setDrag] = useState(null); // { id, item, width, height, left, top }

  const dragRef = useRef(null);
  const orderRef = useRef(null);
  const respondingRef = useRef(false);
  const origin = useRef({ x: 0, y: 0 }); // container position in the window
  const touch = useRef({ x: 0, y: 0, startX: 0, startY: 0 });
  const scrollY = useRef(0);
  const viewH = useRef(0);
  const contentH = useRef(0);
  const lastSwap = useRef(0);
  const timer = useRef(null);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);

  const dataRef = useRef(data);
  dataRef.current = data;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  const byId = useMemo(() => new Map(data.map((n) => [keyExtractor(n), n])), [data, keyExtractor]);
  const items = useMemo(
    () => (order ? order.map((id) => byId.get(id)).filter(Boolean) : data),
    [order, data, byId]
  );
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // Which card (index + layout) is under a point given in container coordinates.
  const hitTest = useCallback((x, y) => {
    const list = listRef.current;
    const count = itemsRef.current.length;
    if (!list || !count) return null;
    const cx = x - PAD;
    const cy = y + scrollY.current;
    let start = 0;
    let end = count - 1;
    try {
      const v = list.computeVisibleIndices();
      if (v && v.startIndex >= 0) {
        start = Math.max(0, v.startIndex - 4);
        end = Math.min(count - 1, v.endIndex + 4);
      }
    } catch {}
    for (let i = start; i <= end; i++) {
      const l = list.getLayout(i);
      if (l && cx >= l.x && cx <= l.x + l.width && cy >= l.y && cy <= l.y + l.height) return { i, l };
    }
    return null;
  }, []);

  const hover = useCallback(
    (x, y) => {
      const d = dragRef.current;
      if (!d) return;
      const now = Date.now();
      if (now - lastSwap.current < SWAP_DELAY) return;
      const hit = hitTest(x, y);
      if (!hit) return;
      const target = itemsRef.current[hit.i];
      if (!target || keyExtractor(target) === d.id) return;
      // Only swap when well inside the target, so cards don't flip back and forth.
      const rel = (y + scrollY.current - hit.l.y) / hit.l.height;
      if (rel < 0.15 || rel > 0.85) return;
      const ids = orderRef.current.slice();
      const from = ids.indexOf(d.id);
      if (from < 0) return;
      ids.splice(from, 1);
      ids.splice(hit.i, 0, d.id);
      orderRef.current = ids;
      lastSwap.current = now;
      setOrder(ids);
      Haptics.selectionAsync().catch(() => {});
    },
    [hitTest, keyExtractor]
  );

  const stopTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };

  // Auto-scroll while the finger is near the top or bottom edge.
  const tick = useCallback(() => {
    if (!dragRef.current) return stopTimer();
    const { x, y } = touch.current;
    const h = viewH.current;
    let speed = 0;
    if (y < EDGE) speed = -MAX_SPEED * Math.min(1, (EDGE - y) / EDGE);
    else if (y > h - EDGE) speed = MAX_SPEED * Math.min(1, (y - (h - EDGE)) / EDGE);
    if (!speed) return;
    const max = Math.max(0, contentH.current - h);
    const next = Math.min(max, Math.max(0, scrollY.current + speed));
    if (next === scrollY.current) return;
    scrollY.current = next;
    listRef.current?.scrollToOffset({ offset: next, animated: false });
    hover(x, y);
  }, [hover]);

  const end = useCallback(() => {
    stopTimer();
    respondingRef.current = false;
    const d = dragRef.current;
    if (!d) return;
    const finalIds = orderRef.current || [];
    dragRef.current = null;
    orderRef.current = null;
    setDrag(null);
    setOrder(null);
    const from = dataRef.current.findIndex((n) => keyExtractor(n) === d.id);
    const to = finalIds.indexOf(d.id);
    if (from >= 0 && to >= 0 && from !== to) {
      try {
        onReorderRef.current(from, to);
      } catch (e) {
        console.warn('Reorder failed', e);
      }
    }
  }, [keyExtractor]);

  // Called by a card's long press with the touch position in the window.
  const start = useCallback(
    (id, pageX, pageY) => {
      if (dragRef.current) return;
      const idx = itemsRef.current.findIndex((n) => keyExtractor(n) === id);
      const l = idx >= 0 ? listRef.current?.getLayout(idx) : null;
      if (!l) return;
      const begin = (ox, oy) => {
        origin.current = { x: ox, y: oy };
        const x = pageX - ox;
        const y = pageY - oy;
        touch.current = { x, y, startX: x, startY: y };
        tx.value = 0;
        ty.value = 0;
        const d = {
          id,
          item: itemsRef.current[idx],
          width: l.width,
          height: l.height,
          left: l.x + PAD,
          top: l.y - scrollY.current,
        };
        dragRef.current = d;
        orderRef.current = itemsRef.current.map(keyExtractor);
        lastSwap.current = Date.now();
        setDrag(d);
        setOrder(orderRef.current);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        stopTimer();
        timer.current = setInterval(tick, 16);
      };
      const node = containerRef.current;
      if (node?.measureInWindow) node.measureInWindow((ox, oy) => begin(ox || 0, oy || 0));
      else begin(origin.current.x, origin.current.y);
    },
    [keyExtractor, tick, tx, ty]
  );

  // A long press released without moving never hands touches to the grid; end it here.
  const releaseFromCard = useCallback(() => {
    setTimeout(() => {
      if (dragRef.current && !respondingRef.current) end();
    }, 60);
  }, [end]);

  useEffect(() => () => stopTimer(), []);

  const move = (e) => {
    if (!dragRef.current) return;
    const x = e.nativeEvent.pageX - origin.current.x;
    const y = e.nativeEvent.pageY - origin.current.y;
    touch.current.x = x;
    touch.current.y = y;
    tx.value = x - touch.current.startX;
    ty.value = y - touch.current.startY;
    hover(x, y);
  };

  const floatingStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: 1.04 }],
  }));

  const dragId = drag?.id;
  const listExtra = useMemo(() => ({ dragId, extraData }), [dragId, extraData]);
  const renderItem = useCallback(
    ({ item }) => (
      <View style={[styles.cell, keyExtractor(item) === dragId && styles.ghost]}>
        {renderCard(item, { onDragStart: start, onDragRelease: releaseFromCard })}
      </View>
    ),
    [renderCard, start, releaseFromCard, dragId, keyExtractor]
  );

  return (
    <View
      ref={containerRef}
      style={styles.flex}
      collapsable={false}
      onLayout={(e) => (viewH.current = e.nativeEvent.layout.height)}
      onMoveShouldSetResponderCapture={() => !!dragRef.current}
      onStartShouldSetResponderCapture={() => false}
      onResponderGrant={() => (respondingRef.current = true)}
      onResponderMove={move}
      onResponderTerminationRequest={() => !dragRef.current}
      onResponderRelease={end}
      onResponderTerminate={end}
    >
      <FlashList
        ref={listRef}
        data={items}
        masonry
        numColumns={2}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        extraData={listExtra}
        scrollEnabled={!drag}
        onScroll={(e) => (scrollY.current = e.nativeEvent.contentOffset.y)}
        scrollEventThrottle={16}
        onContentSizeChange={(_, h) => (contentH.current = h)}
        contentContainerStyle={{ paddingHorizontal: PAD, paddingBottom }}
        ListEmptyComponent={ListEmptyComponent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      />
      {drag && (
        <Reanimated.View
          pointerEvents="none"
          style={[styles.floating, { left: drag.left + 5, top: drag.top, width: drag.width - 10 }, floatingStyle]}
        >
          {renderCard(drag.item, { floating: true })}
        </Reanimated.View>
      )}
    </View>
  );
}

const makeStyles = (colors) => ({
  flex: { flex: 1 },
  cell: { paddingHorizontal: 5 },
  ghost: { opacity: 0.25 },
  floating: {
    position: 'absolute',
    borderRadius: 22,
    backgroundColor: colors.surface,
    zIndex: 50,
    elevation: 16,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.22,
    shadowRadius: 22,
  },
});
