import { loginAction } from "./Login-action";

export default function LoginPage() {
  return (
    <form action={loginAction}>
      <input
        name="username"
        placeholder="username"
        required
      />
      <input
        name="password"
        type="password"
        placeholder="password"
        required
      />
      <button type="submit">Login</button>
    </form>
  );
}
