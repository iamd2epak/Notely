import { memo } from 'react';
import { Pressable, Text, View } from 'react-native';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import { useReorderableDrag } from 'react-native-reorderable-list';
import { fonts, useStyles, useTheme } from '../theme';
import { formatDate } from '../format';

// A note card. `variant` is 'grid' (taller, auto height) or 'list' (compact).
// In selection mode (`selecting`) a tap or long press toggles the card instead of opening
// or dragging it, and the ⋯ button becomes a check circle.
function NoteCardBase({
  note,
  topic,
  variant,
  onOpen,
  onMore,
  onLongPress,
  onDragStart,
  onDragRelease,
  selecting,
  selected,
  onToggleSelect,
}) {
  const { colors, getNoteColor } = useTheme();
  const styles = useStyles(makeStyles);
  const c = topic ? getNoteColor(topic.color) : { bg: colors.surface, accent: colors.primary };
  const grid = variant === 'grid';
  const preview = note.body.slice(0, grid ? 420 : 200);
  const toggle = () => onToggleSelect?.(note);

  return (
    <Pressable
      onPress={selecting ? toggle : () => onOpen(note)}
      onLongPress={
        selecting
          ? toggle
          : onDragStart
            ? (e) => onDragStart(note.id, e.nativeEvent.pageX, e.nativeEvent.pageY)
            : onLongPress
      }
      onPressOut={selecting ? undefined : onDragRelease}
      delayLongPress={selecting ? 350 : 280}
      accessibilityState={selecting ? { selected: !!selected } : undefined}
      style={({ pressed }) => [
        styles.card,
        grid ? styles.cardGrid : styles.cardList,
        { backgroundColor: c.bg },
        !topic && styles.plain,
        pressed && styles.pressed,
      ]}
    >
      {/* Soft accent glow in the corner gives each colour its own character. */}
      <View pointerEvents="none" style={[styles.glow, { backgroundColor: c.accent }]} />
      {/* Selection ring drawn as an overlay, so the card's size (and the grid) doesn't shift. */}
      {selected && <View pointerEvents="none" style={[styles.ring, { borderColor: c.accent }]} />}
      <View style={styles.head}>
        <View style={[styles.dot, { backgroundColor: c.accent }]} />
        {note.pinned && (
          <View style={[styles.pinBadge, { backgroundColor: c.accent }]}>
            <Icon name="pin" size={11} color="#fff" />
          </View>
        )}
        <View style={styles.flex} />
        {selecting ? (
          <Pressable
            onPress={toggle}
            hitSlop={12}
            style={[
              styles.check,
              selected ? { backgroundColor: c.accent, borderColor: c.accent } : { borderColor: colors.muted },
            ]}
            accessibilityLabel={selected ? 'Deselect note' : 'Select note'}
          >
            {selected && <Icon name="check" size={15} color="#fff" />}
          </Pressable>
        ) : (
          <Pressable
            onPress={() => onMore(note)}
            hitSlop={12}
            style={({ pressed }) => [styles.more, pressed && { opacity: 0.6 }]}
            accessibilityLabel="Note options"
          >
            <Icon name="dots-horizontal" size={18} color={colors.subtext} />
          </Pressable>
        )}
      </View>
      {note.locked ? (
        // Locked: title and content are encrypted, so there is nothing to show but the lock.
        <View style={styles.lockedRow}>
          <View style={[styles.lockBadge, { backgroundColor: c.accent + '22' }]}>
            <Icon name="lock" size={grid ? 20 : 17} color={c.accent} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.title}>Locked note</Text>
            <Text style={styles.lockedSub}>Tap to unlock</Text>
          </View>
        </View>
      ) : (
        <Text style={styles.title} numberOfLines={grid ? 3 : 1}>
          {note.title.trim() || 'Untitled'}
        </Text>
      )}
      {!note.locked && !!preview && (
        <Text style={styles.body} numberOfLines={grid ? 7 : 2}>
          {preview}
        </Text>
      )}
      <View style={styles.footer}>
        <Icon name="clock-time-four-outline" size={13} color={colors.muted} />
        <Text style={styles.date}>{formatDate(note.updatedAt)}</Text>
      </View>
    </Pressable>
  );
}

export const NoteCard = memo(NoteCardBase);

// List rows can be dragged: hold to pick up, then move (not while selecting).
function DraggableNoteCardBase(props) {
  const drag = useReorderableDrag();
  return (
    <NoteCardBase
      {...props}
      variant="list"
      onLongPress={() => {
        if (props.selecting) return;
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
        drag();
      }}
    />
  );
}

export const DraggableNoteCard = memo(DraggableNoteCardBase);

const makeStyles = (colors) => ({
  flex: { flex: 1 },
  card: { borderRadius: 22, overflow: 'hidden' },
  cardGrid: { padding: 15, paddingTop: 13, marginBottom: 10 },
  cardList: { paddingHorizontal: 16, paddingVertical: 12, marginBottom: 10 },
  plain: { borderWidth: 1, borderColor: colors.border },
  ring: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, borderRadius: 22, borderWidth: 2.5 },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -2,
  },
  pressed: { opacity: 0.88, transform: [{ scale: 0.985 }] },
  glow: { position: 'absolute', top: -38, right: -38, width: 104, height: 104, borderRadius: 52, opacity: 0.09 },
  head: { flexDirection: 'row', alignItems: 'center', height: 24, marginBottom: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  pinBadge: { width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', marginLeft: 6 },
  more: {
    width: 28,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.glass,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -4,
  },
  title: { fontFamily: fonts.bold, fontSize: 16, lineHeight: 22, color: colors.text, letterSpacing: -0.2 },
  body: { fontFamily: fonts.regular, fontSize: 13.5, lineHeight: 20, color: colors.subtext, marginTop: 4 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 12 },
  date: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
  lockedRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 2 },
  lockBadge: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  lockedSub: { fontFamily: fonts.medium, fontSize: 12.5, color: colors.muted, marginTop: 1 },
});
