// vexon_cell1.patched.js — extended GUI shim for Vexon (safe, backward-compatible)
// - If the core already provides a `gui` builtin we enhance it non-destructively.
// - If not, we register a robust shim that exposes Window/Button/Label/Canvas and
//   a small event system. The shim intentionally does not assume any specific
//   renderer bridge — instead it exposes `vm._gui` helper hooks that the core
//   renderer or your CLI can call to inspect state or dispatch events.
//
// Drop this file in place of your current vexon_cell1.js (or keep as a safe
// replacement). Restart the CLI/Electron after updating.

module.exports = function(vm) {
  if (!vm || typeof vm !== 'object') return;
  if (!vm.builtins || typeof vm.builtins !== 'object') vm.builtins = {};

  // Internal registry used by the shim. Exposed on vm._gui so the host
  // (vexon_core / renderer) can query state or push events into widgets.
  vm._gui = vm._gui || {
    _idCounter: 1,
    registry: {},
    // dispatch an event into a widget by id (used by host to forward clicks etc.)
    triggerEvent: function(id, evName, args) {
      var w = this.registry[id];
      if (!w) return false;
      var handlers = w._handlers && w._handlers[evName];
      if (!handlers) return false;
      try {
        for (var i=0; i<handlers.length; i++) {
          try { handlers[i].apply(w, args || []); } catch(e) { if (vm.debug) console.error("gui handler error", e); }
        }
      } catch(e) { if (vm.debug) console.error(e); }
      return true;
    },
    // produce a serializable snapshot of current widget tree for host rendering
    snapshot: function() {
      var out = [];
      for (var k in this.registry) {
        var w = this.registry[k];
        // shallow serializable representation
        out.push({ id: w._id, type: w._type, props: w._props || {}, children: (w._children || []).map(function(c){ return c._id; }), ops: w._ops || [] });
      }
      return out;
    }
  };

  // helper: new widget id + registration
  function registerWidget(obj) {
    obj._id = vm._gui._idCounter++;
    vm._gui.registry[obj._id] = obj;
    return obj;
  }

  // Enhance existing core gui if present (non-destructive)
  if (vm.builtins.gui) {
    try {
      var existing = vm.builtins.gui;
      var gobj = (typeof existing === 'function') ? existing() : existing;

      // ensure helper constructors exist and add friendly shims if missing
      if (!gobj.VBox) gobj.VBox = function(){ return { _id: 0, add: function(){}, setStyle: function(){} }; };
      if (!gobj.HBox) gobj.HBox = function(){ return { _id: 0, add: function(){}, setStyle: function(){} }; };
      if (!gobj.Canvas) gobj.Canvas = gobj.Canvas || function(w,h){ return { _id: 0, width: w||300, height: h||150, clear: function(){}, drawRect:function(){}, drawCircle:function(){}, drawText:function(){}, drawLine:function(){}, setStyle:function(){} }; };

      // expose a wrapper factory so `gui()` and `gui` both work uniformly
      vm.builtins.gui = function() { return gobj; };

      // attach helper bridge for host to inspect / trigger
      vm._gui._wrappedCore = true;
    } catch(e) {
      // fall through to shim registration if enhancement fails
      if (vm.debug) console.error('Failed to enhance core gui builtin', e);
    }
  }

  // If after enhancement a gui builtin exists, we're done (we don't override core)
  if (typeof vm.builtins.gui === 'function' && vm.builtins.gui().Window) return;
  if (typeof vm.builtins.gui === 'object' && vm.builtins.gui.Window) return;

  // Otherwise register our shim as a factory function (so both gui and gui() work)
  var shim = function() {
    var gui = {};

    // Basic widget factory helpers
    gui.Window = function(title, w, h) {
      var widget = registerWidget({ _type: 'Window', _typeName: 'Window', _props: { title: String(title || ''), w: w||400, h: h||300 }, _children: [], _handlers: {}, _ops: [] });

      widget.add = function(child) { if (!child) return; if (!this._children) this._children = []; this._children.push(child); };
      widget.on = function(){ /* event handlers at window-level (not used in shim) */ };
      widget.setTitle = function(t){ this._props.title = String(t); };
      widget.setSize = function(wi, hi){ this._props.w = wi; this._props.h = hi; };
      widget.show = function(){ /* host renderer should call vm._gui.snapshot() to get state */ };
      widget.close = function(){ /* no-op */ };
      widget.setStyle = function(){};

      return widget;
    };

    gui.Button = function(text) {
      var widget = registerWidget({ _type: 'Button', _props: { text: String(text || '') }, _handlers: {}, _ops: [] });
      widget.setText = function(t){ this._props.text = String(t); };
      widget.on = function(ev, handler) { if (!this._handlers[ev]) this._handlers[ev] = []; this._handlers[ev].push(handler); };
      widget._emit = function(ev /*, ...args */) { var args = Array.prototype.slice.call(arguments, 1); vm._gui.triggerEvent(this._id, ev, args); };
      return widget;
    };

    gui.Label = function(text) {
      var widget = registerWidget({ _type: 'Label', _props: { text: String(text || '') }, _handlers: {}, _ops: [] });
      widget.setText = function(t){ this._props.text = String(t); };
      widget.setStyle = function(){};
      widget.on = function(ev, handler) { if (!this._handlers[ev]) this._handlers[ev] = []; this._handlers[ev].push(handler); };
      return widget;
    };

    gui.VBox = function() { var widget = registerWidget({ _type: 'VBox', _children: [], _props: {}, _handlers: {}, _ops: [] }); widget.add = function(c){ if (!this._children) this._children=[]; this._children.push(c); }; widget.setStyle = function(){}; return widget; };
    gui.HBox = function() { var widget = registerWidget({ _type: 'HBox', _children: [], _props: {}, _handlers: {}, _ops: [] }); widget.add = function(c){ if (!this._children) this._children=[]; this._children.push(c); }; widget.setStyle = function(){}; return widget; };

    gui.Canvas = function(w, h) {
      var widget = registerWidget({ _type: 'Canvas', _props: { width: w||300, height: h||150 }, _ops: [], _handlers: {} });
      widget.width = widget._props.width;
      widget.height = widget._props.height;
      widget.clear = function(){ this._ops = []; };
      widget.drawRect = function(x,y,wid,hei,color){ this._ops.push({op:'rect', x:x, y:y, w:wid, h:hei, color: color}); };
      widget.drawCircle = function(x,y,r,color){ this._ops.push({op:'circle', x:x, y:y, r:r, color: color}); };
      widget.drawText = function(x,y,text,color){ this._ops.push({op:'text', x:x, y:y, text: String(text), color: color}); };
      widget.drawLine = function(x1,y1,x2,y2,color,thick){ this._ops.push({op:'line', x1:x1, y1:y1, x2:x2, y2:y2, color: color, width: thick||1}); };
      widget.setStyle = function(){};
      widget.on = function(ev, handler) { if (!this._handlers[ev]) this._handlers[ev] = []; this._handlers[ev].push(handler); };
      return widget;
    };

    // simple timer proxies
    gui.setInterval = function(fn, ms) { if (typeof vm.setInterval === 'function') return vm.setInterval(fn, ms); return setInterval(fn, ms); };
    gui.setTimeout = function(fn, ms) { if (typeof vm.setTimeout === 'function') return vm.setTimeout(fn, ms); return setTimeout(fn, ms); };

    return gui;
  };

  // register factory and object alias so both gui and gui() work
  try {
    vm.builtins.gui = shim;
    vm.builtins.guiObject = shim();
  } catch(e) {
    if (vm.debug) console.error('Failed to register shim gui builtin', e);
  }

};

