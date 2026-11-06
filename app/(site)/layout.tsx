import SiteHeader from "@/components/SiteHeader";

// Every page except the two indexes: the site-wide header bar above the
// shared content column.
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 py-10">
        {children}
      </main>
    </>
  );
}
