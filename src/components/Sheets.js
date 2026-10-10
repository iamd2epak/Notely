import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Keyboard, Pressable, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  BottomSheetBackdrop,
  BottomSheetModal,
  BottomSheetTextInput,
  BottomSheetView,
} from '@gorhom/bottom-sheet';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { fonts, useStyles, useTheme } from '../theme';
import { MAX_TOPICS, MAX_TOPIC_NAME } from '../data';
import { success, tapSoft, tick, warning } from '../haptics';
import { MIN_PASSWORD, WrongPasswordError } from '../crypto';

const renderBackdrop = (props) => (
  <BottomSheetBackdrop {...props} appearsOnIndex={0} disappearsOnIndex={-1} opacity={0.5} pressBehavior="close" />
);

// Bottom sheet built on @gorhom/bottom-sheet: rendered above the whole app (portal), dimmed
// backdrop that blocks touches, spring open/close, swipe down / tap outside / Android back
// to dismiss, and keyboard-aware inputs. `visible` drives present()/dismiss().
export function Sheet({ visible, onClose, children }) {
  const ref = useRef(null);
  const insets = useSafeAreaInsets();
  const styles = useStyles(makeStyles);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;
  // Keep showing the last content while the sheet animates closed.
  const lastChildren = useRef(children);
  if (visible) lastChildren.current = children;

  // present()/dismiss() only when the state actually changes: calling dismiss() on a
  // sheet the user already swiped away can leave it unable to open again.
  const presented = useRef(false);
  useEffect(() => {
    try {
      if (visible && !presented.current) {
        presented.current = true;
        tapSoft();
        ref.current?.present();
      } else if (!visible && presented.current) {
        presented.current = false;
        ref.current?.dismiss();
      }
    } catch (e) {
      console.warn('Sheet failed to toggle', e);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onCloseRef.current?.();
      return true;
    });
    return () => sub.remove();
  }, [visible]);

  // Dismissed by swipe or backdrop tap: tell the owner so its state matches.
  const handleDismiss = useCallback(() => {
    presented.current = false;
    Keyboard.dismiss();
    if (visibleRef.current) onCloseRef.current?.();
  }, []);

  return (
    <BottomSheetModal
      ref={ref}
      onDismiss={handleDismiss}
      backdropComponent={renderBackdrop}
      enablePanDownToClose
      enableDynamicSizing
      // The app draws edge-to-edge, so Android never resizes the window for the keyboard:
      // "adjustPan" makes the sheet itself move up above the keyboard.
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      android_keyboardInputMode="adjustPan"
      handleIndicatorStyle={styles.handle}
      backgroundStyle={styles.sheetBg}
      style={styles.sheetShadow}
    >
      <BottomSheetView style={[styles.sheet, { paddingBottom: insets.bottom + 18 }]}>
        {visible ? children : lastChildren.current}
      </BottomSheetView>
    </BottomSheetModal>
  );
}

function Row({ icon, label, sublabel, color, onPress, right, disabled }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <Pressable
      disabled={disabled}
      onPress={() => {
        tick();
        onPress?.();
      }}
      style={({ pressed }) => [styles.row, sublabel && styles.rowTall, pressed && styles.rowPressed, disabled && styles.disabled]}
    >
      <View style={styles.rowIcon}>{icon}</View>
      <View style={styles.flex}>
        <Text style={[styles.rowLabel, { color: color ?? colors.text }]} numberOfLines={1}>
          {label}
        </Text>
        {!!sublabel && (
          <Text style={styles.rowSub} numberOfLines={2}>
            {sublabel}
          </Text>
        )}
      </View>
      {right}
    </Pressable>
  );
}

const Dot = ({ color, size = 14 }) => (
  <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
);

function Confirm({ text, onCancel, onConfirm, confirmLabel = 'Delete', danger = true }) {
  const { colors, dark } = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View>
      <Text style={styles.confirmText}>{text}</Text>
      <View style={styles.btnRow}>
        <Pressable style={[styles.btn, styles.btnGhost]} onPress={onCancel}>
          <Text style={[styles.btnText, { color: colors.text }]}>Cancel</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, { backgroundColor: danger ? colors.danger : colors.primary }]}
          onPress={() => {
            if (danger) warning();
            else success();
            onConfirm();
          }}
        >
          <Text style={[styles.btnText, !danger && dark && { color: colors.chipActiveText }]}>{confirmLabel}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function ConfirmSheet({ visible, title, text, confirmLabel, danger, onConfirm, onClose }) {
  const styles = useStyles(makeStyles);
  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={styles.title}>{title}</Text>
      <Confirm text={text} confirmLabel={confirmLabel} danger={danger} onCancel={onClose} onConfirm={onConfirm} />
    </Sheet>
  );
}

