import { useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth";
import { WorkspaceProvider } from "@/lib/workspace-context";
import { ExpFeedbackProvider } from "@/components/exp-feedback/exp-feedback-context";
import { Layout } from "@/components/layout";

import Login from "@/pages/login";
import Employees from "@/pages/employees";
import EmployeeDetail from "@/pages/employee-detail";
import TestingBatches from "@/pages/testing-batches";
import TestingBatchDetail from "@/pages/testing-batch-detail";
import Tasks from "@/pages/tasks";
import Activity from "@/pages/activity";
import Settings from "@/pages/settings";
import OperationsHub from "@/pages/operations-hub";
import OpsQueue from "@/pages/ops-queue";
import TrackerCampaigns from "@/pages/tracker-campaigns";
import LiveCampaigns from "@/pages/live-campaigns";
import Reports from "@/pages/reports";
import Profile from "@/pages/profile";
import NotFound from "@/pages/not-found";
import RouteRedirect from "@/pages/route-redirect";
import Dashboard from "@/pages/dashboard";
import CampaignReview from "@/pages/campaign-review";

const queryClient = new QueryClient();

function ProtectedRoute({ component: Component, adminOnly = false }: { component: any, adminOnly?: boolean }) {
  const { currentEmployee, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading) {
      if (!currentEmployee) {
        setLocation("/login");
      } else if (adminOnly && currentEmployee.role !== "admin") {
        setLocation("/ops");
      }
    }
  }, [currentEmployee, isLoading, adminOnly, setLocation]);

  if (isLoading || !currentEmployee || (adminOnly && currentEmployee.role !== "admin")) {
    return null;
  }

  return <Component />;
}

function Router() {
  const { currentEmployee } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (window.location.pathname === "/") {
      if (currentEmployee) {
        setLocation("/ops");
      } else {
        setLocation("/login");
      }
    }
  }, [currentEmployee, setLocation]);

  return (
    <Switch>
      <Route path="/login" component={Login} />

      <Route path="/ops">
        {() => <ProtectedRoute component={OperationsHub} />}
      </Route>
      {/* Internal legacy surface — not linked from sidebar; use /ops instead. */}
      <Route path="/ops/legacy">
        {() => <ProtectedRoute component={OpsQueue} />}
      </Route>

      {/* Voluum tracker stub — hidden from nav; deep links only. */}
      <Route path="/tracker-campaigns">
        {() => <ProtectedRoute component={TrackerCampaigns} />}
      </Route>

      <Route path="/live-campaigns">
        {() => <ProtectedRoute component={LiveCampaigns} />}
      </Route>

      {/* Legacy overview aliases → canonical operational homes */}
      <Route path="/dashboard">
        {() => <ProtectedRoute component={Dashboard} adminOnly />}
      </Route>
      <Route path="/employee-dashboard">
        {() => <ProtectedRoute component={() => <RouteRedirect to="/ops" />} />}
      </Route>
      <Route path="/mission-control">
        {() => <ProtectedRoute component={() => <RouteRedirect to="/ops" />} />}
      </Route>
      <Route path="/performance">
        {() => <ProtectedRoute component={() => <RouteRedirect to="/ops" />} />}
      </Route>

      <Route path="/employees">
        {() => <ProtectedRoute component={Employees} adminOnly={true} />}
      </Route>
      <Route path="/employees/:id">
        {() => <ProtectedRoute component={EmployeeDetail} adminOnly={true} />}
      </Route>

      <Route path="/testing-batches">
        {() => <ProtectedRoute component={TestingBatches} />}
      </Route>
      <Route path="/testing-batches/:id">
        {() => <ProtectedRoute component={TestingBatchDetail} />}
      </Route>

      <Route path="/tasks">
        {() => <ProtectedRoute component={Tasks} />}
      </Route>

      <Route path="/campaign-review">
        {() => <ProtectedRoute component={CampaignReview} />}
      </Route>

      <Route path="/activity">
        {() => <ProtectedRoute component={Activity} />}
      </Route>

      <Route path="/reports">
        {() => <ProtectedRoute component={Reports} />}
      </Route>
      <Route path="/daily-reports">
        {() => <ProtectedRoute component={() => <RouteRedirect to="/reports" />} />}
      </Route>
      <Route path="/weekly-reports">
        {() => <ProtectedRoute component={() => <RouteRedirect to="/reports" />} />}
      </Route>

      <Route path="/settings">
        {() => <ProtectedRoute component={Settings} adminOnly={true} />}
      </Route>

      {/* Profile — accessible to all authenticated users */}
      <Route path="/profile">
        {() => <ProtectedRoute component={Profile} />}
      </Route>

      {/* Legacy routes — redirect to their new homes */}
      <Route path="/goals">
        {() => { useEffect(() => { setLocation("/profile"); }, []); return null; }}
      </Route>
      <Route path="/admin/goals-config">
        {() => { useEffect(() => { setLocation("/settings"); }, []); return null; }}
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AuthProvider>
            <WorkspaceProvider>
              <ExpFeedbackProvider>
                <Layout>
                  <Router />
                </Layout>
              </ExpFeedbackProvider>
            </WorkspaceProvider>
          </AuthProvider>
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
