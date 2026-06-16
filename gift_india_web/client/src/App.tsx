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
import { Menu } from 'lucide-react';
import { GiftSeal } from './components/GiftSeal';
import { DemoGuide, DemoLaunchButton } from './components/DemoGuide';
import { TrustDeskPage } from './pages/TrustDeskPage';
import { MapPage } from './pages/MapPage';
import { ScorecardPage } from './pages/ScorecardPage';
import { FacilityPage } from './pages/FacilityPage';
import { ReviewsPage } from './pages/ReviewsPage';
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
        Trust Desk
      </NavLink>
      <NavLink to="/navigator" className={linkClass} onClick={onClick}>
        Navigator
      </NavLink>
      <NavLink to="/open-navigator" className={linkClass} onClick={onClick}>
        Open Navigator
      </NavLink>
      <NavLink to="/scorecard" className={linkClass} onClick={onClick}>
        Scorecard
      </NavLink>
      <NavLink to="/reviews" className={linkClass} onClick={onClick}>
        My Reviews
      </NavLink>
    </nav>
  );
}

function Layout() {
  const isMobile = useIsMobile();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    api.whoami().then((r) => setEmail(r.email)).catch(() => undefined);
  }, []);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="sticky top-0 z-30 border-b bg-background/80 px-4 md:px-6 py-3 flex items-center gap-4 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="flex items-center gap-2.5">
          <GiftSeal size={36} showText={false} className="gift-seal-glow shrink-0" />
          <div className="leading-tight max-w-[11rem] sm:max-w-none">
            <span className="block text-[10px] font-bold uppercase tracking-[0.14em] text-amber-700">GIFT Gauge ✨</span>
            <span className="block text-xs sm:text-sm font-semibold text-foreground leading-snug">
              Great care, brought to light
            </span>
          </div>
        </div>
        <NavLinks className="hidden md:flex gap-1 ml-4" linkClass={navLinkClass} />
        <div className="ml-auto flex items-center gap-3">
          <DemoLaunchButton />
          {email && <Badge variant="outline" className="hidden sm:inline-flex">{email}</Badge>}
          <div className="md:hidden">
            <Sheet open={mobileNavOpen && isMobile} onOpenChange={setMobileNavOpen}>
              <Button variant="ghost" size="icon" onClick={() => setMobileNavOpen(true)}>
                <Menu className="h-5 w-5" />
                <span className="sr-only">Open navigation</span>
              </Button>
              <SheetContent side="left">
                <SheetHeader>
                  <SheetTitle>GIFT Gauge ✨ — Great care, brought to light</SheetTitle>
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
        Trust signals computed in gold.* from facility records in Lakebase Postgres · Virtue Foundation hackathon demo
      </footer>

      <DemoGuide />
    </div>
  );
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <TrustDeskPage /> },
      { path: '/navigator', element: <MapPage /> },
      { path: '/open-navigator', element: <MapPage /> },
      { path: '/scorecard', element: <ScorecardPage /> },
      { path: '/facility/:id', element: <FacilityPage /> },
      { path: '/reviews', element: <ReviewsPage /> },
    ],
  },
]);

export default function App() {
  return <RouterProvider router={router} />;
}
