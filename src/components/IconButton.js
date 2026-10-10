import { Pressable } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useStyles, useTheme } from '../theme';

export default function IconButton({ name, onPress, color, bg, size = 22, style, accessibilityLabel }) {
  const { colors } = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.btn, { backgroundColor: bg ?? colors.surface, opacity: pressed ? 0.6 : 1 }, style]}
    >
      <Ionicons name={name} size={size} color={color ?? colors.text} />
    </Pressable>
  );
}

const makeStyles = () => ({
  btn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
