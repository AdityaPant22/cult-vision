import { useEffect, useState } from "react";

export type AppRoute = "kiosk" | "analysis" | "setup";

export function getCurrentRoute(): AppRoute {
  if (typeof window === "undefined") {
    return "kiosk";
  }

  if (window.location.pathname === "/analysis") {
    return "analysis";
  }

  if (window.location.pathname === "/setup") {
    return "setup";
  }

  return "kiosk";
}

export function useAppRoute() {
  const [route, setRoute] = useState<AppRoute>(getCurrentRoute);

  useEffect(() => {
    const handlePopState = () => setRoute(getCurrentRoute());
    window.addEventListener("popstate", handlePopState);

    return () => {
      window.removeEventListener("popstate", handlePopState);
    };
  }, []);

  const navigateTo = (nextRoute: AppRoute) => {
    const nextPath =
      nextRoute === "analysis" ? "/analysis" : nextRoute === "setup" ? "/setup" : "/";
    window.history.pushState({}, "", nextPath);
    setRoute(nextRoute);
  };

  return {
    route,
    navigateTo
  };
}
