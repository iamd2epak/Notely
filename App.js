import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import {
  Animated,
  AppState,
  BackHandler,
  Dimensions,
  Keyboard,
  Pressable,
  StyleSheet,
  Text,
  View,
  useColorScheme,
} from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import { PlusJakartaSans_400Regular } from '@expo-google-fonts/plus-jakarta-sans/400Regular';
import { PlusJakartaSans_500Medium } from '@expo-google-fonts/plus-jakarta-sans/500Medium';
import { PlusJakartaSans_600SemiBold } from '@expo-google-fonts/plus-jakarta-sans/600SemiBold';
import { PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans/700Bold';
import { PlusJakartaSans_800ExtraBold } from '@expo-google-fonts/plus-jakarta-sans/800ExtraBold';
import HomeScreen from './src/screens/HomeScreen';
import EditorScreen from './src/screens/EditorScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ErrorBoundary from './src/components/ErrorBoundary';
import { loadData, saveData } from './src/storage';
import { deleteSafetyCopy, keepSafetyCopy } from './src/backup';
import { ChoiceSheet, PasswordSheet } from './src/components/Sheets';
import { createVault, decryptNote, encryptNote, rewrapVault, unlockVault } from './src/crypto';
import * as Vault from './src/vault';
import { success } from './src/haptics';
import {
  MAX_TOPICS,
  applyReorder,
  defaultTopicId,
  ensureDefaultTopic,
  mergeData,
  newId,
  upsertNote,
} from './src/data';
import { ThemeProvider, fonts, makeTheme, useStyles, useTheme } from './src/theme';
import appJson from './app.json';

const APP_VERSION = appJson?.expo?.version ?? '1.0.0';

SplashScreen.preventAutoHideAsync().catch(() => {});

const WIDTH = Dimensions.get('window').width;
const SAVE_DELAY = 500;
const rootStyle = { flex: 1 };
const isEmpty = (n) => !n.title.trim() && !n.body.trim();

export default function App() {
  return (
    <GestureHandlerRootView style={rootStyle}>
      <SafeAreaProvider>
        <ThemeRoot>
          <BottomSheetModalProvider>
            <ErrorBoundary>
              <Notely />
            </ErrorBoundary>
          </BottomSheetModalProvider>
        </ThemeRoot>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

// Light/dark theme for the whole app, including bottom sheets (which render in a portal
// under BottomSheetModalProvider, so the theme must be provided above it).
const SetThemePref = createContext(() => {});
function ThemeRoot({ children }) {
  const [pref, setPref] = useState('system');
  const scheme = useColorScheme();
  const dark = pref === 'dark' || (pref === 'system' && scheme === 'dark');
  const theme = useMemo(() => makeTheme(dark), [dark]);
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(theme.colors.bg).catch(() => {});
  }, [theme]);
  return (
    <SetThemePref.Provider value={setPref}>
      <ThemeProvider value={theme}>{children}</ThemeProvider>
    </SetThemePref.Provider>
  );
}

function Notely() {
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [notes, setNotes] = useState([]);
  const [topics, setTopics] = useState([]);
  const [prefs, setPrefs] = useState({ view: 'grid', theme: 'system' });
  const [vault, setVault] = useState(null); // wrapped key for locked notes (null = no password set)
  const [pwPrompt, setPwPrompt] = useState(null); // active password sheet, see askPassword()
  const [notice, setNotice] = useState(null); // { title, message }
  const unlocked = useSyncExternalStore(Vault.subscribe, Vault.isUnlocked);
  const [editing, setEditing] = useState(null); // { note, isNew }
  const [settingsOpen, setSettingsOpen] = useState(false);
  const slide = useRef(new Animated.Value(WIDTH)).current;
  const settingsSlide = useRef(new Animated.Value(WIDTH)).current;
  const editorRef = useRef(null);
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const setThemePref = useContext(SetThemePref);
  useEffect(() => setThemePref(prefs.theme), [prefs.theme, setThemePref]);

  const load = useCallback(() => {
    setStatus('loading');
    loadData()
      .then((data) => {
        setNotes(data.notes);
        setTopics(data.topics);
        setPrefs(data.prefs);
        setVault(data.vault);
        setStatus('ready');
      })
      .catch((e) => {
        console.warn('Loading notes failed', e);
        setStatus('error');
      });
  }, []);
  useEffect(load, [load]);

  // Save shortly after any change, and immediately when the app goes to the background.
  const latest = useRef(null);
  const dirty = useRef(false);
  useEffect(() => {
    if (status !== 'ready') return;
    latest.current = { notes, topics, prefs, vault };
    dirty.current = true;
    const t = setTimeout(() => {
      dirty.current = false;
      saveData(latest.current);
    }, SAVE_DELAY);
    return () => clearTimeout(t);
  }, [notes, topics, prefs, vault, status]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active' && dirty.current && latest.current) {
        dirty.current = false;
        saveData(latest.current);
      }
    });
    return () => sub.remove();
  }, []);

  const appReady = (fontsLoaded || !!fontError) && status !== 'loading';
  useEffect(() => {
    if (appReady) SplashScreen.hideAsync().catch(() => {});
  }, [appReady]);

  const vaultRef = useRef(vault);
  vaultRef.current = vault;
  const editingRef = useRef(editing);
  editingRef.current = editing;

  // Saves a note. Locked notes are encrypted here, before they reach state or disk, so
  // their plain text is never stored. If the key is gone (shouldn't happen) nothing is saved.
  const upsert = useCallback((note) => {
    let stored = note;
    if (note.locked) {
      const key = Vault.getKey();
      if (!key) {
        console.warn('Locked note not saved: notes are locked');
        return;
      }
      stored = encryptNote(key, note);
    } else if (note.enc || 'locked' in note) {
      const { enc, locked, ...rest } = note; // eslint-disable-line no-unused-vars
      stored = rest;
    }
    setNotes((list) => upsertNote(list, stored));
  }, []);

  // ---- Locked notes -------------------------------------------------------------
  // Shows the password sheet; resolves with what `run(password)` returned, or null if cancelled
  // ({ extra: true } if the optional extra button was used).
  const promptId = useRef(0);
  const promptRef = useRef(null);
  const askPassword = useCallback(
    (opts) =>
      new Promise((resolve) => {
        promptRef.current?.resolve(null); // never leave an earlier prompt hanging
        const prompt = { ...opts, id: ++promptId.current, resolve };
        promptRef.current = prompt;
        setPwPrompt(prompt);
      }),
    []
  );
  const finishPrompt = (value) => {
    const p = promptRef.current;
    promptRef.current = null;
    setPwPrompt(null);
    p?.resolve(value);
  };

  const createPassword = useCallback(
    () =>
      askPassword({
        mode: 'create',
        title: 'Set a lock password',
        message: 'One password locks and unlocks all your locked notes. Notes are encrypted on this phone.',
        confirmLabel: 'Set password',
        run: async (pw) => {
          const { vault: v, masterKey } = await createVault(pw);
          vaultRef.current = v;
          setVault(v);
          Vault.setKey(masterKey);
          return masterKey;
        },
      }),
    [askPassword]
  );

  // Returns the key for locked notes, asking for (or creating) the password if needed.
  const ensureKey = useCallback(
    async (title = 'Unlock locked notes') => {
      const key = Vault.getKey();
      if (key) return key;
      const v = vaultRef.current;
      if (!v) return createPassword();
      return askPassword({
        mode: 'enter',
        title,
        message: 'Enter your lock password.',
        confirmLabel: 'Unlock',
        run: (pw) => Vault.unlock(v, pw),
      });
    },
    [askPassword, createPassword]
  );

  const openNote = useCallback(
    async (note) => {
      if (!note.locked) return openEditorRef.current(note);
      const key = await ensureKey('Open locked note');
      if (!key) return;
      const current = notesRef.current.find((n) => n.id === note.id) ?? note;
      try {
        openEditorRef.current(decryptNote(key, current));
      } catch (e) {
        console.warn('Decrypt failed', e);
        setNotice({ title: 'Can’t open this note', message: 'This note couldn’t be decrypted. It may be damaged.' });
      }
    },
    [ensureKey]
  );

  const toggleLock = useCallback(
    async (id) => {
      const note = notesRef.current.find((n) => n.id === id);
      if (!note) return;
      const key = await ensureKey(note.locked ? 'Remove lock' : 'Lock note');
      if (!key) return;
      const latestNote = notesRef.current.find((n) => n.id === id);
      if (!latestNote) return;
      try {
        if (latestNote.locked) {
          const { enc, locked, ...plain } = decryptNote(key, latestNote); // eslint-disable-line no-unused-vars
          setNotes((l) => upsertNote(l, plain));
        } else {
          setNotes((l) => upsertNote(l, encryptNote(key, latestNote)));
          deleteSafetyCopy(); // an older copy could still contain this note's plain text
        }
        success();
      } catch (e) {
        console.warn('Lock toggle failed', e);
        setNotice({ title: 'Something went wrong', message: 'The note wasn’t changed. Please try again.' });
      }
    },
    [ensureKey]
  );

  // Deleting a locked note needs the password too.
  const removeNote = useCallback(
    async (id) => {
      const note = notesRef.current.find((n) => n.id === id);
      if (note?.locked && !(await ensureKey('Delete locked note'))) return;
      setNotes((list) => list.filter((n) => n.id !== id));
    },
    [ensureKey]
  );

  // Deletes several notes at once (multi-select). Locked notes among them need the password
  // once. Resolves with how many were deleted, or null if the password prompt was cancelled.
  const removeNotes = useCallback(
    async (ids) => {
      const set = new Set(ids);
      const targets = notesRef.current.filter((n) => set.has(n.id));
      if (!targets.length) return 0;
      if (targets.some((n) => n.locked) && !(await ensureKey('Delete locked notes'))) return null;
      setNotes((list) => list.filter((n) => !set.has(n.id)));
      return targets.length;
    },
    [ensureKey]
  );

  const changePassword = useCallback(async () => {
    const v = vaultRef.current;
    if (!v) return createPassword();
    const key = await askPassword({
      mode: 'enter',
      title: 'Current password',
      message: 'Enter your current lock password.',
      confirmLabel: 'Continue',
      run: (pw) => unlockVault(v, pw),
    });
    if (!key) return;
    const done = await askPassword({
      mode: 'create',
      title: 'New lock password',
      message: 'Your locked notes stay encrypted; only the password changes.',
      confirmLabel: 'Change password',
      run: async (pw) => {
        const next = await rewrapVault(key, pw);
        vaultRef.current = next;
        setVault(next);
        Vault.setKey(key);
        return true;
      },
    });
    if (done) setNotice({ title: 'Password changed', message: 'Use your new password to open locked notes.' });
  }, [askPassword, createPassword]);

  // Forgot password: the only way out is deleting the locked notes (they can't be decrypted).
  const resetLocked = useCallback(() => {
    setNotes((l) => l.filter((n) => !n.locked));
    vaultRef.current = null;
    setVault(null);
    Vault.lock();
  }, []);
  const toggleView = useCallback(
    () => setPrefs((p) => ({ ...p, view: p.view === 'grid' ? 'list' : 'grid' })),
    []
  );
  const remove = useCallback((id) => setNotes((list) => list.filter((n) => n.id !== id)), []);
  const openEditorRef = useRef(null);

  const togglePin = useCallback(
    (id) =>
      setNotes((list) => {
        const n = list.find((x) => x.id === id);
        return n ? upsertNote(list, { ...n, pinned: !n.pinned }) : list;
      }),
    []
  );

  const setNoteTopic = useCallback(
    (id, topicId) => setNotes((list) => list.map((n) => (n.id === id ? { ...n, topicId } : n))),
    []
  );

  const reorder = useCallback(
    (visibleIds, from, to) => setNotes((list) => applyReorder(list, visibleIds, from, to) ?? list),
    []
  );

  // Returns the id of the saved topic (or null if the limit is reached).
  const topicsRef = useRef(topics);
  topicsRef.current = topics;
  const saveTopic = useCallback((id, { name, color }) => {
    if (id) {
      setTopics((list) => list.map((t) => (t.id === id ? { ...t, name, color } : t)));
      return id;
    }
    if (topicsRef.current.length >= MAX_TOPICS) return null;
    const topic = { id: newId(), name, color, isDefault: false };
    topicsRef.current = [...topicsRef.current, topic];
    setTopics((list) => (list.length >= MAX_TOPICS ? list : [...list, topic]));
    return topic.id;
  }, []);

  // Deleting a topic moves its notes to the default topic; the default topic itself stays.
  const deleteTopic = useCallback((id) => {
    const list = topicsRef.current;
    const target = list.find((t) => t.id === id);
    const fallback = defaultTopicId(list);
    if (!target || target.isDefault || !fallback || fallback === id) return;
    setTopics((l) => l.filter((t) => t.id !== id));
    setNotes((l) => l.map((n) => (n.topicId === id ? { ...n, topicId: fallback } : n)));
  }, []);

  const setTheme = useCallback((value) => setPrefs((p) => ({ ...p, theme: value })), []);

  // Restore from a backup: "merge" adds its notes, "replace" swaps everything.
  // A safety copy of the current notes is written first (locked notes stay encrypted in it).
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const restoreBackup = useCallback(
    async (backup, mode) => {
      const current = { notes: notesRef.current, topics: topicsRef.current };
      keepSafetyCopy({ ...current, prefs, vault: vaultRef.current }, APP_VERSION);
      if (mode === 'replace') {
        setTopics(ensureDefaultTopic(backup.topics));
        setNotes(backup.notes);
        // Locked notes in the backup open with the backup's lock password.
        Vault.lock();
        vaultRef.current = backup.vault;
        setVault(backup.vault);
        return { added: backup.notes.length, skipped: 0, lockedSkipped: 0 };
      }
      const incomingLocked = backup.notes.filter((n) => n.locked);
      let transformLocked = null;
      let adoptVault = null;
      if (incomingLocked.length) {
        if (!vaultRef.current && backup.vault) {
          // No lock password here yet: adopt the backup's, so its locked notes open with it.
          adoptVault = backup.vault;
          transformLocked = (note, finalId, origId) => (finalId === origId ? note : null);
        } else if (vaultRef.current) {
          const key = await ensureKey('Unlock to import locked notes');
          if (key) {
            let srcKey = null;
            try {
              decryptNote(key, incomingLocked[0]); // same password lineage as this phone?
              srcKey = key;
            } catch {
              if (backup.vault) {
                const res = await askPassword({
                  mode: 'enter',
                  title: 'Backup’s lock password',
                  message: `This backup has ${incomingLocked.length} locked note${
                    incomingLocked.length === 1 ? '' : 's'
                  } protected by a different password. Enter it to import them.`,
                  confirmLabel: 'Import',
                  extraAction: { label: 'Skip them' },
                  run: (pw) => unlockVault(backup.vault, pw),
                });
                if (res && !res.extra) srcKey = res;
              }
            }
            if (srcKey) {
              transformLocked = (note, finalId, origId) =>
                encryptNote(key, { ...decryptNote(srcKey, { ...note, id: origId }), id: finalId });
            }
          }
        }
      }
      const merged = mergeData(current, backup, { transformLocked });
      if (adoptVault) {
        vaultRef.current = adoptVault;
        setVault(adoptVault);
      }
      setTopics(merged.topics);
      setNotes(merged.notes);
      return merged;
    },
    [prefs, ensureKey, askPassword]
  );

  const openSettings = useCallback(() => {
    Keyboard.dismiss();
    setSettingsOpen(true);
    settingsSlide.setValue(WIDTH);
    Animated.spring(settingsSlide, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 200 }).start();
  }, [settingsSlide]);

  const closeSettings = useCallback(() => {
    Animated.timing(settingsSlide, { toValue: WIDTH, duration: 220, useNativeDriver: true }).start(() =>
      setSettingsOpen(false)
    );
  }, [settingsSlide]);

  const openEditor = useCallback(
    (note, isNew = false) => {
      Keyboard.dismiss();
      setEditing({ note, isNew });
      slide.setValue(WIDTH);
      Animated.spring(slide, { toValue: 0, useNativeDriver: true, damping: 22, stiffness: 200 }).start();
    },
    [slide]
  );
  openEditorRef.current = openEditor;

  // Leaving the app locks everything again: an open locked note is saved (encrypted) and
  // closed first, then the key is wiped from memory.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'background') return;
      if (editingRef.current?.note?.locked) editorRef.current?.close();
      Vault.lock();
    });
    return () => sub.remove();
  }, []);

  const finishClose = useCallback(() => {
    Keyboard.dismiss();
    Animated.timing(slide, { toValue: WIDTH, duration: 220, useNativeDriver: true }).start(() =>
      setEditing(null)
    );
  }, [slide]);

  const closeEditor = useCallback(
    (draft) => {
      if (draft) {
        if (isEmpty(draft)) remove(draft.id);
        else upsert(draft);
      }
      finishClose();
    },
    [remove, upsert, finishClose]
  );

  // New notes go to the selected topic filter, otherwise to the default topic (Personal).
  const createNote = useCallback(
    (filterTopicId) => {
      const list = topicsRef.current;
      const topicId = list.some((t) => t.id === filterTopicId) ? filterTopicId : defaultTopicId(list);
      const now = Date.now();
      openEditor(
        { id: newId(), title: '', body: '', html: '', topicId, pinned: false, createdAt: now, updatedAt: now },
        true
      );
    },
    [openEditor]
  );

  useEffect(() => {
    if (!editing) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      editorRef.current?.close();
      return true;
    });
    return () => sub.remove();
  }, [editing]);

  useEffect(() => {
    if (!settingsOpen || editing) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeSettings();
      return true;
    });
    return () => sub.remove();
  }, [settingsOpen, editing, closeSettings]);

  const passwordSheet = (
    <PasswordSheet
      visible={!!pwPrompt}
      resetKey={pwPrompt?.id}
      title={pwPrompt?.title}
      message={pwPrompt?.message}
      mode={pwPrompt?.mode}
      confirmLabel={pwPrompt?.confirmLabel}
      extraAction={pwPrompt?.extraAction && { label: pwPrompt.extraAction.label, onPress: () => finishPrompt({ extra: true }) }}
      onSubmit={async (pw) => {
        const result = await pwPrompt.run(pw);
        finishPrompt(result ?? true);
      }}
      onClose={() => finishPrompt(null)}
    />
  );

  if (!appReady) return null;

  if (status === 'error') {
    return (
      <View style={styles.error}>
        <Text style={styles.errorTitle}>Couldn’t open your notes</Text>
        <Text style={styles.errorText}>Your notes are safe and weren’t changed. Please try again.</Text>
        <Pressable style={styles.errorBtn} onPress={load}>
          <Text style={styles.errorBtnText}>Try again</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      <HomeScreen
        notes={notes}
        topics={topics}
        view={prefs.view}
        onToggleView={toggleView}
        onOpenSettings={openSettings}
        onOpen={openNote}
        onCreate={createNote}
        onReorder={reorder}
        onTogglePin={togglePin}
        onSetTopic={setNoteTopic}
        onToggleLock={toggleLock}
        onDelete={removeNote}
        onDeleteMany={removeNotes}
        covered={!!editing || settingsOpen}
        onSaveTopic={saveTopic}
        onDeleteTopic={deleteTopic}
      />
      {settingsOpen && (
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: settingsSlide }] }]}>
          <SettingsScreen
            notes={notes}
            topics={topics}
            prefs={prefs}
            onSetTheme={setTheme}
            onRestore={restoreBackup}
            onClose={closeSettings}
            vault={vault}
            unlocked={unlocked}
            askPassword={askPassword}
            onSetPassword={createPassword}
            onChangePassword={changePassword}
            onLockNow={Vault.lock}
            onResetLocked={resetLocked}
          />
        </Animated.View>
      )}
      {editing && (
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ translateX: slide }] }]}>
          <EditorScreen
            key={editing.note.id}
            ref={editorRef}
            note={editing.note}
            isNew={editing.isNew}
            topics={topics}
            onChange={(draft) => !isEmpty(draft) && upsert(draft)}
            onClose={closeEditor}
            onDelete={(id) => {
              remove(id);
              finishClose();
            }}
            onSaveTopic={saveTopic}
            onEnsureKey={ensureKey}
          />
        </Animated.View>
      )}
      {passwordSheet}
      <ChoiceSheet
        visible={!!notice}
        title={notice?.title ?? ''}
        message={notice?.message}
        options={[{ key: 'ok', icon: 'check', label: 'OK', onPress: () => setNotice(null) }]}
        onClose={() => setNotice(null)}
      />
    </View>
  );
}

const makeStyles = (colors) => ({
  root: { flex: 1, backgroundColor: colors.bg },
  error: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: colors.bg },
  errorTitle: { fontFamily: fonts.bold, fontSize: 19, color: colors.text, marginBottom: 8 },
  errorText: { fontFamily: fonts.regular, fontSize: 14.5, color: colors.subtext, textAlign: 'center', lineHeight: 21 },
  errorBtn: {
    marginTop: 22,
    paddingHorizontal: 26,
    height: 48,
    borderRadius: 16,
    backgroundColor: colors.primary,
    justifyContent: 'center',
  },
  errorBtnText: { fontFamily: fonts.bold, fontSize: 15, color: '#fff' },
});
