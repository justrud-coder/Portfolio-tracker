import Link from "next/link";

export function Header({ active }: { active: "dashboard" | "update" }) {
  return (
    <header className="top">
      <h1>Portfolio</h1>
      <nav>
        <Link href="/" className={active === "dashboard" ? "active" : ""}>Dashboard</Link>
        <Link href="/update" className={active === "update" ? "active" : ""}>Monthly update</Link>
        <form method="post" action="/api/logout">
          <button className="btn" type="submit">Log out</button>
        </form>
      </nav>
    </header>
  );
}
