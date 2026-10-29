/*
 * ExamPageGuard.js: injected into every page (and every frame) before the page's own scripts run.
 *
 *  1. A page can never tell that the student switched to another window, tab or app: it is always
 *     visible and focused, and the events that would report otherwise never reach it.
 *  2. A page can never stop the student from quitting: Cmd+Q is not something a page can cancel.
 *
 * Copy, cut, paste and selecting are deliberately NOT touched here. They are left entirely to the
 * page and the browser, exactly as in a normal browser. A code editor (Monaco, CodeMirror, Ace and
 * the like) handles Cmd+C / Cmd+X / Cmd+V / Cmd+A itself: it cancels the key or clipboard event with
 * preventDefault() and then copies the whole document, cuts, or pastes atomically with the right
 * indentation. An earlier version of this guard forced those events through by cancelling the page's
 * preventDefault(), which made the browser's own action run on top of the editor's - so copies came
 * out truncated, pastes piled up extra indentation line after line, and Cmd+A / Cmd+X did nothing.
 * Guaranteeing clipboard against a page that blocks it and letting an editor do its own clipboard are
 * mutually exclusive, so the editor wins: clipboard and selection are plain, native browser behaviour.
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
  } catch (e) { /* never break the page */ }
})();
