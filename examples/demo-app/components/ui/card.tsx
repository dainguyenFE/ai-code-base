import type { HTMLAttributes, ReactNode } from "react";

/** shadcn/ui Card stub — UI library boundary */
export function Card({
  children,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div data-shadcn="Card" className={className} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div data-shadcn="CardHeader" {...props}>
      {children}
    </div>
  );
}

export function CardTitle({
  children,
  ...props
}: HTMLAttributes<HTMLHeadingElement> & { children: ReactNode }) {
  return (
    <h3 data-shadcn="CardTitle" {...props}>
      {children}
    </h3>
  );
}

export function CardContent({
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div data-shadcn="CardContent" {...props}>
      {children}
    </div>
  );
}
