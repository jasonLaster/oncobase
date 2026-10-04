import { LandingPage } from "./LandingPage";
import { SignInPage } from "./SignInPage";
import { asksForSignIn } from "./sign-in";

/**
 * `/login` introduces Diana TNBC. Private pages redirect here with their own
 * address, so those visitors go straight to the password.
 */
export function LoginPage() {
  return asksForSignIn(window.location.search) ? (
    <SignInPage />
  ) : (
    <LandingPage />
  );
}
