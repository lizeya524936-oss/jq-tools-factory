import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { ClientProvider, useClient } from "./contexts/ClientContext";
import Home from "./pages/Home";
import LoginPage from "./pages/LoginPage";

function AppShell() {
  const { isLoggedIn } = useClient();

  if (!isLoggedIn) {
    return <LoginPage />;
  }

  return (
    <Switch>
      <Route path={"/"} component={Home} />
      <Route path={"/404"} component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <ClientProvider>
          <TooltipProvider>
            <Toaster />
            <AppShell />
          </TooltipProvider>
        </ClientProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
