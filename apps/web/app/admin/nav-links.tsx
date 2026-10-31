"use client";

import { usePathname } from "next/navigation";

/** Menü der Verwaltung; der aktuelle Bereich wird hervorgehoben. */
export function NavLinks(props: { links: { href: string; label: string }[] }) {
  const path = usePathname() ?? "";
  const active = (href: string) => (href === "/admin" ? path === "/admin" : path === href || path.startsWith(`${href}/`));
  return (
    <>
      {props.links.map((l) => (
        <a key={l.href} href={l.href} aria-current={active(l.href) ? "page" : undefined}>
          {l.label}
        </a>
      ))}
    </>
  );
}
