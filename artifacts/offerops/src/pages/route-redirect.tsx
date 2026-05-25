import { useEffect } from "react";
import { useLocation } from "wouter";

/** Client redirect for legacy aliases — keeps backend routes unchanged. */
export default function RouteRedirect({ to }: { to: string }) {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation(to);
  }, [to, setLocation]);
  return null;
}
