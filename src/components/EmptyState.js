import { Text, View } from 'react-native';
import Icon from '@expo/vector-icons/MaterialCommunityIcons';
import { fonts, useStyles, useTheme } from '../theme';

const COPY = {
  search: ['magnify', 'No matches found', 'Try a different word.'],
  topic: ['tag-outline', 'Nothing here yet', 'Tap + to add a note to this topic.'],
  empty: ['note-text-outline', 'No notes yet', 'Tap + to capture your first idea.'],
};

export default function EmptyState({ kind = 'empty' }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  const [icon, title, sub] = COPY[kind];
  return (
    <View style={styles.wrap}>
      <View style={styles.badge}>
        <Icon name={icon} size={38} color={colors.primary} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.sub}>{sub}</Text>
    </View>
  );
}

const makeStyles = (colors) => ({
  wrap: { alignItems: 'center', paddingTop: 60, paddingHorizontal: 40 },
  badge: {
    width: 88,
    height: 88,
    borderRadius: 30,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  title: { fontFamily: fonts.bold, fontSize: 18, color: colors.text, marginBottom: 6 },
  sub: { fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, color: colors.muted, textAlign: 'center' },
});
