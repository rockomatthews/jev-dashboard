import Dashboard from "@/components/Dashboard";
import { loadPerformance } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Page() {
  const initial = await loadPerformance();
  return <Dashboard initial={initial} />;
}