// A titled list of actions, e.g. "Save to device / Share".
// options: [{ key, icon, label, sublabel, color, onPress }]
export function ChoiceSheet({ visible, title, message, options, onClose }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={styles.title}>{title}</Text>
      {!!message && <Text style={[styles.confirmText, styles.message]}>{message}</Text>}
      {(options || []).map((o) => (
        <Row
          key={o.key}
          icon={<Icon name={o.icon} size={22} color={o.color ?? colors.text} />}
          label={o.label}
          sublabel={o.sublabel}
          color={o.color}
          onPress={o.onPress}
        />
      ))}
    </Sheet>
  );
}

// Password entry. mode 'enter' asks once; mode 'create' asks twice and explains that a
// forgotten password can't be recovered. onSubmit(password) may throw (wrong password etc.).
export function PasswordSheet({ visible, resetKey, title, message, mode = 'enter', confirmLabel = 'Unlock', extraAction, onSubmit, onClose }) {
  const { colors, dark } = useTheme();
  const styles = useStyles(makeStyles);
  const [session, setSession] = useState(0);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const pw = useRef('');
  const pw2 = useRef('');
  const creating = mode === 'create';

  useEffect(() => {
    if (!visible) return;
    pw.current = '';
    pw2.current = '';
    setShow(false);
    setBusy(false);
    setError(null);
    setSession((n) => n + 1);
  }, [visible, resetKey]);

  const submit = async () => {
    if (busy) return;
    const value = pw.current;
    if (creating) {
      if (value.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`);
      if (value !== pw2.current) return setError('Passwords don’t match.');
    } else if (!value) {
      return setError('Enter your password.');
    }
    setError(null);
    setBusy(true);
    try {
      await onSubmit(value);
    } catch (e) {
      warning();
      setError(e instanceof WrongPasswordError ? 'Wrong password. Try again.' : e?.message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const field = (ref, placeholder, autoFocus, last) => (
    <View style={styles.pwField}>
      <BottomSheetTextInput
        key={`${session}-${placeholder}`}
        onChangeText={(t) => {
          ref.current = t;
          if (error) setError(null);
        }}
        placeholder={placeholder}
        placeholderTextColor={colors.muted}
        secureTextEntry={!show}
        autoFocus={autoFocus}
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="off"
        importantForAutofill="no"
        textContentType="password"
        returnKeyType={last ? 'done' : 'next'}
        onSubmitEditing={last ? submit : undefined}
        editable={!busy}
        style={[styles.input, styles.pwInput, { borderColor: error ? colors.danger : colors.border }]}
      />
      {autoFocus && (
        <Pressable onPress={() => setShow((v) => !v)} hitSlop={10} style={styles.eye} accessibilityLabel={show ? 'Hide password' : 'Show password'}>
          <Icon name={show ? 'eye-off-outline' : 'eye-outline'} size={21} color={colors.muted} />
        </Pressable>
      )}
    </View>
  );

  return (
    <Sheet visible={visible} onClose={busy ? () => {} : onClose}>
      <View style={styles.pwHead}>
        <View style={styles.pwIcon}>
          <Icon name="lock-outline" size={22} color={colors.primary} />
        </View>
        <Text style={[styles.title, styles.flex, { marginBottom: 0 }]}>{title}</Text>
      </View>
      {!!message && <Text style={[styles.confirmText, styles.pwMessage]}>{message}</Text>}
      {field(pw, creating ? 'New password' : 'Password', true, !creating)}
      {creating && field(pw2, 'Confirm password', false, true)}
      {!!error && <Text style={styles.hint}>{error}</Text>}
      {creating && (
        <Text style={styles.note}>
          If you forget this password, locked notes can’t be recovered. There is no reset.
        </Text>
      )}
      <View style={styles.btnRow}>
        {extraAction && (
          <Pressable style={[styles.btn, styles.btnGhost]} onPress={extraAction.onPress} disabled={busy}>
            <Text style={[styles.btnText, { color: colors.text }]}>{extraAction.label}</Text>
          </Pressable>
        )}
        <Pressable style={[styles.btn, { backgroundColor: colors.primary }, busy && styles.disabled]} onPress={submit} disabled={busy}>
          {busy ? (
            <View style={styles.busyRow}>
              <ActivityIndicator color={dark ? '#111017' : '#fff'} />
              <Text style={[styles.btnText, dark && { color: '#111017' }]}>{creating ? 'Securing…' : 'Unlocking…'}</Text>
            </View>
          ) : (
            <Text style={[styles.btnText, dark && { color: '#111017' }]}>{confirmLabel}</Text>
          )}
        </Pressable>
      </View>
    </Sheet>
  );
}

// Export options: choose plain or password-encrypted, then where to save.
export function ExportSheet({ visible, noteCount, lockedCount, onExport, onClose }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const [encrypt, setEncrypt] = useState(true);
  const [session, setSession] = useState(0);
  const [error, setError] = useState(null);
  const pw = useRef('');
  const pw2 = useRef('');

  useEffect(() => {
    if (!visible) return;
    setEncrypt(true);
    setError(null);
    pw.current = '';
    pw2.current = '';
    setSession((n) => n + 1);
  }, [visible]);

  const go = (target) => {
    if (encrypt) {
      if (pw.current.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`);
      if (pw.current !== pw2.current) return setError('Passwords don’t match.');
    }
    setError(null);
    onExport({ target, password: encrypt ? pw.current : null });
  };

  const input = (ref, placeholder) => (
    <BottomSheetTextInput
      key={`${session}-${placeholder}`}
      onChangeText={(t) => {
        ref.current = t;
        if (error) setError(null);
      }}
      placeholder={placeholder}
      placeholderTextColor={colors.muted}
      secureTextEntry
      autoCapitalize="none"
      autoCorrect={false}
      autoComplete="off"
      importantForAutofill="no"
      style={[styles.input, styles.exportInput, { borderColor: error ? colors.danger : colors.border }]}
    />
  );

  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={styles.title}>Export backup</Text>
      <Text style={[styles.confirmText, styles.message]}>
        {noteCount} note{noteCount === 1 ? '' : 's'} will be saved in one file.
      </Text>
      <Pressable style={styles.switchRow} onPress={() => setEncrypt((v) => !v)}>
        <Icon name={encrypt ? 'shield-lock-outline' : 'shield-off-outline'} size={22} color={encrypt ? colors.primary : colors.muted} />
        <View style={styles.flex}>
          <Text style={styles.rowLabel}>Encrypt with password</Text>
          <Text style={styles.rowSub}>
            {encrypt
              ? 'AES-256 encrypted. The file can’t be opened without this password.'
              : lockedCount
              ? 'Readable file. Locked notes stay encrypted inside it.'
              : 'Readable file. Anyone with the file can read your notes.'}
          </Text>
        </View>
        <Switch
          value={encrypt}
          onValueChange={setEncrypt}
          trackColor={{ true: colors.primary, false: colors.border }}
          thumbColor={colors.surface}
        />
      </Pressable>
      {encrypt && (
        <>
          {input(pw, 'Backup password')}
          {input(pw2, 'Confirm password')}
          <Text style={styles.note}>You’ll need this password to restore the backup. It can’t be recovered.</Text>
        </>
      )}
      {!!error && <Text style={styles.hint}>{error}</Text>}
      <View style={styles.exportRows}>
        <Row
          icon={<Icon name="folder-download-outline" size={22} color={colors.text} />}
          label="Save to device"
          sublabel="Choose a folder, like Downloads or Documents"
          onPress={() => go('device')}
        />
        <Row
          icon={<Icon name="share-variant-outline" size={22} color={colors.text} />}
          label="Share…"
          sublabel="Send to Drive, email or another app"
          onPress={() => go('share')}
        />
      </View>
    </Sheet>
  );
}

