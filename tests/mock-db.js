/* Test double for the artifact `db` capability.
   Mirrors the shape the real capability exposes (doc/collection, get/set/
   update/delete, onSnapshot) and proxies every operation to the node-side
   store through a binding, so several browser contexts share one database.
   Snapshots poll and fire only on change, which is enough for a test. */
(function () {
  function call(op, path, data) { return window.__db({ op: op, path: path, data: data }); }
  function clone(o) { return o ? JSON.parse(JSON.stringify(o)) : undefined; }

  function snap(path, data) {
    return {
      id: path.split("/").pop(), path: path, exists: !!data,
      data: function () { return clone(data); },
      metadata: { fromCache: false, hasPendingWrites: false }
    };
  }
  function watch(read, emit) {
    var last = " ", dead = false;
    var tick = function () {
      if (dead) return;
      read().then(function (v) {
        var s = JSON.stringify(v);
        if (s !== last) { last = s; emit(v); }
      });
    };
    tick();
    var h = setInterval(tick, 110);
    return function () { dead = true; clearInterval(h); };
  }
  function docRef(path) {
    return {
      id: path.split("/").pop(), path: path,
      get: function () { return call("get", path).then(function (d) { return snap(path, d); }); },
      set: function (d) { return call("set", path, d); },
      update: function (d) { return call("update", path, d); },
      "delete": function () { return call("del", path); },
      collection: function (sub) { return colRef(path + "/" + sub); },
      onSnapshot: function (cb) {
        return watch(function () { return call("get", path); }, function (d) { cb(snap(path, d)); });
      }
    };
  }
  function colRef(path) {
    return {
      path: path,
      doc: function (id) { return docRef(path + "/" + id); },
      onSnapshot: function (cb) {
        return watch(function () { return call("query", path); }, function (rows) {
          cb({
            docs: rows.map(function (r) { return snap(path + "/" + r.id, r.data); }),
            size: rows.length, empty: !rows.length,
            docChanges: function () { return []; },
            metadata: { fromCache: false, hasPendingWrites: false }
          });
        });
      }
    };
  }
  window.claude = {
    use: function (name) {
      return Promise.resolve(name === "db" ? { doc: docRef, collection: colRef } : null);
    }
  };
})();
