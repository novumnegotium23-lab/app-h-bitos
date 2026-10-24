// Cálculo de horas trabajadas a partir de los fichajes de entrada/salida.
(function (global) {
  'use strict';

  // Un turno abierto más largo que esto se considera "salida olvidada" y no suma horas.
  var MAX_OPEN_MS = 16 * 3600 * 1000;

  // Convierte la lista de fichajes de un trabajador en tramos [inicio, fin].
  function sessions(records, nowTs) {
    var out = [];
    var open = null;
    records.forEach(function (r) {
      if (r.type === 'in') {
        if (open) out.push({ start: open.ts, end: null, issue: 'Entrada sin salida' });
        open = r;
      } else if (r.type === 'out') {
        if (open) {
          out.push({ start: open.ts, end: r.ts });
          open = null;
        } else {
          out.push({ start: null, end: r.ts, issue: 'Salida sin entrada' });
        }
      }
    });
    if (open) {
      if (nowTs - open.ts <= MAX_OPEN_MS) out.push({ start: open.ts, end: null, running: true });
      else out.push({ start: open.ts, end: null, issue: 'Entrada sin salida' });
    }
    return out;
  }

  // Milisegundos trabajados dentro de [from, to). Los turnos en curso cuentan hasta ahora.
  function workedMs(sess, from, to, nowTs) {
    var total = 0;
    sess.forEach(function (s) {
      if (s.start == null) return;
      var end = s.end != null ? s.end : (s.running ? nowTs : null);
      if (end == null) return;
      var a = Math.max(s.start, from);
      var b = Math.min(end, to);
      if (b > a) total += b - a;
    });
    return total;
  }

  function issuesIn(sess, from, to) {
    return sess.filter(function (s) {
      var t = s.start != null ? s.start : s.end;
      return s.issue && t >= from && t < to;
    });
  }

  function startOfDay(d) { var x = new Date(d); x.setHours(0, 0, 0, 0); return x; }

  function range(period, customFrom, customTo) {
    var now = new Date();
    var from, to;
    switch (period) {
      case 'today':
        from = startOfDay(now); to = new Date(from); to.setDate(to.getDate() + 1); break;
      case 'week': {
        from = startOfDay(now);
        var dow = (from.getDay() + 6) % 7; // lunes = 0
        from.setDate(from.getDate() - dow);
        to = new Date(from); to.setDate(to.getDate() + 7); break;
      }
      case 'month':
        from = new Date(now.getFullYear(), now.getMonth(), 1);
        to = new Date(now.getFullYear(), now.getMonth() + 1, 1); break;
      case 'lastmonth':
        from = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        to = new Date(now.getFullYear(), now.getMonth(), 1); break;
      case 'year':
        from = new Date(now.getFullYear(), 0, 1);
        to = new Date(now.getFullYear() + 1, 0, 1); break;
      case 'custom':
        from = customFrom ? parseDate(customFrom) : new Date(2000, 0, 1);
        to = customTo ? parseDate(customTo) : startOfDay(now);
        to = new Date(to); to.setDate(to.getDate() + 1); break;
      default:
        from = new Date(2000, 0, 1); to = new Date(2100, 0, 1);
    }
    return { from: from.getTime(), to: to.getTime() };
  }

  function parseDate(s) {
    var p = s.split('-').map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }

  // Desglose por días: { 'YYYY-MM-DD': { ms, parts: [[start,end,running]] } }
  function byDay(sess, from, to, nowTs) {
    var days = {};
    sess.forEach(function (s) {
      if (s.start == null) return;
      var end = s.end != null ? s.end : (s.running ? nowTs : null);
      if (end == null) return;
      var a = Math.max(s.start, from), b = Math.min(end, to);
      while (b > a) {
        var dayStart = startOfDay(a);
        var next = new Date(dayStart); next.setDate(next.getDate() + 1);
        var segEnd = Math.min(b, next.getTime());
        var key = dateKey(dayStart);
        days[key] = days[key] || { ms: 0, parts: [] };
        days[key].ms += segEnd - a;
        days[key].parts.push([a, segEnd, s.running && segEnd === end]);
        a = segEnd;
      }
    });
    return days;
  }

  function dateKey(d) {
    d = new Date(d);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function fmt(ms) {
    var mins = Math.round(ms / 60000);
    return Math.floor(mins / 60) + ':' + String(mins % 60).padStart(2, '0');
  }

  // Horas en formato decimal con coma, para Excel en español.
  function fmtDecimal(ms) {
    return (ms / 3600000).toFixed(2).replace('.', ',');
  }

  global.Hours = {
    sessions: sessions, workedMs: workedMs, issuesIn: issuesIn, range: range,
    byDay: byDay, dateKey: dateKey, fmt: fmt, fmtDecimal: fmtDecimal, MAX_OPEN_MS: MAX_OPEN_MS
  };
})(typeof window !== 'undefined' ? window : globalThis);
