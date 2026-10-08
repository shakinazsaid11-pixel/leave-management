"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "My requests" },
  { href: "/new-request", label: "New request" },
  { href: "/approvals", label: "Approvals" },
];

// The three page links. Uses Next's Link so moving between pages does not
// reload the app, which keeps the chosen employee selected. The link for
// the page you are on is highlighted.
export default function NavBar() {
  const pathname = usePathname();

  return (
    <nav className="flex items-center gap-1 text-sm font-semibold">
      {LINKS.map((link) => {
        const active = pathname === link.href;
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={`rounded-lg px-3 py-2 transition-colors duration-150 ${
              active
                ? "bg-azure-500 text-white"
                : "text-slate-300 hover:bg-white/5 hover:text-azure-300"
            }`}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}