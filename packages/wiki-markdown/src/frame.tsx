import type { ComponentPropsWithRef } from "react";

export type WikiMarkdownFrameProps = ComponentPropsWithRef<"div">;

function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function WikiMarkdownFrame({
  className,
  children,
  ...props
}: WikiMarkdownFrameProps) {
  return (
    <div
      className={classNames("wiki-markdown prose max-w-none", className)}
      {...props}
    >
      {children}
    </div>
  );
}
