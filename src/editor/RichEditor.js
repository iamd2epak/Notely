import { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';
import { buildEditorHtml, safeJson } from './editorHtml';

// `initial` is read once per mount: { title, html, accent, dark, focusTitle }.
export default function RichEditor({ ref, initial, onMessage, onCrash }) {
  const webRef = useRef(null);
  const [ready, setReady] = useState(false);
  // The page doesn't focus the title by itself: on Android the WebView must have native focus
  // first, or the caret shows without a keyboard. That happens on 'ready' below.
  const html = useMemo(() => buildEditorHtml({ ...initial, focusTitle: false }), []); // eslint-disable-line react-hooks/exhaustive-deps
  const focusTimer = useRef(null);
  useEffect(() => () => clearTimeout(focusTimer.current), []);

  const send = (msg) => {
    webRef.current?.injectJavaScript(`window.__cmd && window.__cmd(${safeJson(msg)});true;`);
  };

  useImperativeHandle(ref, () => ({
    command: (name, value) => send({ type: 'cmd', name, value }),
    // Native focus first, then the caret in the body.
    focus: () => {
      webRef.current?.requestFocus?.();
      send({ type: 'focus' });
    },
    blur: () => send({ type: 'blur' }),
    // Native focus to the page, then the text into the title (keyboard hand-off on new notes).
    appendTitle: (value) => {
      webRef.current?.requestFocus?.();
      send({ type: 'appendTitle', value });
    },
    setAccent: (value) => send({ type: 'accent', value }),
  }));

  const handleMessage = (e) => {
    let msg;
    try {
      msg = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.type === 'ready') {
      setReady(true);
      if (initial.focusTitle) {
        webRef.current?.requestFocus?.();
        clearTimeout(focusTimer.current);
        focusTimer.current = setTimeout(() => send({ type: 'focusTitle' }), 60);
      }
    }
    if (msg.type === 'error') console.warn('Editor:', msg.message);
    onMessage(msg);
  };

  return (
    <WebView
      ref={webRef}
      originWhitelist={['*']}
      source={{ html }}
      onMessage={handleMessage}
      style={[styles.web, !ready && styles.hidden]}
      containerStyle={styles.web}
      javaScriptEnabled
      keyboardDisplayRequiresUserAction={false}
      hideKeyboardAccessoryView
      textZoom={100}
      overScrollMode="never"
      // Android: the WebView keeps every touch that starts in it (parents can't take it over
      // when the finger moves a little), so taps, long presses and caret drags always arrive.
      nestedScrollEnabled
      showsVerticalScrollIndicator={false}
      setSupportMultipleWindows={false}
      allowsLinkPreview={false}
      // Note content is never cached or stored by the WebView.
      incognito
      cacheEnabled={false}
      // Only for the automated Android test build (EXPO_PUBLIC_E2E=1): lets the test read the page.
      webviewDebuggingEnabled={process.env.EXPO_PUBLIC_E2E === '1'}
      onRenderProcessGone={onCrash}
      onContentProcessDidTerminate={onCrash}
      onError={onCrash}
    />
  );
}

const styles = StyleSheet.create({
  web: { flex: 1, backgroundColor: 'transparent' },
  hidden: { opacity: 0 },
});
