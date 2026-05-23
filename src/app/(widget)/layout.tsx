/**
 * Widget route group layout.
 *
 * Intentionally minimal — no CRM sidebar, header, or session providers.
 * The widget chat iframe must be fully self-contained and render
 * on any third-party website without CRM chrome.
 */
export default function WidgetLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, fontFamily: "system-ui, sans-serif" }}>
        {children}
      </body>
    </html>
  );
}
