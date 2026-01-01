// vexon_cell1.js — Kernel bootstrap + GUI shim + error messenger
// - idempotent kernel loader for core extension cells
// - installs a backward-compatible GUI shim if core doesn't provide one
// - installs structured error widget helpers and vm-level hooks
// - exposes vm.loadCell(name, path) and records load activity

module.exports = function(vm) {
  if (!vm || typeof vm !== "object") return;

  // --- idempotency / basic vm markers -------------------------------------
  vm._cells = vm._cells || {};
  if (vm._cells.cell1_kernel) return; // already applied
  vm._cells.cell1_kernel = true;

  vm._cellsLoaded = vm._cellsLoaded || [];
  vm._cellLoadErrors = vm._cellLoadErrors || [];
  vm._kernelVersion = vm._kernelVersion || "cell1-v1";

  // safe require helper relative to this file
  function tryRequire(path) {
    try {
      return require(path);
    } catch (e) {
      return null;
    }
  }

    // HARD-WIRE: load errors cell from the runtime (idempotent)
  try {
    var errCell = tryRequire('./vexon_cell2_errors.js');
    if (errCell) {
      try { errCell(vm); } catch (e) { if (vm.debug) console.error('Failed to apply cell2_errors', e); }
    }
  } catch (e) {
    if (vm.debug) console.error('hard-wire load failed', e);
  }

  // loader helper exposed to other cells / runtime (idempotent)
  vm.loadCell = vm.loadCell || function(name, relPath) {
    if (!name || !relPath) throw new Error("loadCell requires (name, relPath)");
    vm._cells = vm._cells || {};
    if (vm._cells[name]) return true; // already loaded

    try {
      // require relative to this file (module scope)
      var mod = tryRequire(relPath);
      if (!mod) {
        var e = new Error("Cell not found: " + relPath);
        vm._cellLoadErrors.push({ name: name, path: relPath, error: String(e) });
        throw e;
      }
      if (typeof mod === "function") {
        mod(vm);
      }
      vm._cells[name] = true;
      vm._cellsLoaded.push({ name: name, path: relPath, time: (new Date()).toISOString() });
      return true;
    } catch (err) {
      vm._cellLoadErrors.push({ name: name, path: relPath, error: String(err) });
      if (vm.debug) console.error("Failed to load cell:", name, relPath, err);
      throw err;
    }
  };

  // convenience: autorun a small list of common cells (if present)
  // You may edit this list as you add more cells.
  (function autoLoadCommonCells() {
    var base = "./"; // relative to this file
    var common = [
      { n: "errors", p: "./vexon_cell2_errors.js" },
      { n: "exec_guard", p: "./vexon_cell3_exec_guard.js" },
      { n: "gui_invariants", p: "./vexon_cell4_gui_invariants.js" }
    ];
    for (var i = 0; i < common.length; i++) {
      var it = common[i];
      try {
        // try to require without throwing the whole bootstrap on missing files
        var mod = tryRequire(it.p);
        if (mod) {
          vm.loadCell(it.n, it.p);
        }
      } catch (e) {
        // loadCell already recorded failures; continue
      }
    }
  })();

  // --- GUI shim (preserves your original implementation, but inside kernel) ---
  if (!vm.builtins || typeof vm.builtins !== "object") vm.builtins = {};

  vm._gui = vm._gui || {
    _idCounter: 1,
    registry: {},
    triggerEvent: function(id, evName, args) {
      var w = this.registry[id];
      if (!w) return false;
      var handlers = w._handlers && w._handlers[evName];
      if (!handlers) return false;
      try {
        for (var i = 0; i < handlers.length; i++) {
          try { handlers[i].apply(w, args || []); } catch (ee) { if (vm.debug) console.error("gui handler error", ee); }
        }
      } catch (ee) { if (vm.debug) console.error(ee); }
      return true;
    },
    snapshot: function() {
      var out = [];
      for (var k in this.registry) {
        if (!Object.prototype.hasOwnProperty.call(this.registry, k)) continue;
        var w = this.registry[k];
        out.push({
          id: w._id,
          type: w._type,
          props: w._props || {},
          children: (w._children || []).map(function(c) { return c._id; }),
          ops: w._ops || []
        });
      }
      return out;
    }
  };

  function registerWidget(obj) {
    obj._id = vm._gui._idCounter++;
    vm._gui.registry[obj._id] = obj;
    return obj;
  }

  // try to enhance existing core gui non-destructively
  if (vm.builtins.gui) {
    try {
      var existing = vm.builtins.gui;
      var gobj = (typeof existing === "function") ? existing() : existing;

      if (!gobj.VBox) gobj.VBox = function() { return { _id: 0, add: function(){}, setStyle: function(){} }; };
      if (!gobj.HBox) gobj.HBox = function() { return { _id: 0, add: function(){}, setStyle: function(){} }; };
      if (!gobj.Canvas) gobj.Canvas = gobj.Canvas || function(w,h) { return { _id:0, width: w||300, height: h||150, clear:function(){}, drawRect:function(){}, drawCircle:function(){}, drawText:function(){}, drawLine:function(){}, setStyle:function(){} }; };

      // unify to a factory so gui and gui() both work
      vm.builtins.gui = function() { return gobj; };
      vm._gui._wrappedCore = true;
    } catch (e) {
      if (vm.debug) console.error("Failed to enhance core gui builtin", e);
    }
  }

  // If a core gui exists after enhancement, skip the shim registration
  try {
    if ((typeof vm.builtins.gui === "function" && vm.builtins.gui().Window) ||
        (typeof vm.builtins.gui === "object" && vm.builtins.gui.Window)) {
      // Nothing more to do for GUI
    } else {
      // register shim factory so both gui and gui() work
      var shim = function() {
        var gui = {};

        gui.Window = function(title, w, h) {
          var widget = registerWidget({ _type: 'Window', _typeName: 'Window', _props: { title: String(title || ''), w: w||400, h: h||300 }, _children: [], _handlers: {}, _ops: [] });
          widget.add = function(child) { if (!child) return; if (!this._children) this._children = []; this._children.push(child); };
          widget.on = function(){};
          widget.setTitle = function(t){ this._props.title = String(t); };
          widget.setSize = function(wi, hi){ this._props.w = wi; this._props.h = hi; };
          widget.show = function(){};
          widget.close = function(){};
          widget.setStyle = function(){};
          return widget;
        };

        gui.Button = function(text) {
          var widget = registerWidget({ _type: 'Button', _props: { text: String(text || '') }, _handlers: {}, _ops: [] });
          widget.setText = function(t){ this._props.text = String(t); };
          widget.on = function(ev, handler) { if (!this._handlers[ev]) this._handlers[ev] = []; this._handlers[ev].push(handler); };
          widget._emit = function() { var args = Array.prototype.slice.call(arguments, 0); vm._gui.triggerEvent(this._id, args[0], args.slice(1)); };
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

        gui.setInterval = function(fn, ms) { if (typeof vm.setInterval === 'function') return vm.setInterval(fn, ms); return setInterval(fn, ms); };
        gui.setTimeout = function(fn, ms) { if (typeof vm.setTimeout === 'function') return vm.setTimeout(fn, ms); return setTimeout(fn, ms); };

        return gui;
      };

      try {
        vm.builtins.gui = shim;
        vm.builtins.guiObject = shim();
      } catch (e) {
        if (vm.debug) console.error('Failed to register shim gui builtin', e);
      }
    }
  } catch (e) {
    if (vm.debug) console.error("GUI shim decision failed", e);
  }

  // --- Error messenger API ---------------------------------------------------
  vm._gui.showError = vm._gui.showError || function(err) {
    try {
      var message = (err && err.message) ? String(err.message) : String(err);
      var stack = (err && err.stack) ? String(err.stack) : null;
      var id = vm._gui._idCounter++;
      var widget = { _id: id, _type: 'Error', _props: { title: 'Error', message: message, stack: stack, time: (new Date()).toISOString(), visible: true }, _handlers: {}, _ops: [] };
      vm._gui.registry[id] = widget;
      vm._gui.lastError = widget;
      try { if (vm.debug) console.error('GUI Error:', message, stack); } catch(e) {}
      return widget;
    } catch (e) { if (vm.debug) console.error('vm._gui.showError failed', e); return null; }
  };

  vm._gui.clearError = vm._gui.clearError || function() {
    if (vm._gui.lastError) {
      delete vm._gui.registry[vm._gui.lastError._id];
      vm._gui.lastError = null;
    }
  };

  // wrap vm.run so uncaught exceptions create an Error widget (do not swallow)
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

  vm._gui.renderErrorAsText = vm._gui.renderErrorAsText || function(w) {
    if (!w || !w._props) return '';
    var out = '=== ' + (w._props.title || 'Error') + ' ===\n';
    out += (w._props.message || '') + '\n\n';
    if (w._props.stack) out += w._props.stack + '\n';
    out += '\nTimestamp: ' + (w._props.time || '') + '\n';
    return out;
  };

  // --- Kernel diagnostics API exposed to language (read-only helpers) -----
  // Expose a safe __kernel object that Vexon programs can call to inspect kernel state.
  try {
    vm.globals = vm.globals || {};
    vm.globals.__kernel = vm.globals.__kernel || {};
    (function() {
      var k = vm.globals.__kernel;
      k.hasCells = function() { return !!vm._cells; };
      k.hasExec = function() { return !!vm._exec; };
      k.hasErrors = function() { return !!vm._errors; };
      k.hasGui = function() { return !!vm._gui; };
      k.cellsLoaded = function() {
        return (vm._cellsLoaded || []).map(function(c) { return (c && c.name) ? c.name : String(c); });
      };
      k.errorCount = function() { return (vm._errors && vm._errors.length) ? vm._errors.length : 0; };
      k.lastError = function() { return (vm._gui && vm._gui.lastError && vm._gui.lastError._props) ? vm._gui.lastError._props : null; };
    })();

    // Also provide a small builtins accessor so language users can call __kernel() if builtins are factory-based.
    try {
      if (!vm.builtins.__kernel) {
        vm.builtins.__kernel = function() { return vm.globals.__kernel; };
      }
    } catch (e) {
      if (vm.debug) console.error("Failed to register builtins.__kernel", e);
    }
  } catch (e) {
    if (vm.debug) console.error("Failed to install __kernel diagnostics API", e);
  }

  // mark the kernel cell as loaded
  vm._cellsLoaded.push({ name: "cell1_kernel", time: (new Date()).toISOString() });
};
