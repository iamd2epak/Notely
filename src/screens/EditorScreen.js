import { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { AppState, Keyboard, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import * as ScreenCapture from 'expo-screen-capture';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { ChoiceSheet, ConfirmSheet, TopicEditorSheet, TopicPickerSheet } from '../components/Sheets';
import RichEditor from '../editor/RichEditor';
import FormatToolbar from '../editor/FormatToolbar';
import { fonts, useStyles, useTheme } from '../theme';
import { formatDate, wordCount } from '../format';
import { success, tapLight } from '../haptics';
import { deleteSafetyCopy } from '../backup';

const SAVE_DELAY = 400;

// The note screen. Layout, top to bottom:
//   top bar  — back · topic · ⋯ (lock, topic, delete) · Done
//   page     — title and body, both editable areas of one editor page (WebView)
//   bottom   — formatting bar while writing the body, otherwise "Edited … · N words"
export default function EditorScreen({ ref, note, isNew, topics, onChange, onClose, onDelete, onSaveTopic, onEnsureKey }) {
  const insets = useSafeAreaInsets();
  const { colors, dark, getNoteColor } = useTheme();
  const styles = useStyles(makeStyles);

  const [draft, setDraft] = useState(note);
  const draftRef = useRef(note);
  const editorRef = useRef(null);
  const [fmt, setFmt] = useState(null);
  const [toolbar, setToolbar] = useState(false);
  const [keyboard, setKeyboard] = useState(false);
  const [sheet, setSheet] = useState(null); // 'menu' | 'topic' | 'newTopic' | 'delete'
  const [editorKey, setEditorKey] = useState(0);
  // New notes on Android: the editor page can't open the keyboard by itself, so an invisible
  // native input takes focus at once (keyboard opens immediately) until the page has focused the
  // title; then it's removed. Anything typed meanwhile is moved into the title.
  const [keyboardHelper, setKeyboardHelper] = useState(isNew && Platform.OS === 'android');

  // Every note has a topic; if it was just deleted, show the default one.
  const topic = topics.find((t) => t.id === draft.topicId) ?? topics.find((t) => t.isDefault) ?? null;
  const c = topic ? getNoteColor(topic.color) : null;
  const accent = c?.accent ?? colors.primary;
  const bg = c?.bg ?? colors.bg;
  const words = wordCount(draft.body);
  const edited = `Edited ${formatDate(draft.updatedAt)} · ${words} ${words === 1 ? 'word' : 'words'}`;

  // Latest callbacks without re-subscribing listeners.
  const cb = useRef({ onChange, onClose });
  cb.current = { onChange, onClose };

  // Edits update local state at once and are pushed up (and saved) shortly after.
  const timer = useRef(null);
  const commit = useCallback((patch) => {
    const next = { ...draftRef.current, ...patch, updatedAt: Date.now() };
    draftRef.current = next;
    setDraft(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      try {
        cb.current.onChange(draftRef.current);
      } catch (e) {
        console.warn('Saving the note failed', e);
      }
    }, SAVE_DELAY);
  }, []);

  const flush = useCallback(() => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    cb.current.onChange(draftRef.current);
  }, []);

  // Blurring the editor page closes its keyboard; Keyboard.dismiss() covers native inputs.
  const hideKeyboard = useCallback(() => {
    try {
      editorRef.current?.blur();
    } catch (e) {
      console.warn('Hiding the keyboard failed', e);
    }
    Keyboard.dismiss();
  }, []);

  const close = useCallback(() => {
    tapLight();
    hideKeyboard();
    clearTimeout(timer.current);
    timer.current = null;
    cb.current.onClose(draftRef.current);
  }, [hideKeyboard]);

  useImperativeHandle(ref, () => ({ close }), [close]);

  useEffect(() => {
    const subs = [
      AppState.addEventListener('change', (s) => s !== 'active' && flush()),
      Keyboard.addListener('keyboardDidShow', () => setKeyboard(true)),
      Keyboard.addListener('keyboardDidHide', () => setKeyboard(false)),
    ];
    return () => {
      subs.forEach((s) => s.remove());
      clearTimeout(timer.current);
    };
  }, [flush]);

  useEffect(() => {
    editorRef.current?.setAccent(accent);
  }, [accent]);

  // Safety net: the helper never stays longer than a few seconds.
  useEffect(() => {
    if (!keyboardHelper) return;
    const t = setTimeout(() => setKeyboardHelper(false), 4000);
    return () => clearTimeout(t);
  }, [keyboardHelper]);
  const onHelperText = useCallback((text) => {
    if (text) editorRef.current?.appendTitle(text);
  }, []);

  // While a locked note is open: no screenshots, screen recording or recent-apps preview.
  useEffect(() => {
    if (!draft.locked || Platform.OS === 'web') return;
    ScreenCapture.preventScreenCaptureAsync('locked-note').catch(() => {});
    return () => {
      ScreenCapture.allowScreenCaptureAsync('locked-note').catch(() => {});
    };
  }, [draft.locked]);

  const toggleLock = async () => {
    try {
      if (draftRef.current.locked) {
        commit({ locked: false });
        return;
      }
      const key = await onEnsureKey?.('Lock note');
      if (!key) return;
      commit({ locked: true });
      deleteSafetyCopy();
      success();
    } catch (e) {
      console.warn('Changing the lock failed', e);
    }
  };

  // The formatting bar shows while the body has focus. It hides a moment after the body loses
  // focus, so tapping a formatting button (which may briefly blur the body) doesn't flicker it.
  const hideTimer = useRef(null);
  const onEditorMessage = useCallback(
    (msg) => {
      if (msg.type === 'change') {
        if (typeof msg.html !== 'string' || typeof msg.title !== 'string') return;
        const d = draftRef.current;
        if (msg.title === d.title && msg.html === d.html) return;
        commit({ title: msg.title, html: msg.html, body: typeof msg.text === 'string' ? msg.text : '' });
      } else if (msg.type === 'state') {
        // The page has the focus now (keyboard stays open), so the helper can go.
        if (msg.focus) setTimeout(() => setKeyboardHelper(false), 300);
        setFmt(msg);
        clearTimeout(hideTimer.current);
        if (msg.focus === 'body') setToolbar(true);
        else hideTimer.current = setTimeout(() => setToolbar(false), 220);
      }
    },
    [commit]
  );
  useEffect(() => () => clearTimeout(hideTimer.current), []);

  const onCommand = useCallback((name, value) => editorRef.current?.command(name, value), []);
  const onKeepFocus = useCallback(() => editorRef.current?.focus(), []);

  const openSheet = (name) => {
    tapLight();
    hideKeyboard();
    setSheet(name);
  };
  const pickTopic = (topicId) => {
    if (topicId !== draftRef.current.topicId) commit({ topicId });
    setSheet(null);
  };

  const menuOptions = [
    {
      key: 'lock',
      icon: draft.locked ? 'lock-open-variant-outline' : 'lock-outline',
      label: draft.locked ? 'Remove lock' : 'Lock note',
      sublabel: draft.locked ? 'It will open without your password' : 'It will need your password to open',
      onPress: () => {
        setSheet(null);
        // Let the menu close before a password sheet may open.
        setTimeout(toggleLock, 250);
      },
    },
    { key: 'topic', icon: 'tag-outline', label: 'Change topic', onPress: () => setSheet('topic') },
    {
      key: 'delete',
      icon: 'trash-can-outline',
      label: 'Delete note',
      color: colors.danger,
      onPress: () => setSheet('delete'),
    },
  ];

  return (
    <View style={[styles.screen, { backgroundColor: bg, paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable
          onPress={close}
          hitSlop={6}
          style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
          accessibilityLabel="Back"
        >
          <Icon name="arrow-left" size={24} color={colors.text} />
        </Pressable>
        <Pressable
          onPress={() => openSheet('topic')}
          style={({ pressed }) => [styles.topic, pressed && styles.pressed]}
          accessibilityLabel="Topic"
        >
          <View style={[styles.topicDot, { backgroundColor: accent }]} />
          <Text style={styles.topicText} numberOfLines={1}>
            {topic?.name ?? 'Topic'}
          </Text>
          <Icon name="chevron-down" size={16} color={colors.muted} />
        </Pressable>
        <View style={styles.flex} />
        {draft.locked && <Icon name="lock" size={17} color={accent} style={styles.lockMark} />}
        <Pressable
          onPress={() => openSheet('menu')}
          hitSlop={6}
          style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
          accessibilityLabel="More options"
        >
          <Icon name="dots-horizontal" size={24} color={colors.text} />
        </Pressable>
        <Pressable
          onPress={close}
          style={({ pressed }) => [styles.done, { backgroundColor: accent }, pressed && styles.pressed]}
          accessibilityLabel="Done"
        >
          <Text style={[styles.doneText, dark && { color: '#111017' }]}>Done</Text>
        </Pressable>
      </View>

      {keyboardHelper && (
        <TextInput
          autoFocus
          value=""
          onChangeText={onHelperText}
          style={styles.keyboardHelper}
          caretHidden
          contextMenuHidden
          autoCorrect={false}
          autoCapitalize="sentences"
          importantForAutofill="no"
          accessible={false}
          importantForAccessibility="no-hide-descendants"
          pointerEvents="none"
        />
      )}
      <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <RichEditor
          key={editorKey}
          ref={editorRef}
          initial={{
            title: draftRef.current.title,
            html: draftRef.current.html,
            accent,
            dark,
            focusTitle: isNew && editorKey === 0,
          }}
          onMessage={onEditorMessage}
          // If Android kills the WebView's renderer, rebuild it from the latest draft.
          onCrash={() => {
            setToolbar(false);
            setEditorKey((k) => (k < 3 ? k + 1 : k));
          }}
        />
        {toolbar ? (
          <>
            <FormatToolbar state={fmt} accent={accent} onCommand={onCommand} onKeepFocus={onKeepFocus} />
            {!keyboard && <View style={{ height: insets.bottom }} />}
          </>
        ) : (
          !keyboard && (
            <View style={[styles.footer, { paddingBottom: insets.bottom + 10 }]}>
              <Text style={styles.footerText} numberOfLines={1}>
                {edited}
              </Text>
            </View>
          )
        )}
      </KeyboardAvoidingView>

      <ChoiceSheet
        visible={sheet === 'menu'}
        title={draft.locked ? 'Locked note' : draft.title.trim() || 'Untitled note'}
        message={edited}
        options={menuOptions}
        onClose={() => setSheet(null)}
      />
      <TopicPickerSheet
        visible={sheet === 'topic'}
        topics={topics}
        value={topic?.id ?? null}
        onPick={pickTopic}
        onNewTopic={() => setSheet('newTopic')}
        onClose={() => setSheet(null)}
      />
      <TopicEditorSheet
        visible={sheet === 'newTopic'}
        topic={null}
        topics={topics}
        onClose={() => setSheet(null)}
        onSave={(values) => {
          const id = onSaveTopic(null, values);
          if (id) commit({ topicId: id });
          setSheet(null);
        }}
      />
      <ConfirmSheet
        visible={sheet === 'delete'}
        title="Delete note?"
        text="This note will be removed permanently."
        onClose={() => setSheet(null)}
        onConfirm={() => {
          setSheet(null);
          hideKeyboard();
          clearTimeout(timer.current);
          timer.current = null;
          onDelete(draftRef.current.id);
        }}
      />
    </View>
  );
}

const makeStyles = (colors) => ({
  screen: { flex: 1 },
  flex: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 4, height: 56, paddingHorizontal: 8 },
  iconBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.55 },
  topic: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingLeft: 11,
    paddingRight: 8,
    borderRadius: 17,
    backgroundColor: colors.glass,
    maxWidth: 170,
    flexShrink: 1,
  },
  topicDot: { width: 8, height: 8, borderRadius: 4 },
  topicText: { fontFamily: fonts.semibold, fontSize: 13.5, color: colors.text, flexShrink: 1 },
  lockMark: { marginRight: 2 },
  done: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 4,
  },
  doneText: { fontFamily: fonts.bold, fontSize: 14, color: '#fff' },
  keyboardHelper: { position: 'absolute', top: 0, left: 0, width: 1, height: 1, opacity: 0 },
  footer: { alignItems: 'center', paddingTop: 8 },
  footerText: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted },
});
