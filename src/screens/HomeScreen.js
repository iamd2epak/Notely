import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { BackHandler, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import Reanimated, { FadeInDown, FadeOutDown } from 'react-native-reanimated';
import ReorderableList from 'react-native-reorderable-list';
import DraggableMasonry from '../components/DraggableMasonry';
import { DraggableNoteCard, NoteCard } from '../components/NoteCard';
import EmptyState from '../components/EmptyState';
import { ConfirmSheet, NoteActionsSheet, TopicEditorSheet } from '../components/Sheets';
import { fonts, shadowFor, useStyles, useTheme } from '../theme';
import { MAX_TOPICS } from '../data';
import { greeting } from '../format';
import { success, tapLight, tapSoft, tick, warning } from '../haptics';

const keyExtractor = (n) => n.id;
const MAX_SELECT = 100; // most notes that can be selected at once
const plural = (n) => `${n} note${n === 1 ? '' : 's'}`;

export default function HomeScreen({
  notes,
  topics,
  view,
  onToggleView,
  onOpenSettings,
  onOpen,
  onCreate,
  onReorder,
  onTogglePin,
  onSetTopic,
  onToggleLock,
  onDelete,
  onDeleteMany,
  onSaveTopic,
  onDeleteTopic,
  covered, // another screen (editor, settings) is on top
}) {
  const insets = useSafeAreaInsets();
  const { colors, getNoteColor } = useTheme();
  const styles = useStyles(makeStyles);
  const [filter, setFilter] = useState('all'); // 'all' | topic id
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [actionId, setActionId] = useState(null);
  const [topicSheet, setTopicSheet] = useState(null); // { topic } — topic null means "new"

  // Multi-select: while `selecting`, taps toggle notes instead of opening them and drag is off.
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [confirmBulk, setConfirmBulk] = useState(false);
  const busyRef = useRef(false);

  const [toast, setToast] = useState(null); // { text, error, id }
  const toastTimer = useRef(null);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const showToast = useCallback((text, error = false) => {
    clearTimeout(toastTimer.current);
    setToast({ text, error, id: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  // A deleted topic can't stay selected.
  useEffect(() => {
    if (filter !== 'all' && !topics.some((t) => t.id === filter)) setFilter('all');
  }, [topics, filter]);

  const topicMap = useMemo(() => new Map(topics.map((t) => [t.id, t])), [topics]);

  const visible = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (filter === 'all' && !q) return notes;
    return notes.filter(
      (n) =>
        (filter === 'all' || n.topicId === filter) &&
        (!q || n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q))
    );
  }, [notes, filter, deferredQuery]);

  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  const setSelection = useCallback((next) => {
    selectedRef.current = next;
    setSelected(next);
  }, []);
  const startSelection = useCallback(
    (id) => {
      tapLight();
      setSelection(id ? new Set([id]) : new Set());
      setSelecting(true);
    },
    [setSelection]
  );
  const exitSelection = useCallback(() => {
    setSelecting(false);
    setConfirmBulk(false);
    setSelection(new Set());
  }, [setSelection]);

  const toggleSelect = useCallback(
    (note) => {
      const prev = selectedRef.current;
      const next = new Set(prev);
      if (prev.has(note.id)) next.delete(note.id);
      else if (prev.size >= MAX_SELECT) {
        warning();
        showToast(`You can select up to ${MAX_SELECT} notes at a time`, true);
        return;
      } else next.add(note.id);
      tick();
      setSelection(next);
    },
    [setSelection, showToast]
  );

  // Selected notes must stay on screen: drop ids that were deleted or filtered/searched away.
  useEffect(() => {
    if (!selecting) return;
    const prev = selectedRef.current;
    if (!prev.size) return;
    const shown = new Set(visible.map(keyExtractor));
    const next = new Set([...prev].filter((id) => shown.has(id)));
    if (next.size !== prev.size) setSelection(next);
  }, [visible, selecting, setSelection]);

  // Nothing left to select: leave selection mode.
  useEffect(() => {
    if (selecting && notes.length === 0) exitSelection();
  }, [selecting, notes.length, exitSelection]);

  // Android back leaves selection mode (open sheets handle back first).
  useEffect(() => {
    if (!selecting) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      exitSelection();
      return true;
    });
    return () => sub.remove();
  }, [selecting, exitSelection]);

  const selectCap = Math.min(visible.length, MAX_SELECT);
  const allSelected = selected.size > 0 && selected.size >= selectCap;
  const toggleSelectAll = () => {
    tick();
    if (allSelected) {
      setSelection(new Set());
      return;
    }
    // Keep the current picks and fill up to the limit in on-screen order.
    const next = new Set(selectedRef.current);
    for (const n of visibleRef.current) {
      if (next.size >= MAX_SELECT) break;
      next.add(n.id);
    }
    setSelection(next);
    if (visibleRef.current.length > MAX_SELECT) {
      showToast(`Selected ${MAX_SELECT} notes, the most at a time`);
    }
  };

  const selectedLocked = useMemo(() => {
    if (!confirmBulk) return 0;
    return notes.reduce((k, n) => (n.locked && selected.has(n.id) ? k + 1 : k), 0);
  }, [confirmBulk, notes, selected]);

  const deleteSelected = useCallback(async () => {
    const ids = [...selectedRef.current];
    setConfirmBulk(false);
    if (!ids.length || busyRef.current) return;
    busyRef.current = true;
    try {
      // Let the confirm sheet close before a password sheet may open.
      await new Promise((r) => setTimeout(r, 250));
      const count = await onDeleteMany(ids);
      if (count == null) return; // password cancelled: keep the selection
      exitSelection();
      if (count > 0) {
        success();
        showToast(`Deleted ${plural(count)}`);
      }
    } catch (e) {
      console.warn('Bulk delete failed', e);
      showToast('Couldn’t delete the notes. Nothing was removed.', true);
    } finally {
      busyRef.current = false;
    }
  }, [onDeleteMany, exitSelection, showToast]);
  const handleReorder = useCallback(
    ({ from, to }) => {
      tapSoft();
      onReorder(visibleRef.current.map((n) => n.id), from, to);
    },
    [onReorder]
  );
  const handleGridReorder = useCallback(
    (from, to) => {
      tapSoft();
      onReorder(visibleRef.current.map((n) => n.id), from, to);
    },
    [onReorder]
  );

  const openActions = useCallback((note) => setActionId(note.id), []);
  const renderListItem = useCallback(
    ({ item }) => (
      <DraggableNoteCard
        note={item}
        topic={item.topicId ? topicMap.get(item.topicId) : null}
        onOpen={onOpen}
        onMore={openActions}
        selecting={selecting}
        selected={selecting && selected.has(item.id)}
        onToggleSelect={toggleSelect}
      />
    ),
    [topicMap, onOpen, openActions, selecting, selected, toggleSelect]
  );
  const renderGridCard = useCallback(
    (item, drag) => (
      <NoteCard
        note={item}
        variant="grid"
        topic={item.topicId ? topicMap.get(item.topicId) : null}
        onOpen={onOpen}
        onMore={openActions}
        onDragStart={selecting ? undefined : drag?.onDragStart}
        onDragRelease={selecting ? undefined : drag?.onDragRelease}
        selecting={selecting && !drag?.floating}
        selected={selecting && selected.has(item.id)}
        onToggleSelect={toggleSelect}
      />
    ),
    [topicMap, onOpen, openActions, selecting, selected, toggleSelect]
  );
  const empty = <EmptyState kind={deferredQuery.trim() ? 'search' : filter !== 'all' ? 'topic' : 'empty'} />;

  const actionNote = actionId ? notes.find((n) => n.id === actionId) ?? null : null;
  return (
    // While the note editor or settings cover home, nothing here can receive a touch (or focus),
    // so taps on the screen on top can never reach the search box or lists underneath.
    <View
      style={[styles.screen, { paddingTop: insets.top + 8 }]}
      pointerEvents={covered ? 'none' : 'auto'}
      importantForAccessibility={covered ? 'no-hide-descendants' : 'auto'}
    >
      {selecting ? (
        <View style={styles.header}>
          <Pressable
            onPress={() => {
              tapLight();
              exitSelection();
            }}
            style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}
            accessibilityLabel="Cancel selection"
          >
            <Icon name="close" size={21} color={colors.text} />
          </Pressable>
          <View style={[styles.flex, styles.selInfo]}>
            <Text style={styles.selTitle} numberOfLines={1}>
              {selected.size} selected
            </Text>
            <Text style={styles.greet} numberOfLines={1}>
              Up to {MAX_SELECT} at a time
            </Text>
          </View>
          <Pressable
            onPress={toggleSelectAll}
            disabled={!visible.length}
            style={({ pressed }) => [styles.headerBtn, (pressed || !visible.length) && { opacity: 0.5 }]}
            accessibilityLabel={allSelected ? 'Deselect all' : 'Select all'}
          >
            <Icon name={allSelected ? 'select-off' : 'select-all'} size={21} color={colors.text} />
          </Pressable>
          <Pressable
            onPress={() => {
              if (!selectedRef.current.size) return;
              tapLight();
              setConfirmBulk(true);
            }}
            disabled={!selected.size}
            style={({ pressed }) => [
              styles.headerBtn,
              styles.deleteBtn,
              { backgroundColor: colors.danger, borderColor: colors.danger },
              (pressed || !selected.size) && { opacity: 0.45 },
            ]}
            accessibilityLabel="Delete selected"
          >
            <Icon name="trash-can-outline" size={21} color="#fff" />
          </Pressable>
        </View>
      ) : (
        <View style={styles.header}>
          <View style={styles.flex}>
            <Text style={styles.greet}>{greeting()} 👋</Text>
            <View style={styles.titleRow}>
              <Text style={styles.title} numberOfLines={1}>
                My Notes
              </Text>
              <View style={styles.count}>
                <Text style={styles.countText}>{notes.length}</Text>
              </View>
            </View>
          </View>
          {notes.length > 0 && (
            <Pressable
              onPress={() => startSelection(null)}
              style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}
              accessibilityLabel="Select notes"
            >
              <Icon name="checkbox-multiple-marked-outline" size={20} color={colors.text} />
            </Pressable>
          )}
          <Pressable
            onPress={() => {
              tapLight();
              onToggleView();
            }}
            style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}
            accessibilityLabel={view === 'grid' ? 'List view' : 'Grid view'}
          >
            <Icon name={view === 'grid' ? 'view-agenda-outline' : 'view-grid-outline'} size={21} color={colors.text} />
          </Pressable>
          <Pressable
            onPress={() => {
              tapLight();
              onOpenSettings();
            }}
            style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}
            accessibilityLabel="Settings"
          >
            <Icon name="cog-outline" size={21} color={colors.text} />
          </Pressable>
        </View>
      )}

      <View style={styles.search}>
        <Icon name="magnify" size={21} color={colors.primary} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search your notes…"
          placeholderTextColor={colors.muted}
          style={styles.searchInput}
          returnKeyType="search"
          autoCorrect={false}
          // While a screen covers home, the search box can't take focus, so typing (e.g. in a
          // new note's title) never ends up here.
          editable={!covered}
          accessibilityLabel="Search notes"
        />
        {!!query && (
          <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityLabel="Clear search">
            <Icon name="close-circle" size={19} color={colors.muted} />
          </Pressable>
        )}
      </View>

      <View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chips}
          keyboardShouldPersistTaps="handled"
        >
          <Chip label="All" active={filter === 'all'} onPress={() => setFilter('all')} />
          {topics.map((t) => (
            <Chip
              key={t.id}
              label={t.name}
              accent={getNoteColor(t.color).accent}
              active={filter === t.id}
              onPress={() => setFilter(filter === t.id ? 'all' : t.id)}
              onLongPress={() => setTopicSheet({ topic: t })}
            />
          ))}
          {topics.length < MAX_TOPICS && (
            <Pressable
              onPress={() => setTopicSheet({ topic: null })}
              style={({ pressed }) => [styles.addChip, pressed && { opacity: 0.6 }]}
              accessibilityLabel="New topic"
            >
              <Icon name="plus" size={18} color={colors.subtext} />
              {topics.length === 0 && <Text style={styles.chipText}>Topic</Text>}
            </Pressable>
          )}
        </ScrollView>
      </View>

      {view === 'grid' ? (
        <DraggableMasonry
          key="grid"
          data={visible}
          keyExtractor={keyExtractor}
          renderCard={renderGridCard}
          onReorder={handleGridReorder}
          extraData={selected}
          paddingBottom={insets.bottom + 100}
          ListEmptyComponent={empty}
        />
      ) : (
        <ReorderableList
          key="list"
          data={visible}
          keyExtractor={keyExtractor}
          renderItem={renderListItem}
          onReorder={handleReorder}
          dragEnabled={!selecting}
          extraData={selected}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 100 }]}
          ListEmptyComponent={empty}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          showsVerticalScrollIndicator={false}
          initialNumToRender={14}
          maxToRenderPerBatch={10}
          windowSize={11}
          autoscrollThreshold={0.15}
          style={styles.flex}
        />
      )}

      {!selecting && (
        <Pressable
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
            onCreate(filter === 'all' ? null : filter);
          }}
          style={({ pressed }) => [
            styles.fab,
            { bottom: insets.bottom + 22, transform: [{ scale: pressed ? 0.92 : 1 }] },
          ]}
          accessibilityLabel="New note"
        >
          <Icon name="plus" size={30} color="#fff" />
        </Pressable>
      )}

      {toast && (
        <Reanimated.View
          key={toast.id}
          entering={FadeInDown.duration(220)}
          exiting={FadeOutDown.duration(180)}
          pointerEvents="none"
          style={[
            styles.toast,
            { bottom: insets.bottom + (selecting ? 24 : 96) },
            toast.error && styles.toastError,
          ]}
        >
          <Icon name={toast.error ? 'alert-circle-outline' : 'check-circle-outline'} size={19} color="#fff" />
          <Text style={styles.toastText} numberOfLines={2}>
            {toast.text}
          </Text>
        </Reanimated.View>
      )}

      <NoteActionsSheet
        note={actionNote}
        topics={topics}
        onClose={() => setActionId(null)}
        onTogglePin={() => {
          onTogglePin(actionId);
          setActionId(null);
        }}
        onToggleLock={() => {
          const id = actionId;
          setActionId(null);
          // Let the sheet close before a password sheet may open.
          setTimeout(() => onToggleLock(id), 250);
        }}
        onSetTopic={(topicId) => {
          onSetTopic(actionId, topicId);
          setActionId(null);
        }}
        onSelect={() => {
          const id = actionId;
          setActionId(null);
          startSelection(id);
        }}
        onDelete={() => {
          const id = actionId;
          setActionId(null);
          setTimeout(() => onDelete(id), 250);
        }}
      />

      <ConfirmSheet
        visible={confirmBulk}
        title={`Delete ${plural(selected.size)}?`}
        text={
          `${selected.size === 1 ? 'It' : 'They'}’ll be removed permanently. This can’t be undone.` +
          (selectedLocked
            ? ` ${selectedLocked === 1 ? '1 locked note is' : `${selectedLocked} locked notes are`} included, so you’ll need your password.`
            : '')
        }
        confirmLabel="Delete"
        danger
        onConfirm={deleteSelected}
        onClose={() => setConfirmBulk(false)}
      />

      <TopicEditorSheet
        visible={!!topicSheet}
        topic={topicSheet?.topic ?? null}
        topics={topics}
        onClose={() => setTopicSheet(null)}
        onSave={(values) => {
          onSaveTopic(topicSheet?.topic?.id ?? null, values);
          setTopicSheet(null);
        }}
        onDelete={() => {
          if (topicSheet?.topic) onDeleteTopic(topicSheet.topic.id);
          setTopicSheet(null);
        }}
      />
    </View>
  );
}

