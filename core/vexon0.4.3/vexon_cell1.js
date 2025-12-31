// vexon_cell1.js
// Core extension cell: GUI support (Window, Canvas, timers)

module.exports = function (vm) {

  vm.builtins["gui"] = () => {
    const gui = {};

    // ---- Window ----
    gui.Window = function (title, w, h) {
      return {
        _title: title,
        _w: w,
        _h: h,
        _children: [],
        add(child) {
          this._children.push(child);
        },
        show() {
          // Trigger Electron mode via CLI hook
          if (vm.onGuiInit) {
            vm.onGuiInit({
              title: this._title,
              width: this._w,
              height: this._h,
              children: this._children
            });
          }
        }
      };
    };

    // ---- Canvas ----
    gui.Canvas = function (w, h) {
      return {
        width: w,
        height: h,
        clear() {},
        rect(x, y, w, h) {},
        circle(x, y, r) {},
        text(t, x, y) {}
      };
    };

    // ---- Timers ----
    gui.setInterval = function (fn, ms) {
      return vm.setInterval(fn, ms);
    };

    gui.setTimeout = function (fn, ms) {
      return vm.setTimeout(fn, ms);
    };

    return gui;
  };

};
