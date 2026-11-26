'use client';

import Link from 'next/link';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { CheckIcon } from './icons';

/*
 * Popup menu (modern-web-guidance "menu"): the trigger is a command invoker that toggles a
 * popover="auto" placed right after it, so the browser handles light dismiss, Escape and
 * top-layer rendering. CSS anchor positioning places it below the trigger and flips it near
 * the viewport edges (globals.css `.anchored-popover`); browsers without anchor positioning get
 * the same placement from script. Arrow keys, Home and End move between items.
 */

interface MenuContextValue {
  /** Runs an item's action, then closes the menu and returns focus to the trigger. */
  activate: (action: (() => void) | undefined, fromPointer: boolean) => void;
}

const MenuContext = createContext<MenuContextValue | null>(null);

export const supportsInvokers = () =>
  typeof HTMLButtonElement !== 'undefined' && 'commandForElement' in HTMLButtonElement.prototype;
export const supportsAnchoring = () =>
  typeof CSS !== 'undefined' && CSS.supports('position-area', 'block-end');

const itemSelector = '[data-menu-item]:not([aria-disabled="true"])';

/** Fallback placement for browsers without CSS anchor positioning. */
export function placeBelow(trigger: HTMLElement, menu: HTMLElement, align: 'start' | 'end') {
  const gap = 4;
  const edge = 8;
  const t = trigger.getBoundingClientRect();
  const m = menu.getBoundingClientRect();
  let left = align === 'start' ? t.left : t.right - m.width;
  left = Math.min(Math.max(edge, left), window.innerWidth - m.width - edge);
  let top = t.bottom + gap;
  if (top + m.height > window.innerHeight - edge && t.top - gap - m.height >= edge) {
    top = t.top - gap - m.height;
  }
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.max(edge, top)}px`;
}

export function Menu({
  label,
  trigger,
  triggerClassName = '',
  triggerProps,
  align = 'start',
  menuClassName = '',
  disabled = false,
  deferItems = false,
  children,
}: {
  /** Shows the trigger but blocks opening, e.g. while a save is in flight. */
  disabled?: boolean;
  /** Accessible name of the menu (and of the trigger when it shows only an icon). */
  label: string;
  trigger: ReactNode;
  triggerClassName?: string;
  triggerProps?: HTMLAttributes<HTMLButtonElement> & { title?: string };
  /** Which edge of the trigger the menu lines up with. */
  align?: 'start' | 'end';
  menuClassName?: string;
  /**
   * Renders the items only once the user reaches for the trigger (pointer, focus or touch),
   * for menus repeated many times on one screen, such as one per board card (#128).
   */
  deferItems?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  const menuId = `${id}-menu`;
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const enterOnOpen = useRef(false);
  const typeahead = useRef({ text: '', at: 0 });
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(!deferItems);
  const arm = () => {
    if (!armed) setArmed(true);
  };

  const items = () => [...(menuRef.current?.querySelectorAll<HTMLElement>(itemSelector) ?? [])];

  const close = useCallback((fromPointer: boolean) => {
    const trigger = triggerRef.current;
    // Focus the trigger first so focus never sits inside hidden content.
    trigger?.focus({ focusVisible: !fromPointer } as FocusOptions);
    if (menuRef.current?.matches(':popover-open')) menuRef.current.hidePopover();
  }, []);

  useEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const onToggle = (e: Event) => {
      const isOpen = (e as ToggleEvent).newState === 'open';
      setOpen(isOpen);
      if (!isOpen) {
        enterOnOpen.current = false;
        return;
      }
      if (!supportsAnchoring() && triggerRef.current) placeBelow(triggerRef.current, menu, align);
      if (enterOnOpen.current) {
        enterOnOpen.current = false;
        const list = items();
        // Start on the selected choice (checked item or current page), else the first item.
        const selected = list.find(
          (el) =>
            el.getAttribute('aria-checked') === 'true' ||
            el.getAttribute('aria-current') === 'true',
        );
        (selected ?? list[0])?.focus();
      }
    };
    menu.addEventListener('toggle', onToggle);
    return () => menu.removeEventListener('toggle', onToggle);
  }, [align]);

  function onTriggerClick(e: MouseEvent<HTMLButtonElement>) {
    // A click with detail 0 came from Enter or Space: move into the menu once it opens.
    if (e.detail === 0) enterOnOpen.current = true;
    if (supportsInvokers()) return; // the command invoker toggles the popover natively
    const menu = menuRef.current;
    if (!menu) return;
    if (menu.matches(':popover-open')) menu.hidePopover();
    else
      (menu.showPopover as (options?: { source?: HTMLElement }) => void)({
        source: e.currentTarget,
      });
  }

  function onTriggerKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
    if (e.key !== 'ArrowDown') return;
    e.preventDefault();
    if (menuRef.current?.matches(':popover-open')) {
      items()[0]?.focus();
    } else {
      enterOnOpen.current = true;
      e.currentTarget.click();
    }
  }

  function onMenuKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const list = items();
    const current = list.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (e.key === 'ArrowDown') next = current + 1;
    else if (e.key === 'ArrowUp') next = current - 1;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    else if (e.key === 'Tab') menuRef.current?.hidePopover();
    else if (e.key.length === 1 && e.key !== ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Typeahead: jump to the next item whose label starts with what was typed.
      const now = Date.now();
      const typed = (now - typeahead.current.at < 600 ? typeahead.current.text : '') + e.key;
      typeahead.current = { text: typed.toLowerCase(), at: now };
      const query = typeahead.current.text;
      const label = (el: HTMLElement) =>
        (el.querySelector('[data-menu-label]')?.textContent ?? el.textContent ?? '')
          .trim()
          .replace(/^@/, '')
          .toLowerCase();
      const order = list.map((_, i) => list[(current + 1 + i) % list.length]!);
      const match = order.find((el) => label(el).startsWith(query));
      if (match) {
        e.preventDefault();
        match.focus();
      }
      return;
    }
    if (next === null || list.length === 0) return;
    e.preventDefault();
    list[(next + list.length) % list.length]?.focus();
  }

  const context: MenuContextValue = {
    activate: (action, fromPointer) => {
      action?.();
      close(fromPointer);
    },
  };

  const invoker = { commandfor: menuId, command: 'toggle-popover' } as Record<string, string>;

  return (
    <MenuContext.Provider value={context}>
      <button
        ref={triggerRef}
        id={`${id}-trigger`}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        {...invoker}
        {...triggerProps}
        onClick={onTriggerClick}
        onKeyDown={onTriggerKeyDown}
        onPointerEnter={(e) => {
          arm();
          triggerProps?.onPointerEnter?.(e);
        }}
        onPointerDown={(e) => {
          arm();
          triggerProps?.onPointerDown?.(e);
        }}
        onFocus={(e) => {
          arm();
          triggerProps?.onFocus?.(e);
        }}
        className={triggerClassName}
      >
        {trigger}
      </button>
      {/* Right after its trigger, so browsers add no implicit aria-details. */}
      <div
        ref={menuRef}
        id={menuId}
        popover="auto"
        className={`anchored-popover ${align === 'end' ? 'anchored-popover-end' : ''} min-w-48 rounded-card border border-line bg-surface p-1 text-fg shadow-overlay ${menuClassName}`}
      >
        <div role="menu" aria-label={label} onKeyDown={onMenuKeyDown}>
          {armed ? children : null}
        </div>
      </div>
    </MenuContext.Provider>
  );
}

const itemClass =
  'flex min-h-8 w-full items-center gap-2 rounded-control px-2 py-1.5 text-left text-sm text-fg-secondary transition-colors hover:bg-surface-muted hover:text-fg focus-visible:bg-surface-muted focus-visible:text-fg focus-visible:shadow-none pointer-coarse:min-h-11';

function useMenu() {
  const menu = useContext(MenuContext);
  if (!menu) throw new Error('Menu items must be inside <Menu>.');
  return menu;
}

/** Pointer hover moves focus too, so hover and keyboard focus are one item. */
const focusOnHover = (e: MouseEvent<HTMLElement>) =>
  e.currentTarget.focus({ focusVisible: false } as FocusOptions);

/** A command. `checked` makes it one choice of a set (menuitemradio). */
export function MenuItem({
  onSelect,
  checked,
  icon,
  children,
  className = '',
}: {
  onSelect?: () => void;
  checked?: boolean;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const menu = useMenu();
  return (
    <button
      type="button"
      data-menu-item=""
      tabIndex={-1}
      role={checked === undefined ? 'menuitem' : 'menuitemradio'}
      aria-checked={checked}
      onMouseMove={focusOnHover}
      onClick={(e) => menu.activate(onSelect, e.detail !== 0)}
      className={`${itemClass} ${className}`}
    >
      {/* The label names the item; icons are decoration. */}
      {icon ? (
        <span aria-hidden="true" className="inline-flex shrink-0">
          {icon}
        </span>
      ) : null}
      <span data-menu-label="" className="min-w-0 flex-1">
        {children}
      </span>
      {checked ? <CheckIcon size={14} className="shrink-0 text-primary" /> : null}
    </button>
  );
}

/** A destination. Stays a real link: opens in a new tab, copies as a URL. */
export function MenuLink({
  href,
  current,
  icon,
  onNavigate,
  children,
  className = '',
}: {
  href: string;
  /** Also runs on activation, e.g. to close the mobile navigation sheet. */
  onNavigate?: () => void;
  /** Marks the page you are on (shown with a check). */
  current?: boolean;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const menu = useMenu();
  return (
    <Link
      href={href}
      data-menu-item=""
      tabIndex={-1}
      role="menuitem"
      aria-current={current ? 'true' : undefined}
      onMouseMove={focusOnHover}
      onClick={(e) => menu.activate(onNavigate, e.detail !== 0)}
      className={`${itemClass} ${className}`}
    >
      {/* The label names the item; icons are decoration. */}
      {icon ? (
        <span aria-hidden="true" className="inline-flex shrink-0">
          {icon}
        </span>
      ) : null}
      <span data-menu-label="" className="min-w-0 flex-1">
        {children}
      </span>
      {current ? <CheckIcon size={14} className="shrink-0 text-primary" /> : null}
    </Link>
  );
}

export function MenuGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      <p aria-hidden="true" className="px-2 pt-1.5 pb-1 text-xs font-medium text-fg-muted">
        {label}
      </p>
      {children}
    </div>
  );
}

export function MenuSeparator() {
  return <hr className="my-1 border-line-subtle" />;
}
