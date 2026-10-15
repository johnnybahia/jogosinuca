type Kid = Node | string | null | false | undefined;

export interface Props {
  class?: string;
  text?: string;
  attrs?: Record<string, string>;
  on?: Record<string, (e: Event) => void>;
  style?: Record<string, string>;
}

/** Cria elementos sempre com textContent (nunca innerHTML): nomes de jogadores vêm de fora. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props?: Props | null, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props) {
    if (props.class) el.className = props.class;
    if (props.text !== undefined) el.textContent = props.text;
    if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);
    if (props.on) for (const [k, fn] of Object.entries(props.on)) el.addEventListener(k, fn);
    if (props.style) for (const [k, v] of Object.entries(props.style)) el.style.setProperty(k, v);
  }
  for (const k of kids) if (k) el.append(k);
  return el;
}

export function btn(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  return h('button', { class: `btn ${cls}`.trim(), text: label, attrs: { type: 'button' }, on: { click: onClick } });
}

let toastHost: HTMLElement | null = null;
export function toast(msg: string, ms = 2600): void {
  if (!toastHost || !toastHost.isConnected) {
    toastHost = h('div', { class: 'toasts' });
    document.body.append(toastHost);
  }
  const t = h('div', { class: 'toast', text: msg });
  toastHost.append(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Avatar: foto, ou inicial sobre cor derivada do id. */
export function avatarEl(name: string, color: string, photo: string | null | undefined, cls = 'avatar'): HTMLElement {
  if (photo) return h('img', { class: cls, attrs: { src: photo, alt: name, draggable: 'false' } });
  return h('div', { class: `${cls} initial`, text: (name.trim()[0] ?? '?').toUpperCase(), style: { background: color } });
}

export function modal(content: HTMLElement, onClose?: () => void): { close(): void; el: HTMLElement } {
  const el = h('div', { class: 'modal', on: { click: (e) => e.target === el && close() } }, content);
  const close = (): void => {
    el.remove();
    onClose?.();
  };
  document.body.append(el);
  return { close, el };
}

export function segmented<T extends string | number>(options: readonly { value: T; label: string; disabled?: boolean }[], value: T, onChange: (v: T) => void): HTMLElement {
  const wrap = h('div', { class: 'seg' });
  const render = (cur: T): void => {
    clear(wrap);
    for (const o of options) {
      wrap.append(
        h('button', {
          class: `seg-btn${o.value === cur ? ' active' : ''}`,
          text: o.label,
          attrs: { type: 'button', ...(o.disabled ? { disabled: '' } : {}) },
          on: {
            click: () => {
              if (o.disabled) return;
              onChange(o.value);
              render(o.value);
            },
          },
        }),
      );
    }
  };
  render(value);
  return wrap;
}
