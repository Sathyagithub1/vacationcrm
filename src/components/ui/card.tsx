import * as React from "react";
import { cn } from "@/lib/utils";

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  header?: React.ReactNode;
  noPadding?: boolean;
}

function Card({ className, header, noPadding, children, ...props }: CardProps) {
  return (
    <div
      className={cn(
        "rounded-lg border border-gray-200 bg-card shadow-sm",
        className
      )}
      {...props}
    >
      {header && (
        <div className="border-b border-gray-200 px-6 py-4">
          {typeof header === "string" ? (
            <h3 className="text-lg font-semibold text-gray-900">{header}</h3>
          ) : (
            header
          )}
        </div>
      )}
      <div className={cn(!noPadding && "p-6")}>{children}</div>
    </div>
  );
}

export { Card };
