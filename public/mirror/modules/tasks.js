// Tasks & shopping list renderer.
import { esc } from '../renderers.js';

const box = '<svg class="ico tasks-box" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="4" width="16" height="16" rx="3.5"/></svg>';
const PRIO_CLASS = ['', 'p1', 'p2', 'p3'];

export default function render(el, mod, ctx) {
  const s = mod.settings;
  const { t } = ctx.fmt;
  let last = null;

  const dueLabel = (item) => {
    if (item.allDay) return ctx.fmt.dayLabel(item.due);
    const d = new Date(item.due);
    const key = ctx.fmt.dayKey(d);
    const today = ctx.fmt.dayKey(new Date());
    return key === today ? ctx.fmt.time(d) : `${ctx.fmt.dayLabel(key)} ${ctx.fmt.time(d)}`;
  };

  const overdue = (item, now) => {
    if (!item.due) return false;
    if (item.allDay) return item.due < ctx.fmt.dayKey(now);
    return Date.parse(item.due) < now.getTime();
  };

  const draw = () => {
    const d = last;
    if (!d) return;
    if (!d.items.length) {
      el.innerHTML = `<div class="dim">${esc(t('Nothing to do'))}</div>`;
      return;
    }
    const now = new Date();
    const today = ctx.fmt.dayKey(now);
    const rows = d.items
      .map((item) => {
        const late = s.highlightOverdue && overdue(item, now);
        const isToday = item.due && (item.allDay ? item.due === today : ctx.fmt.dayKey(new Date(item.due)) === today);
        const prio = s.showPriority ? PRIO_CLASS[item.priority] || '' : '';
        const marker = s.listStyle === 'checkbox' ? box : s.listStyle === 'bullet' ? '<span class="tasks-dot"></span>' : '';
        const due = s.showDue && item.due ? `<span class="tasks-due${late ? ' late' : isToday ? ' today' : ''}">${esc(dueLabel(item))}</span>` : '';
        return `<li class="tasks-item${late ? ' overdue' : ''}${prio ? ' ' + prio : ''}">${marker ? `<span class="tasks-mark">${marker}</span>` : ''}<span class="tasks-title">${esc(item.title)}</span>${due}</li>`;
      })
      .join('');
    const more = s.showCount && d.total > d.items.length ? `<div class="tasks-more dim small">${esc(t('+ {n} more', { n: d.total - d.items.length }))}</div>` : '';
    el.innerHTML = `<ul class="tasks-list style-${esc(s.listStyle)}">${rows}</ul>${more}`;
  };

  return {
    update(data) {
      last = data;
      draw();
    },
    tick: draw,
    tickEvery: 60000,
  };
}
