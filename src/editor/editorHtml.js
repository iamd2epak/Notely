// The note editor runs as a small HTML page inside a WebView (an iframe on web).
// It owns the title and the rich-text body and talks to React Native through JSON messages:
//   page -> app : ready | change {title, html, text} | state {...} | error
//   app -> page : cmd {name, value} | focus | focusTitle | appendTitle {value} | blur | accent {value}
// The title is a one-line plain-text contenteditable: the same kind of element as the body, so
// tapping, selecting and moving the caret behave exactly the same in both.
import fonts from './fontData';

const fontFace = (weight) =>
  `@font-face{font-family:'Jakarta';font-weight:${weight};font-style:normal;` +
  `src:url(data:font/ttf;base64,${fonts[weight]}) format('truetype');}`;

const CHECK_SVG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M5 12.5l4.2 4.2L19 7' fill='none' stroke='white' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E\")";

const CSS = `
${fontFace(400)}${fontFace(700)}${fontFace(800)}
:root{--accent:#6C5CE7;--text:#1B1A2E;--sub:#5E5B73;--muted:rgba(27,26,46,.32);--line:rgba(27,26,46,.07)}
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:transparent;-webkit-text-size-adjust:100%}
body{font-family:'Jakarta',system-ui,sans-serif;color:var(--text);padding:0 22px 140px;
  -webkit-tap-highlight-color:transparent;overflow-wrap:anywhere;word-break:break-word}
/* Title: laid out like the body (same side padding, no scroll box), kept on one line. */
#title{position:relative;outline:0;margin:0 0 14px;padding:12px 0;border-bottom:1px solid var(--line);
  font-size:27px;font-weight:800;line-height:36px;min-height:61px;letter-spacing:-.3px;color:var(--text);
  caret-color:var(--accent);white-space:nowrap;overflow:hidden}
#title.is-empty::before{content:attr(data-placeholder);position:absolute;left:0;top:12px;color:var(--muted);
  pointer-events:none}
#editor{position:relative;outline:0;min-height:calc(100vh - 160px);font-size:16.5px;line-height:1.65;caret-color:var(--accent)}
#editor.is-empty::before{content:attr(data-placeholder);position:absolute;top:0;left:0;color:var(--muted);pointer-events:none}
#editor > *:first-child{margin-top:0}
p,div{margin:0 0 4px}
h1{font-size:24px;line-height:1.3;font-weight:800;margin:14px 0 6px;letter-spacing:-.3px}
h2{font-size:19.5px;line-height:1.35;font-weight:700;margin:12px 0 4px}
b,strong{font-weight:700}
blockquote{margin:8px 0;padding:6px 14px;border-left:3.5px solid var(--accent);background:rgba(255,255,255,.55);
  border-radius:0 12px 12px 0;color:var(--sub);font-style:italic}
pre{margin:8px 0;padding:12px 14px;background:rgba(27,26,46,.07);border-radius:12px;white-space:pre-wrap;
  font:14px/1.55 ui-monospace,Menlo,Consolas,monospace;color:#2b2940}
blockquote:has(+ blockquote){margin-bottom:0;padding-bottom:2px;border-bottom-right-radius:0}
blockquote + blockquote{margin-top:0;padding-top:2px;border-top-right-radius:0}
pre:has(+ pre){margin-bottom:0;padding-bottom:0;border-bottom-left-radius:0;border-bottom-right-radius:0}
pre + pre{margin-top:0;padding-top:0;border-top-left-radius:0;border-top-right-radius:0}
body.dark{--text:#F2F1F8;--sub:#B9B6CB;--muted:rgba(242,241,248,.34);--line:rgba(242,241,248,.08)}
body.dark blockquote{background:rgba(255,255,255,.05)}
body.dark pre{background:rgba(255,255,255,.08);color:#E6E4F2}
body.dark ul.checklist > li::before{background-color:rgba(0,0,0,.2)}
/* "Default" text colour follows the theme; highlighted text stays readable in dark mode. */
#editor [style*="color: rgb(27, 26, 46)"]{color:var(--text) !important}
body.dark #editor span[style*="background-color"]{color:#1B1A2E}
hr{border:0;height:2px;margin:16px 0;background:repeating-linear-gradient(90deg,var(--accent) 0 8px,transparent 8px 14px);opacity:.55}
ul,ol{margin:4px 0;padding-left:24px}
li{margin:2px 0;padding-left:2px}
li::marker{color:var(--accent);font-weight:700}
ul.checklist{list-style:none;padding-left:2px}
ul.checklist > li{position:relative;padding-left:32px}
ul.checklist > li::before{content:'';position:absolute;left:0;top:.22em;width:20px;height:20px;border-radius:7px;
  border:2px solid var(--accent);background:rgba(255,255,255,.7) center/14px no-repeat}
ul.checklist > li[data-checked="true"]::before{background-color:var(--accent);background-image:${CHECK_SVG}}
ul.checklist > li[data-checked="true"]{color:var(--muted);text-decoration:line-through}
`;

