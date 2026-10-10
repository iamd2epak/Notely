# Notely: notes for Claude

Expo SDK 57 / React Native 0.86 (new architecture) notes app for Android. Local only: no server, no account.

## Layout
- `App.js`: root, loading and saving, editor open/close, back button
- `src/screens/HomeScreen.js`: home, search, topics, multi-select (max 100), drag & drop
- `src/screens/EditorScreen.js`: note editor top bar, menu, keyboard hand-off
- `src/editor/editorHtml.js`: rich editor HTML page inside a WebView (`#title`, `#editor`). Regex escapes in its template literal must be doubled (`\\n`).
- `src/editor/RichEditor.js`: WebView bridge (`RichEditor.web.js` uses an iframe for web)
- `src/data.js`: model and ordering. `src/storage.js`: atomic file storage. `src/crypto.js` + `src/vault.js`: lock encryption. `src/backup.js`: export/import.

## Build and test
- A push to `main` builds the APK and publishes a GitHub Release. The workflow deletes older releases.
- Use `[skip ci]` in a commit message unless the user says "export apk".
- Test in the web build (`npx expo start --web`) with Playwright. Don't use an Android emulator.
- Android compile check: `EXPO_OFFLINE=1 npx expo export --platform android --output-dir /tmp/export`
- Bump `version` and `versionCode` in `app.json` for each release.

## User preferences
- Clean, premium, simple UX. Short Hinglish replies when the user writes Hinglish.
- The user tests APKs themselves. Never ask for tokens or passwords in chat.
- No PR unless asked. Stay within the free GitHub Actions quota.
