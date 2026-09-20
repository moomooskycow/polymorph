/** Small DOM helpers shared by the popup and options pages. No framework. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export interface SwitchOptions {
  /** Visible/accessibility label. The switch is never a bare checkbox. */
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
  disabled?: boolean;
  id?: string;
  /** Hide the text when a neighboring row already shows it. */
  showLabel?: boolean;
}

/** Labeled switch control (checkbox with visible text and an aria label). */
export function switchControl(options: SwitchOptions): HTMLLabelElement {
  const label = el('label', 'switch');
  const input = el('input');
  input.type = 'checkbox';
  input.role = 'switch';
  input.checked = options.checked;
  input.disabled = options.disabled === true;
  input.setAttribute('aria-label', options.label);
  if (options.id !== undefined) input.id = options.id;
  input.addEventListener('change', () => options.onChange(input.checked));
  const track = el('span', 'switch-track');
  const text = el('span', 'switch-label', options.label);
  if (options.showLabel === false) text.hidden = true;
  label.append(input, track, text);
  return label;
}

export function row(left: Node, right: Node, className = 'row'): HTMLDivElement {
  const div = el('div', className);
  div.append(left, right);
  return div;
}

export function section(title: string, id?: string): HTMLElement {
  const node = el('section');
  if (id !== undefined) node.id = id;
  node.append(el('h2', undefined, title));
  return node;
}