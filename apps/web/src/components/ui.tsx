import type { ButtonHTMLAttributes, ChangeEvent, InputHTMLAttributes, ReactNode } from "react";
import {
    Children,
    isValidElement,
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from "react";
import { createPortal } from "react-dom";

const cardBase =
    "rounded-2xl border shadow-sm backdrop-blur-sm transition-colors duration-200 " +
    "border-slate-200/90 bg-white/90 dark:border-slate-800/80 dark:bg-slate-900/50 dark:shadow-xl";

export function Card({
    children,
    className = "",
}: {
    children: ReactNode;
    className?: string;
}) {
    return <div className={`${cardBase} ${className}`}>{children}</div>;
}

export function Button({
    children,
    variant = "primary",
    className = "",
    ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: "primary" | "secondary" | "ghost" | "danger";
    children: ReactNode;
}) {
    const base =
        "inline-flex min-h-11 min-w-[2.75rem] items-center justify-center rounded-xl px-4 py-2 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-40";
    const styles = {
        primary:
            "bg-claw-600 text-white hover:bg-claw-500 focus-visible:outline-claw-400 active:scale-[0.98] dark:bg-claw-600 dark:hover:bg-claw-500",
        secondary:
            "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 focus-visible:outline-slate-400 dark:border-slate-600 dark:bg-slate-800/80 dark:text-slate-100 dark:hover:bg-slate-700",
        ghost:
            "text-claw-700 hover:bg-slate-100 focus-visible:outline-claw-500 dark:text-claw-300 dark:hover:bg-slate-800/80",
        danger: "bg-rose-600/90 text-white hover:bg-rose-500 focus-visible:outline-rose-400",
    };
    return (
        <button type="button" className={`${base} ${styles[variant]} ${className}`} {...props}>
            {children}
        </button>
    );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
    return (
        <input
            {...props}
            className={`min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-claw-500 focus:outline-none focus:ring-1 focus:ring-claw-500 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-100 dark:placeholder:text-slate-500 ${props.className ?? ""}`}
        />
    );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
    return (
        <textarea
            {...props}
            className={`min-h-[88px] w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-claw-500 focus:outline-none focus:ring-1 focus:ring-claw-500 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-100 dark:placeholder:text-slate-500 ${props.className ?? ""}`}
        />
    );
}

function collectOptionText(node: ReactNode): string {
    if (node == null || typeof node === "boolean") return "";
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(collectOptionText).join("");
    if (isValidElement(node)) {
        const ch = (node.props as { children?: ReactNode }).children;
        return collectOptionText(ch);
    }
    return "";
}

type ParsedOption = { value: string; label: string; disabled?: boolean };

function parseOptions(children: ReactNode): ParsedOption[] {
    const out: ParsedOption[] = [];
    Children.forEach(children, (child) => {
        if (!isValidElement(child)) return;
        if (child.type !== "option") return;
        const p = child.props as { value?: string; children?: ReactNode; disabled?: boolean };
        out.push({
            value: p.value != null ? String(p.value) : "",
            label: collectOptionText(p.children).trim() || String(p.value ?? ""),
            disabled: Boolean(p.disabled),
        });
    });
    return out;
}

function ChevronDownIcon({ className }: { className?: string }) {
    return (
        <svg
            className={className}
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
        >
            <path d="M6 9l6 6 6-6" />
        </svg>
    );
}

/**
 * 自定义下拉：与原生 `<select>` 相同的 children（`<option>`）与 `onChange(e.target.value)` 用法，
 * 样式与圆角/主题一致；列表通过 portal 固定定位，避免被父级裁切并留出与触发器的间距。
 */
export function Select(
    props: React.SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode },
) {
    const {
        children,
        className = "",
        value: valueProp,
        defaultValue,
        onChange,
        disabled,
        id: idProp,
        name,
        required,
        autoFocus,
        "aria-label": ariaLabel,
        "aria-labelledby": ariaLabelledBy,
    } = props;

    const autoId = useId();
    const id = idProp ?? autoId;
    const listboxId = `${id}-listbox`;

    const options = useMemo(() => parseOptions(children), [children]);

    const isControlled = valueProp !== undefined;
    const [internalValue, setInternalValue] = useState(String(defaultValue ?? ""));
    const currentValue = isControlled ? String(valueProp ?? "") : internalValue;

    const selected = options.find((o) => o.value === currentValue);
    const displayLabel = selected?.label ?? (currentValue || "—");

    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const menuRef = useRef<HTMLUListElement>(null);
    const [menuPos, setMenuPos] = useState({ top: 0, left: 0, width: 0, maxH: 280 });

    const updateMenuPosition = useCallback(() => {
        const el = triggerRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const gap = 8;
        const below = r.bottom + gap;
        const spaceBelow = window.innerHeight - below - 16;
        const maxH = Math.min(280, Math.max(120, spaceBelow));
        setMenuPos({
            top: below,
            left: r.left,
            width: r.width,
            maxH,
        });
    }, []);

    useLayoutEffect(() => {
        if (!open) return;
        updateMenuPosition();
        const raf = requestAnimationFrame(updateMenuPosition);
        return () => cancelAnimationFrame(raf);
    }, [open, updateMenuPosition, currentValue]);

    useEffect(() => {
        if (!open) return;
        const onScrollResize = () => {
            updateMenuPosition();
        };
        window.addEventListener("scroll", onScrollResize, true);
        window.addEventListener("resize", onScrollResize);
        return () => {
            window.removeEventListener("scroll", onScrollResize, true);
            window.removeEventListener("resize", onScrollResize);
        };
    }, [open, updateMenuPosition]);

    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent | TouchEvent) => {
            const t = e.target as Node;
            if (triggerRef.current?.contains(t) || menuRef.current?.contains(t)) return;
            setOpen(false);
        };
        document.addEventListener("mousedown", onDoc);
        document.addEventListener("touchstart", onDoc, { passive: true });
        return () => {
            document.removeEventListener("mousedown", onDoc);
            document.removeEventListener("touchstart", onDoc);
        };
    }, [open]);

    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") setOpen(false);
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [open]);

    const commit = (v: string) => {
        if (!isControlled) setInternalValue(v);
        onChange?.({
            target: { value: v } as HTMLSelectElement,
            currentTarget: { value: v } as HTMLSelectElement,
        } as ChangeEvent<HTMLSelectElement>);
        setOpen(false);
    };

    const triggerClass =
        "flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-900 shadow-sm transition " +
        "hover:border-slate-400 focus:border-claw-500 focus:outline-none focus:ring-2 focus:ring-claw-500/30 " +
        "disabled:cursor-not-allowed disabled:opacity-50 " +
        "dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-100 dark:hover:border-slate-600 " +
        (open ? "border-claw-500 ring-2 ring-claw-500/25 dark:border-claw-500 " : "");

    const menuClass =
        "fixed z-[1000] overflow-y-auto rounded-xl border border-slate-200/95 bg-white py-1 shadow-xl " +
        "ring-1 ring-black/5 dark:border-slate-700 dark:bg-slate-900 dark:ring-white/10";

    const itemClass = (active: boolean, isDisabled?: boolean) =>
        "flex w-full items-center px-3 py-2.5 text-left text-sm transition " +
        (isDisabled
            ? "cursor-not-allowed text-slate-400 dark:text-slate-600"
            : "cursor-pointer " +
              (active
                  ? "bg-claw-50 font-medium text-claw-900 dark:bg-claw-600/20 dark:text-claw-100"
                  : "text-slate-800 hover:bg-slate-50 dark:text-slate-100 dark:hover:bg-slate-800/80"));

    return (
        <div className={`relative w-full ${className}`}>
            {name ? (
                <input type="hidden" name={name} value={currentValue} disabled={disabled} readOnly />
            ) : null}
            <button
                type="button"
                id={id}
                ref={triggerRef}
                disabled={disabled}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-controls={listboxId}
                aria-label={ariaLabel}
                aria-labelledby={ariaLabelledBy}
                aria-required={required}
                autoFocus={autoFocus}
                className={triggerClass}
                onClick={() => {
                    if (disabled) return;
                    setOpen((o) => !o);
                }}
            >
                <span className="min-w-0 flex-1 truncate">{displayLabel}</span>
                <ChevronDownIcon
                    className={`shrink-0 text-slate-500 transition dark:text-slate-400 ${open ? "rotate-180" : ""}`}
                />
            </button>
            {open &&
                typeof document !== "undefined" &&
                createPortal(
                    <ul
                        ref={menuRef}
                        id={listboxId}
                        role="listbox"
                        className={menuClass}
                        style={{
                            top: menuPos.top,
                            left: menuPos.left,
                            width: menuPos.width,
                            maxHeight: menuPos.maxH,
                        }}
                    >
                        {options.map((opt) => {
                            const active = opt.value === currentValue;
                            return (
                                <li
                                    key={`${opt.value}-${opt.label}`}
                                    role="option"
                                    aria-selected={active}
                                    aria-disabled={opt.disabled}
                                    className={itemClass(active, opt.disabled)}
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        if (opt.disabled) return;
                                        commit(opt.value);
                                    }}
                                >
                                    <span className="min-w-0 flex-1 break-words">{opt.label}</span>
                                </li>
                            );
                        })}
                    </ul>,
                    document.body,
                )}
        </div>
    );
}

