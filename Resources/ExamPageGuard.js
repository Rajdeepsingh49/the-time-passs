/*
 * ExamPageGuard.js: injected into every page (and every frame) before the page's own scripts run.
 *
 *  1. A page can never tell that the student switched to another window, tab or app: it is always
 *     visible and focused, and the events that would report otherwise never reach it.
 *  2. A page can never stop the student from quitting: Cmd+Q is not something a page can cancel.
 *  3. A page can never take copy, cut, paste or selecting away from the student. This is an
 *     open-book browser: moving code and text in and out is the whole point. Pages that try to
 *     block the clipboard (CodeChef, HackerRank and other judges do this) are overridden, but the
 *     insert is done through the editor's own API so a pasted block keeps its exact indentation -
 *     never the double-insert that an earlier approach caused.
 *
 * Everything is wrapped so that a problem here can never break the page.
 */
(function () {
  'use strict';
  try {
    var define = function (target, property, descriptor) {
      try { Object.defineProperty(target, property, descriptor); } catch (e) {}
    };

    /* ---- 1. Always visible, always focused ---------------------------------------------------- */

    define(Document.prototype, 'hidden', { get: function () { return false; }, configurable: true });
    define(Document.prototype, 'webkitHidden', { get: function () { return false; }, configurable: true });
    define(Document.prototype, 'visibilityState', { get: function () { return 'visible'; }, configurable: true });
    define(Document.prototype, 'webkitVisibilityState', { get: function () { return 'visible'; }, configurable: true });
    define(Document.prototype, 'hasFocus', {
      value: function hasFocus() { return true; }, writable: true, configurable: true
    });

    // Swallowed: events aimed at the window or the document, and the two events that the page's focused element
    // gets when the whole window loses focus and gets it back (switching to another app or window). WebKit sends
    // that blur while the element is still the active one and with nothing taking over its focus, and the focus
    // that comes back lands on the same element. Focus moving between the page's own elements, to the page
    // background or with the Tab key is untouched, so forms and keyboard navigation keep working.
    // (focusin and focusout are not sent when the window changes focus.)
    var blurredWithWindow = null;
    var swallowWindowEvent = function (event) {
      var target = event.target;
      if (target === window || target === document) {
        event.stopImmediatePropagation();
      } else if (event.type === 'blur' && event.relatedTarget === null && target === document.activeElement) {
        blurredWithWindow = target;
        event.stopImmediatePropagation();
      } else if (event.type === 'focus') {
        var comesBackWithWindow = (target === blurredWithWindow && event.relatedTarget === null);
        blurredWithWindow = null;
        if (comesBackWithWindow) { event.stopImmediatePropagation(); }
      } else if (event.type === 'mouseleave' && target === document.documentElement) {
        event.stopImmediatePropagation();
      }
    };
    ['blur', 'focus', 'visibilitychange', 'webkitvisibilitychange', 'mouseleave'].forEach(function (type) {
      // capturing, and registered before any page script can register anything
      window.addEventListener(type, swallowWindowEvent, true);
    });

    /* ---- 2. A page can never cancel Cmd+Q ----------------------------------------------------- */

    // Only the quit shortcut is protected. Copy, cut, paste, select-all and everything else are left alone.
    var isQuitShortcut = function (event) {
      var type = event.type;
      if (type !== 'keydown' && type !== 'keypress' && type !== 'keyup') { return false; }
      if (!(event.metaKey || event.ctrlKey)) { return false; }
      return String(event.key).toLowerCase() === 'q' || String(event.code).toLowerCase() === 'keyq';
    };

    // The page asks to cancel the Cmd+Q key event: the request is ignored, so quitting can never be trapped.
    var originalPreventDefault = Event.prototype.preventDefault;
    define(Event.prototype, 'preventDefault', {
      value: function preventDefault() {
        if (isQuitShortcut(this)) { return; }
        return originalPreventDefault.apply(this, arguments);
      },
      writable: true, configurable: true
    });

    var returnValue = Object.getOwnPropertyDescriptor(Event.prototype, 'returnValue');
    if (returnValue && returnValue.set) {
      define(Event.prototype, 'returnValue', {
        get: returnValue.get,
        set: function (value) { if (isQuitShortcut(this)) { return; } returnValue.set.call(this, value); },
        configurable: true, enumerable: returnValue.enumerable
      });
    }

    /* ---- 3. Copy, cut, paste and selecting always work --------------------------------------- */
    // The student may copy the problem and their code out to any tool, and paste code back in. Pages that
    // block the clipboard are overridden. The guiding rule for pasting: let the page's own (or the editor's
    // own) paste run first and only step in when it produced nothing, then insert ONCE, verbatim, through
    // the editor's API - so indentation is never doubled or reflowed.
    try {

      /* ---- DIAGNOSTIC (off) — set DIAG=true only to debug clipboard on a new editor/site ------- */
      var DIAG = false;
      var dbgBuf = [], dbgEl = null;
      var describe = function (el) {
        if (!el) { return 'null'; }
        var c = (el.className && el.className.toString ? el.className.toString() : '').slice(0, 24);
        return (el.tagName || '?') + (c ? '.' + c : '') + (el.isContentEditable ? '[CE]' : '');
      };
      var ensureOverlay = function () {
        if (!DIAG || dbgEl || !document.body) { return; }
        dbgEl = document.createElement('div');
        dbgEl.setAttribute('data-exam-diag', '1');
        dbgEl.style.cssText = 'position:fixed;top:0;right:0;z-index:2147483647;max-width:48vw;max-height:72vh;overflow:hidden;background:rgba(0,0,0,.86);color:#4f8;font:11px/1.3 ui-monospace,Menlo,monospace;padding:6px 8px;white-space:pre-wrap;pointer-events:none;border-bottom-left-radius:8px';
        document.body.appendChild(dbgEl);
      };
      var dbg = function (m) {
        if (!DIAG) { return; }
        try {
          dbgBuf.unshift(new Date().toTimeString().slice(3, 12) + ' ' + m);
          if (dbgBuf.length > 22) { dbgBuf.pop(); }
          ensureOverlay();
          if (dbgEl) { dbgEl.textContent = dbgBuf.join('\n'); }
        } catch (e) {}
      };
      if (DIAG) {
        setInterval(ensureOverlay, 400);
        var probeEnv = function () {
          try {
            var m = (typeof window.monaco !== 'undefined');
            var ge = 'n/a';
            if (m && window.monaco.editor && monaco.editor.getEditors) { ge = monaco.editor.getEditors().length; }
            dbg('ENV monaco=' + m + ' getEds=' + ge +
                ' .monaco=' + document.querySelectorAll('.monaco-editor').length +
                ' .cm6=' + document.querySelectorAll('.cm-editor').length +
                ' .cm5=' + document.querySelectorAll('.CodeMirror').length +
                ' .ace=' + document.querySelectorAll('.ace_editor').length +
                ' top=' + (window.top === window) + ' ' + location.host);
          } catch (e) { dbg('ENV err ' + e); }
        };
        setTimeout(probeEnv, 1500); setTimeout(probeEnv, 4000); setTimeout(probeEnv, 9000);
        window.addEventListener('keydown', function (e) {
          try {
            if (!(e.metaKey || e.ctrlKey)) { return; }
            var k = String(e.key).toLowerCase();
            if ('cvxa'.indexOf(k) === -1) { return; }
            probeEnv();
            dbg('KD ' + (e.metaKey ? 'Cmd' : 'Ctrl') + '+' + k + ' tgt=' + describe(document.activeElement));
            setTimeout(function () { dbg('   KD ' + k + ' defaultPrevented=' + e.defaultPrevented); }, 0);
          } catch (x) {}
        }, true);
      }
      /* ---- end diagnostic -------------------------------------------------------------------- */

      // -- Back the JS Clipboard API with the native pasteboard ----------------------------------
      // WKWebView denies navigator.clipboard (writeText/readText throw "Clipboard access denied"), which
      // is what breaks a code editor's own copy/paste - the editor then falls back to typing the text,
      // so a paste explodes its indentation. We route reads and writes through native message handlers
      // that use the real pasteboard, so the editor's copy/paste works, verbatim.
      var sebWriteText = null, sebReadText = null, reapplyClipboard = function () {};
      try {
        var mh = window.webkit && window.webkit.messageHandlers;
        if (mh && mh.sebClipWrite && mh.sebClipRead) {
          var sebClipSeq = 0, sebClipPending = {};
          window.__sebClipRead = function (id, text) {
            var r = sebClipPending[id];
            if (r) { delete sebClipPending[id]; dbg('BRIDGE read resolved len=' + (text ? String(text).length : 0)); r(text == null ? '' : String(text)); }
          };
          sebWriteText = function (text) {
            var s = String(text == null ? '' : text);
            // Never clobber the native clipboard with an empty string. The editor's own (failing)
            // navigator.clipboard.write path falls back to '' and would otherwise wipe a freshly-copied
            // clipboard right before a paste reads it. A real copy always carries text.
            if (!s) { dbg('BRIDGE writeText skip empty'); return Promise.resolve(); }
            dbg('BRIDGE writeText len=' + s.length);
            try { mh.sebClipWrite.postMessage(s); } catch (e) {}
            return Promise.resolve();
          };
          sebReadText = function () {
            dbg('BRIDGE readText called');
            return new Promise(function (resolve) {
              var id = ++sebClipSeq;
              sebClipPending[id] = resolve;
              try { mh.sebClipRead.postMessage(id); }
              catch (e) { delete sebClipPending[id]; resolve(''); }
            });
          };
          // Capture text passed to `new Blob([text], {type:'text/plain'})`, so we have it synchronously
          // and never need to read a cancellable Blob/promise asynchronously.
          var blobText = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
          var lastTextBlob = '';
          var patchBlob = function () {
            try {
              if (!window.Blob || !blobText || window.Blob.__sebPatched) { return; }
              var OrigBlob = window.Blob;
              var PatchedBlob = function (parts, opts) {
                var b = new OrigBlob(parts || [], opts);
                try { if (parts && parts.length === 1 && typeof parts[0] === 'string' && opts && /text\/plain/i.test(opts.type || '')) { blobText.set(b, parts[0]); lastTextBlob = parts[0]; } } catch (e) {}
                return b;
              };
              PatchedBlob.prototype = OrigBlob.prototype;
              PatchedBlob.__sebPatched = true;
              try { Object.defineProperty(window, 'Blob', { value: PatchedBlob, configurable: true, writable: true }); } catch (e) { try { window.Blob = PatchedBlob; } catch (e2) {} }
            } catch (e) {}
          };
          patchBlob();
          var extractText = function (rep) {
            try { if (blobText && rep instanceof Blob && blobText.has(rep)) { return Promise.resolve(blobText.get(rep)); } } catch (e) {}
            return Promise.resolve(rep).then(function (v) {
              try { if (blobText && v instanceof Blob && blobText.has(v)) { return blobText.get(v); } } catch (e) {}
              if (typeof v === 'string') { return v; }
              if (v && typeof v.text === 'function') { return v.text(); }
              if (v) { return new Response(v).text(); }
              return '';
            });
          };
          // Capture the data passed to `new ClipboardItem(...)`. We EAGERLY resolve its text/plain value
          // right here at construction time (while the blob/promise is still live). Monaco's own copy
          // path cancels that promise by the time write() runs, so reading it then fails "Canceled" -
          // reading it now, before write() returns, captures the text while it's still valid.
          var clipItemData = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
          var clipItemText = (typeof WeakMap !== 'undefined') ? new WeakMap() : null;
          var repOf = function (data) {
            return data ? (data['text/plain'] || data['text/plain;charset=utf-8'] || (Object.keys(data).length ? data[Object.keys(data)[0]] : null)) : null;
          };
          var patchClipboardItem = function () {
            try {
              if (!window.ClipboardItem || !clipItemData || window.ClipboardItem.__sebPatched) { return; }
              var OrigCI = window.ClipboardItem;
              var PatchedCI = function (data) {
                var inst = new OrigCI(data);
                try { clipItemData.set(inst, data); } catch (e) {}
                try { var rep = repOf(data); if (rep != null && clipItemText) { clipItemText.set(inst, extractText(rep)); } } catch (e) {}
                return inst;
              };
              PatchedCI.prototype = OrigCI.prototype;
              PatchedCI.__sebPatched = true;
              PatchedCI.__orig = OrigCI;
              try { Object.defineProperty(window, 'ClipboardItem', { value: PatchedCI, configurable: true, writable: true }); }
              catch (e) { try { window.ClipboardItem = PatchedCI; } catch (e2) {} }
            } catch (e) {}
          };
          patchClipboardItem();
          // navigator.clipboard.write([ClipboardItem]) - what recent Monaco uses for copy.
          var sebWrite = function (items) {
            try {
              var item = (items && items.length) ? items[0] : null;
              if (!item) { return Promise.resolve(); }
              // Only ever write THIS item's own text. If we can't extract it (e.g. the editor's internal
              // ClipboardItem whose promise is cancelled), write nothing - never a stale fallback that
              // would clobber the clipboard. Real copies go through the keydown path, not here.
              var pre = clipItemText ? clipItemText.get(item) : null;
              if (pre != null) {
                return Promise.resolve(pre).then(function (text) { dbg('BRIDGE write pre len=' + (text ? text.length : 0)); return sebWriteText(text); }).catch(function (er) { dbg('BRIDGE write pre err ' + er); });
              }
              var data = clipItemData ? clipItemData.get(item) : null;
              var rep = repOf(data);
              if (rep != null) {
                return extractText(rep).then(function (text) { dbg('BRIDGE write got len=' + (text ? text.length : 0)); return sebWriteText(text); }).catch(function (er) { dbg('BRIDGE write err ' + er); });
              }
              if (item.getType && item.types && item.types.length) {
                var type = (item.types.indexOf('text/plain') !== -1) ? 'text/plain' : item.types[0];
                return extractText(item.getType(type)).then(function (text) { return sebWriteText(text); }).catch(function (er) { dbg('BRIDGE write getType err ' + er); });
              }
            } catch (e) { dbg('BRIDGE write threw ' + e); }
            return Promise.resolve();
          };
          var sebRead = function () {
            dbg('BRIDGE read called');
            return sebReadText().then(function (text) {
              try {
                var CI = (window.ClipboardItem && window.ClipboardItem.__orig) ? window.ClipboardItem.__orig : window.ClipboardItem;
                var blob = new Blob([text == null ? '' : text], { type: 'text/plain' });
                return [new CI({ 'text/plain': blob })];
              } catch (e) { return []; }
            });
          };
          var patchPairs = [['writeText', sebWriteText], ['readText', sebReadText], ['write', sebWrite], ['read', sebRead]];
          var applyTo = function (obj) {
            if (!obj) { return; }
            for (var pi = 0; pi < patchPairs.length; pi++) {
              var nm = patchPairs[pi][0], fn = patchPairs[pi][1];
              try { Object.defineProperty(obj, nm, { value: fn, configurable: true, writable: true }); }
              catch (e) { try { obj[nm] = fn; } catch (e2) {} }
            }
          };
          var fixedClip = null, navClipLocked = false;
          // Re-appliable: complex pages (CodeChef) restore the native navigator.clipboard after load. We
          // patch the prototype each time AND lock navigator.clipboard to our bridged object once, so a
          // later restore can't revert it and the editor captures our version.
          reapplyClipboard = function () {
            try {
              patchBlob();
              patchClipboardItem();
              if (!navigator.clipboard) { try { Object.defineProperty(navigator, 'clipboard', { value: {}, configurable: true }); } catch (e) {} }
              if (!fixedClip) {
                fixedClip = {};
                try { var orig = navigator.clipboard; for (var k in orig) { try { if (typeof orig[k] === 'function') { fixedClip[k] = orig[k].bind(orig); } } catch (e2) {} } } catch (e3) {}
              }
              fixedClip.writeText = sebWriteText;
              fixedClip.readText = sebReadText;
              fixedClip.write = sebWrite;
              fixedClip.read = sebRead;
              applyTo(navigator.clipboard);
              try { applyTo(Object.getPrototypeOf(navigator.clipboard)); } catch (e) {}
              try { if (window.Clipboard && window.Clipboard.prototype) { applyTo(window.Clipboard.prototype); } } catch (e) {}
              if (!navClipLocked) {
                try { Object.defineProperty(navigator, 'clipboard', { get: function () { return fixedClip; }, configurable: false }); navClipLocked = true; } catch (e) {
                  try { Object.defineProperty(navigator, 'clipboard', { get: function () { return fixedClip; }, configurable: true }); } catch (e2) {}
                }
              }
            } catch (e) {}
          };
          reapplyClipboard();
          setInterval(reapplyClipboard, 500);
          dbg('CB bridge installed navWT=' + (navigator.clipboard && navigator.clipboard.writeText === sebWriteText));

          // ROOT CAUSE of dead paste on CodeChef /learn: the page OVERRIDES EventTarget.prototype
          // .addEventListener to drop 'paste' (and copy/cut) listeners (proven: aelNative=0, and a paste
          // listener added to a brand-new element we own never fires). That kills the EDITOR'S OWN paste
          // handler at registration time. We lock addEventListener to a transparent pass-through at
          // document-start - before the page's scripts run - so the page cannot install its stripper and the
          // editor's paste listener registers normally; our synthetic paste then reaches it. The property is
          // an un-writable accessor whose setter silently ignores override attempts, so the page's
          // `addEventListener = ...` assignment is a no-op instead of throwing (keeps the page working).
          try {
            var _realAEL = EventTarget.prototype.addEventListener;
            if (typeof _realAEL === 'function') {
              var _passAEL = function () { return _realAEL.apply(this, arguments); };
              Object.defineProperty(EventTarget.prototype, 'addEventListener', {
                get: function () { return _passAEL; }, set: function () {}, configurable: false, enumerable: true
              });
              dbg('CB addEventListener locked');
            }
          } catch (e) {}

          // Also defeat capture-phase paste blocking: a page may still add a document-capture paste handler
          // (through our pass-through) that calls stopImmediatePropagation() before the event reaches the
          // editor. Neuter stop-propagation ONLY for our tagged synthetic paste, at the prototype level, so
          // the page's blocker can't swallow it while every other event (real copy/cut, the page's own
          // handlers) stays completely intact.
          try {
            var _evSIP = Event.prototype.stopImmediatePropagation;
            var _evSP = Event.prototype.stopPropagation;
            Event.prototype.stopImmediatePropagation = function () {
              try { if (this && this.__sebSynthetic && this.type === 'paste') { return; } } catch (e) {}
              return _evSIP.apply(this, arguments);
            };
            Event.prototype.stopPropagation = function () {
              try { if (this && this.__sebSynthetic && this.type === 'paste') { return; } } catch (e) {}
              return _evSP.apply(this, arguments);
            };
          } catch (e) {}

          // Monaco (and others) sometimes copy via execCommand('copy')/('cut'); bridge those too.
          var origExec = document.execCommand ? document.execCommand.bind(document) : null;
          if (origExec) {
            document.execCommand = function (cmd) {
              try {
                var c = String(cmd).toLowerCase();
                if (c === 'copy' || c === 'cut') {
                  var sel = '';
                  var ae = document.activeElement;
                  if (ae && typeof ae.selectionStart === 'number' && ae.selectionStart !== ae.selectionEnd) {
                    sel = ae.value.substring(ae.selectionStart, ae.selectionEnd);
                  }
                  if (!sel && window.getSelection) { sel = String(window.getSelection()); }
                  if (sel) { sebWriteText(sel); return true; }
                }
              } catch (e) {}
              return origExec.apply(document, arguments);
            };
          }
        } else {
          dbg('CB no native handlers');
        }
      } catch (e) { dbg('CB err ' + e); }

      // -- Which editor, if any, owns this element -----------------------------------------------
      var isTextInput = function (el) {
        if (!el) { return false; }
        var tag = (el.tagName || '').toUpperCase();
        if (tag === 'TEXTAREA') { return true; }
        if (tag === 'INPUT') {
          var t = (el.type || 'text').toLowerCase();
          return ['text', 'search', 'url', 'tel', 'password', 'email', 'number', ''].indexOf(t) !== -1;
        }
        return false;
      };
      var closest = function (el, selector) {
        try { return el && el.closest ? el.closest(selector) : null; } catch (e) { return null; }
      };
      // Returns { kind, node } for Monaco / Ace / CodeMirror 5 / CodeMirror 6, else null.
      var findEditor = function (el) {
        var node;
        if ((node = closest(el, '.monaco-editor'))) { return { kind: 'monaco', node: node }; }
        if ((node = closest(el, '.ace_editor'))) { return { kind: 'ace', node: node }; }
        if ((node = closest(el, '.CodeMirror'))) { return { kind: 'cm5', node: node }; }
        if ((node = closest(el, '.cm-editor'))) { return { kind: 'cm6', node: node }; }
        return null;
      };

      // -- Reach the live editor instance from its DOM node --------------------------------------
      var monacoFor = function (node) {
        try {
          if (window.monaco && monaco.editor && monaco.editor.getEditors) {
            var eds = monaco.editor.getEditors();
            for (var i = 0; i < eds.length; i++) {
              var dn = eds[i].getDomNode && eds[i].getDomNode();
              if (dn && (dn === node || dn.contains(node) || node.contains(dn))) { return eds[i]; }
            }
          }
        } catch (e) {}
        return null;
      };
      var aceFor = function (node) {
        try { if (window.ace && ace.edit) { return ace.edit(node); } } catch (e) {}
        try { if (node.env && node.env.editor) { return node.env.editor; } } catch (e) {}
        return null;
      };
      var cm5For = function (node) { try { return node.CodeMirror || null; } catch (e) { return null; } };

      // -- Read the current selection, whatever holds it -----------------------------------------
      var selectedText = function (target) {
        try {
          if (isTextInput(target) && target.selectionStart !== target.selectionEnd) {
            return target.value.substring(target.selectionStart, target.selectionEnd);
          }
          var info = findEditor(target);
          if (info) {
            if (info.kind === 'monaco') { var m = monacoFor(info.node); if (m) { var r = m.getSelection(); return r ? m.getModel().getValueInRange(r) : ''; } }
            if (info.kind === 'ace') { var a = aceFor(info.node); if (a) { return a.getSelectedText(); } }
            if (info.kind === 'cm5') { var c = cm5For(info.node); if (c) { return c.getSelection(); } }
          }
          var sel = window.getSelection ? String(window.getSelection()) : '';
          return sel;
        } catch (e) { return ''; }
      };

      // -- Insert text ONCE, verbatim, at the caret (replacing any selection) --------------------
      var insertVerbatim = function (target, text) {
        if (text == null) { return false; }
        var info = findEditor(target);
        try {
          if (info && info.kind === 'monaco') {
            var m = monacoFor(info.node);
            if (m) { var sel = m.getSelection(); m.executeEdits('seb-paste', [{ range: sel, text: text, forceMoveMarkers: true }]); m.focus(); return true; }
          } else if (info && info.kind === 'ace') {
            var a = aceFor(info.node);
            if (a) { a.insert(text); a.focus(); return true; }   // Ace.insert replaces the selection, no auto-indent
          } else if (info && info.kind === 'cm5') {
            var c = cm5For(info.node);
            if (c) { c.replaceSelection(text); c.focus(); return true; }
          }
        } catch (e) {}
        // Plain textarea / input / contenteditable / CodeMirror 6: the browser's own verbatim insert.
        try {
          if (document.queryCommandSupported && document.queryCommandSupported('insertText')) {
            if (document.execCommand('insertText', false, text)) { return true; }
          } else if (document.execCommand) {
            if (document.execCommand('insertText', false, text)) { return true; }
          }
        } catch (e) {}
        // Last resort for a plain text field (keeps React-style value binding working).
        try {
          if (isTextInput(target)) {
            var s = target.selectionStart, en = target.selectionEnd, v = target.value;
            var proto = (target.tagName.toUpperCase() === 'TEXTAREA') ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
            var setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
            setter.call(target, v.slice(0, s) + text + v.slice(en));
            target.selectionStart = target.selectionEnd = s + text.length;
            target.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
          }
        } catch (e) {}
        return false;
      };

      var deleteSelection = function (target) {
        try {
          var info = findEditor(target);
          if (info && info.kind === 'monaco') { var m = monacoFor(info.node); if (m) { m.executeEdits('seb-cut', [{ range: m.getSelection(), text: '' }]); return; } }
          if (info && info.kind === 'ace') { var a = aceFor(info.node); if (a) { a.insert(''); return; } }
          if (info && info.kind === 'cm5') { var c = cm5For(info.node); if (c) { c.replaceSelection(''); return; } }
          document.execCommand('delete', false, null);
        } catch (e) {}
      };

      // -- Copy / cut: supply the clipboard ourselves so a page blocker cannot empty it -----------
      var onCopyCut = function (event) {
        try {
          if (event.__sebSynthetic) {
            // Our own copy/cut event, fired so the editor writes its selection to our DataTransfer. Strip
            // any page blocker in its path and let it reach the editor's own handler untouched.
            event.preventDefault = function () {};
            event.stopPropagation = function () {};
            event.stopImmediatePropagation = function () {};
            return;
          }
          var target = document.activeElement;
          if (findEditor(target)) {
            event.stopPropagation = function () {};
            event.stopImmediatePropagation = function () {};
            dbg(event.type.toUpperCase() + ' editor, blocker stripped');
            return;
          }
          var text = selectedText(target);
          dbg(event.type.toUpperCase() + ' selLen=' + (text ? text.length : 0) + ' tgt=' + describe(target));
          if (text && text.length && event.clipboardData) {
            event.clipboardData.setData('text/plain', text);
            // we have put the data on the clipboard, so stop the page (and keep the browser from re-copying)
            originalPreventDefault.call(event);
            event.stopImmediatePropagation();
            if (event.type === 'cut') { deleteSelection(target); }
          } else {
            // nothing we can read: at least don't let a page handler cancel the native copy
            event.stopImmediatePropagation();
          }
        } catch (e) {}
      };
      window.addEventListener('copy', onCopyCut, true);
      window.addEventListener('cut', onCopyCut, true);

      // -- Defeat page-level blocking of the clipboard/select KEYSTROKES (CodeChef and other judges) --
      // Monaco-based judges cancel Cmd/Ctrl+C/V/X/A at keydown, so no copy/paste event ever fires and
      // (in a locked-down browser, where the async Clipboard API may be the editor's only path) the
      // editor's own clipboard is dead too. We run first (injected at document start). When we can reach
      // the Monaco editor instance we perform the clipboard operation ourselves - verbatim, no
      // auto-indent; otherwise we just stop the page cancelling the keystroke so the editor can act.
      var realStopImmediate = Event.prototype.stopImmediatePropagation;
      var monacoNS = function () {
        try { if (window.monaco && window.monaco.editor) { return window.monaco; } } catch (e) {}
        try { if (typeof window.require === 'function') { var m = window.require('vs/editor/editor.api'); if (m && m.editor) { return m; } } } catch (e) {}
        try { if (typeof window.require === 'function') { window.require('vs/editor/editor.main'); if (window.monaco && window.monaco.editor) { return window.monaco; } } } catch (e) {}
        return null;
      };
      var looksLikeMonaco = function (v) {
        return v && typeof v === 'object' &&
               typeof v.executeEdits === 'function' &&
               typeof v.getModel === 'function' &&
               typeof v.getSelection === 'function';
      };
      var monacoCache = null;
      var monacoEditorFor = function (node) {
        if (monacoCache) { try { if (monacoCache.getModel && monacoCache.getModel()) { return monacoCache; } } catch (e) {} monacoCache = null; }
        // 1. Official API, if a monaco global is reachable.
        try {
          var ns = monacoNS();
          if (ns && ns.editor && ns.editor.getEditors) {
            var eds = ns.editor.getEditors();
            for (var i = 0; i < eds.length; i++) {
              var dn = eds[i].getDomNode && eds[i].getDomNode();
              if (dn && (dn === node || dn.contains(node) || (node && node.contains(dn)))) { monacoCache = eds[i]; return eds[i]; }
            }
            if (eds.length === 1) { monacoCache = eds[0]; return eds[0]; }
          }
        } catch (e) {}
        // 2. A global variable that holds the editor (some apps expose it).
        try {
          var names = Object.getOwnPropertyNames(window);
          for (var j = 0; j < names.length; j++) {
            var val; try { val = window[names[j]]; } catch (e) { continue; }
            if (looksLikeMonaco(val)) { monacoCache = val; return val; }
          }
        } catch (e) {}
        // 3. Walk the React fiber for a held editor instance or ref. The .monaco-editor element is created
        // imperatively by Monaco, so React's fiber lives on an ANCESTOR; climb the DOM to find it, then walk
        // the fiber up, traversing the hooks linked list (@monaco-editor/react holds the editor in a hook).
        try {
          var probe = function (v) {
            try {
              if (looksLikeMonaco(v)) { return v; }
              if (v && v.current && looksLikeMonaco(v.current)) { return v.current; }
              if (v && typeof v === 'object') {
                for (var p in v) {
                  try { var pv = v[p]; if (looksLikeMonaco(pv)) { return pv; } if (pv && pv.current && looksLikeMonaco(pv.current)) { return pv.current; } } catch (e) {}
                }
              }
            } catch (e) {}
            return null;
          };
          var fiber = null, domEl = node || document.querySelector('.monaco-editor'), climb = 0;
          while (domEl && !fiber && climb < 15) {
            var dkeys = Object.keys(domEl);
            for (var k = 0; k < dkeys.length; k++) { if (dkeys[k].indexOf('__reactFiber$') === 0 || dkeys[k].indexOf('__reactInternalInstance$') === 0) { fiber = domEl[dkeys[k]]; break; } }
            domEl = domEl.parentElement; climb++;
          }
          var sawEdit = false, depth = 0;
          while (fiber && depth < 120) {
            var hit = probe(fiber.memoizedProps) || probe(fiber.stateNode);
            if (hit) { dbg('CB fiber hit depth=' + depth); monacoCache = hit; return hit; }
            var hook = fiber.memoizedState, hd = 0;      // traverse the hooks chain
            while (hook && typeof hook === 'object' && hd < 80) {
              var h2 = probe(hook.memoizedState);
              if (h2) { dbg('CB fiber hook hit depth=' + depth + ' hd=' + hd); monacoCache = h2; return h2; }
              try { var ms = hook.memoizedState; if (ms && typeof ms === 'object' && typeof ms.executeEdits === 'function') { sawEdit = true; } } catch (e) {}
              hook = hook.next; hd++;
            }
            fiber = fiber.return; depth++;
          }
          dbg('CB fiber none climb=' + climb + ' depth=' + depth + ' sawEdit=' + sawEdit);
        } catch (e) { dbg('CB fiber err ' + e); }
        // 4. Reach the monaco namespace via the webpack module cache. CodeChef bundles Monaco with webpack
        // and exposes no window.monaco; the editor lives in a module closure, but the loaded modules' exports
        // sit in webpack's cache. Grab webpack's require (the standard empty-chunk push - no app code runs),
        // then scan the cache for the editor namespace and ask it for the editor on this DOM node.
        try {
          var wpKey = null;
          for (var wk in window) { try { if (wk.indexOf('webpackChunk') === 0 && Array.isArray(window[wk])) { wpKey = wk; break; } } catch (e) {} }
          if (wpKey) {
            var wreq = null;
            try { window[wpKey].push([['seb_' + Math.random().toString(36).slice(2)], {}, function (r) { wreq = r; }]); } catch (e) {}
            var cache = wreq && wreq.c;
            if (cache) {
              var fromNs = function (ns) {
                try {
                  if (ns && ns.editor && typeof ns.editor.getEditors === 'function') {
                    var eds2 = ns.editor.getEditors();
                    for (var z = 0; z < eds2.length; z++) {
                      var dn2 = eds2[z].getDomNode && eds2[z].getDomNode();
                      if (dn2 && (dn2 === node || dn2.contains(node) || (node && node.contains(dn2)))) { return eds2[z]; }
                    }
                    if (eds2.length === 1) { return eds2[0]; }
                  }
                } catch (e) {}
                return null;
              };
              var scanned = 0;
              for (var mid in cache) {
                var ex; try { ex = cache[mid] && cache[mid].exports; } catch (e) { continue; }
                scanned++;
                var found = fromNs(ex) || (ex && fromNs(ex.default));
                if (found) { monacoCache = found; dbg('CB webpack editor found scanned=' + scanned); return found; }
              }
              dbg('CB webpack scanned=' + scanned + ' no-monaco');
            } else { dbg('CB webpack no require/cache'); }
          } else { dbg('CB no webpackChunk key'); }
        } catch (e) { dbg('CB webpack err ' + e); }

        // 4b. Direct: scan the editor node and a few ancestors for a property that IS or holds the editor
        // (some integrations stash it on the DOM).
        try {
          var dn = node || document.querySelector('.monaco-editor'), up = 0;
          while (dn && up < 8) {
            var ks = Object.keys(dn);
            for (var ki = 0; ki < ks.length; ki++) {
              try {
                var vv = dn[ks[ki]];
                if (looksLikeMonaco(vv)) { monacoCache = vv; dbg('CB node prop hit ' + ks[ki]); return vv; }
                if (vv && vv.current && looksLikeMonaco(vv.current)) { monacoCache = vv.current; dbg('CB node ref hit ' + ks[ki]); return vv.current; }
              } catch (e) {}
            }
            dn = dn.parentElement; up++;
          }
        } catch (e) {}

        // Diagnostic: how does this page hold the editor? Dump the editor node's own keys, its parent's
        // keys, and window globals that look editor/bundler related.
        try {
          var dnode = node || document.querySelector('.monaco-editor');
          var nkeys = dnode ? Object.keys(dnode).slice(0, 12).join(',') : 'n/a';
          var pkeys = (dnode && dnode.parentElement) ? Object.keys(dnode.parentElement).slice(0, 12).join(',') : 'n/a';
          var wmon = []; for (var ww in window) { try { if (/monaco|editor|ace|codemirror|vite|require|webpack|__vue|ng_|redux|store/i.test(ww)) { wmon.push(ww); } } catch (e) {} }
          dbg('CB diag n=[' + nkeys + '] p=[' + pkeys + '] win=[' + wmon.slice(0, 14).join(',') + ']');
        } catch (e) {}

        // 5. Bounded breadth-first search over the object graph reachable from window.
        try {
          if (typeof Set !== 'undefined') {
            var queue = [window], seen = new Set(), visited = 0;
            while (queue.length && visited < 15000) {
              var o = queue.shift();
              if (!o || typeof o !== 'object' || seen.has(o)) { continue; }
              seen.add(o);
              if (typeof Node !== 'undefined' && o instanceof Node) { continue; }
              visited++;
              if (looksLikeMonaco(o)) { monacoCache = o; return o; }
              var props2; try { props2 = Object.keys(o); } catch (e) { continue; }
              for (var qq = 0; qq < props2.length && qq < 80; qq++) {
                try { var cv = o[props2[qq]]; if (cv && typeof cv === 'object' && !seen.has(cv)) { queue.push(cv); } } catch (e) {}
              }
            }
            dbg('CB bfs visited=' + visited);
          }
        } catch (e) {}
        return null;
      };
      // Find the editor whose DOM node matches, inside a monaco namespace's editor list.
      var editorForNode = function (ns, node) {
        try {
          if (!ns || !ns.editor || !ns.editor.getEditors) { return null; }
          var eds = ns.editor.getEditors();
          for (var z = 0; z < eds.length; z++) {
            var dn = eds[z].getDomNode && eds[z].getDomNode();
            if (dn && (dn === node || dn.contains(node) || (node && node.contains(dn)))) { return eds[z]; }
          }
          if (eds.length === 1) { return eds[0]; }
        } catch (e) {}
        return null;
      };
      // Reach monaco's namespace by re-importing its already-loaded ES-module chunk. Vite/Rollup builds
      // (CodeChef) keep the editor in a module closure with no global, but ES modules are cached by URL, so
      // import()ing the chunk returns the SAME namespace the app uses - then getEditors() gives the instance.
      var monacoNsCache = null;
      var findMonacoNsAsync = function () {
        if (monacoNsCache) { return Promise.resolve(monacoNsCache); }
        if (typeof Promise === 'undefined') { return { then: function (f) { f(null); } }; }
        var urls = [], seen = {};
        var add = function (u) { if (u && !seen[u] && /\.m?js(\?|$)/i.test(u)) { seen[u] = 1; urls.push(u); } };
        try { var es = performance.getEntriesByType ? performance.getEntriesByType('resource') : []; for (var i = 0; i < es.length; i++) { add(es[i].name); } } catch (e) {}
        try { var ls = document.querySelectorAll('link[rel="modulepreload"],script[type="module"][src]'); for (var j = 0; j < ls.length; j++) { add(ls[j].href || ls[j].src); } } catch (e) {}
        urls.sort(function (a, b) { return (/monaco|editor|vendor|index|chunk/i.test(a) ? 0 : 1) - (/monaco|editor|vendor|index|chunk/i.test(b) ? 0 : 1); });
        dbg('CB import scan n=' + urls.length);
        var idx = 0, ok = 0, fail = 0, sawEd = 0;
        // Accept a namespace that exposes EITHER getEditors (lists live instances) OR create (full monaco
        // namespace); broader than before so a tree-shaken getEditors doesn't make us miss the namespace.
        var pick = function (m) {
          try { if (m && m.editor && (typeof m.editor.getEditors === 'function' || typeof m.editor.create === 'function')) { return m; } } catch (e) {}
          return null;
        };
        var step = function () {
          if (idx >= urls.length) { dbg('CB import done ok=' + ok + ' fail=' + fail + ' sawEd=' + sawEd); return Promise.resolve(null); }
          var u = urls[idx++], p;
          try { p = import(u); } catch (e) { fail++; return step(); }
          return p.then(function (mod) {
            ok++;
            var ns = pick(mod) || pick(mod && mod.default);
            if (!ns && mod) { try { for (var k in mod) { var v = mod[k]; if (v && v.editor) { sawEd++; if (pick(v)) { ns = v; break; } } } } catch (e) {} }
            if (ns) { monacoNsCache = ns; dbg('CB import FOUND ns getEds=' + (typeof ns.editor.getEditors)); return ns; }
            return step();
          }, function () { fail++; return step(); });
        };
        return step();
      };
      var neutralise = function (e, alsoDefault) {
        e.stopPropagation = function () {};
        e.stopImmediatePropagation = function () {};
        if (alsoDefault) { e.preventDefault = function () {}; }
      };
      // Hand the editor a real 'paste' event carrying the text, so it pastes verbatim (no auto-indent),
      // even when we can't reach the editor instance. Tagged so our own capture handler lets it through
      // and strips any page blocker in its path.
      var pasteIntoEditor = function (ta, text) {
        var el = ta || document.activeElement;
        // Hand the editor a 'paste' event carrying the text so it inserts verbatim through its PASTE path
        // (no auto-indent cascade), even when we can't reach the editor instance.
        //   WebKit WONT let a page-built DataTransfer be populated outside a trusted clipboard event -
        //   setData() silently no-ops, so a real `new DataTransfer()` delivers EMPTY text to the editor
        //   (this is why the old synthetic paste "did nothing"). A plain stand-in whose getData() returns
        //   the text sidesteps that entirely: Monaco/Slate/CM read clipboardData.getData('text/plain') off
        //   the event and never inspect its prototype. Returning '' for the 'vscode-editor-data' mime makes
        //   Monaco treat it as an external paste (plain, verbatim), not an internal multi-cursor paste.
        try {
          var fakeClip = {
            getData: function (t) { t = String(t || '').toLowerCase(); return (t === 'text/plain' || t === 'text') ? text : ''; },
            setData: function () {}, clearData: function () {},
            types: ['text/plain'], files: [],
            // Some Monaco/VSCode builds iterate clipboardData.items (DataTransferItemList) rather than calling
            // getData, so expose a text/plain string item too.
            items: [{ kind: 'string', type: 'text/plain', getAsString: function (cb) { try { cb(text); } catch (e) {} }, getAsFile: function () { return null; } }]
          };
          var ev;
          try { ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true }); }
          catch (e) { ev = new Event('paste', { bubbles: true, cancelable: true }); }
          try { Object.defineProperty(ev, 'clipboardData', { value: fakeClip, configurable: true }); } catch (e) {}
          try { Object.defineProperty(ev, 'isTrusted', { value: true, configurable: true }); } catch (e) {}   // some Monaco builds gate paste on isTrusted
          ev.__sebSynthetic = true;
          if (el && el.focus) { try { el.focus(); } catch (e) {} }
          el.dispatchEvent(ev);
          dbg('   synth paste len=' + text.length + ' read=' + (ev.clipboardData ? ev.clipboardData.getData('text/plain').length : -1) + ' dPrev=' + ev.defaultPrevented);
          return true;
        } catch (e) { dbg('   synth paste err ' + e); return false; }
      };
      // Fire the editor's OWN copy/cut handler with a synthetic event and read back what it put on the
      // DataTransfer. Monaco/Ace/CM register 'copy'/'cut' listeners on their textarea that write the real
      // selection via setData - this reaches that text without needing the editor instance or the
      // (cancellable) async clipboard. Returns the selection text, or '' if the editor supplied nothing.
      var copyViaSyntheticEvent = function (ta, isCut) {
        try {
          var dt = null;
          try { dt = new DataTransfer(); } catch (e) {}
          if (!dt) { return ''; }
          var type = isCut ? 'cut' : 'copy';
          var ev;
          try { ev = new ClipboardEvent(type, { clipboardData: dt, bubbles: true, cancelable: true }); }
          catch (e) { ev = new Event(type, { bubbles: true, cancelable: true }); }
          if (!ev.clipboardData) { try { Object.defineProperty(ev, 'clipboardData', { value: dt, configurable: true }); } catch (e) {} }
          ev.__sebSynthetic = true;
          (ta || document.activeElement).dispatchEvent(ev);
          var t = '';
          try { t = dt.getData('text/plain') || ''; } catch (e) {}
          dbg('   synth ' + type + ' len=' + t.length);
          return t;
        } catch (e) { dbg('   synth copy err ' + e); return ''; }
      };
      // The textarea the editor listens on (Monaco/Ace/CM focus a hidden <textarea>); fall back to target.
      var editorTextareaFor = function (tgt, info) {
        try {
          if (tgt && tgt.tagName && tgt.tagName.toUpperCase() === 'TEXTAREA') { return tgt; }
          if (info && info.node) { var ta = info.node.querySelector('textarea'); if (ta) { return ta; } }
        } catch (e) {}
        return tgt || document.activeElement;
      };
      var sebSelfTested = false;
      var clipboardKind = function (e) {
        if (!(e.metaKey || e.ctrlKey) || e.altKey) { return 0; }
        var k = String(e.key).toLowerCase();
        if (k === 'v') { return 1; }   // paste
        if (k === 'c') { return 2; }   // copy
        if (k === 'x') { return 3; }   // cut
        if (k === 'a') { return 4; }   // select all
        return 0;
      };
      // Own copy / cut / paste outright at the keystroke. This WebView denies the JS clipboard API, so the
      // editor's own navigator.clipboard copy cancels and its paste reads nothing. Instead we drive the
      // editor's own copy/paste event handlers with synthetic events and bridge to the native pasteboard:
      //  - copy/cut: fire a synthetic copy/cut so the editor writes its real selection to a DataTransfer we
      //    read, then push that to the native clipboard (sebWriteText).
      //  - paste: read the native clipboard (sebReadText) and hand the editor a synthetic paste carrying it,
      //    so it lands exactly ONCE and verbatim (paste path = no auto-indent cascade).
      window.addEventListener('keydown', function (e) {
        try {
          var kind = clipboardKind(e);
          if (!kind) { return; }
          reapplyClipboard();
          var tgt = document.activeElement;
          var info = findEditor(tgt);
          var editable = isTextInput(tgt) || (tgt && tgt.isContentEditable) || !!info;
          var ta = editorTextareaFor(tgt, info);

          if (kind === 2 || kind === 3) {               // copy / cut
            var mEd = (info && info.kind === 'monaco') ? monacoEditorFor(info.node) : null;
            var text = '', viaSynthetic = false;
            if (mEd) { try { var rr = mEd.getSelection(); text = rr ? mEd.getModel().getValueInRange(rr) : ''; } catch (e2) {} }  // instance: exact selection
            if (!text && info) { text = copyViaSyntheticEvent(ta, kind === 3); if (text) { viaSynthetic = true; } }  // editor's own copy handler
            if (!text) { text = selectedText(tgt); }                      // textarea range
            if (!text) { try { text = String(window.getSelection() || ''); } catch (x) {} }  // page selection
            dbg('KEY ' + (kind === 3 ? 'cut' : 'copy') + ' len=' + (text ? text.length : 0) + ' inst=' + !!mEd + ' syn=' + viaSynthetic);
            if (text) {
              originalPreventDefault.call(e);
              e.stopImmediatePropagation();
              sebWriteText(text);
              if (kind === 3) {                           // cut: remove the selection
                if (mEd) { try { mEd.executeEdits('seb-cut', [{ range: mEd.getSelection(), text: '' }]); mEd.focus(); } catch (e3) {} }
                else if (!viaSynthetic) { deleteSelection(tgt); }   // a synthetic cut already deleted via the editor
              }
            }
            return;
          }

          if (kind === 1) {                              // paste
            if (!editable) { return; }
            // Decide synchronously (preventDefault can't be undone): if we can reach the editor instance,
            // own the keystroke and paste verbatim via its API (executeEdits never auto-indents). This is
            // proven to work wherever the instance is reachable - window.monaco, a React fiber, a webpack
            // module, Ace via window.ace, a plain field. If the instance is sealed away (CodeChef's
            // Vite-bundled Monaco keeps it in a module closure, unreachable from page script), we do NOT
            // own the keystroke: we only defeat the page's keystroke blocker and let the editor's own paste
            // run, so the code still lands (it may auto-indent, as in build 15770, but it inserts).
            var mEd = (info && info.kind === 'monaco') ? monacoEditorFor(info.node) : null;
            if (mEd) {
              // Monaco with a reachable instance -> paste verbatim via executeEdits.
              originalPreventDefault.call(e);
              e.stopImmediatePropagation();
              sebReadText().then(function (text) {
                if (!text) { return; }
                try {
                  var r = mEd.getSelection();
                  mEd.executeEdits('seb-paste', [{ range: r, text: text, forceMoveMarkers: true }]);
                  if (mEd.pushUndoStop) { mEd.pushUndoStop(); }
                  mEd.focus();
                  dbg('PASTE via instance len=' + text.length);
                } catch (er) { dbg('PASTE exec err ' + er); }
              });
              return;
            }
            if (info && info.kind === 'monaco') {
              // Monaco whose instance is SEALED (CodeChef /learn Vite bundle; instance PROVEN unreachable).
              // This Monaco pastes through the DOM 'paste' event's clipboardData (its Cmd+V does NOT drive a
              // navigator.clipboard paste - letting Cmd+V through reads nothing). Cmd+V never produces that
              // event in this WebView, so we own the keystroke and synthesise the paste event ourselves on the
              // LIVE focused textarea (not a stale reference), carrying the clipboard via a complete fake
              // clipboardData. A reach probe records whether the event actually reaches the textarea's own
              // listeners (so we can tell "didn't reach" from "reached but Monaco ignored it").
              originalPreventDefault.call(e);
              e.stopImmediatePropagation();
              sebReadText().then(function (text) {
                if (!text) { dbg('PASTE sealed empty'); return; }
                // With addEventListener locked (above), the editor's own 'paste' listener survives the page's
                // stripper, so handing it a synthetic 'paste' carrying the clipboard lands VERBATIM.
                pasteIntoEditor(document.activeElement || ta, text);
                dbg('PASTE sealed-monaco -> synth paste len=' + text.length);
              });
              return;
            }
            // Plain field, rich-text / contenteditable (Slate - CodeChef skill-test), Ace, CodeMirror: read
            // the native clipboard and insert it ourselves (editor API / execCommand insertText / value
            // splice). This fires a trusted-looking insert the editor accepts, bypassing the dead paste event.
            originalPreventDefault.call(e);
            e.stopImmediatePropagation();
            sebReadText().then(function (text) {
              if (!text) { dbg('PASTE empty'); return; }
              var r = insertVerbatim(tgt, text);
              dbg('PASTE insert=' + r + ' ed=' + (info ? info.kind : (tgt && tgt.isContentEditable ? 'contenteditable' : 'input')) + ' len=' + text.length);
            });
            return;
          }

          // select-all (kind 4): just stop the page from cancelling it
          if (editable) { neutralise(e, false); }
        } catch (x) { dbg('keydown err ' + x); }
      }, true);

      // -- Paste: own the paste outright, so it lands exactly ONCE, verbatim ----------------------
      // We do not try to detect whether the page blocked the paste (that is unreliable: Monaco and
      // friends swallow their own events). Instead, for any editable target we cancel the event
      // (stopping both the page's blocker and the editor's own paste handler) and insert the clipboard
      // text once through the editor's API. One insert, every time - never the double that detection
      // produced, never the reflow that neutering preventDefault produced. Non-editable targets and
      // non-text payloads (images, files) are left completely alone.
      var onPaste = function (event) {
        try {
          if (event.__sebSynthetic) {
            // Our own paste event, carrying the clipboard text to the editor. Strip any page blocker
            // in its path and let it reach the editor's own paste handler untouched.
            event.preventDefault = function () {};
            event.stopPropagation = function () {};
            event.stopImmediatePropagation = function () {};
            dbg('PASTE synthetic passthrough');
            return;
          }
          var text = event.clipboardData ? event.clipboardData.getData('text/plain') : '';
          var target = document.activeElement;
          var rich = findEditor(target);
          dbg('PASTE evt len=' + (text ? text.length : 0) + ' tgt=' + describe(target) + ' edi=' + (rich ? rich.kind : 'none'));
          if (!text) { return; }
          if (rich) {
            event.stopPropagation = function () {};
            event.stopImmediatePropagation = function () {};
            dbg('   editor paste, blocker stripped (' + rich.kind + ')');
            return;
          }
          if (isTextInput(target) || (target && target.isContentEditable)) {
            originalPreventDefault.call(event);
            event.stopImmediatePropagation();
            var r = insertVerbatim(target, text);
            dbg('   insertVerbatim=' + r);
          }
        } catch (e) { dbg('PASTE err ' + e); }
      };
      window.addEventListener('paste', onPaste, true);

      // -- Let selection and the context menu happen (pages block these to stop copying) ---------
      ['selectstart', 'contextmenu', 'dragstart', 'beforecopy', 'beforecut', 'beforepaste'].forEach(function (type) {
        window.addEventListener(type, function (e) { try { e.stopImmediatePropagation(); } catch (x) {} }, true);
      });
      // Inline on* blockers (document.oncopy = ... etc.) are neutralised and cannot be reassigned.
      ['oncopy', 'oncut', 'onpaste', 'oncontextmenu', 'onselectstart', 'ondragstart'].forEach(function (prop) {
        try {
          define(document, prop, { get: function () { return null; }, set: function () {}, configurable: true });
          define(document.body || HTMLBodyElement.prototype, prop, { get: function () { return null; }, set: function () {}, configurable: true });
        } catch (e) {}
      });

      // -- Make text selectable again (pages use user-select:none to stop copying the problem) ----
      var addSelectableStyle = function () {
        try {
          var style = document.createElement('style');
          style.setAttribute('data-exam-guard', 'selectable');
          style.textContent =
            'html, body, body * { -webkit-user-select: text !important; user-select: text !important; -webkit-touch-callout: default !important; }' +
            '.monaco-editor, .monaco-editor *, .ace_editor, .ace_editor *, .CodeMirror, .CodeMirror *, .cm-editor, .cm-editor * { -webkit-user-select: text !important; user-select: text !important; }';
          (document.head || document.documentElement).appendChild(style);
        } catch (e) {}
      };
      if (document.head || document.body) { addSelectableStyle(); }
      document.addEventListener('DOMContentLoaded', addSelectableStyle, { once: true, capture: true });

    } catch (e) { /* clipboard liberation must never break the page */ }

  } catch (e) { /* never break the page */ }
})();
