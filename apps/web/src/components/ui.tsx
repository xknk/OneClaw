import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

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

export function Select(
    props: React.SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode },
) {
    return (
        <select
            {...props}
            className={`min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-claw-500 focus:outline-none focus:ring-1 focus:ring-claw-500 dark:border-slate-700 dark:bg-slate-900/80 dark:text-slate-100 ${props.className ?? ""}`}
        />
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
