import Link from "next/link";

/**
 * The teacher-area tab bar: Scores (/admin) · Students (/admin/students).
 * Rendered only for teachers (the pages decide). A plain server component — the
 * active tab is passed in, so no client-side routing hook is needed.
 */
export default function AdminTabs({ active }: { active: "scores" | "students" }) {
  const tab = (href: string, key: "scores" | "students", label: string) => (
    <Link
      href={href}
      className={
        active === key
          ? "border-b-2 border-stone-900 pb-2 text-sm font-medium text-stone-900"
          : "border-b-2 border-transparent pb-2 text-sm text-stone-500 transition hover:text-stone-900"
      }
    >
      {label}
    </Link>
  );

  return (
    <nav className="mb-6 flex gap-6 border-b border-stone-200">
      {tab("/admin", "scores", "Scores")}
      {tab("/admin/students", "students", "Students")}
    </nav>
  );
}
