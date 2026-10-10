import { Component } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { palettes } from '../theme';

const colors = palettes.light;

// Last line of defence: an unexpected render error shows a recover button instead of
// a blank screen. Notes are already saved on disk, so reloading loses nothing.
export default class ErrorBoundary extends Component {
  state = { error: null, attempt: 0 };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.warn('Unexpected error', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return <View key={this.state.attempt} style={styles.flex}>{this.props.children}</View>;
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.text}>Your notes are saved. Tap below to reload the app.</Text>
        <Pressable
          style={styles.btn}
          onPress={() => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }))}
        >
          <Text style={styles.btnText}>Reload</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32, backgroundColor: colors.bg },
  title: { fontSize: 19, fontWeight: '700', color: colors.text, marginBottom: 8 },
  text: { fontSize: 14.5, color: colors.subtext, textAlign: 'center', lineHeight: 21 },
  btn: { marginTop: 22, paddingHorizontal: 26, height: 48, borderRadius: 16, backgroundColor: colors.primary, justifyContent: 'center' },
  btnText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
