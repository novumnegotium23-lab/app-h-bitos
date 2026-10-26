// Almacenamiento local (memoria del iPad) y combinación de copias entre dispositivos.
// Los datos viven en memoria y se guardan enteros en IndexedDB en cada cambio
// (localStorage solo como reserva, porque su límite de ~5 MB se llenaría en meses).
(function (global) {
  'use strict';

  var KEY = 'fichaje-residencia-v1';
  var IDB_NAME = 'fichaje-residencia';
  var IDB_STORE = 'kv';
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

  // Completa campos que falten para que unos datos incompletos no rompan la app.
  function normalize(d) {
    var base = emptyDb();
    if (!d || typeof d !== 'object') return base;
    if (!d.deviceId) d.deviceId = base.deviceId;
    if (!d.settings || typeof d.settings !== 'object') d.settings = base.settings;
    if (!d.meta || typeof d.meta !== 'object') d.meta = base.meta;
    if (!Array.isArray(d.employees)) d.employees = [];
    if (!Array.isArray(d.records)) d.records = [];
    d.employees = d.employees.filter(validEmployee);
    d.records = d.records.filter(validRecord);
    return d;
  }

  function validEmployee(e) {
    return !!e && typeof e.id === 'string' && typeof e.name === 'string' && typeof e.username === 'string';
  }

  function validRecord(r) {
    return !!r && typeof r.id === 'string' && typeof r.empId === 'string' &&
      (r.type === 'in' || r.type === 'out') && Number.isFinite(r.ts);
  }

  // ---------- IndexedDB ----------
  var idb = null;

  function idbOpen() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) { reject(new Error('IndexedDB no disponible')); return; }
      var req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(IDB_STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error('IndexedDB bloqueado')); };
    });
  }

  function idbRequest(mode, fn) {
    return new Promise(function (resolve, reject) {
      var tx = idb.transaction(IDB_STORE, mode);
      var req = fn(tx.objectStore(IDB_STORE));
      tx.oncomplete = function () { resolve(req.result); };
      tx.onerror = function () { reject(tx.error || req.error); };
      tx.onabort = function () { reject(tx.error || new Error('Guardado cancelado')); };
    });
  }

  var db = null;
  var loadError = null;
  var channel = global.BroadcastChannel ? new BroadcastChannel('fichaje-residencia') : null;

  function readLocalStorage() {
    var raw = null;
    try { raw = localStorage.getItem(KEY); } catch (e) { /* sin acceso */ }
    if (!raw) return { data: null };
    try {
      return { data: JSON.parse(raw), raw: raw };
    } catch (e) {
      // Nunca sobrescribir datos ilegibles: se apartan a otra clave para poder recuperarlos.
      try { localStorage.setItem(KEY + '-ilegible-' + Date.now(), raw); localStorage.removeItem(KEY); } catch (e2) { /* nada */ }
      return { data: null, error: 'Los datos guardados estaban dañados y se han apartado. Restaura la última copia de seguridad.' };
    }
  }

  function load() {
    loadError = null;
    return idbOpen().then(function (handle) {
      idb = handle;
      return idbRequest('readonly', function (s) { return s.get('db'); });
    }).catch(function (err) {
      console.warn('IndexedDB', err);
      idb = null;
      return null;
    }).then(function (stored) {
      if (stored) {
        db = normalize(stored);
        return db;
      }
      // Primera vez con IndexedDB: migrar lo que hubiera en localStorage.
      var ls = readLocalStorage();
      if (ls.error) loadError = ls.error;
      db = normalize(ls.data);
      if (ls.data && idb) {
        return save().then(function () {
          try { localStorage.removeItem(KEY); } catch (e) { /* nada */ }
          return db;
        }, function () { return db; });
      }
      return db;
    });
  }

  // Devuelve una promesa que falla si no se ha podido guardar.
  function save() {
    var p;
    if (idb) {
      p = idbRequest('readwrite', function (s) { return s.put(db, 'db'); });
    } else {
      p = new Promise(function (resolve) {
        localStorage.setItem(KEY, JSON.stringify(db));
        resolve();
      });
    }
    return p.then(function () {
      if (channel) channel.postMessage('changed');
    }, function (err) {
      console.error('Error al guardar', err);
      if (Store.onSaveError) Store.onSaveError(err);
      throw err;
    });
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
    onSaveError: null,
    get db() { return db; },
    get loadError() { return loadError; },
    get usingIndexedDb() { return !!idb; },

    // Avisa cuando otra pestaña (p. ej. en el ordenador) cambia los datos.
    onExternalChange: function (fn) {
      if (channel) channel.onmessage = function () { load().then(fn); };
    },

    isConfigured: function () { return !!db.admin; },

    setupAdmin: function (user, pass, centerName) {
      var c = makeCredentials(pass);
      db.admin = { user: normUser(user), salt: c.salt, hash: c.hash, updatedAt: now() };
      db.settings.centerName = centerName;
      db.settings.updatedAt = now();
      return save();
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
      return save();
    },

    setSettings: function (changes) {
      Object.assign(db.settings, changes, { updatedAt: now() });
      return save();
    },

    maxShiftMs: function () {
      var h = Number(db.settings.maxShiftHours);
      return h > 0 ? h * 3600 * 1000 : Hours.DEFAULT_MAX_SHIFT_MS;
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
      return save().then(function () { return emp; });
    },

    // Si dos dispositivos crearon el mismo usuario, vale la contraseña de cualquiera de ellos.
    authEmployee: function (username, pass) {
      var u = normUser(username);
      return db.employees.find(function (e) {
        return !e.deleted && e.active && e.username === u && checkPassword(e, pass);
      }) || null;
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

    // Promesa con el fichaje guardado. Si no se puede guardar, se deshace y la promesa falla.
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
      return save().then(function () { return rec; }, function (err) {
        var i = db.records.indexOf(rec);
        if (i >= 0) db.records.splice(i, 1);
        throw err;
      });
    },

    // Las correcciones guardan el valor anterior en el historial del fichaje.
    updateRecord: function (id, changes) {
      var rec = db.records.find(function (r) { return r.id === id; });
      if (!rec) return Promise.resolve(null);
      rec.history = (rec.history || []).concat([{
        action: 'edit', at: now(), empId: rec.empId, type: rec.type, ts: rec.ts, note: rec.note
      }]);
      Object.assign(rec, changes, { manual: true, updatedAt: now() });
      return save().then(function () { return rec; });
    },

    // Los borrados se marcan (no se eliminan) para que se propaguen al combinar copias
    // y para que quede constancia.
    deleteRecord: function (id, reason) {
      var rec = db.records.find(function (r) { return r.id === id; });
      if (!rec) return Promise.resolve();
      rec.history = (rec.history || []).concat([{ action: 'delete', at: now(), reason: reason || '' }]);
      rec.deleted = true;
      rec.updatedAt = now();
      return save();
    },

    // --- Copias de seguridad ---
    exportJson: function () {
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

    markBackup: function () {
      db.meta.lastBackup = now();
      return save();
    },

    // Combina una copia con los datos locales. Gana siempre la versión modificada más recientemente.
    // Se valida todo el archivo antes de tocar nada.
    importJson: function (text) {
      var parsed;
      try { parsed = JSON.parse(text); } catch (e) { throw new Error('El archivo está dañado o no es una copia.'); }
      if (!parsed || parsed.app !== 'fichaje-residencia' || !parsed.data || typeof parsed.data !== 'object') {
        throw new Error('El archivo no es una copia de esta aplicación.');
      }
      var src = parsed.data;
      if (!Array.isArray(src.employees) || !Array.isArray(src.records)) {
        throw new Error('La copia está incompleta.');
      }
      var employees = src.employees.filter(validEmployee);
      var records = src.records.filter(validRecord);
      var stats = {
        employees: 0, records: 0, adminChanged: false,
        skipped: (src.employees.length - employees.length) + (src.records.length - records.length),
        duplicateUsers: []
      };

      function mergeList(localList, incoming, counterKey) {
        var byId = new Map(localList.map(function (x) { return [x.id, x]; }));
        incoming.forEach(function (item) {
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

      mergeList(db.employees, employees, 'employees');
      mergeList(db.records, records, 'records');

      var seen = {};
      Store.employees(true).forEach(function (e) {
        if (seen[e.username] && stats.duplicateUsers.indexOf(e.username) < 0) stats.duplicateUsers.push(e.username);
        seen[e.username] = true;
      });

      var a = src.admin;
      if (a && typeof a.user === 'string' && typeof a.salt === 'string' && typeof a.hash === 'string' &&
          (!db.admin || (a.updatedAt || 0) > (db.admin.updatedAt || 0))) {
        stats.adminChanged = !!db.admin && (db.admin.user !== a.user || db.admin.hash !== a.hash);
        db.admin = a;
      }
      if (src.settings && typeof src.settings === 'object' &&
          (!db.settings.centerName || (src.settings.updatedAt || 0) > (db.settings.updatedAt || 0))) {
        db.settings = Object.assign({}, db.settings, src.settings);
      }
      return save().then(function () { return stats; });
    },

    // Tamaño aproximado de los datos guardados, en bytes.
    dataSize: function () {
      return JSON.stringify(db).length;
    },

    wipe: function () {
      db = emptyDb();
      try { localStorage.removeItem(KEY); } catch (e) { /* nada */ }
      return save();
    }
  };

  global.Store = Store;
})(window);
