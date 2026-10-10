import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import IconButton from '../components/IconButton';
import { ChoiceSheet, ConfirmSheet, ExportSheet } from '../components/Sheets';
import { fonts, useStyles, useTheme } from '../theme';
import { pickBackup, saveBackupToDevice, shareBackup } from '../backup';
import { success, tick, warning } from '../haptics';
import { decryptBlob, encryptBlob } from '../crypto';
import { isEncryptedBackup, lockedCount as countLocked, makeBackup, parseBackupObject } from '../data';
import appJson from '../../app.json';

const APP_VERSION = appJson?.expo?.version ?? '1.0.0';
const THEME_OPTIONS = [
  { key: 'system', label: 'System', icon: 'cellphone' },
  { key: 'light', label: 'Light', icon: 'white-balance-sunny' },
  { key: 'dark', label: 'Dark', icon: 'weather-night' },
];

export default function SettingsScreen({
  notes,
  topics,
  prefs,
  vault,
  unlocked,
  askPassword,
  onSetTheme,
  onRestore,
  onSetPassword,
  onChangePassword,
  onLockNow,
  onResetLocked,
  onClose,
}) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const [sheet, setSheet] = useState(null); // 'export' | 'import' | 'replace' | 'forgot'
  const locked = countLocked(notes);
  const [pending, setPending] = useState(null); // parsed backup waiting for a choice
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null); // { text, error }
  const toastTimer = useRef(null);

  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const showToast = (text, error = false) => {
    clearTimeout(toastTimer.current);
    setToast({ text, error });
    if (error) warning();
    else success();
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  };

  // Runs a backup task with a busy state and friendly error messages.
  const run = async (task) => {
    if (busy) return;
    setBusy(true);
    try {
      await task();
    } catch (e) {
      console.warn('Backup task failed', e);
      showToast(e?.message || 'Something went wrong. Please try again.', true);
    } finally {
      setBusy(false);
    }
  };

  const data = { notes, topics, prefs, vault };

  // password = null for a readable file, otherwise the file is AES-256 encrypted with it.
  const exportTo = ({ target, password }) => {
    setSheet(null);
    // Let the sheet close before the system picker opens.
    setTimeout(
      () =>
        run(async () => {
          const backup = makeBackup(data, APP_VERSION);
          const json = JSON.stringify(password ? await encryptBlob(password, backup) : backup);
          const encrypted = !!password;
          const name = target === 'device' ? await saveBackupToDevice(json, encrypted) : await shareBackup(json, encrypted);
          if (name && target === 'device') showToast(`${encrypted ? 'Encrypted backup' : 'Backup'} saved as ${name}`);
        }),
      250
    );
  };

  const startImport = async () => {
    if (busy) return;
    let raw;
    setBusy(true);
    try {
      raw = await pickBackup();
    } catch (e) {
      showToast(e?.message || 'Couldn’t read that file.', true);
      return;
    } finally {
      setBusy(false);
    }
    if (!raw) return;
    try {
      if (isEncryptedBackup(raw)) {
        const blob = raw;
        raw = await askPassword({
          mode: 'enter',
          title: 'Encrypted backup',
          message: 'Enter the password that was used to export this backup.',
          confirmLabel: 'Open backup',
          run: (pw) => decryptBlob(pw, blob),
        });
        if (!raw) return;
      }
      const backup = parseBackupObject(raw);
      if (!backup.notes.length) {
        showToast('That backup doesn’t contain any notes.', true);
        return;
      }
      setPending(backup);
      setSheet('import');
    } catch (e) {
      console.warn('Import failed', e);
      showToast(e?.message || 'Couldn’t read that backup.', true);
    }
  };

  const restore = (mode) => {
    const backup = pending;
    setSheet(null);
    setPending(null);
    if (!backup) return;
    setTimeout(async () => {
      try {
        const result = await onRestore(backup, mode);
        const skippedLocked = result.lockedSkipped
          ? ` ${result.lockedSkipped} locked note${result.lockedSkipped === 1 ? ' was' : 's were'} skipped.`
          : '';
        if (mode === 'replace') showToast(`Restored ${backup.notes.length} notes`);
        else if (result.added === 0) showToast(`Nothing new to add.${skippedLocked}`, !!skippedLocked);
        else showToast(`Added ${result.added} note${result.added === 1 ? '' : 's'}.${skippedLocked}`);
      } catch (e) {
        console.warn('Restore failed', e);
        showToast('Couldn’t restore this backup. Your notes weren’t changed.', true);
      }
    }, 250);
  };

  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
      <View style={styles.topbar}>
        <IconButton name="chevron-back" onPress={onClose} accessibilityLabel="Back" />
        <Text style={styles.heading}>Settings</Text>
      </View>

      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}>
        <Text style={styles.section}>Appearance</Text>
        <View style={styles.card}>
          <View style={styles.segment}>
            {THEME_OPTIONS.map((o) => {
              const active = prefs.theme === o.key;
              return (
                <Pressable
                  key={o.key}
                  onPress={() => {
                    if (!active) tick();
                    onSetTheme(o.key);
                  }}
                  style={[styles.segBtn, active && styles.segActive]}
                  accessibilityLabel={`${o.label} theme`}
                  accessibilityState={{ selected: active }}
                >
                  <Icon name={o.icon} size={19} color={active ? colors.primary : colors.subtext} />
                  <Text style={[styles.segText, active && { color: colors.primary }]}>{o.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.caption}>System follows your phone’s light or dark setting.</Text>
        </View>

        <Text style={styles.section}>Locked notes</Text>
        <View style={styles.card}>
          {vault ? (
            <>
              <View style={styles.statusRow}>
                <Icon name={unlocked ? 'lock-open-variant-outline' : 'lock'} size={18} color={colors.primary} />
                <Text style={styles.statusText}>
                  {locked} locked note{locked === 1 ? '' : 's'} · {unlocked ? 'Unlocked until you leave the app' : 'Locked'}
                </Text>
              </View>
              <View style={styles.divider} />
              {unlocked && (
                <>
                  <SettingRow icon="lock-outline" title="Lock now" subtitle="Ask for the password again" onPress={onLockNow} />
                  <View style={styles.divider} />
                </>
              )}
              <SettingRow
                icon="form-textbox-password"
                title="Change password"
                subtitle="Notes stay encrypted; only the password changes"
                onPress={onChangePassword}
              />
              <View style={styles.divider} />
              <SettingRow
                icon="help-circle-outline"
                title="Forgot password?"
                subtitle="Locked notes can’t be recovered without it"
                onPress={() => setSheet('forgot')}
              />
            </>
          ) : (
            <SettingRow
              icon="lock-plus-outline"
              title="Set lock password"
              subtitle="Lock notes with AES-256 encryption on this phone"
              onPress={onSetPassword}
            />
          )}
        </View>

        <Text style={styles.section}>Backup & restore</Text>
        <View style={styles.card}>
          <SettingRow
            icon="tray-arrow-up"
            title="Export backup"
            subtitle="Save all notes and topics to a file"
            onPress={() => setSheet('export')}
            disabled={busy}
          />
          <View style={styles.divider} />
          <SettingRow
            icon="tray-arrow-down"
            title="Import backup"
            subtitle="Restore notes from a backup file"
            onPress={startImport}
            disabled={busy}
          />
        </View>

        <Text style={styles.section}>About</Text>
        <View style={styles.card}>
          <InfoRow label="Version" value={APP_VERSION} />
          <View style={styles.divider} />
          <InfoRow label="Notes" value={String(notes.length)} />
          <View style={styles.divider} />
          <InfoRow label="Topics" value={String(topics.length)} />
        </View>
        <Text style={styles.footer}>Notely · Your notes stay on this device</Text>
      </ScrollView>

      {busy && (
        <View style={styles.busy} pointerEvents="none">
          <ActivityIndicator color={colors.primary} />
        </View>
      )}
      {toast && (
        <View
          style={[styles.toast, { bottom: insets.bottom + 24 }, toast.error && styles.toastError]}
          pointerEvents="none"
        >
          <Icon name={toast.error ? 'alert-circle-outline' : 'check-circle-outline'} size={19} color="#fff" />
          <Text style={styles.toastText} numberOfLines={3}>
            {toast.text}
          </Text>
        </View>
      )}

      <ExportSheet
        visible={sheet === 'export'}
        noteCount={notes.length}
        lockedCount={locked}
        onExport={exportTo}
        onClose={() => setSheet(null)}
      />
      <ChoiceSheet
        visible={sheet === 'import'}
        title="Restore backup"
        message={
          pending
            ? `This backup has ${plural(pending.notes.length, 'note')} and ${plural(pending.topics.length, 'topic')}${
                countLocked(pending.notes) ? ` (${countLocked(pending.notes)} locked)` : ''
              }.`
            : ''
        }
        onClose={() => {
          setSheet(null);
          setPending(null);
        }}
        options={[
          {
            key: 'merge',
            icon: 'playlist-plus',
            label: 'Add to my notes',
            sublabel: 'Keep current notes and add the ones from the backup',
            onPress: () => restore('merge'),
          },
          {
            key: 'replace',
            icon: 'backup-restore',
            label: 'Replace all notes',
            sublabel: 'Remove current notes and restore the backup',
            color: colors.danger,
            onPress: () => setSheet('replace'),
          },
        ]}
      />
      <ConfirmSheet
        visible={sheet === 'replace'}
        title="Replace all notes?"
        text="Your current notes and topics will be replaced by the backup. A safety copy is kept inside the app."
        confirmLabel="Replace"
        onClose={() => {
          setSheet(null);
          setPending(null);
        }}
        onConfirm={() => restore('replace')}
      />
      <ConfirmSheet
        visible={sheet === 'forgot'}
        title="Forgot password?"
        text={`Locked notes are encrypted with your password, so nobody can open them without it. You can remove the password, which permanently deletes ${plural(
          locked,
          'locked note'
        )}.`}
        confirmLabel="Delete & reset"
        onClose={() => setSheet(null)}
        onConfirm={() => {
          setSheet(null);
          onResetLocked();
          showToast('Lock password removed');
        }}
      />
    </View>
  );
}

function SettingRow({ icon, title, subtitle, onPress, disabled }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed, disabled && { opacity: 0.5 }]}
    >
      <View style={styles.rowIcon}>
        <Icon name={icon} size={21} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSub}>{subtitle}</Text>
      </View>
      <Icon name="chevron-right" size={22} color={colors.muted} />
    </Pressable>
  );
}

