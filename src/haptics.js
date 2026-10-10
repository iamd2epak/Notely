import * as Haptics from 'expo-haptics';

// Small, safe wrappers: haptics are a nicety, so failures (unsupported device,
// haptics turned off) are ignored.
const safe = (fn) => () => {
  try {
    fn().catch(() => {});
  } catch {}
};

export const tapLight = safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light));
export const tapSoft = safe(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Soft));
export const tick = safe(() => Haptics.selectionAsync());
export const success = safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success));
export const warning = safe(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning));
