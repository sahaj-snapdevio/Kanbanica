import React from "react"
import { headers } from "next/headers"
import { auth } from "@/lib/auth"
import {
  UsersIcon,
  CurrencyDollarIcon,
  ChartLineUpIcon,
  ArrowUpIcon,
  ClockIcon,
  CheckCircleIcon,
  XCircleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react/dist/ssr"
import { StatGrid, Stat } from "@/components/ui/stat"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

const recentOrders = [
  { id: "#ORD-001", customer: "Alice Johnson", email: "alice@example.com", status: "completed",  amount: "$120.00", date: "Jun 11, 2026" },
  { id: "#ORD-002", customer: "Bob Smith",     email: "bob@example.com",   status: "processing", amount: "$85.50",  date: "Jun 11, 2026" },
  { id: "#ORD-003", customer: "Carol White",   email: "carol@example.com", status: "completed",  amount: "$240.00", date: "Jun 10, 2026" },
  { id: "#ORD-004", customer: "David Lee",     email: "david@example.com", status: "failed",     amount: "$60.00",  date: "Jun 10, 2026" },
  { id: "#ORD-005", customer: "Emma Davis",    email: "emma@example.com",  status: "pending",    amount: "$175.00", date: "Jun 09, 2026" },
  { id: "#ORD-006", customer: "Frank Miller",  email: "frank@example.com", status: "completed",  amount: "$95.00",  date: "Jun 09, 2026" },
]

const recentActivity = [
  { icon: CheckCircleIcon,    color: "text-emerald-500", label: "New user signed up",    time: "2 min ago",  detail: "alice@example.com" },
  { icon: CurrencyDollarIcon, color: "text-blue-500",    label: "Payment received",      time: "18 min ago", detail: "$240.00 from Carol White" },
  { icon: XCircleIcon,        color: "text-destructive", label: "Payment failed",        time: "1 hr ago",   detail: "$60.00 from David Lee" },
  { icon: UsersIcon,          color: "text-violet-500",  label: "Team member added",     time: "3 hr ago",   detail: "frank@example.com" },
  { icon: WarningCircleIcon,  color: "text-amber-500",   label: "Subscription expiring", time: "5 hr ago",   detail: "Pro plan — 3 days left" },
]

const channelData = [
  { channel: "Organic Search", sessions: 4823, pct: 72 },
  { channel: "Direct",         sessions: 1204, pct: 45 },
  { channel: "Social Media",   sessions: 893,  pct: 33 },
  { channel: "Email",          sessions: 612,  pct: 23 },
  { channel: "Referral",       sessions: 271,  pct: 10 },
]

const topUsers = [
  { name: "Alice Johnson", email: "alice@example.com", initials: "AJ", orders: 12, spend: "$1,440" },
  { name: "Carol White",   email: "carol@example.com", initials: "CW", orders: 9,  spend: "$2,160" },
  { name: "Emma Davis",    email: "emma@example.com",  initials: "ED", orders: 7,  spend: "$1,225" },
  { name: "Frank Miller",  email: "frank@example.com", initials: "FM", orders: 6,  spend: "$570"   },
]

const statusConfig: Record<string, { label: string; className: string }> = {
  completed:  { label: "Completed",  className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  processing: { label: "Processing", className: "bg-blue-500/10 text-blue-700 dark:text-blue-400" },
  pending:    { label: "Pending",    className: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  failed:     { label: "Failed",     className: "bg-destructive/10 text-destructive" },
}

export default async function DashboardPage() {
  const session = await auth.api.getSession({ headers: await headers() })
  const name = session?.user.name || session?.user.email || "there"

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Welcome back, <span className="font-medium text-foreground">{name}</span>. Here's what's happening.
        </p>
      </div>

      <StatGrid columns={4}>
        <Stat label="Total Revenue" value="$24,520" sublabel="+12.5% from last month" icon={<CurrencyDollarIcon />} tone="success" />
        <Stat label="Active Users" value="1,284" sublabel="+8.2% from last month" icon={<UsersIcon />} />
        <Stat label="Conversion Rate" value="3.6%" sublabel="-0.4% from last month" icon={<ChartLineUpIcon />} tone="warning" />
        <Stat label="Churn Rate" value="1.2%" sublabel="+0.3% from last month" icon={<ArrowUpIcon />} tone="destructive" />
      </StatGrid>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="normal-case tracking-normal text-sm font-semibold">Recent Orders</CardTitle>
                <CardDescription>Latest 6 transactions across all customers</CardDescription>
              </div>
              <span className="text-xs text-muted-foreground tabular-nums">{recentOrders.length} orders</span>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Order</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Date</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentOrders.map((order) => {
                  const cfg = statusConfig[order.status]
                  return (
                    <TableRow key={order.id}>
                      <TableCell className="font-mono text-muted-foreground">{order.id}</TableCell>
                      <TableCell>
                        <div>
                          <p className="font-medium">{order.customer}</p>
                          <p className="text-muted-foreground">{order.email}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${cfg.className}`}>
                          {cfg.label}
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-mono font-medium">{order.amount}</TableCell>
                      <TableCell className="text-muted-foreground">{order.date}</TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="normal-case tracking-normal text-sm font-semibold">Recent Activity</CardTitle>
            <CardDescription>Latest events across your workspace</CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-0">
              {recentActivity.map((item, i) => (
                <li key={i} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className={`mt-0.5 shrink-0 ${item.color}`}>
                      <item.icon className="size-4" weight="fill" />
                    </div>
                    {i < recentActivity.length - 1 && (
                      <div className="w-px flex-1 bg-border my-1" />
                    )}
                  </div>
                  <div className="pb-4 min-w-0">
                    <p className="text-sm font-medium leading-tight">{item.label}</p>
                    <p className="text-xs text-muted-foreground truncate">{item.detail}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                      <ClockIcon className="size-3" />
                      {item.time}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="normal-case tracking-normal text-sm font-semibold">Traffic by Channel</CardTitle>
            <CardDescription>Sessions breakdown for the last 30 days</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {channelData.map((row) => (
              <div key={row.channel} className="space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{row.channel}</span>
                  <span className="tabular-nums text-muted-foreground">{row.sessions.toLocaleString()}</span>
                </div>
                <Progress value={row.pct} className="h-1.5" />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="normal-case tracking-normal text-sm font-semibold">Top Customers</CardTitle>
            <CardDescription>Highest-spending users this month</CardDescription>
          </CardHeader>
          <CardContent className="space-y-0">
            {topUsers.map((user, i) => (
              <React.Fragment key={user.email}>
                <div className="flex items-center gap-3 py-3">
                  <span className="w-4 text-xs text-muted-foreground tabular-nums">{i + 1}</span>
                  <Avatar size="sm">
                    <AvatarFallback>{user.initials}</AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{user.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-mono font-medium">{user.spend}</p>
                    <p className="text-xs text-muted-foreground">{user.orders} orders</p>
                  </div>
                </div>
                {i < topUsers.length - 1 && <Separator />}
              </React.Fragment>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="normal-case tracking-normal text-sm font-semibold">Monthly Goals</CardTitle>
          <CardDescription>Progress towards your targets for June 2026</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 sm:grid-cols-3">
            {[
              { label: "Revenue",     current: 24520, target: 30000, pct: 82 },
              { label: "New Signups", current: 312,   target: 500,   pct: 62 },
              { label: "Churn Rate",  current: 1.2,   target: 1.0,   pct: 40 },
            ].map((goal) => (
              <div key={goal.label} className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{goal.label}</span>
                  <span className="text-muted-foreground tabular-nums">{goal.pct}%</span>
                </div>
                <Progress value={goal.pct} className="h-2" />
                <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                  <span>{goal.label === "Revenue" ? `$${goal.current.toLocaleString()}` : goal.current}</span>
                  <span>{goal.label === "Revenue" ? `$${goal.target.toLocaleString()}` : goal.target}</span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