// Create or edit a topic: name + one of the six colours (each colour belongs to one topic).
// The default topic (Personal) can be renamed and recoloured but not deleted.
export function TopicEditorSheet({ visible, topic: topicProp, topics, onSave, onDelete, onClose }) {
  const { colors, dark, noteColors, getNoteColor } = useTheme();
  // While the sheet animates closed its owner may already have cleared `topic`
  // (e.g. right after deleting it); keep rendering the one that was open.
  const lastTopic = useRef(topicProp);
  if (visible) lastTopic.current = topicProp;
  const topic = visible ? topicProp : lastTopic.current;
  const styles = useStyles(makeStyles);
  const [name, setName] = useState('');
  const [color, setColor] = useState(null);
  const [confirming, setConfirming] = useState(false);
  const [session, setSession] = useState(0); // remounts the input each time the sheet opens
  const used = new Set(topics.filter((t) => t.id !== topic?.id).map((t) => t.color));
  const defaultTopic = topics.find((t) => t.isDefault);

  useEffect(() => {
    if (!visible) return;
    setName(topic?.name ?? '');
    setSession((n) => n + 1);
    setColor(topic?.color ?? noteColors.find((c) => !used.has(c.key))?.key ?? null);
    setConfirming(false);
  }, [visible, topic]); // eslint-disable-line react-hooks/exhaustive-deps

  const trimmed = name.trim();
  const duplicate = topics.some((t) => t.id !== topic?.id && t.name.toLowerCase() === trimmed.toLowerCase());
  const canSave = !!trimmed && !!color && !duplicate;
  const accent = getNoteColor(color).accent;
  const save = () => {
    if (!canSave) return;
    success();
    onSave({ name: trimmed, color });
  };

  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={styles.title}>{topic ? 'Edit topic' : 'New topic'}</Text>
      {confirming ? (
        <Confirm
          text={`Delete “${topic?.name ?? 'this topic'}”? Its notes move to “${defaultTopic?.name ?? 'Personal'}”.`}
          onCancel={() => setConfirming(false)}
          onConfirm={onDelete}
        />
      ) : (
        <>
          {/* Uncontrolled input: the field owns its text, so fast typing never drops characters. */}
          <BottomSheetTextInput
            key={session}
            defaultValue={topic?.name ?? ''}
            onChangeText={setName}
            placeholder="Topic name"
            placeholderTextColor={colors.muted}
            maxLength={MAX_TOPIC_NAME}
            autoFocus={!topic}
            style={[styles.input, { borderColor: accent }]}
            returnKeyType="done"
            onSubmitEditing={save}
          />
          {duplicate && <Text style={styles.hint}>You already have a topic with this name.</Text>}
          {topic?.isDefault && <Text style={styles.note}>Default topic: new notes are saved here.</Text>}
          <Text style={styles.label}>Colour</Text>
          <View style={styles.swatches}>
            {noteColors.map((c) => {
              const taken = used.has(c.key);
              const active = c.key === color;
              return (
                <Pressable
                  key={c.key}
                  disabled={taken}
                  onPress={() => {
                    tick();
                    setColor(c.key);
                  }}
                  style={[styles.swatch, { backgroundColor: c.bg, borderColor: active ? c.accent : 'transparent' }, taken && styles.taken]}
                >
                  <View style={[styles.swatchInner, { backgroundColor: c.accent }]}>
                    {active && <Icon name="check" size={15} color={dark ? '#111017' : '#fff'} />}
                  </View>
                </Pressable>
              );
            })}
          </View>
          <View style={styles.btnRow}>
            {topic && !topic.isDefault && (
              <Pressable style={[styles.btn, styles.btnGhost]} onPress={() => setConfirming(true)}>
                <Text style={[styles.btnText, { color: colors.danger }]}>Delete</Text>
              </Pressable>
            )}
            <Pressable
              disabled={!canSave}
              style={[styles.btn, { backgroundColor: accent }, !canSave && styles.disabled]}
              onPress={save}
            >
              <Text style={[styles.btnText, dark && { color: '#111017' }]}>{topic ? 'Save' : 'Create topic'}</Text>
            </Pressable>
          </View>
        </>
      )}
    </Sheet>
  );
}

