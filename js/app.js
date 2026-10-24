(function () {
  'use strict';

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.from((root || document).querySelectorAll(sel)); };

  var ADMIN_IDLE_MS = 5 * 60 * 1000;
  var RESULT_SECONDS = 8;
  var MAX_FAILS = 5;
  var LOCK_MS = 30 * 1000;

  var adminLogged = false;
  var adminIdleTimer = null;
  var resultTimer = null;
  var fails = 0;
  var lockedUntil = 0;
  var editingRecordId = null;
  var editingEmployeeId = null;

  // ---------- Utilidades ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fDate(ts) { return new Date(ts).toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }); }
  function fTime(ts) { return new Date(ts).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }); }
  function fDateTime(ts) { return new Date(ts).toLocaleString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
  function timeInput(ts) { var d = new Date(ts); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('show'); }, 3000);
  }

  function show(view) {
    $$('.view').forEach(function (v) { v.hidden = v.id !== 'view-' + view; });
    window.scrollTo(0, 0);
  }

  function tickClock() {
    var d = new Date();
    $('#clockTime').textContent = d.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
    $('#clockDate').textContent = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  }

  function renderCenter() {
    var name = Store.db.settings.centerName || 'Residencia';
    $('#centerName').textContent = name;
    document.title = 'Fichaje · ' + name;
  }

  // ---------- Configuración inicial ----------
  $('#setupForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    if (f.pass.value !== f.pass2.value) { toast('Las contraseñas no coinciden'); return; }
    Store.setupAdmin(f.user.value, f.pass.value, f.center.value.trim());
    f.reset();
    renderCenter();
    toast('Administrador creado. Ahora da de alta a los trabajadores.');
    enterAdmin();
    switchTab('employees');
  });

  // ---------- Fichaje ----------
  var punchType = 'in';
  $$('#punchForm button[type=submit]').forEach(function (b) {
    b.addEventListener('click', function () { punchType = b.value; });
  });

  $('#punchForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    var type = (e.submitter && e.submitter.value) || punchType;
    var msg = $('#punchMsg');
    msg.className = 'msg error';

    if (Date.now() < lockedUntil) {
      msg.textContent = 'Demasiados intentos. Espera ' + Math.ceil((lockedUntil - Date.now()) / 1000) + ' s.';
      return;
    }

    var emp = Store.authEmployee(f.user.value, f.pass.value);
    if (!emp) {
      fails++;
      if (fails >= MAX_FAILS) { lockedUntil = Date.now() + LOCK_MS; fails = 0; }
      msg.textContent = 'Usuario o contraseña incorrectos.';
      f.pass.value = '';
      f.pass.focus();
      return;
    }
    fails = 0;

    var last = Store.lastRecord(emp.id);
    var nowTs = Date.now();
    if (last && last.type === type && nowTs - last.ts < 2 * 60 * 1000) {
      msg.textContent = 'Ya registraste una ' + (type === 'in' ? 'entrada' : 'salida') + ' hace un momento (' + fTime(last.ts) + ').';
      f.pass.value = '';
      return;
    }
    if (type === 'in' && last && last.type === 'in' && nowTs - last.ts < Hours.MAX_OPEN_MS) {
      if (!confirm('Tienes una entrada abierta desde las ' + fTime(last.ts) + ' sin salida.\n¿Registrar una nueva ENTRADA de todas formas?\n\n(Si te olvidaste de fichar la salida, avisa a administración.)')) return;
    }
    if (type === 'out' && (!last || last.type === 'out')) {
      if (!confirm('No tienes ninguna entrada abierta.\n¿Registrar SALIDA de todas formas?')) return;
    }

    var rec = Store.addRecord(emp.id, type, nowTs);
    f.reset();
    msg.textContent = '';
    showResult(emp, rec);
  });

  function showResult(emp, rec) {
    var isIn = rec.type === 'in';
    var icon = $('#resultIcon');
    icon.className = 'result-icon ' + rec.type;
    icon.textContent = isIn ? '→' : '←';
    $('#resultTitle').textContent = (isIn ? 'Entrada' : 'Salida') + ' registrada a las ' + fTime(rec.ts);
    $('#resultWho').textContent = (isIn ? '¡Buen turno, ' : '¡Hasta luego, ') + emp.name.split(' ')[0] + '!';

    var sess = Hours.sessions(Store.records(emp.id), Date.now());
    var nowTs = Date.now();
    ['today', 'week', 'month'].forEach(function (p) {
      var r = Hours.range(p);
      var id = { today: '#resToday', week: '#resWeek', month: '#resMonth' }[p];
      $(id).textContent = Hours.fmt(Hours.workedMs(sess, r.from, r.to, nowTs));
    });

    show('result');
    var left = RESULT_SECONDS;
    $('#resCountdown').textContent = left;
    clearInterval(resultTimer);
    resultTimer = setInterval(function () {
      left--;
      $('#resCountdown').textContent = left;
      if (left <= 0) backToKiosk();
    }, 1000);
  }

  function backToKiosk() {
    clearInterval(resultTimer);
    adminLogged = false;
    clearTimeout(adminIdleTimer);
    $('#punchMsg').textContent = '';
    show('kiosk');
  }

  // ---------- Login administrador ----------
  $('#adminLoginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    if (Date.now() < lockedUntil) {
      $('#adminLoginMsg').textContent = 'Demasiados intentos. Espera unos segundos.';
      return;
    }
    if (Store.checkAdmin(f.user.value, f.pass.value)) {
      fails = 0;
      f.reset();
      $('#adminLoginMsg').textContent = '';
      enterAdmin();
    } else {
      fails++;
      if (fails >= MAX_FAILS) { lockedUntil = Date.now() + LOCK_MS; fails = 0; }
      f.pass.value = '';
      $('#adminLoginMsg').textContent = 'Usuario o contraseña incorrectos.';
    }
  });

  function enterAdmin() {
    adminLogged = true;
    show('admin');
    bumpAdminIdle();
    switchTab('summary');
  }

  function bumpAdminIdle() {
    if (!adminLogged) return;
    clearTimeout(adminIdleTimer);
    adminIdleTimer = setTimeout(function () {
      $$('dialog[open]').forEach(function (d) { d.close(); });
      toast('Sesión de administración cerrada por inactividad');
      backToKiosk();
    }, ADMIN_IDLE_MS);
  }
  ['pointerdown', 'keydown'].forEach(function (ev) { document.addEventListener(ev, bumpAdminIdle, true); });

  // ---------- Panel: pestañas ----------
  var currentTab = 'summary';
  function switchTab(tab) {
    currentTab = tab;
    $$('.tab').forEach(function (t) { t.classList.toggle('active', t.dataset.tab === tab); });
    $$('.tabpanel').forEach(function (p) { p.hidden = p.dataset.panel !== tab; });
    renderAdmin();
  }
  $$('.tab').forEach(function (t) { t.addEventListener('click', function () { switchTab(t.dataset.tab); }); });

  function renderAdmin() {
    if (!adminLogged) return;
    if (currentTab === 'summary') renderSummary();
    if (currentTab === 'records') renderRecords();
    if (currentTab === 'employees') renderEmployees();
    if (currentTab === 'data') renderData();
  }

  // ---------- Panel: horas ----------
  function summaryRange() {
    var p = $('#sumPeriod').value;
    $$('.custom-range').forEach(function (l) { l.hidden = p !== 'custom'; });
    return Hours.range(p, $('#sumFrom').value, $('#sumTo').value);
  }

  function summaryRows() {
    var r = summaryRange();
    var nowTs = Date.now();
    return Store.employees(true).map(function (emp) {
      var recs = Store.records(emp.id);
      var sess = Hours.sessions(recs, nowTs);
      var ms = Hours.workedMs(sess, r.from, r.to, nowTs);
      var days = Object.values(Hours.byDay(sess, r.from, r.to, nowTs)).filter(function (d) { return d.ms > 0; }).length;
      var issues = Hours.issuesIn(sess, r.from, r.to);
      var running = sess.find(function (s) { return s.running; });
      return { emp: emp, ms: ms, days: days, issues: issues, running: running };
    }).filter(function (row) { return row.emp.active || row.ms > 0; });
  }

  function renderSummary() {
    var rows = summaryRows();
    var total = 0;
    var html = rows.map(function (row) {
      total += row.ms;
      var state = row.running
        ? '<span class="pill in">Dentro desde ' + fTime(row.running.start) + '</span>'
        : '<span class="pill off">Fuera</span>';
      var warn = row.issues.length
        ? '<span class="pill warn">' + row.issues.length + ' fichaje' + (row.issues.length > 1 ? 's' : '') + ' incompleto' + (row.issues.length > 1 ? 's' : '') + '</span>'
        : '';
      return '<tr class="' + (row.emp.active ? '' : 'inactive') + '">' +
        '<td><b>' + esc(row.emp.name) + '</b>' + (row.emp.role ? '<br><span class="muted small">' + esc(row.emp.role) + '</span>' : '') + '</td>' +
        '<td>' + state + '</td>' +
        '<td class="num">' + row.days + '</td>' +
        '<td class="num"><b>' + Hours.fmt(row.ms) + '</b></td>' +
        '<td>' + warn + '</td>' +
        '<td><div class="row-actions"><button class="btn small" data-detail="' + row.emp.id + '">Ver detalle</button></div></td>' +
        '</tr>';
    }).join('');
    $('#sumBody').innerHTML = html || '<tr><td colspan="6" class="empty">Aún no hay trabajadores. Añádelos en la pestaña «Trabajadores».</td></tr>';
    $('#sumTotal').textContent = Hours.fmt(total);
  }

  ['#sumPeriod', '#sumFrom', '#sumTo'].forEach(function (s) { $(s).addEventListener('change', renderSummary); });

  $('#sumBody').addEventListener('click', function (e) {
    var b = e.target.closest('[data-detail]');
    if (b) openDetail(b.dataset.detail);
  });

  function openDetail(empId) {
    var emp = Store.employee(empId);
    var r = summaryRange();
    var nowTs = Date.now();
    var sess = Hours.sessions(Store.records(empId), nowTs);
    var days = Hours.byDay(sess, r.from, r.to, nowTs);
    var issues = Hours.issuesIn(sess, r.from, r.to);
    var keys = Object.keys(days).sort().reverse();
    var total = 0;
    var html = keys.map(function (k) {
      var d = days[k];
      total += d.ms;
      var parts = d.parts.map(function (p) { return fTime(p[0]) + '–' + (p[2] ? 'ahora' : fTime(p[1])); }).join(', ');
      return '<tr><td>' + fDate(d.parts[0][0]) + '</td><td>' + parts + '</td><td class="num">' + Hours.fmt(d.ms) + '</td></tr>';
    }).join('');
    html += issues.map(function (s) {
      var t = s.start != null ? s.start : s.end;
      return '<tr><td>' + fDate(t) + '</td><td><span class="pill warn">' + esc(s.issue) + ' (' + fTime(t) + ')</span> <span class="muted small">Corrígelo en «Fichajes»</span></td><td class="num">—</td></tr>';
    }).join('');
    $('#detailTitle').textContent = emp.name + ' · ' + Hours.fmt(total) + ' h';
    $('#detailBody').innerHTML = html || '<tr><td colspan="3" class="empty">Sin fichajes en este periodo.</td></tr>';
    $('#dlgDetail').showModal();
  }

  // ---------- Panel: fichajes ----------
  function initRecordFilters() {
    var now = new Date();
    $('#recFrom').value = Hours.dateKey(new Date(now.getFullYear(), now.getMonth(), 1));
    $('#recTo').value = Hours.dateKey(now);
  }

  function fillEmployeeSelect(sel, withAll, selected) {
    var opts = withAll ? '<option value="">Todos</option>' : '';
    opts += Store.employees(true).map(function (e) {
      return '<option value="' + e.id + '"' + (e.id === selected ? ' selected' : '') + '>' + esc(e.name) + (e.active ? '' : ' (baja)') + '</option>';
    }).join('');
    sel.innerHTML = opts;
  }

  function filteredRecords() {
    var empId = $('#recEmp').value;
    var r = Hours.range('custom', $('#recFrom').value, $('#recTo').value);
    return Store.records(empId || null).filter(function (x) { return x.ts >= r.from && x.ts < r.to; });
  }

  function renderRecords() {
    var sel = $('#recEmp');
    var cur = sel.value;
    fillEmployeeSelect(sel, true, cur);
    sel.value = cur;
    var list = filteredRecords().reverse();
    $('#recBody').innerHTML = list.map(function (r) {
      var emp = Store.employee(r.empId);
      return '<tr>' +
        '<td>' + fDate(r.ts) + '</td>' +
        '<td>' + fTime(r.ts) + '</td>' +
        '<td>' + esc(emp ? emp.name : '¿?') + '</td>' +
        '<td><span class="pill ' + r.type + '">' + (r.type === 'in' ? 'Entrada' : 'Salida') + '</span></td>' +
        '<td>' + (r.manual ? '<span class="pill warn">Manual</span>' : '<span class="muted small">Fichado</span>') + '</td>' +
        '<td class="small">' + esc(r.note) + '</td>' +
        '<td><div class="row-actions">' +
          '<button class="btn small" data-edit-rec="' + r.id + '">Editar</button>' +
          '<button class="btn small" data-del-rec="' + r.id + '">Borrar</button>' +
        '</div></td></tr>';
    }).join('') || '<tr><td colspan="7" class="empty">No hay fichajes en este periodo.</td></tr>';
  }

  ['#recEmp', '#recFrom', '#recTo'].forEach(function (s) { $(s).addEventListener('change', renderRecords); });

  $('#recBody').addEventListener('click', function (e) {
    var ed = e.target.closest('[data-edit-rec]');
    var del = e.target.closest('[data-del-rec]');
    if (ed) openRecordDialog(ed.dataset.editRec);
    if (del && confirm('¿Borrar este fichaje?')) {
      Store.deleteRecord(del.dataset.delRec);
      renderRecords();
      toast('Fichaje borrado');
    }
  });

  function openRecordDialog(id) {
    editingRecordId = id || null;
    var f = $('#recordForm');
    f.reset();
    var rec = id ? Store.db.records.find(function (r) { return r.id === id; }) : null;
    fillEmployeeSelect(f.empId, false, rec ? rec.empId : $('#recEmp').value);
    $('#dlgRecordTitle').textContent = rec ? 'Editar fichaje' : 'Fichaje manual';
    var ts = rec ? rec.ts : Date.now();
    f.type.value = rec ? rec.type : 'in';
    f.date.value = Hours.dateKey(ts);
    f.time.value = timeInput(ts);
    f.note.value = rec ? rec.note : '';
    $('#dlgRecord').showModal();
  }

  $('#recordForm').addEventListener('submit', function (e) {
    if (e.submitter && e.submitter.value === 'cancel') return;
    var f = e.target;
    if (!f.empId.value) { e.preventDefault(); toast('Primero da de alta algún trabajador'); return; }
    var p = f.date.value.split('-').map(Number);
    var t = f.time.value.split(':').map(Number);
    var ts = new Date(p[0], p[1] - 1, p[2], t[0], t[1]).getTime();
    var data = { empId: f.empId.value, type: f.type.value, ts: ts, note: f.note.value.trim() };
    if (editingRecordId) Store.updateRecord(editingRecordId, data);
    else Store.addRecord(data.empId, data.type, data.ts, { manual: true, note: data.note });
    toast('Fichaje guardado');
    renderAdmin();
  });

  // ---------- Panel: trabajadores ----------
  function renderEmployees() {
    var showInactive = $('#empShowInactive').checked;
    var list = Store.employees(showInactive);
    $('#empBody').innerHTML = list.map(function (e) {
      return '<tr class="' + (e.active ? '' : 'inactive') + '">' +
        '<td><b>' + esc(e.name) + '</b></td>' +
        '<td>' + esc(e.username) + '</td>' +
        '<td>' + esc(e.role) + '</td>' +
        '<td>' + (e.active ? '<span class="pill in">Activo</span>' : '<span class="pill off">Baja</span>') + '</td>' +
        '<td><div class="row-actions"><button class="btn small" data-edit-emp="' + e.id + '">Editar</button></div></td>' +
        '</tr>';
    }).join('') || '<tr><td colspan="5" class="empty">No hay trabajadores. Pulsa «+ Nuevo trabajador».</td></tr>';
  }

  $('#empShowInactive').addEventListener('change', renderEmployees);
  $('#empBody').addEventListener('click', function (e) {
    var b = e.target.closest('[data-edit-emp]');
    if (b) openEmployeeDialog(b.dataset.editEmp);
  });

  function openEmployeeDialog(id) {
    editingEmployeeId = id || null;
    var f = $('#employeeForm');
    f.reset();
    $('#empMsg').textContent = '';
    var emp = id ? Store.employee(id) : null;
    $('#dlgEmployeeTitle').textContent = emp ? 'Editar trabajador' : 'Nuevo trabajador';
    $('#empPassLabel').textContent = emp ? 'Nueva contraseña (dejar vacío para no cambiarla)' : 'Contraseña (mínimo 4 caracteres)';
    f.pass.required = !emp;
    if (emp) {
      f.name.value = emp.name;
      f.username.value = emp.username;
      f.role.value = emp.role || '';
      f.active.checked = emp.active;
    }
    $('#dlgEmployee').showModal();
  }

  $('#employeeForm').addEventListener('submit', function (e) {
    if (e.submitter && e.submitter.value === 'cancel') return;
    var f = e.target;
    var err = '';
    if (/\s/.test(f.username.value.trim())) err = 'El usuario no puede tener espacios.';
    else if (Store.usernameTaken(f.username.value, editingEmployeeId)) err = 'Ese usuario ya existe.';
    else if (f.pass.value && f.pass.value.length < 4) err = 'La contraseña debe tener al menos 4 caracteres.';
    if (err) { e.preventDefault(); $('#empMsg').textContent = err; return; }
    Store.saveEmployee({
      id: editingEmployeeId,
      name: f.name.value,
      username: f.username.value,
      role: f.role.value,
      pass: f.pass.value,
      active: f.active.checked
    });
    toast('Trabajador guardado');
    renderAdmin();
  });

  // ---------- Panel: datos ----------
  function stamp() {
    var d = new Date();
    return Hours.dateKey(d) + '_' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
  }

  // En el iPad abre el menú de compartir (AirDrop, Archivos, correo…). Si no, descarga el archivo.
  function deliverFile(name, content, mime) {
    var blob = new Blob([content], { type: mime });
    var file;
    try { file = new File([blob], name, { type: mime }); } catch (e) { file = null; }
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      return navigator.share({ files: [file], title: name }).catch(function (err) {
        if (err && err.name !== 'AbortError') download(blob, name);
      });
    }
    download(blob, name);
    return Promise.resolve();
  }

  function download(blob, name) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
  }

  function csv(rows) {
    // Punto y coma y BOM para que Excel en español lo abra bien.
    return '﻿' + rows.map(function (r) {
      return r.map(function (v) {
        v = String(v == null ? '' : v);
        return /[";\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(';');
    }).join('\r\n');
  }

  function recordsCsv(list) {
    var rows = [['Trabajador', 'Usuario', 'Fecha', 'Hora', 'Tipo', 'Origen', 'Nota']];
    list.forEach(function (r) {
      var emp = Store.employee(r.empId) || {};
      var d = new Date(r.ts);
      rows.push([emp.name, emp.username, d.toLocaleDateString('es-ES'), fTime(r.ts), r.type === 'in' ? 'Entrada' : 'Salida', r.manual ? 'Manual' : 'Fichado', r.note]);
    });
    return csv(rows);
  }

  function summaryCsv() {
    var r = summaryRange();
    var label = new Date(r.from).toLocaleDateString('es-ES') + ' - ' + new Date(r.to - 1).toLocaleDateString('es-ES');
    var rows = [['Periodo', label], [], ['Trabajador', 'Usuario', 'Puesto', 'Días trabajados', 'Horas (h:mm)', 'Horas (decimal)', 'Fichajes incompletos']];
    summaryRows().forEach(function (row) {
      rows.push([row.emp.name, row.emp.username, row.emp.role, row.days, Hours.fmt(row.ms), Hours.fmtDecimal(row.ms), row.issues.length]);
    });
    return csv(rows);
  }

  function renderData() {
    var f = $('#settingsForm');
    f.center.value = Store.db.settings.centerName || '';
    f.user.value = Store.db.admin ? Store.db.admin.user : '';
    f.pass.value = '';
    f.current.value = '';
    var lb = Store.db.meta.lastBackup;
    $('#lastBackup').textContent = lb ? 'Última copia enviada: ' + fDateTime(lb) : 'Todavía no se ha enviado ninguna copia desde este dispositivo.';

    var info = Store.db.records.filter(function (r) { return !r.deleted; }).length + ' fichajes y ' +
      Store.employees(true).length + ' trabajadores guardados en este dispositivo.';
    $('#storageInfo').textContent = info;
    if (navigator.storage && navigator.storage.persisted) {
      navigator.storage.persisted().then(function (p) {
        $('#storageInfo').textContent = info + (p
          ? ' Almacenamiento protegido: el sistema no lo borrará automáticamente.'
          : ' Consejo: en el iPad, añade la app a la pantalla de inicio para que el sistema no borre los datos, y envía copias a menudo.');
      });
    }
  }

  $('#settingsForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    if (!Store.checkAdmin(Store.db.admin.user, f.current.value)) { toast('La contraseña actual no es correcta'); return; }
    Store.setCenterName(f.center.value.trim());
    Store.updateAdmin(f.user.value, f.pass.value);
    renderCenter();
    renderData();
    toast('Ajustes guardados');
  });

  var importFromSetup = false;
  $('#importFile').addEventListener('change', function (e) {
    var file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    file.text().then(function (text) {
      var stats = Store.importJson(text);
      renderCenter();
      toast('Copia importada: ' + stats.records + ' fichajes y ' + stats.employees + ' trabajadores nuevos o actualizados');
      if (importFromSetup) {
        importFromSetup = false;
        show(Store.isConfigured() ? 'admin-login' : 'setup');
      } else {
        renderAdmin();
      }
    }).catch(function (err) {
      alert('No se pudo importar: ' + err.message);
    });
  });

  // ---------- Acciones de botones ----------
  var actions = {
    'go-admin-login': function () { show('admin-login'); $('#adminLoginForm').user.focus(); },
    'back-kiosk': backToKiosk,
    'logout': backToKiosk,
    'close-detail': function () { $('#dlgDetail').close(); },
    'new-record': function () { openRecordDialog(null); },
    'new-employee': function () { openEmployeeDialog(null); },
    'export-summary-csv': function () { deliverFile('horas_' + stamp() + '.csv', summaryCsv(), 'text/csv'); },
    'export-records-csv': function () { deliverFile('fichajes_' + stamp() + '.csv', recordsCsv(filteredRecords()), 'text/csv'); },
    'share-csv': function () { deliverFile('fichajes_' + stamp() + '.csv', recordsCsv(Store.records()), 'text/csv'); },
    'share-backup': function () {
      deliverFile('copia_fichajes_' + stamp() + '.json', Store.exportJson(), 'application/json').then(renderData);
    },
    'import': function () { importFromSetup = false; $('#importFile').click(); },
    'import-setup': function () { importFromSetup = true; $('#importFile').click(); },
    'wipe': function () {
      if (!confirm('¿Seguro que quieres borrar TODOS los datos de este dispositivo?')) return;
      if (prompt('Escribe BORRAR para confirmar') !== 'BORRAR') return;
      Store.wipe();
      adminLogged = false;
      renderCenter();
      show('setup');
      toast('Datos borrados');
    }
  };

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-action]');
    if (b && actions[b.dataset.action]) {
      e.preventDefault();
      actions[b.dataset.action]();
    }
  });

  // ---------- Arranque ----------
  Store.load();
  Store.requestPersistence();
  renderCenter();
  initRecordFilters();
  tickClock();
  setInterval(tickClock, 10000);
  setInterval(function () { if (adminLogged && currentTab === 'summary') renderSummary(); }, 60000);
  // Si otra pestaña modifica los datos (p. ej. en el ordenador), recargarlos.
  window.addEventListener('storage', function () { Store.load(); renderAdmin(); });
  show(Store.isConfigured() ? 'kiosk' : 'setup');

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function (err) { console.warn('SW', err); });
  }
})();
