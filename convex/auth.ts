import GitHub from "@auth/core/providers/github";
import { convexAuth } from "@convex-dev/auth/server";

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  // GitHub now includes RFC 9207's `iss` callback parameter. Auth.js validates
  // it only when the provider declares the authorization-server issuer.
  providers: [
    GitHub({
      issuer: "https://github.com/login/oauth",
      profile(profile) {
        const login = String(profile.login || profile.id);
        return {
          id: String(profile.id),
          name: profile.name || login,
          email: profile.email || `${login}@users.noreply.github.com`,
          image: profile.avatar_url,
        };
      },
    }),
  ],
});
