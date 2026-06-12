import type { HTMLAttributes, ReactNode } from "react";

/** shadcn/ui Badge stub — UI library boundary */
export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  variant?: "default" | "secondary" | "outline" | "destructive";
}

export function Badge({ children, variant = "default", ...props }: BadgeProps) {
  return (
    <span data-shadcn="Badge" data-variant={variant} {...props}>
      {children}
    </span>
  );
}
