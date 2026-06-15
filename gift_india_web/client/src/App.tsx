import { createBrowserRouter, RouterProvider, NavLink, Outlet } from 'react-router';
import { useState, useEffect } from 'react';
import {
  Button,
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Badge,
  useIsMobile,
} from '@databricks/appkit-ui/react';
import { Menu, Stethoscope } from 'lucide-react';
import { NavigatorPage } from './pages/NavigatorPage';
import { MapPage } from './pages/MapPage';
import { PlansPage } from './pages/PlansPage';
import { api } from './lib/api';

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
    isActive
      ? 'bg-primary text-primary-foreground'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
  }`;

const mobileNavLinkClass = ({ isActive }: { isActive: boolean }) =>
  `block px-3 py-2 rounded-md text-sm font-medium transition-colors ${
    isActive
      ? 'bg-primary text-primary-foreground'
      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
  }`;

type NavLinkClassFn = (props: { isActive: boolean }) => string;

function NavLinks({ className, linkClass, onClick }: { className?: string; linkClass: NavLinkClassFn; onClick?: () => void }) {
  return (
    <nav className={className}>
      <NavLink to="/" end className={linkClass} onClick={onClick}>
        Navigator
      </NavLink>
      <NavLink to="/map" className={linkClass} onClick={onClick}>
        Desert Map
      </NavLink>
      <NavLink to="/plans" className={linkClass} onClick={onClick}>
        Saved Plans
      </NavLink>
    </nav>
  );
}

function Layout() {
  const isMobile = useIsMobile();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    if (!isMobile) setMobileNavOpen(false);
  }, [isMobile]);

  useEffect(() => {
    api.whoami().then((r) => setEmail(r.email)).catch(() => undefined);
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="border-b px-4 md:px-6 py-3 flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Stethoscope className="h-5 w-5" />
          </span>
          <div className="leading-tight">
            <span className="block text-base font-semibold text-foreground">GIFT India</span>
            <span className="block text-[11px] text-muted-foreground">Gold Insights & Facility Templates for India</span>
          </div>
        </div>
        <NavLinks className="hidden md:flex gap-1 ml-4" linkClass={navLinkClass} />
        <div className="ml-auto flex items-center gap-3">
          {email && <Badge variant="outline" className="hidden sm:inline-flex">{email}</Badge>}
          <div className="md:hidden">
            <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
              <Button variant="ghost" size="icon" onClick={() => setMobileNavOpen(true)}>
                <Menu className="h-5 w-5" />
                <span className="sr-only">Open navigation</span>
              </Button>
              <SheetContent side="left">
                <SheetHeader>
                  <SheetTitle>GIFT India</SheetTitle>
                </SheetHeader>
                <NavLinks className="flex flex-col gap-1 mt-4" linkClass={mobileNavLinkClass} onClick={() => setMobileNavOpen(false)} />
              </SheetContent>
            </Sheet>
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-6">
        <Outlet />
      </main>

      <footer className="border-t px-4 md:px-6 py-3 text-xs text-muted-foreground">
        Data synced from Unity Catalog into Lakebase Postgres · Virtue Foundation hackathon demo
      </footer>
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <NavigatorPage /> },
      { path: '/map', element: <MapPage /> },
      { path: '/plans', element: <PlansPage /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
