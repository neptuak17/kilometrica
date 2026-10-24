import { Tabs, TabsContent, TabsList, TabsTrigger } from '@dpg/ui';

export const Default = () => (
  <Tabs defaultSelectedKey="dream" className="max-w-sm">
    <TabsList>
      <TabsTrigger id="dream">Dream</TabsTrigger>
      <TabsTrigger id="plan">Plan</TabsTrigger>
      <TabsTrigger id="go">Go</TabsTrigger>
    </TabsList>
    <TabsContent id="dream" className="text-muted-foreground">
      Which stretch suits you, when, and which way.
    </TabsContent>
    <TabsContent id="plan" className="text-muted-foreground">
      Days, nights and the decisions only you can make.
    </TabsContent>
    <TabsContent id="go" className="text-muted-foreground">
      Your plan at a glance, on the road.
    </TabsContent>
  </Tabs>
);

export const Line = () => (
  <Tabs defaultSelectedKey="days" className="max-w-sm">
    <TabsList variant="line">
      <TabsTrigger id="brief">Brief</TabsTrigger>
      <TabsTrigger id="days">The days</TabsTrigger>
      <TabsTrigger id="before">Before you go</TabsTrigger>
    </TabsList>
    <TabsContent id="brief" className="text-muted-foreground">
      Five lines on what you're taking on.
    </TabsContent>
    <TabsContent id="days" className="text-muted-foreground">
      Day 1 · Cádiz → Conil de la Frontera · 62 km
    </TabsContent>
    <TabsContent id="before" className="text-muted-foreground">
      4 checks and a train at one end.
    </TabsContent>
  </Tabs>
);
