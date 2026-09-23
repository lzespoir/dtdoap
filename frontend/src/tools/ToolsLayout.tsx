import type { ReactNode } from "react";

interface Props {
  title: string;
  children: ReactNode;
}

export default function ToolsLayout({ title, children }: Props) {
  return (
    <div className="tools-page">
      <header className="tools-header">
        <a href="/">← 返回 DTDOAP</a>
        <a href="/tools">工具列表</a>
        <h1>{title}</h1>
      </header>
      <main className="tools-main">{children}</main>
    </div>
  );
}
