import { Sidebar } from "@/components/layout/sidebar";
import { Header } from "@/components/layout/header";
import { PageTransition } from "@/components/layout/page-transition";
import { getCurrentUserUiAccess } from "@/server/queries/ui-access";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const access = await getCurrentUserUiAccess();

  return (
    <div className="flex h-screen">
      <Sidebar access={access} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header />
        <main className="flex-1 overflow-y-auto p-6">
          <PageTransition>{children}</PageTransition>
        </main>
      </div>
    </div>
  );
}
