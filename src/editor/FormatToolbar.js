import { memo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import * as Haptics from 'expo-haptics';
import { fonts, shadowFor, useStyles, useTheme } from '../theme';

const TEXT_COLORS = ['#1B1A2E', '#E5484D', '#F2763A', '#D49B00', '#14A673', '#2F86E6', '#6C5CE7', '#E64980'];
const HIGHLIGHTS = [null, '#FFF1A8', '#C9F2DD', '#D4E8FF', '#FFD6E5', '#E3DCFF', '#FFE0CC'];
const ALIGN_NEXT = { left: 'center', center: 'right', right: 'left' };

// One row of buttons above the keyboard. Colour buttons swap the row for a palette.
function FormatToolbar({ state, accent, onCommand, onKeepFocus }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const shadow = shadowFor(colors);
  const [palette, setPaletteState] = useState(null); // null | 'color' | 'highlight'
  const setPalette = (v) => {
    setPaletteState(v);
    onKeepFocus?.();
  };
  const s = state || {};

  const run = (name, value) => {
    Haptics.selectionAsync().catch(() => {});
    onCommand(name, value);
  };

  if (palette) {
    const isColor = palette === 'color';
    return (
      <View style={[styles.bar, shadow]}>
        <Btn icon="chevron-left" onPress={() => setPalette(null)} />
        <Text style={styles.paletteLabel}>{isColor ? 'Text' : 'Highlight'}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always"
          contentContainerStyle={styles.row}>
          {(isColor ? TEXT_COLORS : HIGHLIGHTS).map((c) => (
            <Pressable
              key={c || 'none'}
              onPress={() => {
                run(isColor ? 'color' : 'highlight', c);
                setPalette(null);
              }}
              hitSlop={4}
              // The first text colour means "default text colour", which follows the theme.
              style={[
                styles.swatch,
                { backgroundColor: c === TEXT_COLORS[0] ? colors.text : c || colors.surface },
                !c && styles.swatchNone,
              ]}
            >
              {!c && <Icon name="water-off" size={16} color={colors.muted} />}
              {isColor && c && <Text style={[styles.swatchA, c === TEXT_COLORS[0] && { color: colors.surface }]}>A</Text>}
            </Pressable>
          ))}
        </ScrollView>
      </View>
    );
  }

  const tint = accent + '24';
  const b = (icon, name, active, value) => (
    <Btn key={name + (value || '')} icon={icon} active={active} accent={accent} tint={tint} onPress={() => run(name, value)} />
  );

  return (
    <View style={[styles.bar, shadow]}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always"
        contentContainerStyle={styles.row}>
        {b('format-bold', 'bold', s.bold)}
        {b('format-italic', 'italic', s.italic)}
        {b('format-underline', 'underline', s.underline)}
        {b('format-strikethrough-variant', 'strike', s.strike)}
        <Sep />
        {b('format-header-1', 'h1', s.block === 'h1')}
        {b('format-header-2', 'h2', s.block === 'h2')}
        <Sep />
        {b('checkbox-marked-outline', 'check', s.list === 'check')}
        {b('format-list-bulleted', 'ul', s.list === 'ul')}
        {b('format-list-numbered', 'ol', s.list === 'ol')}
        <Sep />
        <Btn icon="format-color-text" onPress={() => setPalette('color')} />
        <Btn icon="marker" onPress={() => setPalette('highlight')} />
        <Sep />
        {b('format-quote-open', 'quote', s.block === 'quote')}
        {b('code-tags', 'code', s.block === 'code')}
        {b('minus', 'divider', false)}
        {b(`format-align-${s.align || 'left'}`, 'align', s.align && s.align !== 'left', ALIGN_NEXT[s.align || 'left'])}
        {b('format-clear', 'clear', false)}
        <Sep />
        {b('undo', 'undo', false)}
        {b('redo', 'redo', false)}
      </ScrollView>
    </View>
  );
}

function Btn({ icon, onPress, active, accent, tint }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      hitSlop={2}
      style={({ pressed }) => [styles.btn, active && { backgroundColor: tint }, pressed && styles.pressed]}
    >
      <Icon name={icon} size={22} color={active ? accent : colors.text} />
    </Pressable>
  );
}

function Sep() {
  const styles = useStyles(makeStyles);
  return <View style={styles.sep} />;
}

export default memo(FormatToolbar);

const makeStyles = (colors) => ({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: 10,
    marginTop: 6,
    marginBottom: 8,
    height: 52,
    borderRadius: 18,
    backgroundColor: colors.surface,
    paddingHorizontal: 4,
    shadowOpacity: 0.1,
  },
  row: { alignItems: 'center', paddingHorizontal: 2, gap: 2 },
  btn: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  pressed: { backgroundColor: colors.bg },
  sep: { width: 1, height: 22, backgroundColor: colors.border, marginHorizontal: 4 },
  paletteLabel: { fontFamily: fonts.semibold, fontSize: 13, color: colors.subtext, marginRight: 6 },
  swatch: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatchNone: { borderWidth: 1.5, borderColor: colors.border },
  swatchA: { fontFamily: fonts.extrabold, fontSize: 14, color: '#fff' },
});
