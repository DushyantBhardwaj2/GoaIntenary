import { Workspace } from "@/components/workspace";
export default async function TripPage({ params }: { params: Promise<{ tripId: string }> }) {
  return <Workspace tripId={(await params).tripId} />;
}
