const COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function getRefreshCookieConfig({ NODE_ENV = "development", APP_STAGE = "local" } = {}) {
  const secure = NODE_ENV === "production" || APP_STAGE === "staging" || APP_STAGE === "production";
  return {
    cookieName: secure ? "__Host-lh_refresh" : "lh_refresh",
    cookieOptions: {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      maxAge: COOKIE_MAX_AGE_MS,
    },
  };
}

export function setRefreshCookie(res, token, { cookieName, cookieOptions }) {
  res.cookie(cookieName, token, cookieOptions);
}

export function clearRefreshCookie(res, { cookieName, cookieOptions }) {
  const { maxAge: _maxAge, ...options } = cookieOptions;
  res.clearCookie(cookieName, options);
}