// --- Error messenger API ---------------------------------------------------
// vm._gui.showError(err) : record and create an Error widget with message + stack
vm._gui.showError = function(err) {
  try {
    var message = (err && err.message) ? String(err.message) : String(err);
    var stack = (err && err.stack) ? String(err.stack) : null;
    var id = vm._gui._idCounter++;
    var widget = { _id: id, _type: 'Error', _props: { title: 'Error', message: message, stack: stack, time: (new Date()).toISOString(), visible: true }, _handlers: {}, _ops: [] };
    vm._gui.registry[id] = widget;
    vm._gui.lastError = widget;
    // also print to host console
    try { if (vm.debug) console.error('GUI Error:', message, stack); } catch(e) {}
    return widget;
  } catch(e) { if (vm.debug) console.error('vm._gui.showError failed', e); return null; }
};

// convenience to clear last error
vm._gui.clearError = function() {
  if (vm._gui.lastError) {
    delete vm._gui.registry[vm._gui.lastError._id];
    vm._gui.lastError = null;
  }
};

// install an optional VM-level hook to automatically show uncaught errors.
// If vm.run is a function we wrap it so uncaught exceptions inside script code
// are captured and forwarded to the GUI as an Error widget. This mirrors a
// Python-like traceback messenger for interactive debugging.
if (typeof vm.run === 'function' && !vm._gui._runPatched) {
  var originalRun = vm.run;
  vm.run = function() {
    try {
      return originalRun.apply(vm, arguments);
    } catch (e) {
      try { vm._gui.showError(e); } catch (ee) { if (vm.debug) console.error('showError failed', ee); }
      throw e;
    }
  };
  vm._gui._runPatched = true;
}

// expose a helper that returns a plain text representation for renderer consumption.
vm._gui.renderErrorAsText = function(w) {
  if (!w || !w._props) return '';
  var out = '=== ' + (w._props.title || 'Error') + ' ===\n';
  out += (w._props.message || '') + '\n\n';
  if (w._props.stack) out += w._props.stack + '\n';
  out += '\nTimestamp: ' + (w._props.time || '') + '\n';
  return out;
};

};
