import { Loader2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button as RACButton, type ButtonProps as RACButtonProps } from "react-aria-components";

export type ButtonVariant =
  | "dark"
  | "lime"
  | "light"
  | "ghost"
  | "danger"
  | "night"
  | "outline"
  | "outlineLight"
  | "violet";
export type ButtonSize = "sm" | "md" | "lg";

const base =
  "relative inline-flex items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap select-none outline-none cursor-pointer " +
  "transition-[background-color,color,transform,box-shadow] duration-150 ease-out " +
  "data-[focus-visible]:outline-2 data-[focus-visible]:outline-offset-2 data-[focus-visible]:outline-ink " +
  "data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45 data-[pressed]:scale-[0.97]";

export const buttonVariants: Record<ButtonVariant, string> = {
  dark: "bg-ink text-white hover:bg-night-3",
  lime: "bg-lime text-ink hover:bg-lime-strong",
  light: "bg-card text-ink ring-1 ring-line-strong hover:bg-panel",
  ghost: "text-ink hover:bg-ink/6",
  danger: "bg-coral text-ink hover:brightness-95",
  night: "bg-night-3 text-night-ink hover:bg-night-4 data-[focus-visible]:outline-lime",
  // The academy website's secondary actions: an ink outline on the ivory ground, white on slabs.
  outline: "text-ink ring-[1.5px] ring-ink ring-inset hover:bg-ink/6",
  outlineLight:
    "text-white ring-[1.5px] ring-white/75 ring-inset hover:bg-white/10 data-[focus-visible]:outline-lime",
  // Its ways to reach the academy: violet with an ink outline.
  violet: "bg-violet text-ink ring-[1.5px] ring-ink ring-inset hover:bg-lavender",
};

export const buttonSizes: Record<ButtonSize, string> = {
  sm: "h-9 px-4 text-[0.875rem]",
  md: "h-11 px-5 text-[0.9375rem]",
  lg: "h-13 px-6 text-[1rem]",
};

const linkBase =
  "relative inline-flex items-center justify-center gap-2 rounded-full font-medium whitespace-nowrap select-none outline-none cursor-pointer " +
  "transition-[background-color,color,transform] duration-150 ease-out active:scale-[0.97] " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink";

/** Button styling for router links (navigation that looks like a pill button). */
export function buttonClass(variant: ButtonVariant = "dark", size: ButtonSize = "md", extra = "") {
  return `${linkBase} ${buttonVariants[variant]} ${buttonSizes[size]} ${extra}`;
}

/**
 * Grows a small text link's tap area to about 44px (an invisible box above and below it) without
 * moving anything around it. For links set as text: footers, contact lines, "All" in a card head.
 */
export const tapArea = "relative before:absolute before:-inset-y-2.5 before:inset-x-0";

/** A card header's quiet text action ("All", "Open session"), underlined on hover. */
export const textActionClass = `${tapArea} rounded-full px-2 py-1 text-[0.875rem] font-medium outline-none hover:underline focus-visible:outline-2 focus-visible:outline-ink`;

export interface ButtonProps extends Omit<RACButtonProps, "className" | "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export function Button({
  variant = "dark",
  size = "md",
  icon,
  className = "",
  children,
  isPending,
  ...props
}: ButtonProps) {
  return (
    <RACButton
      {...props}
      isPending={isPending}
      className={`${base} ${buttonVariants[variant]} ${buttonSizes[size]} ${className}`}
    >
      {isPending ? <Loader2 aria-hidden className="size-[1.1em] animate-spin" /> : icon}
      {children}
    </RACButton>
  );
}

export type CircleVariant = "lime" | "white" | "night" | "soft" | "dark";

const circleVariants: Record<CircleVariant, string> = {
  lime: "bg-lime text-ink hover:bg-lime-strong",
  white: "bg-card text-ink hover:bg-panel",
  night: "bg-night-3 text-night-ink hover:bg-night-4 data-[focus-visible]:outline-lime",
  soft: "bg-panel text-ink hover:bg-line",
  dark: "bg-ink text-white hover:bg-night-3",
};

export interface IconButtonProps extends Omit<RACButtonProps, "className" | "children"> {
  label: string;
  children: ReactNode;
  variant?: CircleVariant | "ghost";
  size?: "sm" | "md" | "lg";
  className?: string;
}

/** Round icon button (the reference's lime action circles). Label is required for screen readers. */
export function IconButton({
  label,
  children,
  variant = "ghost",
  size = "md",
  className = "",
  ...props
}: IconButtonProps) {
  const dims = size === "sm" ? "size-9" : size === "lg" ? "size-13" : "size-11";
  const tone = variant === "ghost" ? "text-ink hover:bg-ink/6" : circleVariants[variant];
  return (
    <RACButton {...props} aria-label={label} className={`${base} ${tone} ${dims} p-0 ${className}`}>
      {children}
    </RACButton>
  );
}