const SCRIPT = `
(function(){
var init = window.__INIT__ || {};
var editor = document.getElementById('editor');
var title = document.getElementById('title');
var TITLE_MAX = 200;
var lastState = '';
var stateQueued = false;
var savedRange = null;
if (init.accent) document.documentElement.style.setProperty('--accent', init.accent);
if (init.dark) document.body.classList.add('dark');

function send(msg){
  var s = JSON.stringify(msg);
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
  else if (window.parent !== window) window.parent.postMessage(s, '*');
}
window.onerror = function(m){ send({type:'error', message:String(m)}); };

function exec(c, v){ return document.execCommand(c, false, v == null ? '' : v); }
try { exec('styleWithCSS', false); exec('defaultParagraphSeparator', 'div'); } catch(e) {}
function execCss(c, v){ exec('styleWithCSS', true); exec(c, v); exec('styleWithCSS', false); }

function nodeAtCaret(){
  var s = window.getSelection();
  if (!s || !s.rangeCount) return null;
  var n = s.anchorNode;
  if (n && n.nodeType === 3) n = n.parentNode;
  return n && editor.contains(n) ? n : null;
}
function closest(sel){
  var n = nodeAtCaret();
  var el = n && n.closest ? n.closest(sel) : null;
  return el && editor.contains(el) && el !== editor ? el : null;
}
function isChecklist(ul){ return !!ul && ul.classList.contains('checklist'); }

function toText(root){
  var out = [], line = '';
  var BLOCK = /^(P|DIV|H1|H2|H3|LI|BLOCKQUOTE|PRE|UL|OL)$/;
  function flush(){ out.push(line); line = ''; }
  function walk(node){
    if (node.nodeType === 3) { line += node.nodeValue; return; }
    if (node.nodeType !== 1) return;
    var tag = node.tagName;
    if (tag === 'BR') { flush(); return; }
    if (tag === 'HR') { if (line) flush(); out.push('———'); return; }
    var block = BLOCK.test(tag);
    if (block && line) flush();
    if (tag === 'LI') {
      var p = node.parentElement;
      if (isChecklist(p)) line += node.getAttribute('data-checked') === 'true' ? '☑ ' : '☐ ';
      else if (p && p.tagName === 'OL') line += (Array.prototype.indexOf.call(p.children, node) + 1) + '. ';
      else line += '• ';
    }
    for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
    if (block && line) flush();
  }
  walk(root);
  if (line) flush();
  return out.join('\\n').replace(/\\u00a0/g, ' ').replace(/\\n{3,}/g, '\\n\\n').trim();
}

function isEmpty(){
  return !editor.textContent.trim() && !editor.querySelector('li,hr');
}
function refreshPlaceholder(){ editor.classList.toggle('is-empty', isEmpty()); }

function emitChange(){
  refreshPlaceholder();
  var html = isEmpty() ? '' : editor.innerHTML;
  send({type:'change', title: titleText(), html: html, text: toText(editor)});
}

function state(){
  var a = document.activeElement;
  var focus = a === editor || editor.contains(a) ? 'body' : a === title || title.contains(a) ? 'title' : null;
  var s = {type:'state', focus: focus};
  if (focus === 'body') {
    var q = function(c){ try { return document.queryCommandState(c); } catch(e) { return false; } };
    s.bold = q('bold'); s.italic = q('italic'); s.underline = q('underline'); s.strike = q('strikeThrough');
    s.block = closest('h1') ? 'h1' : closest('h2') ? 'h2' : closest('pre') ? 'code' : closest('blockquote') ? 'quote' : 'p';
    var ul = closest('ul'), ol = closest('ol');
    s.list = isChecklist(ul) ? 'check' : ol ? 'ol' : ul ? 'ul' : null;
    var line = caretLine(), ta = line ? getComputedStyle(line).textAlign : 'left';
    s.align = ta === 'center' ? 'center' : ta === 'right' || ta === 'end' ? 'right' : 'left';
  }
  return s;
}
function emitState(){
  if (stateQueued) return;
  stateQueued = true;
  requestAnimationFrame(function(){
    stateQueued = false;
    var s = state(), k = JSON.stringify(s);
    if (k !== lastState) { lastState = k; send(s); }
  });
}

function caretIntoView(){
  var s = window.getSelection();
  if (!s || !s.rangeCount || document.activeElement !== editor) return;
  var range = s.getRangeAt(0);
  var r = range.getClientRects()[0];
  if (!r) { var n = nodeAtCaret(); r = n && n.getBoundingClientRect ? n.getBoundingClientRect() : null; }
  if (!r) return;
  var vh = window.innerHeight;
  if (r.bottom > vh - 24) window.scrollBy(0, r.bottom - vh + 56);
  else if (r.top < 8) window.scrollBy(0, r.top - 56);
}

function placeCaret(el, atEnd){
  var range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(!atEnd);
  var s = window.getSelection();
  s.removeAllRanges(); s.addRange(range);
}
function ensureBlock(){
  if (!editor.firstChild) { editor.innerHTML = '<div><br></div>'; placeCaret(editor.firstChild, false); }
}

// ---- Block engine -------------------------------------------------------------
// The body is a flat list of "lines": top-level DIV/H1/H2/PRE/BLOCKQUOTE/HR, or LI
// items inside top-level UL/OL. Block commands rebuild lines directly (Chrome's
// list commands nest lists inside paragraphs and lose the caret).
var LINE_TAG = {DIV:1, P:1, H1:1, H2:1, H3:1, PRE:1, BLOCKQUOTE:1};
var KIND_TAG = {div:'DIV', h1:'H1', h2:'H2', code:'PRE', quote:'BLOCKQUOTE'};
function isListKind(k){ return k === 'ul' || k === 'ol' || k === 'check'; }

function normalizeTop(){
  var n = editor.firstChild;
  while (n) {
    var next = n.nextSibling;
    if (n.nodeType === 3 && !n.nodeValue.trim()) { editor.removeChild(n); n = next; continue; }
    var isLine = n.nodeType === 1 && (LINE_TAG[n.tagName] || n.tagName === 'UL' || n.tagName === 'OL' || n.tagName === 'HR');
    if (!isLine) {
      var d = document.createElement('div');
      editor.insertBefore(d, n);
      while (d.nextSibling && !(d.nextSibling.nodeType === 1 && (LINE_TAG[d.nextSibling.tagName] || /^(UL|OL|HR)$/.test(d.nextSibling.tagName)))) d.appendChild(d.nextSibling);
      next = d.nextSibling;
    } else if (n.tagName === 'UL' || n.tagName === 'OL') {
      var c = n.firstChild;
      while (c) {
        var cn = c.nextSibling;
        if (!(c.nodeType === 1 && c.tagName === 'LI')) {
          if (c.nodeType === 3 && !c.nodeValue.trim()) n.removeChild(c);
          else { var li = document.createElement('li'); n.insertBefore(li, c); li.appendChild(c); }
        }
        c = cn;
      }
      if (!n.firstChild) editor.removeChild(n);
    }
    n = next;
  }
}
function allLines(){
  var out = [];
  for (var c = editor.firstElementChild; c; c = c.nextElementSibling) {
    if (c.tagName === 'UL' || c.tagName === 'OL') {
      for (var li = c.firstElementChild; li; li = li.nextElementSibling) out.push(li);
    } else out.push(c);
  }
  return out;
}
function lineOf(node){
  while (node && node !== editor) {
    if (node.nodeType === 1 && node.parentNode === editor && node.tagName !== 'UL' && node.tagName !== 'OL') return node;
    if (node.nodeType === 1 && node.tagName === 'LI' && node.parentNode && node.parentNode.parentNode === editor) return node;
    node = node.parentNode;
  }
  return null;
}
function kindOf(el){
  if (el.tagName === 'LI') return el.parentElement.tagName === 'OL' ? 'ol' : isChecklist(el.parentElement) ? 'check' : 'ul';
  return {H1:'h1', H2:'h2', PRE:'code', BLOCKQUOTE:'quote', HR:'hr'}[el.tagName] || 'div';
}
function textOffset(line, node, offset){
  var r = document.createRange();
  r.selectNodeContents(line);
  try { r.setEnd(node, offset); } catch (e) { return 0; }
  return r.toString().length;
}
function pointAt(line, off){
  var w = document.createTreeWalker(line, NodeFilter.SHOW_TEXT), n, acc = 0, last = null;
  while ((n = w.nextNode())) {
    if (acc + n.nodeValue.length >= off) return [n, off - acc];
    acc += n.nodeValue.length; last = n;
  }
  return last ? [last, last.nodeValue.length] : [line, 0];
}
function selectedLines(range){
  return allLines().filter(function(l){ return l.tagName !== 'HR' && range.intersectsNode(l); });
}

// Converts the selected lines with pick(kindsOfSelectedLines) -> newKind, keeping the caret.
function transform(pick, only){
  normalizeTop();
  var sel = window.getSelection();
  if (!sel.rangeCount) return;
  var range = sel.getRangeAt(0);
  var lines = allLines();
  var chosen = only ? [only] : selectedLines(range);
  if (!chosen.length) return;
  var sLine = lineOf(range.startContainer) || chosen[0], eLine = lineOf(range.endContainer) || chosen[chosen.length - 1];
  var so = textOffset(sLine, range.startContainer, range.startOffset);
  var eo = textOffset(eLine, range.endContainer, range.endOffset);
  var target = pick(chosen.map(kindOf));
  var map = new Map(), frag = document.createDocumentFragment(), list = null, listKind = null;

  lines.forEach(function(old){
    var kind = chosen.indexOf(old) >= 0 ? target : kindOf(old);
    if (kind === 'hr') { list = null; listKind = null; frag.appendChild(old); return; }
    var checked = old.getAttribute('data-checked') === 'true';
    var tag = isListKind(kind) ? 'LI' : KIND_TAG[kind];
    var el = old;
    if (old.tagName !== tag) {
      el = document.createElement(tag);
      while (old.firstChild) el.appendChild(old.firstChild);
      if (old.style.textAlign) el.style.textAlign = old.style.textAlign;
    }
    if (!el.firstChild) el.appendChild(document.createElement('br'));
    if (isListKind(kind)) {
      if (!list || listKind !== kind) {
        list = document.createElement(kind === 'ol' ? 'ol' : 'ul');
        if (kind === 'check') list.className = 'checklist';
        listKind = kind;
        frag.appendChild(list);
      }
      if (kind === 'check') el.setAttribute('data-checked', checked ? 'true' : 'false');
      else el.removeAttribute('data-checked');
      list.appendChild(el);
    } else {
      el.removeAttribute('data-checked');
      list = null; listKind = null;
      frag.appendChild(el);
    }
    map.set(old, el);
  });
  editor.innerHTML = '';
  editor.appendChild(frag);
  var a = pointAt(map.get(sLine) || editor.firstChild, so), b = pointAt(map.get(eLine) || editor.lastChild, eo);
  var r2 = document.createRange();
  r2.setStart(a[0], a[1]); r2.setEnd(b[0], b[1]);
  sel.removeAllRanges(); sel.addRange(r2);
}
function toggleKind(kind){
  transform(function(kinds){ return kinds.every(function(k){ return k === kind; }) ? 'div' : kind; });
}
function caretLine(){
  var s = window.getSelection();
  return s && s.rangeCount ? lineOf(s.getRangeAt(0).startContainer) : null;
}
function lineIsEmpty(line){ return !line.textContent.replace(/​/g, '').length; }
function atLineStart(line){
  var s = window.getSelection();
  if (!s.rangeCount || !s.isCollapsed) return false;
  var r = s.getRangeAt(0);
  return textOffset(line, r.startContainer, r.startOffset) === 0;
}

// Backspace-merging two different line types makes Chrome copy font sizes into
// inline spans; strip those so text takes the style of the line it joined.
function cleanMergedStyles(){
  var line = caretLine();
  if (!line) return;
  var spans = line.querySelectorAll('span[style]');
  if (!spans.length) return;
  var dirty = false;
  for (var i = 0; i < spans.length; i++) {
    var st = spans[i].style;
    if (!st.fontSize && !st.lineHeight && !st.letterSpacing) continue;
    st.removeProperty('font-size'); st.removeProperty('line-height'); st.removeProperty('letter-spacing'); st.removeProperty('font-family');
    if (st.fontWeight && st.fontWeight !== '700' && st.fontWeight !== 'bold') st.removeProperty('font-weight');
    dirty = true;
  }
  if (!dirty) return;
  var s = window.getSelection(), r = s.getRangeAt(0), off = textOffset(line, r.startContainer, r.startOffset);
  Array.prototype.slice.call(line.querySelectorAll('span')).forEach(function(sp){
    if (!sp.getAttribute('style')) { while (sp.firstChild) sp.parentNode.insertBefore(sp.firstChild, sp); sp.parentNode.removeChild(sp); }
  });
  line.normalize();
  var pt = pointAt(line, off), r2 = document.createRange();
  r2.setStart(pt[0], pt[1]); r2.collapse(true);
  s.removeAllRanges(); s.addRange(r2);
}

var commands = {
  bold: function(){ exec('bold'); },
  italic: function(){ exec('italic'); },
  underline: function(){ exec('underline'); },
  strike: function(){ exec('strikeThrough'); },
  h1: function(){ toggleKind('h1'); },
  h2: function(){ toggleKind('h2'); },
  code: function(){ toggleKind('code'); },
  quote: function(){ toggleKind('quote'); },
  ul: function(){ toggleKind('ul'); },
  ol: function(){ toggleKind('ol'); },
  check: function(){ toggleKind('check'); },
  color: function(v){ execCss('foreColor', v || '#1B1A2E'); },
  highlight: function(v){ execCss('hiliteColor', v || 'transparent'); },
  align: function(v){
    var s = window.getSelection();
    if (!s.rangeCount) return;
    selectedLines(s.getRangeAt(0)).forEach(function(l){ l.style.textAlign = v === 'left' ? '' : v; if (!l.getAttribute('style')) l.removeAttribute('style'); });
  },
  divider: function(){
    normalizeTop();
    var line = caretLine();
    var top = line && line.tagName === 'LI' ? line.parentNode : line;
    var hr = document.createElement('hr');
    var next = document.createElement('div');
    next.appendChild(document.createElement('br'));
    if (top && top.tagName === 'DIV' && lineIsEmpty(top)) editor.insertBefore(hr, top), placeCaret(top, false);
    else {
      editor.insertBefore(hr, top ? top.nextSibling : null);
      editor.insertBefore(next, hr.nextSibling);
      placeCaret(next, false);
    }
  },
  clear: function(){
    exec('removeFormat');
    transform(function(){ return 'div'; });
  },
  undo: function(){ exec('undo'); },
  redo: function(){ exec('redo'); },
};

// Focusing can reset the caret; put it back where the user last was.
function refocus(){
  if (document.activeElement === editor) return;
  editor.focus();
  if (savedRange && editor.contains(savedRange.startContainer)) {
    var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(savedRange);
  }
}

window.__cmd = function(msg){
  try {
    if (!msg) return;
    if (msg.type === 'focusTitle') { focusTitle(); return; }
    if (msg.type === 'appendTitle') { appendTitle(msg.value); return; }
    if (msg.type === 'blur') {
      if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
      emitState(); return;
    }
    if (msg.type === 'accent') { document.documentElement.style.setProperty('--accent', msg.value); return; }
    if (msg.type === 'focus') { refocus(); emitState(); return; }
    if (msg.type === 'cmd' && commands[msg.name]) {
      refocus();
      ensureBlock();
      commands[msg.name](msg.value);
      emitChange(); emitState(); caretIntoView();
    }
  } catch (e) { send({type:'error', message: String(e && e.message || e)}); }
};


editor.innerHTML = init.html || '';
// Older notes use <p> paragraphs; Chrome nests lists inside <p>, so use <div> everywhere.
Array.prototype.slice.call(editor.querySelectorAll('p')).forEach(function(p){
  var d = document.createElement('div');
  while (p.firstChild) d.appendChild(p.firstChild);
  for (var i = 0; i < p.attributes.length; i++) d.setAttribute(p.attributes[i].name, p.attributes[i].value);
  p.parentNode.replaceChild(d, p);
});
editor.setAttribute('data-placeholder', init.placeholder || 'Start writing…');
refreshPlaceholder();

editor.addEventListener('keydown', function(e){
  if (e.isComposing || e.keyCode === 229) return;
  var line = caretLine();
  if (!line) return;
  var kind = kindOf(line);
  if (kind === 'div' || kind === 'hr') return;
  var leave = (e.key === 'Enter' && !e.shiftKey && lineIsEmpty(line) && kind !== 'h1' && kind !== 'h2') ||
              (e.key === 'Backspace' && atLineStart(line));
  if (leave) {
    e.preventDefault();
    transform(function(){ return 'div'; }, line);
    emitChange(); emitState();
  }
});
editor.addEventListener('input', function(e){
  if (e.inputType === 'insertParagraph') {
    var li = closest('li');
    if (li && isChecklist(li.parentElement)) li.setAttribute('data-checked', 'false');
  }
  if (!editor.firstChild) ensureBlock();
  if (e.inputType && e.inputType.indexOf('delete') === 0) cleanMergedStyles();
  saveRange();
  emitChange(); emitState(); caretIntoView();
});
editor.addEventListener('focus', function(){ ensureBlock(); emitState(); });
editor.addEventListener('blur', emitState);
editor.addEventListener('paste', function(e){
  e.preventDefault();
  var text = (e.clipboardData || window.clipboardData).getData('text/plain');
  if (text) exec('insertText', text);
});

// Tapping a checkbox toggles it without moving the caret or opening the keyboard.
function onCheckboxPress(e){
  var t = e.target && e.target.closest ? e.target.closest('ul.checklist > li') : null;
  if (!t || !editor.contains(t)) return;
  var x = (e.touches ? e.touches[0].clientX : e.clientX) - t.getBoundingClientRect().left;
  if (x > 28) return;
  e.preventDefault();
  t.setAttribute('data-checked', t.getAttribute('data-checked') === 'true' ? 'false' : 'true');
  emitChange();
}
editor.addEventListener('touchstart', onCheckboxPress, {passive: false});
// The title gets the same kind of touch listener as the body, so both are handled alike.
title.addEventListener('touchstart', function(){}, {passive: false});
editor.addEventListener('mousedown', onCheckboxPress);

// Tapping empty page space puts the caret at the end: of the title when beside it, else the body.
document.body.addEventListener('mousedown', function(e){
  if (e.target === document.body || e.target === document.documentElement) {
    e.preventDefault();
    if (e.clientY <= title.getBoundingClientRect().bottom) { focusTitle(); return; }
    editor.focus(); ensureBlock(); placeCaret(editor, true); emitState();
  }
});

function saveRange(){
  var s = window.getSelection();
  if (s && s.rangeCount && editor.contains(s.anchorNode)) savedRange = s.getRangeAt(0).cloneRange();
}
document.addEventListener('selectionchange', function(){ saveRange(); emitState(); });
editor.addEventListener('keyup', saveRange);
window.addEventListener('resize', function(){ setTimeout(caretIntoView, 60); });

// ---- Title: one line of plain text ----
function titleText(){
  return (title.textContent || '').replace(/[\\r\\n]+/g, ' ').replace(/\\u00a0/g, ' ').slice(0, TITLE_MAX);
}
function refreshTitlePlaceholder(){ title.classList.toggle('is-empty', !title.textContent); }
// Text typed into the app's keyboard helper before the page took over (new notes).
function appendTitle(value){
  var add = String(value || '').replace(/[\\r\\n]+/g, ' ');
  if (!add) return;
  title.textContent = ((title.textContent || '') + add).slice(0, TITLE_MAX);
  refreshTitlePlaceholder();
  title.focus();
  placeCaret(title, true);
  emitChange();
  emitState();
}
function focusTitle(){
  try {
    if (document.activeElement !== title) { title.focus(); placeCaret(title, true); }
  } catch (e) {}
  emitState();
}
// Keeps the title plain text on one line: anything else the browser or a keyboard inserts
// (line breaks, formatting) is flattened, and the caret stays where it was.
function cleanTitle(){
  var hasMarkup = title.children.length > 0;
  var text = title.textContent || '';
  var flat = text.replace(/[\\r\\n]+/g, ' ');
  if (!hasMarkup && flat === text && text.length <= TITLE_MAX) return;
  var offset = caretOffsetIn(title);
  flat = flat.slice(0, TITLE_MAX);
  title.textContent = flat;
  if (document.activeElement === title) setCaretOffset(title, Math.min(offset, flat.length));
}
function caretOffsetIn(el){
  var s = window.getSelection();
  if (!s || !s.rangeCount || !el.contains(s.anchorNode)) return (el.textContent || '').length;
  var r = s.getRangeAt(0).cloneRange();
  r.selectNodeContents(el);
  r.setEnd(s.anchorNode, s.anchorOffset);
  return r.toString().length;
}
function setCaretOffset(el, offset){
  var node = el.firstChild;
  var range = document.createRange();
  if (node && node.nodeType === 3) range.setStart(node, Math.min(offset, node.length));
  else range.selectNodeContents(el);
  range.collapse(true);
  var s = window.getSelection(); s.removeAllRanges(); s.addRange(range);
}
title.textContent = String(init.title || '').replace(/\\s*[\\r\\n]+\\s*/g, ' ').slice(0, TITLE_MAX);
refreshTitlePlaceholder();
title.addEventListener('keydown', function(e){
  if (e.isComposing || e.keyCode === 229) return;
  // Enter continues in the body; formatting shortcuts don't apply to the title.
  if (e.key === 'Enter') {
    e.preventDefault(); editor.focus(); ensureBlock(); placeCaret(editor.firstChild, false); emitState();
    return;
  }
  if ((e.ctrlKey || e.metaKey) && /^[biu]$/i.test(e.key)) e.preventDefault();
});
title.addEventListener('beforeinput', function(e){
  var t = e.inputType || '';
  if (t === 'insertParagraph' || t === 'insertLineBreak') { e.preventDefault(); return; }
  if (t.indexOf('format') === 0) { e.preventDefault(); return; }
  if (t.indexOf('insert') === 0 && !e.isComposing) {
    var sel = window.getSelection();
    var collapsed = !sel || sel.isCollapsed;
    if (collapsed && titleText().length >= TITLE_MAX) e.preventDefault();
  }
});
title.addEventListener('paste', function(e){
  e.preventDefault();
  var text = ((e.clipboardData || window.clipboardData).getData('text/plain') || '').replace(/\\s*[\\r\\n]+\\s*/g, ' ');
  if (text) exec('insertText', text);
});
title.addEventListener('input', function(e){
  if (!e.isComposing) cleanTitle();
  refreshTitlePlaceholder();
  emitChange();
});
title.addEventListener('compositionend', function(){ cleanTitle(); refreshTitlePlaceholder(); emitChange(); });
title.addEventListener('focus', emitState);
title.addEventListener('blur', function(){ title.scrollLeft = 0; emitState(); });

send({type:'ready'});
if (init.focusTitle) setTimeout(focusTitle, 50);
})();
`;

const safeJson = (v) =>
  JSON.stringify(v)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

export function buildEditorHtml(init) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>${CSS}</style></head><body>
<div id="title" contenteditable="true" spellcheck="true" autocapitalize="sentences" autocorrect="on" enterkeyhint="next" role="textbox" aria-label="Note title" data-placeholder="Title"></div>
<div id="editor" contenteditable="true" spellcheck="true" autocapitalize="sentences"></div>
<script>window.__INIT__=${safeJson(init)};</script>
<script>${SCRIPT}</script>
</body></html>`;
}

export { safeJson };
