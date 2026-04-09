import { useEffect, useState } from "react";

export type AppRoute = "kiosk" | "analysis";

export function getCurrentRoute(): AppRoute {
  if (typeof window === "undefined") {
    return "kiosk";
  }

  return window.location.pathname === "/analysis" ? "analysis" : "kiosk";
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
    const nextPath = nextRoute === "analysis" ? "/analysis" : "/";
    window.history.pushState({}, "", nextPath);
    setRoute(nextRoute);
  };

  return {
    route,
    navigateTo
  };
}
