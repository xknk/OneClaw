import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function Card({
    children,
    className = "",
}: {
    children: ReactNode;
    className?: string;
}) {
    return (
        <div
            className={`rounded-2xl border border-slate-800/80 bg-slate-900/50 shadow-xl backdrop-blur-sm ${className}`}
        >
            {children}
        </div>
    );
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
            "bg-claw-600 text-white hover:bg-claw-500 focus-visible:outline-claw-400 active:scale-[0.98]",
        secondary:
            "border border-slate-600 bg-slate-800/80 text-slate-100 hover:bg-slate-700 focus-visible:outline-slate-400",
        ghost: "text-claw-300 hover:bg-slate-800/80 focus-visible:outline-claw-500",
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
            className={`min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-claw-500 focus:outline-none focus:ring-1 focus:ring-claw-500 ${props.className ?? ""}`}
        />
    );
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
    return (
        <textarea
            {...props}
            className={`min-h-[88px] w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:border-claw-500 focus:outline-none focus:ring-1 focus:ring-claw-500 ${props.className ?? ""}`}
        />
    );
}

export function Select(
    props: React.SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode },
) {
    return (
        <select
            {...props}
            className={`min-h-11 w-full rounded-xl border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm text-slate-100 focus:border-claw-500 focus:outline-none focus:ring-1 focus:ring-claw-500 ${props.className ?? ""}`}
        />
    );
}

const statusStyles: Record<string, string> = {
    draft: "bg-slate-600/40 text-slate-200",
    planned: "bg-sky-600/30 text-sky-200",
    running: "bg-amber-500/25 text-amber-100",
    pending_approval: "bg-orange-600/30 text-orange-100",
    review: "bg-violet-600/30 text-violet-100",
    approved: "bg-emerald-600/30 text-emerald-100",
    rejected: "bg-rose-600/30 text-rose-100",
    done: "bg-claw-600/30 text-claw-100",
    failed: "bg-red-600/30 text-red-100",
    cancelled: "bg-slate-600/40 text-slate-300",
};

export function StatusBadge({ status }: { status: string }) {
    return (
        <span
            className={`inline-flex max-w-full truncate rounded-lg px-2 py-0.5 text-xs font-medium ${statusStyles[status] ?? "bg-slate-700 text-slate-200"}`}
        >
            {status}
        </span>
    );
}
