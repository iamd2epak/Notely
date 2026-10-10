import { useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { buildEditorHtml } from './editorHtml';

// Web build (used for previews/testing): same editor page inside an iframe.
export default function RichEditor({ ref, initial, onMessage }) {
  const frameRef = useRef(null);
  const html = useMemo(() => buildEditorHtml(initial), []); // eslint-disable-line react-hooks/exhaustive-deps
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    const handler = (e) => {
      if (e.source !== frameRef.current?.contentWindow) return;
      try {
        onMessageRef.current(JSON.parse(e.data));
      } catch {}
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  const send = (msg) => frameRef.current?.contentWindow?.__cmd?.(msg);

  useImperativeHandle(ref, () => ({
    command: (name, value) => send({ type: 'cmd', name, value }),
    focus: () => send({ type: 'focus' }),
    blur: () => send({ type: 'blur' }),
    appendTitle: (value) => send({ type: 'appendTitle', value }),
    setAccent: (value) => send({ type: 'accent', value }),
  }));

  return (
    <iframe
      ref={frameRef}
      srcDoc={html}
      title="Note editor"
      style={{ border: 0, flex: 1, width: '100%', height: '100%', background: 'transparent' }}
    />
  );
}
