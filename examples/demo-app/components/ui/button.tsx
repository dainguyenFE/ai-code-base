import type { ButtonHTMLAttributes, ReactNode } from "react";

/** shadcn/ui Button stub — UI library boundary (do not trace implementation details) */
export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: "default" | "outline" | "ghost" | "destructive";
  size?: "default" | "sm" | "lg" | "icon";
}

export function Button({
  children,
  variant = "default",
  size = "default",
  ...props
}: ButtonProps) {
  return (
    <button
      data-shadcn="Button"
      data-variant={variant}
      data-size={size}
      type={props.type ?? "button"}
      {...props}
    >
      {children}
    </button>
  );
}
