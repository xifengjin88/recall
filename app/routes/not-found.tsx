import { data } from "react-router";

// Unknown URLs render the root ErrorBoundary as a 404.
export function clientLoader() {
  throw data("Not found", { status: 404 });
}

export default function NotFound() {
  return null;
}
