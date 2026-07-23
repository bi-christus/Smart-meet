"use client";

import { useEffect, useId, useRef, useState } from "react";
import styles from "./select.module.css";

export type SelectOption = { value: string; label: string; color?: string };

export function Select({
  value,
  options,
  onChange,
  placeholder = "Selecionar…",
  ariaLabel,
}: {
  value: string;
  options: SelectOption[];
  onChange: (v: string) => void;
  placeholder?: string;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [up, setUp] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const listId = `${baseId}-list`;

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    if (open) setActive(options.findIndex((o) => o.value === value));
  }, [open, value, options]);

  function openMenu() {
    const r = rootRef.current?.getBoundingClientRect();
    if (r) {
      const below = window.innerHeight - r.bottom;
      setUp(below < 280 && r.top > below);
    }
    setOpen(true);
  }

  function choose(v: string) {
    onChange(v);
    setOpen(false);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      if (open) {
        e.stopPropagation();
        setOpen(false);
      }
      return;
    }
    if (!open && (e.key === "Enter" || e.key === " " || e.key === "ArrowDown")) {
      e.preventDefault();
      openMenu();
      return;
    }
    if (!open) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(options.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = options[active];
      if (o) choose(o.value);
    }
  }

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={`${styles.trigger} ${open ? styles.open : ""}`}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKey}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={
          open && active >= 0 ? `${baseId}-opt-${active}` : undefined
        }
        aria-label={ariaLabel}
      >
        <span className={styles.val}>
          {selected?.color && (
            <span
              className={styles.dot}
              style={{ background: selected.color }}
            />
          )}
          <span className={selected ? "" : styles.ph}>
            {selected ? selected.label : placeholder}
          </span>
        </span>
        <svg
          className={styles.chev}
          viewBox="0 0 24 24"
          width="15"
          height="15"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          className={`${styles.menu} ${up ? styles.up : ""}`}
          role="listbox"
          id={listId}
        >
          {options.map((o, i) => (
            <button
              key={o.value}
              type="button"
              id={`${baseId}-opt-${i}`}
              role="option"
              aria-selected={o.value === value}
              className={`${styles.option} ${o.value === value ? styles.sel : ""} ${i === active ? styles.active : ""}`}
              onClick={() => choose(o.value)}
              onMouseEnter={() => setActive(i)}
              style={{ animationDelay: `${i * 18}ms` }}
            >
              {o.color && (
                <span className={styles.dot} style={{ background: o.color }} />
              )}
              <span className={styles.optLabel}>{o.label}</span>
              {o.value === value && (
                <svg
                  className={styles.check}
                  viewBox="0 0 24 24"
                  width="14"
                  height="14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                >
                  <path d="M20 6L9 17l-5-5" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
