// Almacenamiento local (memoria del iPad) y combinación de copias entre dispositivos.
(function (global) {
  'use strict';

  var KEY = 'fichaje-residencia-v1';
  var HASH_ROUNDS = 3000;

  function uid() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    crypto.getRandomValues(b);
    return Array.from(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }

  function hashPassword(pass, salt) {
    var h = salt + ':' + pass;
    for (var i = 0; i < HASH_ROUNDS; i++) h = sha256(salt + h);
    return h;
  }

  function makeCredentials(pass) {
    var salt = uid();
    return { salt: salt, hash: hashPassword(pass, salt) };
  }

  function checkPassword(obj, pass) {
    return !!obj && !!obj.salt && hashPassword(pass, obj.salt) === obj.hash;
  }

  function normUser(u) {
    return String(u || '').trim().toLowerCase();
  }

  function emptyDb() {
    return {
      version: 1,
      deviceId: uid(),
      settings: { centerName: '' },
      admin: null,
      employees: [],
      records: [],
      meta: { lastBackup: null }
    };
  }

  var db = null;

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      db = raw ? JSON.parse(raw) : emptyDb();
    } catch (e) {
      console.error(e);
      db = emptyDb();
    }
    if (!db.meta) db.meta = { lastBackup: null };
    if (!db.settings) db.settings = { centerName: '' };
    return db;
  }

  function save() {
    localStorage.setItem(KEY, JSON.stringify(db));
  }

  // Pide al navegador que no borre los datos automáticamente.
  function requestPersistence() {
    if (navigator.storage && navigator.storage.persist) {
      return navigator.storage.persist().catch(function () { return false; });
    }
    return Promise.resolve(false);
  }

  function now() { return Date.now(); }

  var Store = {
    load: load,
    save: save,
    requestPersistence: requestPersistence,
    get db() { return db; },

    isConfigured: function () { return !!db.admin; },

    setupAdmin: function (user, pass, centerName) {
      var c = makeCredentials(pass);
      db.admin = { user: normUser(user), salt: c.salt, hash: c.hash, updatedAt: now() };
      db.settings.centerName = centerName;
      db.settings.updatedAt = now();
      save();
    },

    checkAdmin: function (user, pass) {
      return !!db.admin && normUser(user) === db.admin.user && checkPassword(db.admin, pass);
    },

    updateAdmin: function (user, newPass) {
      db.admin.user = normUser(user);
      if (newPass) {
        var c = makeCredentials(newPass);
        db.admin.salt = c.salt;
        db.admin.hash = c.hash;
      }
      db.admin.updatedAt = now();
      save();
    },

    setCenterName: function (name) {
      db.settings.centerName = name;
      db.settings.updatedAt = now();
      save();
    },

    // --- Trabajadores ---
    employees: function (includeInactive) {
      return db.employees
        .filter(function (e) { return !e.deleted && (includeInactive || e.active); })
        .sort(function (a, b) { return a.name.localeCompare(b.name, 'es'); });
    },

    employee: function (id) {
      return db.employees.find(function (e) { return e.id === id; }) || null;
    },

    usernameTaken: function (username, exceptId) {
      var u = normUser(username);
      return db.employees.some(function (e) { return !e.deleted && e.username === u && e.id !== exceptId; });
    },

    saveEmployee: function (data) {
      var emp = data.id ? Store.employee(data.id) : null;
      if (!emp) {
        emp = { id: uid(), createdAt: now() };
        db.employees.push(emp);
      }
      emp.name = data.name.trim();
      emp.username = normUser(data.username);
      emp.role = (data.role || '').trim();
      emp.active = !!data.active;
      if (data.pass) {
        var c = makeCredentials(data.pass);
        emp.salt = c.salt;
        emp.hash = c.hash;
      }
      emp.updatedAt = now();
      save();
      return emp;
    },

    authEmployee: function (username, pass) {
      var u = normUser(username);
      var emp = db.employees.find(function (e) { return !e.deleted && e.active && e.username === u; });
      return emp && checkPassword(emp, pass) ? emp : null;
    },

    // --- Fichajes ---
    records: function (empId) {
      return db.records
        .filter(function (r) { return !r.deleted && (!empId || r.empId === empId); })
        .sort(function (a, b) { return a.ts - b.ts; });
    },

    lastRecord: function (empId) {
      var list = Store.records(empId);
      return list.length ? list[list.length - 1] : null;
    },

    addRecord: function (empId, type, ts, opts) {
      opts = opts || {};
      var rec = {
        id: uid(),
        empId: empId,
        type: type,
        ts: ts,
        device: db.deviceId,
        manual: !!opts.manual,
        note: opts.note || '',
        createdAt: now(),
        updatedAt: now()
      };
      db.records.push(rec);
      save();
      return rec;
    },

    updateRecord: function (id, changes) {
      var rec = db.records.find(function (r) { return r.id === id; });
      if (!rec) return null;
      Object.assign(rec, changes, { manual: true, updatedAt: now() });
      save();
      return rec;
    },

    // Los borrados se marcan (no se eliminan) para que se propaguen al combinar copias.
    deleteRecord: function (id) {
      var rec = db.records.find(function (r) { return r.id === id; });
      if (rec) {
        rec.deleted = true;
        rec.updatedAt = now();
        save();
      }
    },

    // --- Copias de seguridad ---
    exportJson: function () {
      db.meta.lastBackup = now();
      save();
      return JSON.stringify({
        app: 'fichaje-residencia',
        exportedAt: new Date().toISOString(),
        fromDevice: db.deviceId,
        data: {
          version: db.version,
          settings: db.settings,
          admin: db.admin,
          employees: db.employees,
          records: db.records
        }
      }, null, 2);
    },

    // Combina una copia con los datos locales. Gana siempre la versión modificada más recientemente.
    importJson: function (text) {
      var parsed = JSON.parse(text);
      if (!parsed || parsed.app !== 'fichaje-residencia' || !parsed.data) {
        throw new Error('El archivo no es una copia de esta aplicación.');
      }
      var src = parsed.data;
      var stats = { employees: 0, records: 0 };

      function mergeList(localList, incoming, counterKey) {
        var byId = new Map(localList.map(function (x) { return [x.id, x]; }));
        (incoming || []).forEach(function (item) {
          if (!item || !item.id) return;
          var cur = byId.get(item.id);
          if (!cur) {
            localList.push(item);
            byId.set(item.id, item);
            stats[counterKey]++;
          } else if ((item.updatedAt || 0) > (cur.updatedAt || 0)) {
            Object.keys(cur).forEach(function (k) { delete cur[k]; });
            Object.assign(cur, item);
            stats[counterKey]++;
          }
        });
      }

      mergeList(db.employees, src.employees, 'employees');
      mergeList(db.records, src.records, 'records');

      if (src.admin && (!db.admin || (src.admin.updatedAt || 0) > (db.admin.updatedAt || 0))) {
        db.admin = src.admin;
      }
      if (src.settings && (!db.settings.centerName || (src.settings.updatedAt || 0) > (db.settings.updatedAt || 0))) {
        db.settings = Object.assign({}, db.settings, src.settings);
      }
      save();
      return stats;
    },

    wipe: function () {
      localStorage.removeItem(KEY);
      load();
    }
  };

  global.Store = Store;
})(window);
