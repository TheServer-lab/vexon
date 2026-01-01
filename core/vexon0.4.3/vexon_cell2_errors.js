// vexon_cell2_errors.js
// Error cell: installs vm._errors, recordError, clearErrors, vm._exec guard, and run wrapper.
// Extended features: ids, severity, listeners, async wrappers, exportErrors, trimming, filters.

module.exports = function(vm) {
  if (!vm || typeof vm !== 'object') return;

  // idempotent guard
  vm._cells = vm._cells || {};
  if (vm._cells.cell2_errors) return;
  vm._cells.cell2_errors = true;

  // errors array & config
  vm._errors = vm._errors || [];
  vm._errorsMax = (typeof vm._errorsMax === 'number' && vm._errorsMax > 0) ? vm._errorsMax : 1000;

  // listeners for error events
  vm._errorListeners = vm._errorListeners || [];

  // tiny unique id generator (time + random)
  function genId() {
    return String(Date.now()) + "-" + Math.floor(Math.random()*1000000);
  }

  // normalize incoming error-like objects
  function normalizeError(err) {
    var message = (err && err.message) ? String(err.message) : String(err || '');
    var stack = (err && err.stack) ? String(err.stack) : null;
    return { message: message, stack: stack };
  }

  // internal: notify listeners (fail-safe)
  function notifyListeners(item) {
    try {
      var ls = vm._errorListeners || [];
      for (var i = 0; i < ls.length; i++) {
        try { ls[i](item); } catch (e) { if (vm.debug) console.error('error listener failed', e); }
      }
    } catch (e) { if (vm.debug) console.error('notifyListeners failed', e); }
  }

  // recordError: push structured error and optionally show GUI error widget
  vm.recordError = vm.recordError || function(err, source, opts) {
    try {
      opts = opts || {};
      var norm = normalizeError(err);
      var severity = String(opts.severity || 'error');
      var item = {
        id: genId(),
        message: norm.message,
        stack: norm.stack,
        time: (new Date()).toISOString(),
        source: source || (opts.source || null),
        severity: severity,
        handled: !!opts.handled,
        meta: opts.meta || null
      };

      vm._errors.push(item);

      // trim if exceeding max
      try {
        if (vm._errorsMax && vm._errors.length > vm._errorsMax) {
          // remove oldest
          vm._errors.splice(0, vm._errors.length - vm._errorsMax);
        }
      } catch (e) { if (vm.debug) console.error('error trim failed', e); }

      // GUI hook
      try {
        if (vm._gui && typeof vm._gui.showError === 'function') {
          var fakeErr = { message: item.message, stack: item.stack };
          vm._gui.showError(fakeErr);
        }
      } catch (e) {
        if (vm.debug) console.error('vm.recordError: gui.showError failed', e);
      }

      // notify listeners
      notifyListeners(item);

      return item;
    } catch (e) {
      if (vm.debug) console.error('vm.recordError failed', e);
      return null;
    }
  };

  // clearErrors: clear buffer and clear GUI if present
  vm.clearErrors = vm.clearErrors || function() {
    try {
      vm._errors.length = 0;
      if (vm._gui && typeof vm._gui.clearError === 'function') {
        try { vm._gui.clearError(); } catch (e) { if (vm.debug) console.error('clearError failed', e); }
      }
    } catch (e) { if (vm.debug) console.error('vm.clearErrors failed', e); }
  };

  // errorCount helper
  vm.errorCount = vm.errorCount || function() {
    return (vm._errors && vm._errors.length) ? vm._errors.length : 0;
  };

  // lastError helper (returns the last recorded item's props)
  vm.lastError = (typeof vm.lastError === 'function') ? vm.lastError : function() {
    if (!vm._errors || vm._errors.length === 0) return null;
    return vm._errors[vm._errors.length - 1];
  };

  // getErrors(filter) -> copy array; filter may have { source, severity, sinceISO }
  vm.getErrors = vm.getErrors || function(filter) {
    try {
      filter = filter || {};
      var res = (vm._errors || []).slice(0);
      if (filter.source) {
        res = res.filter(function(x) { return x && x.source === filter.source; });
      }
      if (filter.severity) {
        res = res.filter(function(x) { return x && x.severity === filter.severity; });
      }
      if (filter.sinceISO) {
        res = res.filter(function(x) { return x && x.time && x.time >= filter.sinceISO; });
      }
      return res.map(function(x) { return Object.assign({}, x); });
    } catch (e) {
      if (vm.debug) console.error('vm.getErrors failed', e);
      return [];
    }
  };

  // markErrorHandled(id) -> mark handled: true
  vm.markErrorHandled = vm.markErrorHandled || function(id) {
    try {
      if (!vm._errors) return false;
      for (var i = vm._errors.length - 1; i >= 0; i--) {
        if (vm._errors[i].id === id) {
          vm._errors[i].handled = true;
          return true;
        }
      }
      return false;
    } catch (e) { if (vm.debug) console.error('markErrorHandled failed', e); return false; }
  };

  // onError/offError listener APIs
  vm.onError = vm.onError || function(cb) {
    try {
      if (typeof cb !== 'function') return false;
      vm._errorListeners = vm._errorListeners || [];
      vm._errorListeners.push(cb);
      return true;
    } catch (e) { if (vm.debug) console.error('onError failed', e); return false; }
  };

  vm.offError = vm.offError || function(cb) {
    try {
      if (typeof cb !== 'function') return false;
      vm._errorListeners = vm._errorListeners || [];
      var idx = vm._errorListeners.indexOf(cb);
      if (idx >= 0) vm._errorListeners.splice(idx, 1);
      return true;
    } catch (e) { if (vm.debug) console.error('offError failed', e); return false; }
  };

  // exec guard: execute a function and capture errors into vm._errors
  // Usage: vm._exec(function(){ /* code */ }, "optional-source")
  vm._exec = vm._exec || function(fn, source) {
    if (typeof fn !== 'function') {
      // not a function — nothing to execute; return as-is
      return fn;
    }
    try {
      return fn();
    } catch (e) {
      try { vm.recordError(e, source || 'vm._exec'); } catch (er) { if (vm.debug) console.error('error recording failed', er); }
      // rethrow so callers / VM can still handle it
      throw e;
    }
  };

  // helpers for async handling: wrapAsync(fn) and handlePromise(p, source)
  vm.wrapAsync = vm.wrapAsync || function(fn, source) {
    if (typeof fn !== 'function') return fn;
    return function() {
      try {
        var p = Promise.resolve().then(function() { return fn.apply(this, arguments); }.bind(this));
        p = p.catch(function(err) {
          try { vm.recordError(err, source || 'wrapAsync'); } catch (e) { if (vm.debug) console.error('wrapAsync record failed', e); }
          // rethrow to allow further handling upstream
          throw err;
        });
        return p;
      } catch (e) {
        try { vm.recordError(e, source || 'wrapAsync'); } catch (er) { if (vm.debug) console.error('wrapAsync record failed', er); }
        return Promise.reject(e);
      }
    };
  };

  vm.handlePromise = vm.handlePromise || function(promise, source) {
    try {
      if (!promise || typeof promise.then !== 'function') return promise;
      promise.catch(function(err) {
        try { vm.recordError(err, source || 'promise'); } catch (e) { if (vm.debug) console.error('handlePromise record failed', e); }
      });
      return promise;
    } catch (e) { if (vm.debug) console.error('handlePromise failed', e); return promise; }
  };

  // exportErrors: write JSON to disk (node/electron main only). Safe if fs missing.
  vm.exportErrors = vm.exportErrors || function(targetPath, opts) {
    try {
      opts = opts || {};
      var fs = null;
      try { fs = require('fs'); } catch (e) { fs = null; }
      if (!fs) {
        if (vm.debug) console.warn('exportErrors: fs not available in this environment');
        return false;
      }
      var out = JSON.stringify({ errors: vm._errors || [], meta: opts.meta || null }, null, 2);
      fs.writeFileSync(String(targetPath), out, 'utf8');
      return true;
    } catch (e) {
      if (vm.debug) console.error('exportErrors failed', e);
      return false;
    }
  };

  // Wrap vm.run so uncaught exceptions are recorded (idempotent)
  if (typeof vm.run === 'function' && !vm._errorsRunPatched) {
    var _origRun = vm.run;
    vm.run = function() {
      try {
        return _origRun.apply(vm, arguments);
      } catch (e) {
        try { vm.recordError(e, 'vm.run'); } catch (er) { if (vm.debug) console.error('recordError failed in run wrapper', er); }
        // rethrow (kernel's vm.run wrapper may also show GUI; we don't swallow)
        throw e;
      }
    };
    // marker to avoid double-wrapping
    vm._errorsRunPatched = true;
  }

  // convenience: ensure vm._cellLoadErrors exists (keeps parallel records)
  vm._cellLoadErrors = vm._cellLoadErrors || vm._cellLoadErrors;

  // done — record this cell as loaded (vm._cellsLoaded is managed by kernel typically)
  try {
    if (Array.isArray(vm._cellsLoaded)) {
      // avoid duplicate entry if it exists
      var found = (vm._cellsLoaded || []).some(function(x) { return x && x.name === 'cell2_errors'; });
      if (!found) vm._cellsLoaded.push({ name: "cell2_errors", time: (new Date()).toISOString() });
    }
  } catch (e) {
    if (vm.debug) console.error('failed to push cell2_errors to _cellsLoaded', e);
  }
};
