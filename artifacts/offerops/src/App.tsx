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
import Dashboard from "@/pages/dashboard";
import EmployeeDashboard from "@/pages/employee-dashboard";
import Employees from "@/pages/employees";
import EmployeeDetail from "@/pages/employee-detail";
import TestingBatches from "@/pages/testing-batches";
import TestingBatchDetail from "@/pages/testing-batch-detail";
import Tasks from "@/pages/tasks";
import Activity from "@/pages/activity";
import DailyReports from "@/pages/daily-reports";
import WeeklyReports from "@/pages/weekly-reports";
import Settings from "@/pages/settings";
import PerformanceRedirect from "@/pages/performance";
import OperationsHub from "@/pages/operations-hub";
import OpsQueue from "@/pages/ops-queue";
import TrackerCampaigns from "@/pages/tracker-campaigns";
import LiveCampaigns from "@/pages/live-campaigns";
import Reports from "@/pages/reports";
import Profile from "@/pages/profile";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient();

function ProtectedRoute({ component: Component, adminOnly = false }: { component: any, adminOnly?: boolean }) {
  const { currentEmployee, isLoading } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading) {
      if (!currentEmployee) {
        setLocation("/login");
      } else if (adminOnly && currentEmployee.role !== "admin") {
        setLocation("/employee-dashboard");
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
      <Route path="/ops/legacy">
        {() => <ProtectedRoute component={OpsQueue} />}
      </Route>

      <Route path="/tracker-campaigns">
        {() => <ProtectedRoute component={TrackerCampaigns} />}
      </Route>
      {/* Phase 9c: legacy /live-campaigns kept as a redirect alias so any
          stale bookmarks land on the new page without a 404. */}
      <Route path="/live-campaigns">
        {() => <ProtectedRoute component={LiveCampaigns} />}
      </Route>

      <Route path="/dashboard">
        {() => <ProtectedRoute component={Dashboard} adminOnly={true} />}
      </Route>
      <Route path="/employee-dashboard">
        {() => <ProtectedRoute component={EmployeeDashboard} />}
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

      <Route path="/activity">
        {() => <ProtectedRoute component={Activity} />}
      </Route>

      <Route path="/reports">
        {() => <ProtectedRoute component={Reports} />}
      </Route>
      <Route path="/daily-reports">
        {() => <ProtectedRoute component={DailyReports} />}
      </Route>
      <Route path="/weekly-reports">
        {() => <ProtectedRoute component={WeeklyReports} />}
      </Route>

      <Route path="/performance">
        {() => <ProtectedRoute component={PerformanceRedirect} />}
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
