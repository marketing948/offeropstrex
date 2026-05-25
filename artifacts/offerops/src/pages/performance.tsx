import { useEffect } from "react";
import { useLocation } from "wouter";

/** Legacy route — merged into Operations Hub. */
export default function PerformanceRedirect() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    setLocation("/ops");
  }, [setLocation]);
  return null;
}