function InfoRow({ label, value }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.info}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const makeStyles = (colors) => ({
  screen: { flex: 1, backgroundColor: colors.bg },
  topbar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingBottom: 6 },
  heading: { fontFamily: fonts.extrabold, fontSize: 24, color: colors.text, letterSpacing: -0.4 },
  content: { paddingHorizontal: 16, paddingTop: 8 },
  section: {
    fontFamily: fonts.bold,
    fontSize: 12.5,
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    color: colors.muted,
    marginTop: 18,
    marginBottom: 8,
    marginLeft: 6,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 8,
  },
  segment: { flexDirection: 'row', gap: 6, backgroundColor: colors.bg, borderRadius: 16, padding: 4 },
  segBtn: {
    flex: 1,
    height: 64,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  segActive: {
    backgroundColor: colors.surface,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 2,
  },
  segText: { fontFamily: fonts.semibold, fontSize: 13, color: colors.subtext },
  caption: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.muted, marginTop: 10, marginHorizontal: 8, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, borderRadius: 16 },
  rowPressed: { backgroundColor: colors.bg },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 13,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { fontFamily: fonts.semibold, fontSize: 15.5, color: colors.text },
  rowSub: { fontFamily: fonts.regular, fontSize: 12.5, color: colors.muted, marginTop: 2 },
  divider: { height: 1, backgroundColor: colors.border, marginHorizontal: 10 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 12 },
  statusText: { flex: 1, fontFamily: fonts.semibold, fontSize: 13.5, color: colors.subtext },
  info: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, height: 48 },
  infoLabel: { fontFamily: fonts.medium, fontSize: 15, color: colors.subtext },
  infoValue: { fontFamily: fonts.bold, fontSize: 15, color: colors.text },
  footer: { fontFamily: fonts.medium, fontSize: 12.5, color: colors.muted, textAlign: 'center', marginTop: 24 },
  busy: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
});
