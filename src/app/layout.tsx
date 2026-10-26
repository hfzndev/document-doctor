import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Document Doctor", template: "%s · Document Doctor" },
  description: "Fill in Word templates on the web, preview them live and export DOCX or PDF.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
