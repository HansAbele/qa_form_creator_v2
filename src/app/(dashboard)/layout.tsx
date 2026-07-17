import { Header } from "@/components/layout/header";
import { PageTransition } from "@/components/layout/page-transition";
import { Sidebar } from "@/components/layout/sidebar";
import { getCurrentUserUiAccess } from "@/server/queries/ui-access";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const access = await getCurrentUserUiAccess();

  return (
    <div className="flex min-h-dvh min-w-0 items-stretch bg-sidebar">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[100] focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
      >
        Saltar al contenido principal
      </a>
      <Sidebar access={access} />
      <div className="flex min-h-dvh min-w-0 flex-1 flex-col bg-background">
        <Header access={access} />
        <main
          id="main-content"
          tabIndex={-1}
          className="min-w-0 flex-1 scroll-mt-14 px-4 py-4 focus:outline-none sm:px-6 sm:py-6"
        >
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  );
}