const statusStyles: Record<string, string> = {
    draft: "bg-slate-200 text-slate-800 dark:bg-slate-600/40 dark:text-slate-200",
    planned: "bg-sky-100 text-sky-900 dark:bg-sky-600/30 dark:text-sky-200",
    running: "bg-amber-100 text-amber-900 dark:bg-amber-500/25 dark:text-amber-100",
    pending_approval: "bg-orange-100 text-orange-900 dark:bg-orange-600/30 dark:text-orange-100",
    review: "bg-violet-100 text-violet-900 dark:bg-violet-600/30 dark:text-violet-100",
    approved: "bg-emerald-100 text-emerald-900 dark:bg-emerald-600/30 dark:text-emerald-100",
    rejected: "bg-rose-100 text-rose-900 dark:bg-rose-600/30 dark:text-rose-100",
    done: "bg-teal-100 text-teal-900 dark:bg-claw-600/30 dark:text-claw-100",
    failed: "bg-red-100 text-red-900 dark:bg-red-600/30 dark:text-red-100",
    cancelled: "bg-slate-200 text-slate-700 dark:bg-slate-600/40 dark:text-slate-300",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
    return (
        <span
            className={`inline-flex max-w-full truncate rounded-lg px-2 py-0.5 text-xs font-medium ${statusStyles[status] ?? "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-200"}`}
        >
            {label ?? status}
        </span>
    );
}
