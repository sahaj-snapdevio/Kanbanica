"use client";

import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useTabParam } from "@/hooks/use-tab-param";

const TAB_VALUES = [
  "overview",
  "networking",
  "snapshots",
  "members",
  "activity",
] as const;

/**
 * Client tab shell for the Orbit cube-detail page. The page (a server
 * component) builds each section's cards server-side and passes them in as
 * slots; this shell only owns the tab layout — mirroring the slot pattern used
 * by ServerDetail. Keeping it a thin shell means no cube data fetching moves to
 * the client.
 */
export function CubeDetailTabs({
  overview,
  networking,
  snapshots,
  members,
  activity,
}: {
  overview: ReactNode;
  networking: ReactNode;
  snapshots: ReactNode;
  members: ReactNode;
  activity: ReactNode;
}) {
  const tabParam = useTabParam(TAB_VALUES, "overview");
  return (
    <Tabs className="space-y-6" {...tabParam}>
      <TabsList className="w-full justify-start overflow-x-auto">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="networking">Networking</TabsTrigger>
        <TabsTrigger value="snapshots">Snapshots</TabsTrigger>
        <TabsTrigger value="members">Members</TabsTrigger>
        <TabsTrigger value="activity">Activity</TabsTrigger>
      </TabsList>
      <TabsContent className="space-y-6" value="overview">
        {overview}
      </TabsContent>
      <TabsContent className="space-y-6" value="networking">
        {networking}
      </TabsContent>
      <TabsContent className="space-y-6" value="snapshots">
        {snapshots}
      </TabsContent>
      <TabsContent className="space-y-6" value="members">
        {members}
      </TabsContent>
      <TabsContent className="space-y-6" value="activity">
        {activity}
      </TabsContent>
    </Tabs>
  );
}
