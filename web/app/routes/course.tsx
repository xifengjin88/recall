import { Outlet } from "react-router";
import type { Route } from "./+types/course";
import { ensureCourse } from "~/content/load";

// Every screen under /c/:course needs the course's content and progress loaded first.
export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  await ensureCourse(params.course);
  return null;
}

export default function CourseLayout() {
  return <Outlet />;
}