function Chip({ label, accent, active, onPress, onLongPress }) {
  const { colors, dark } = useTheme();
  const styles = useStyles(makeStyles);
  const bg = active ? accent ?? colors.chipActive : colors.surface;
  const activeText = accent ? (dark ? '#111017' : '#fff') : colors.chipActiveText;
  return (
    <Pressable
      onPress={() => {
        if (!active) tick();
        onPress();
      }}
      onLongPress={onLongPress}
      delayLongPress={350}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: bg, borderColor: active ? bg : colors.border },
        pressed && { opacity: 0.75 },
      ]}
    >
      {accent && <View style={[styles.chipDot, { backgroundColor: active ? activeText : accent }]} />}
      <Text style={[styles.chipText, active && { color: activeText }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const makeStyles = (colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 18, minHeight: 62 },
  greet: { fontFamily: fonts.medium, fontSize: 13.5, color: colors.muted },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  title: { fontFamily: fonts.extrabold, fontSize: 29, lineHeight: 36, color: colors.text, letterSpacing: -0.6, flexShrink: 1 },
  selInfo: { paddingLeft: 4 },
  selTitle: { fontFamily: fonts.extrabold, fontSize: 22, lineHeight: 28, color: colors.text, letterSpacing: -0.4 },
  deleteBtn: { borderWidth: 0 },
  count: {
    marginLeft: 8,
    paddingHorizontal: 8,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.primarySoft,
    justifyContent: 'center',
  },
  countText: { fontFamily: fonts.bold, fontSize: 12, color: colors.primary },
  headerBtn: {
    width: 41,
    height: 41,
    borderRadius: 14,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 48,
    marginHorizontal: 16,
    marginTop: 10,
    paddingHorizontal: 15,
    borderRadius: 17,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
    elevation: 1,
  },
  searchInput: { flex: 1, fontFamily: fonts.medium, fontSize: 15, color: colors.text, paddingVertical: 0, height: '100%' },
  chips: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12, gap: 7, alignItems: 'center' },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 13,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    maxWidth: 170,
  },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.subtext },
  addChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 9,
    height: 34,
    minWidth: 34,
    justifyContent: 'center',
    borderRadius: 17,
    borderWidth: 1.2,
    borderStyle: 'dashed',
    borderColor: colors.muted,
  },
  list: { paddingHorizontal: 16 },
  toast: {
    position: 'absolute',
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderRadius: 16,
    backgroundColor: '#1F9D6B',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 14,
    elevation: 8,
  },
  toastError: { backgroundColor: '#D9434A' },
  toastText: { flex: 1, fontFamily: fonts.semibold, fontSize: 14, color: '#fff' },
  fab: {
    position: 'absolute',
    right: 20,
    width: 60,
    height: 60,
    borderRadius: 21,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadowFor(colors),
    shadowColor: colors.primary,
    shadowOpacity: 0.4,
  },
});
