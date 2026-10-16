import React, { useEffect, useState } from 'react';
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react';

const listeners = new Set();
let next = 1;
// toast('Sale completed') · toast('Could not save', 'error') · toast('Saved offline', 'info')
export function toast(text, kind = 'success', ms = 3800) {
  const t = { id: next++, text, kind, ms };
  for (const fn of listeners) fn(t);
}

const icons = { success: CheckCircle2, error: AlertCircle, info: Info };

export function Toaster() {
  const [items, setItems] = useState([]);
  useEffect(() => {
    const add = t => {
      setItems(list => [...list.slice(-3), t]);
      setTimeout(() => setItems(list => list.filter(x => x.id !== t.id)), t.ms);
    };
    listeners.add(add);
    return () => listeners.delete(add);
  }, []);
  return (
    <div className="toaster no-print" aria-live="polite" aria-atomic="false">
      {items.map(t => {
        const Icon = icons[t.kind] || Info;
        return (
          <div key={t.id} className={'toast toast-' + t.kind} role={t.kind === 'error' ? 'alert' : 'status'}>
            <Icon size={18} />
            <span>{t.text}</span>
            <button aria-label="Dismiss" onClick={() => setItems(list => list.filter(x => x.id !== t.id))}><X size={15} /></button>
          </div>
        );
      })}
    </div>
  );
}