function TopicList({ topics, value, onPick, onNewTopic }) {
  const { colors, getNoteColor } = useTheme();
  return (
    <View>
      {topics.map((t) => {
        const c = getNoteColor(t.color);
        return (
          <Row
            key={t.id}
            icon={<Dot color={c.accent} />}
            label={t.name}
            onPress={() => onPick(t.id)}
            right={value === t.id && <Icon name="check" size={20} color={c.accent} />}
          />
        );
      })}
      {topics.length < MAX_TOPICS && onNewTopic && (
        <Row
          icon={<Icon name="plus" size={20} color={colors.primary} />}
          label="New topic"
          color={colors.primary}
          onPress={onNewTopic}
        />
      )}
    </View>
  );
}

export function TopicPickerSheet({ visible, topics, value, onPick, onNewTopic, onClose }) {
  const styles = useStyles(makeStyles);
  return (
    <Sheet visible={visible} onClose={onClose}>
      <Text style={styles.title}>Topic</Text>
      <TopicList topics={topics} value={value} onPick={onPick} onNewTopic={onNewTopic} />
    </Sheet>
  );
}

// Actions for a note on the home screen: pin, change topic, delete.
export function NoteActionsSheet({ note, topics, onTogglePin, onToggleLock, onSetTopic, onSelect, onDelete, onClose }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const [mode, setMode] = useState('menu'); // menu | topic | confirm
  const lastNote = useRef(note);
  if (note) lastNote.current = note;
  useEffect(() => {
    if (note) setMode('menu');
  }, [note?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = note ?? lastNote.current;
  if (!shown) return null;

  return (
    <Sheet visible={!!note} onClose={onClose}>
      <Text style={styles.title} numberOfLines={1}>
        {shown.locked ? 'Locked note' : shown.title.trim() || 'Untitled note'}
      </Text>
      {mode === 'menu' && (
        <>
          <Row
            icon={<Icon name={shown.pinned ? 'pin-off-outline' : 'pin-outline'} size={21} color={colors.text} />}
            label={shown.pinned ? 'Unpin' : 'Pin to top'}
            onPress={onTogglePin}
          />
          <Row
            icon={<Icon name={shown.locked ? 'lock-open-variant-outline' : 'lock-outline'} size={21} color={colors.text} />}
            label={shown.locked ? 'Remove lock' : 'Lock note'}
            onPress={onToggleLock}
          />
          <Row
            icon={<Icon name="tag-outline" size={21} color={colors.text} />}
            label="Change topic"
            onPress={() => setMode('topic')}
            right={<Icon name="chevron-right" size={20} color={colors.muted} />}
          />
          {onSelect && (
            <Row
              icon={<Icon name="checkbox-multiple-marked-circle-outline" size={21} color={colors.text} />}
              label="Select"
              sublabel="Choose several notes to delete at once"
              onPress={onSelect}
            />
          )}
          <Row
            icon={<Icon name="trash-can-outline" size={21} color={colors.danger} />}
            label="Delete"
            color={colors.danger}
            onPress={() => setMode('confirm')}
          />
        </>
      )}
      {mode === 'topic' && <TopicList topics={topics} value={shown.topicId} onPick={onSetTopic} />}
      {mode === 'confirm' && (
        <Confirm text="Delete this note? This can’t be undone." onCancel={() => setMode('menu')} onConfirm={onDelete} />
      )}
    </Sheet>
  );
}

const makeStyles = (colors) => ({
  flex: { flex: 1 },
  sheetBg: { backgroundColor: colors.surface, borderTopLeftRadius: 28, borderTopRightRadius: 28 },
  sheetShadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 24,
  },
  sheet: { paddingHorizontal: 20, paddingTop: 4 },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border },
  title: { fontFamily: fonts.bold, fontSize: 18, color: colors.text, marginBottom: 12 },
  message: { marginTop: -4, marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 52, borderRadius: 14, paddingHorizontal: 6 },
  rowTall: { paddingVertical: 10 },
  rowPressed: { backgroundColor: colors.bg },
  rowIcon: { width: 32, alignItems: 'center', marginRight: 10 },
  rowLabel: { fontFamily: fonts.semibold, fontSize: 15.5 },
  rowSub: { fontFamily: fonts.regular, fontSize: 12.5, lineHeight: 17, color: colors.muted, marginTop: 2 },
  input: {
    height: 52,
    borderWidth: 1.5,
    borderRadius: 16,
    paddingHorizontal: 16,
    fontFamily: fonts.semibold,
    fontSize: 16,
    color: colors.text,
    backgroundColor: colors.bg,
  },
  hint: { fontFamily: fonts.medium, fontSize: 12.5, color: colors.danger, marginTop: 6 },
  note: { fontFamily: fonts.medium, fontSize: 12.5, color: colors.muted, marginTop: 8 },
  label: { fontFamily: fonts.semibold, fontSize: 13, color: colors.muted, marginTop: 18, marginBottom: 10 },
  swatches: { flexDirection: 'row', justifyContent: 'space-between' },
  swatch: { width: 44, height: 44, borderRadius: 22, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  swatchInner: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  taken: { opacity: 0.25 },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 22 },
  btn: { flex: 1, height: 50, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { backgroundColor: colors.bg },
  btnText: { fontFamily: fonts.bold, fontSize: 15, color: '#fff' },
  disabled: { opacity: 0.4 },
  confirmText: { fontFamily: fonts.medium, fontSize: 15, lineHeight: 22, color: colors.subtext },
  pwHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
  pwIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pwMessage: { fontSize: 14, marginBottom: 12 },
  pwField: { justifyContent: 'center', marginBottom: 10 },
  pwInput: { paddingRight: 48 },
  eye: { position: 'absolute', right: 14 },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  exportInput: { marginTop: 8 },
  exportRows: { marginTop: 10 },
});
