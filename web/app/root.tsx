import { APP } from "~/config";
import { isRouteErrorResponse, Link, Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

import type { Route } from "./+types/root";
import { SUBJECT } from "./content";
import { THEME_KEY } from "./state/progress-store";
import "./app.css";

// Runs before first paint so a saved dark theme doesn't flash light.
const THEME_BOOT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(THEME_KEY)})||"system";var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);document.documentElement.classList.toggle("dark",d)}catch(e){}})()`;

export function meta() {
  return [{ title: `${APP.name} · ${SUBJECT.short}` }, { name: "description", content: `${APP.tagline}: ${SUBJECT.title}` }];
}

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
        <Meta />
        <Links />
      </head>
      <body className="min-h-dvh overflow-x-hidden antialiased">
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function HydrateFallback() {
  return (
    <div className="grid min-h-dvh place-items-center text-sm text-muted-foreground" role="status">
      Loading…
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Something went wrong";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "Not found" : "Error";
    details = error.status === 404 ? "That page doesn't exist." : error.statusText || details;
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="mx-auto max-w-2xl space-y-3 p-6 pt-16">
      <h1 className="text-2xl font-semibold">{message}</h1>
      <p className="text-muted-foreground">{details}</p>
      <Link to="/" className="text-sm font-medium underline underline-offset-4">
        Back home
      </Link>
      {stack && (
        <pre className="overflow-x-auto rounded-lg bg-muted p-4 font-mono text-xs">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
