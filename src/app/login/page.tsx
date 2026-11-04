export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="container">
      <form className="card login" method="post" action="/api/login">
        <h2>Portfolio tracker</h2>
        {error && <div className="msg error">Wrong password.</div>}
        <label htmlFor="password" className="muted">Password</label>
        <input id="password" name="password" type="password" autoFocus required style={{ margin: "6px 0 12px" }} />
        <button className="btn primary" type="submit" style={{ width: "100%" }}>Log in</button>
      </form>
    </div>
  );
}
