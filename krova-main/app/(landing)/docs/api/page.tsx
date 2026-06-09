import {
  ArrowRightIcon,
  CodeIcon,
  LinkSimpleIcon,
} from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { PRODUCT_NAME } from "@/config/platform";
import { env } from "@/lib/env";
import { breadcrumbJsonLd, JsonLd, techArticleJsonLd } from "@/lib/seo/jsonld";
import { pageOpenGraph, pageTwitter } from "@/lib/seo/metadata";

export const metadata: Metadata = {
  title: { absolute: `${PRODUCT_NAME} API — REST Reference` },
  description: `Manage Cubes, snapshots, domains, and webhooks programmatically with the ${PRODUCT_NAME} v1 REST API — scoped API keys, idempotency, OpenAPI spec.`,
  alternates: { canonical: "/docs/api" },
  openGraph: pageOpenGraph({
    url: "/docs/api",
    title: `${PRODUCT_NAME} API — REST Reference`,
    description: `Manage Cubes, snapshots, domains, port mappings, and backups via the ${PRODUCT_NAME} REST API.`,
  }),
  twitter: pageTwitter({
    title: `${PRODUCT_NAME} API — REST Reference`,
    description: `REST API reference for the ${PRODUCT_NAME} cloud platform.`,
  }),
};

export default function DocsApiPage() {
  const productName = PRODUCT_NAME;
  const baseUrl = env.NEXT_PUBLIC_APP_URL.replace(/\/+$/, "");

  return (
    <div>
      <JsonLd
        data={techArticleJsonLd({
          headline: `${productName} API — REST Reference`,
          description: `${productName} REST API v1 reference for managing Cubes, snapshots, domains, port mappings, and backups.`,
          path: "/docs/api",
        })}
      />
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Docs", path: "/docs/api" },
          { name: "API", path: "/docs/api" },
        ])}
      />
      <section>
        <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6 sm:py-20 lg:px-8">
          <Badge className="mb-6" variant="secondary">
            <CodeIcon className="mr-1.5 h-3.5 w-3.5" weight="duotone" />
            API v1
          </Badge>
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">
            {productName} API
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-muted-foreground">
            Create, manage, and destroy Cubes programmatically — the same
            hardware-isolated microVMs you get in the dashboard, each with its
            own kernel, a per-cube sandbox, and no public IP. Scoped API keys,
            idempotency, and a machine-readable OpenAPI spec.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg" variant="outline">
              <Link href="/post-auth">
                <ArrowRightIcon className="mr-2 h-4 w-4" />
                Go to Dashboard
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/api/v1/openapi.json">
                <CodeIcon className="mr-2 h-4 w-4" />
                OpenAPI spec
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/">
                <LinkSimpleIcon className="mr-2 h-4 w-4" />
                Back to Home
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <Separator />

      <section>
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Authentication
          </h2>
          <p className="mt-6 text-muted-foreground">
            All API requests (except <code>/regions</code>, <code>/images</code>
            , and <code>/pricing</code>) require an API key. Generate keys from
            your Space Settings in the dashboard. Each key is scoped to a single
            Space and inherits the permissions of the membership that created
            it.
          </p>

          <Card className="mt-10">
            <CardHeader>
              <CardTitle>Include your key in every request</CardTitle>
              <CardDescription>
                Pass your API key as the <code>X-API-KEY</code> header.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="overflow-x-auto bg-muted/50 p-4 font-mono text-xs">
                <code>
                  {`curl -H "X-API-KEY: kro_your_key_here" ${baseUrl}/api/v1/regions`}
                </code>
              </pre>
            </CardContent>
          </Card>
        </div>
      </section>

      <Separator />

      <section>
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Idempotency
          </h2>
          <p className="mt-6 text-muted-foreground">
            Mutating <code>POST</code> endpoints accept an optional{" "}
            <code>Idempotency-Key</code> header. Replays return the original
            response without re-running the operation. Keys expire after 24
            hours and are scoped per Space.
          </p>
          <p className="mt-4 text-muted-foreground">
            Supported on: create cube, add domain, create TCP mapping, create
            snapshot.
          </p>
          <pre className="mt-6 overflow-x-auto bg-muted/50 p-4 font-mono text-xs">
            <code>{"Idempotency-Key: <any unique string, max 255 chars>"}</code>
          </pre>
          <p className="mt-4 text-sm text-muted-foreground">
            Replayed responses include the header{" "}
            <code>Idempotency-Replayed: true</code>.
          </p>
        </div>
      </section>

      <Separator />

      <section>
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Endpoints
          </h2>
          <p className="mt-6 wrap-break-word text-muted-foreground">
            Base URL: <code className="break-all">{`${baseUrl}/api/v1`}</code>
          </p>

          <h3 className="mt-12 text-xl font-bold">Public</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            No authentication required.
          </p>
          <div className="mt-6 space-y-6">
            <EndpointBlock
              header={<EndpointHeader method="GET" path="/regions" public />}
              id="regions"
            >
              <p className="text-muted-foreground">
                List regions with available capacity.
              </p>
              <div className="mt-6 space-y-6">
                <CodeExample
                  code={`curl ${baseUrl}/api/v1/regions`}
                  title="Example request"
                />
                <CodeExample
                  code={`{\n  "regions": [\n    {\n      "id": "abc123...",\n      "name": "Germany (Nuremberg)",\n      "slug": "eu-nuremberg"\n    }\n  ]\n}`}
                  title="Example response"
                />
              </div>
            </EndpointBlock>

            <EndpointBlock
              header={<EndpointHeader method="GET" path="/images" public />}
              id="images"
            >
              <p className="text-muted-foreground">
                List the OS images you can pass as <code>image</code> when
                creating a Cube.
              </p>
              <div className="mt-6 space-y-6">
                <CodeExample
                  code={`curl ${baseUrl}/api/v1/images`}
                  title="Example request"
                />
                <CodeExample
                  code={`{\n  "images": [\n    {\n      "id": "ubuntu-24.04",\n      "name": "Ubuntu 24.04 LTS",\n      "version": "24.04",\n      "description": "Ubuntu 24.04 LTS (Debian-based)"\n    }\n  ]\n}`}
                  title="Example response"
                />
              </div>
            </EndpointBlock>

            <EndpointBlock
              header={<EndpointHeader method="GET" path="/pricing" public />}
              id="pricing"
            >
              <p className="text-muted-foreground">
                Per-resource hourly rates and volume tiers. Every allocated GB
                of RAM and disk is billed — Krova sells 1:1 with host resources
                and does not oversell. Tier multiplier is applied to all rates.
              </p>
              <div className="mt-6 space-y-6">
                <p className="mt-2 text-xs text-muted-foreground">
                  Rates are quoted per hour but billed by the minute — run a
                  Cube for 5 minutes and you pay for 5 minutes.
                </p>
                <CodeExample
                  code={`curl ${baseUrl}/api/v1/pricing`}
                  title="Example request"
                />
                <CodeExample
                  code={`{\n  "currency": "USD",\n  "rates": {\n    "vcpuPerHour": 0.001,\n    "ramGbPerHour": 0.0025,\n    "diskGbPerHour": 0.00005\n  },\n  "tiers": [\n    { "minVcpus": 1, "maxVcpus": 2, "multiplier": 1.00, "label": "Standard" },\n    { "minVcpus": 3, "maxVcpus": 4, "multiplier": 0.95, "label": "Plus" },\n    { "minVcpus": 5, "maxVcpus": 8, "multiplier": 0.85, "label": "Pro" },\n    { "minVcpus": 9, "maxVcpus": null, "multiplier": 0.80, "label": "Enterprise" }\n  ],\n  "note": "Running Cubes pay vCPU + RAM + disk per hour; sleeping Cubes pay only diskGbPerHour × diskLimitGb × tierMultiplier per hour. RAM and disk are sold 1:1 with host resources — no overselling."\n}`}
                  title="Example response"
                />
              </div>
            </EndpointBlock>
          </div>

          <h3 className="mt-12 text-xl font-bold">Cubes</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            <code>publicIpv4</code> is the shared host-gateway address you use
            to reach a Cube&apos;s mapped ports (SSH and any TCP mappings) — not
            a dedicated public IP for the Cube. Each Cube has no public IP of
            its own; only the ports you explicitly map are reachable, and each
            can be locked to an IP allowlist.
          </p>
          <div className="mt-6 space-y-6">
            <EndpointBlock
              header={
                <EndpointHeader
                  method="GET"
                  path="/spaces/{spaceId}/cubes"
                  permission="cube.view"
                />
              }
              id="list-cubes"
            >
              <p className="text-muted-foreground">
                List all Cubes in a space. Returns the normalized cube shape
                including <code>state</code>, <code>resources</code>, and{" "}
                <code>costPerHour</code>.
              </p>
              <div className="mt-6 space-y-6">
                <CodeExample
                  code={`curl -H "X-API-KEY: kro_your_key" \\\n  ${baseUrl}/api/v1/spaces/{spaceId}/cubes`}
                  title="Example request"
                />
                <CodeExample
                  code={`{\n  "cubes": [\n    {\n      "id": "cube_abc123",\n      "name": "my-api-server",\n      "state": "running",\n      "publicIpv4": "1.2.3.4",\n      "resources": {\n        "vcpu": 2,\n        "ramGb": 4,\n        "diskGb": 30\n      },\n      "image": "ubuntu-24.04",\n      "costPerHour": 0.0135,\n      "createdAt": "2026-05-01T12:00:00.000Z",\n      "updatedAt": "2026-05-01T12:05:00.000Z"\n    }\n  ],\n  "pagination": {\n    "page": 1,\n    "limit": 10,\n    "total": 1,\n    "totalPages": 1\n  }\n}`}
                  title="Example response"
                />
              </div>
            </EndpointBlock>

            <EndpointBlock
              header={
                <EndpointHeader
                  method="POST"
                  path="/spaces/{spaceId}/cubes"
                  permission="cube.create"
                />
              }
              id="create-cube"
            >
              <p className="text-muted-foreground">
                Create a new Cube. Provisioning runs asynchronously — poll the
                get-cube endpoint to track <code>state</code>.
              </p>

              <p className="mt-6 mb-2 text-sm font-medium">
                Request Body (JSON)
              </p>
              <div className="overflow-x-auto border bg-card">
                <table className="w-full min-w-160 text-sm">
                  <thead>
                    <tr className="border-b bg-muted/50 text-left">
                      <th className="p-3 font-medium sm:p-4">Field</th>
                      <th className="p-3 font-medium sm:p-4">Type</th>
                      <th className="p-3 font-medium sm:p-4">Required</th>
                      <th className="p-3 font-medium sm:p-4">Description</th>
                    </tr>
                  </thead>
                  <tbody>
                    <ReqRow
                      desc="Cube name, 1–64 chars. Also becomes the hostname inside the Cube."
                      name="name"
                      required
                      type="string"
                    />
                    <ReqRow
                      desc="Integer CPU cores."
                      name="resources.vcpu"
                      required
                      type="number"
                    />
                    <ReqRow
                      desc="RAM in GB."
                      name="resources.ramGb"
                      required
                      type="number"
                    />
                    <ReqRow
                      desc="Disk in GB."
                      name="resources.diskGb"
                      required
                      type="number"
                    />
                    <ReqRow
                      desc="Image id from /images."
                      name="image"
                      required
                      type="string"
                    />
                    <ReqRow
                      desc="SSH public key written to the Cube's /root/.ssh/authorized_keys at boot. Must start with ssh-ed25519, ssh-rsa, ecdsa-sha2-*, ssh-dss, or sk-*@openssh.com."
                      name="sshPublicKey"
                      required
                      type="string"
                    />
                    <ReqRow
                      desc="Region slug from /regions."
                      name="region"
                      required={false}
                      type="string"
                    />
                    <ReqRow
                      desc="cloud-init script. Max 16 KB."
                      name="userData"
                      required={false}
                      type="string"
                    />
                  </tbody>
                </table>
              </div>

              <div className="mt-6 space-y-6">
                <CodeExample
                  code={`curl -X POST \\\n  -H "X-API-KEY: kro_your_key" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "name": "my-api-server",\n    "resources": { "vcpu": 2, "ramGb": 4, "diskGb": 30 },\n    "image": "ubuntu-24.04",\n    "sshPublicKey": "ssh-ed25519 AAAA... user@host",\n    "region": "eu-nuremberg",\n    "userData": "#cloud-config\\npackages:\\n  - nginx\\n"\n  }' \\\n  ${baseUrl}/api/v1/spaces/{spaceId}/cubes`}
                  title="Example request"
                />
                <CodeExample
                  code={`{\n  "cube": {\n    "id": "cube_abc123",\n    "name": "my-api-server",\n    "state": "pending",\n    "publicIpv4": null,\n    "resources": { "vcpu": 2, "ramGb": 4, "diskGb": 30 },\n    "image": "ubuntu-24.04",\n    "costPerHour": 0.0135,\n    "createdAt": "2026-05-04T08:00:00.000Z",\n    "updatedAt": "2026-05-04T08:00:00.000Z"\n  }\n}`}
                  title="Example response"
                />
              </div>
            </EndpointBlock>

            <EndpointBlock
              header={
                <EndpointHeader
                  method="GET"
                  path="/spaces/{spaceId}/cubes/{cubeId}"
                  permission="cube.view"
                />
              }
              id="get-cube"
            >
              <p className="text-muted-foreground">
                Get a single Cube. Returns the same shape as list, plus{" "}
                <code>serverDomain</code> for Caddy routing.
              </p>
              <div className="mt-6 space-y-6">
                <CodeExample
                  code={`curl -H "X-API-KEY: kro_your_key" \\\n  ${baseUrl}/api/v1/spaces/{spaceId}/cubes/{cubeId}`}
                  title="Example request"
                />
                <CodeExample
                  code={`{\n  "cube": {\n    "id": "cube_abc123",\n    "name": "my-api-server",\n    "state": "running",\n    "publicIpv4": "1.2.3.4",\n    "resources": { "vcpu": 2, "ramGb": 4, "diskGb": 30 },\n    "image": "ubuntu-24.04",\n    "costPerHour": 0.0135,\n    "serverDomain": "sv1.eu-nuremberg.${baseUrl.replace(/^https?:\/\//, "")}",\n    "createdAt": "2026-05-01T12:00:00.000Z",\n    "updatedAt": "2026-05-01T12:05:00.000Z"\n  }\n}`}
                  title="Example response"
                />
              </div>
            </EndpointBlock>

            <EndpointBlock
              header={
                <EndpointHeader
                  method="DELETE"
                  path="/spaces/{spaceId}/cubes/{cubeId}"
                  permission="cube.manage"
                />
              }
              id="delete-cube"
            >
              <p className="text-muted-foreground">
                Delete a Cube. Processed asynchronously — the worker stops the
                VM, frees ports, and cleans up snapshots.
              </p>
              <div className="mt-6 space-y-6">
                <CodeExample
                  code={`curl -X DELETE \\\n  -H "X-API-KEY: kro_your_key" \\\n  ${baseUrl}/api/v1/spaces/{spaceId}/cubes/{cubeId}`}
                  title="Example request"
                />
                <CodeExample
                  code={`{\n  "success": true\n}`}
                  title="Example response"
                />
              </div>
            </EndpointBlock>

            <EndpointBlock
              header={
                <EndpointHeader
                  method="POST"
                  path="/spaces/{spaceId}/cubes/{cubeId}/sleep"
                  permission="cube.manage"
                />
              }
              id="sleep-cube"
            >
              <p className="text-muted-foreground">
                Pause a running Cube. Compute (vCPU + RAM) billing stops
                immediately; state and disk are preserved. The disk component of
                the Cube&apos;s price continues — billed hourly at the same
                per-GB rate it pays while running, for as long as the rootfs
                sits on host disk. Rates are quoted per hour but billed by the
                minute.
              </p>
              <div className="mt-6 space-y-6">
                <CodeExample
                  code={`curl -X POST \\\n  -H "X-API-KEY: kro_your_key" \\\n  ${baseUrl}/api/v1/spaces/{spaceId}/cubes/{cubeId}/sleep`}
                  title="Example request"
                />
                <CodeExample
                  code={`{\n  "success": true\n}`}
                  title="Example response"
                />
              </div>
            </EndpointBlock>

            <EndpointBlock
              header={
                <EndpointHeader
                  method="POST"
                  path="/spaces/{spaceId}/cubes/{cubeId}/wake"
                  permission="cube.manage"
                />
              }
              id="wake-cube"
            >
              <p className="text-muted-foreground">
                Resume a sleeping Cube. Requires sufficient credits for at least
                one hour of runtime.
              </p>
              <div className="mt-6 space-y-6">
                <CodeExample
                  code={`curl -X POST \\\n  -H "X-API-KEY: kro_your_key" \\\n  ${baseUrl}/api/v1/spaces/{spaceId}/cubes/{cubeId}/wake`}
                  title="Example request"
                />
                <CodeExample
                  code={`{\n  "success": true\n}`}
                  title="Example response"
                />
              </div>
            </EndpointBlock>
          </div>

          <h3 className="mt-12 text-xl font-bold">Domains</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Map a custom domain to a port on a Cube via Caddy reverse-proxy.
          </p>
          <div className="mt-6 space-y-6">
            <EndpointBlock
              header={
                <EndpointHeader
                  method="GET"
                  path="/spaces/{spaceId}/cubes/{cubeId}/domains"
                  permission="cube.view"
                />
              }
              id="list-domains"
            >
              <CodeExample
                code={`{\n  "domains": [\n    {\n      "id": "dm_abc",\n      "cubeId": "cube_abc",\n      "domain": "api.example.com",\n      "port": 8080,\n      "status": "active",\n      "createdAt": "2026-05-04T08:00:00.000Z",\n      "updatedAt": "2026-05-04T08:00:00.000Z"\n    }\n  ]\n}`}
                title="Example response"
              />
            </EndpointBlock>

            <EndpointBlock
              header={
                <EndpointHeader
                  method="POST"
                  path="/spaces/{spaceId}/cubes/{cubeId}/domains"
                  permission="cube.manage"
                />
              }
              id="add-domain"
            >
              <p className="text-muted-foreground">
                Add a CNAME record pointing your domain at{" "}
                <code>dns.krova.cloud</code>, then call this. Cloudflare
                provisions and manages the TLS certificate automatically. If
                your domain&apos;s DNS is on Cloudflare, set the CNAME to
                DNS-only (grey cloud).
              </p>
              <div className="mt-6 space-y-6">
                <CodeExample
                  code={`curl -X POST \\\n  -H "X-API-KEY: kro_your_key" \\\n  -H "Content-Type: application/json" \\\n  -d '{ "domain": "api.example.com", "port": 8080 }' \\\n  ${baseUrl}/api/v1/spaces/{spaceId}/cubes/{cubeId}/domains`}
                  title="Example request"
                />
              </div>
            </EndpointBlock>

            <EndpointBlock
              header={
                <EndpointHeader
                  method="DELETE"
                  path="/spaces/{spaceId}/cubes/{cubeId}/domains/{mappingId}"
                  permission="cube.manage"
                />
              }
              id="remove-domain"
            >
              <p className="text-muted-foreground">
                Removes the Caddy route. Update DNS afterwards if reusing the
                domain elsewhere.
              </p>
            </EndpointBlock>
          </div>

          <h3 className="mt-12 text-xl font-bold">TCP Port Mappings</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Forward a public host port to a port on the Cube. Optional IP
            whitelist supports CIDR ranges.
          </p>
          <div className="mt-6 space-y-6">
            <EndpointBlock
              header={
                <EndpointHeader
                  method="GET"
                  path="/spaces/{spaceId}/cubes/{cubeId}/tcp-mappings"
                  permission="cube.view"
                />
              }
              id="list-tcp"
            >
              <CodeExample
                code={`{\n  "tcpMappings": [\n    {\n      "id": "tcp_abc",\n      "cubeId": "cube_abc",\n      "cubePort": 5432,\n      "hostPort": 30001,\n      "label": "postgres",\n      "status": "active",\n      "isSsh": false,\n      "createdAt": "2026-05-04T08:00:00.000Z",\n      "updatedAt": "2026-05-04T08:00:00.000Z",\n      "whitelistedIps": [{ "id": "wl_abc", "cidr": "1.2.3.4/32" }]\n    }\n  ]\n}`}
                title="Example response"
              />
            </EndpointBlock>

            <EndpointBlock
              header={
                <EndpointHeader
                  method="POST"
                  path="/spaces/{spaceId}/cubes/{cubeId}/tcp-mappings"
                  permission="cube.manage"
                />
              }
              id="create-tcp"
            >
              <p className="text-muted-foreground">
                Host port is auto-allocated from the server pool. Up to 500
                whitelist entries.
              </p>
              <div className="mt-6 space-y-6">
                <CodeExample
                  code={`curl -X POST \\\n  -H "X-API-KEY: kro_your_key" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "cubePort": 5432,\n    "label": "postgres",\n    "whitelistedIps": ["1.2.3.4/32"]\n  }' \\\n  ${baseUrl}/api/v1/spaces/{spaceId}/cubes/{cubeId}/tcp-mappings`}
                  title="Example request"
                />
              </div>
            </EndpointBlock>

            <EndpointBlock
              header={
                <EndpointHeader
                  method="DELETE"
                  path="/spaces/{spaceId}/cubes/{cubeId}/tcp-mappings/{mappingId}"
                  permission="cube.manage"
                />
              }
              id="delete-tcp"
            >
              <p className="text-muted-foreground">
                Your Cube's SSH mapping (the row with{" "}
                <code className="font-mono">isSsh: true</code>) cannot be
                deleted — every Cube needs SSH access. To change which port sshd
                listens on inside your Cube, use{" "}
                <code className="font-mono">PUT /ssh-port</code> below.
              </p>
            </EndpointBlock>
          </div>

          <h3 className="mt-12 text-xl font-bold">SSH Port</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Every Cube has exactly one SSH mapping, created automatically at
            boot with sshd on port <code className="font-mono">22</code>. When
            you change the sshd port inside your Cube, call this endpoint with
            the new port so the platform's port-forward keeps working. There's
            no mapping id in the URL because each Cube has exactly one SSH
            mapping.
          </p>
          <div className="mt-6 space-y-6">
            <EndpointBlock
              header={
                <EndpointHeader
                  method="PUT"
                  path="/spaces/{spaceId}/cubes/{cubeId}/ssh-port"
                  permission="cube.manage"
                />
              }
              id="update-ssh-port"
            >
              <p className="text-muted-foreground">
                Updates the iptables forward in place — the public host port
                stays the same and the IP whitelist is preserved. The mapping's
                status briefly flips to{" "}
                <code className="font-mono">pending</code> while the change is
                applied, then returns to{" "}
                <code className="font-mono">active</code>. The new value shows
                up as <code className="font-mono">cubePort</code> on the SSH row
                in the TCP mappings list.
              </p>
              <div className="mt-6 space-y-6">
                <CodeExample
                  code={`curl -X PUT \\\n  -H "X-API-KEY: kro_your_key" \\\n  -H "Content-Type: application/json" \\\n  -d '{ "cubePort": 2222 }' \\\n  ${baseUrl}/api/v1/spaces/{spaceId}/cubes/{cubeId}/ssh-port`}
                  title="Example request"
                />
                <CodeExample
                  code={`{\n  "success": true,\n  "cubePort": 2222\n}`}
                  title="Example response"
                />
              </div>
              <p className="mt-4 text-sm text-muted-foreground">
                <strong>409 Conflict</strong> if another SSH port change is
                already in progress on the same Cube, or if the requested port
                is already used by another TCP mapping on the same Cube.
                <br />
                <strong>400 Bad Request</strong> if{" "}
                <code className="font-mono">cubePort</code> is missing or
                outside <code className="font-mono">1..65535</code>.
              </p>
            </EndpointBlock>
          </div>

          <h3 className="mt-12 text-xl font-bold">Snapshots</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Point-in-time disk snapshots stored on S3-compatible object storage.
          </p>
          <div className="mt-6 space-y-6">
            <EndpointBlock
              header={
                <EndpointHeader
                  method="GET"
                  path="/spaces/{spaceId}/cubes/{cubeId}/snapshots"
                  permission="cube.view"
                />
              }
              id="list-snapshots"
            >
              <CodeExample
                code={`{\n  "snapshots": [\n    {\n      "id": "snap_abc",\n      "cubeId": "cube_abc",\n      "spaceId": "sp_xyz",\n      "name": "before-upgrade",\n      "status": "complete",\n      "sizeBytes": 1234567890,\n      "kind": "manual",\n      "completedAt": "2026-05-04T08:01:30.000Z",\n      "createdAt": "2026-05-04T08:00:00.000Z"\n    }\n  ]\n}`}
                title="Example response"
              />
            </EndpointBlock>

            <EndpointBlock
              header={
                <EndpointHeader
                  method="POST"
                  path="/spaces/{spaceId}/cubes/{cubeId}/snapshots"
                  permission="cube.manage"
                />
              }
              id="create-snapshot"
            >
              <p className="text-muted-foreground">
                Triggers a snapshot job. <code>name</code> is optional —
                auto-generated if omitted. Only one snapshot may be in progress
                per Cube.
              </p>
              <div className="mt-6 space-y-6">
                <CodeExample
                  code={`curl -X POST \\\n  -H "X-API-KEY: kro_your_key" \\\n  -H "Content-Type: application/json" \\\n  -d '{ "name": "before-upgrade" }' \\\n  ${baseUrl}/api/v1/spaces/{spaceId}/cubes/{cubeId}/snapshots`}
                  title="Example request"
                />
              </div>
            </EndpointBlock>

            <EndpointBlock
              header={
                <EndpointHeader
                  method="DELETE"
                  path="/spaces/{spaceId}/cubes/{cubeId}/snapshots/{snapshotId}"
                  permission="cube.manage"
                />
              }
              id="delete-snapshot"
            >
              <p className="text-muted-foreground">
                Deletes the snapshot object from the storage backend and the DB
                record.
              </p>
            </EndpointBlock>

            <EndpointBlock
              header={
                <EndpointHeader
                  method="POST"
                  path="/spaces/{spaceId}/cubes/{cubeId}/restore"
                  permission="cube.manage"
                />
              }
              id="restore-snapshot"
            >
              <p className="text-muted-foreground">
                Restore a Cube&apos;s disk from a snapshot. The Cube is paused,
                the snapshot is downloaded and applied, then the Cube boots from
                the restored disk.
              </p>
              <div className="mt-6 space-y-6">
                <CodeExample
                  code={`curl -X POST \\\n  -H "X-API-KEY: kro_your_key" \\\n  -H "Content-Type: application/json" \\\n  -d '{ "snapshotId": "snap_abc" }' \\\n  ${baseUrl}/api/v1/spaces/{spaceId}/cubes/{cubeId}/restore`}
                  title="Example request"
                />
              </div>
            </EndpointBlock>
          </div>

          <h3 className="mt-12 text-xl font-bold">Webhooks</h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Receive a signed POST whenever a Cube changes state. See the
            Webhooks section below for event types, payload shape, and signature
            verification.
          </p>
          <div className="mt-6 space-y-6">
            <EndpointBlock
              header={
                <EndpointHeader
                  method="GET"
                  path="/spaces/{spaceId}/webhooks"
                />
              }
              id="list-webhooks"
            >
              <CodeExample
                code={`{\n  "webhooks": [\n    {\n      "id": "wh_abc",\n      "url": "https://example.com/hooks/krova",\n      "events": ["cube.running", "cube.deleted"],\n      "enabled": true,\n      "createdAt": "2026-05-04T08:00:00.000Z",\n      "updatedAt": "2026-05-04T08:00:00.000Z"\n    }\n  ]\n}`}
                title="Example response"
              />
            </EndpointBlock>

            <EndpointBlock
              header={
                <EndpointHeader
                  method="POST"
                  path="/spaces/{spaceId}/webhooks"
                />
              }
              id="create-webhook"
            >
              <p className="text-muted-foreground">
                The signing <code>secret</code> is returned only once at
                creation. Store it securely — to rotate, delete and re-create
                the endpoint.
              </p>
              <div className="mt-6 space-y-6">
                <CodeExample
                  code={`curl -X POST \\\n  -H "X-API-KEY: kro_your_key" \\\n  -H "Content-Type: application/json" \\\n  -d '{\n    "url": "https://example.com/hooks/krova",\n    "events": ["cube.running", "cube.sleeping", "cube.error", "cube.deleted"]\n  }' \\\n  ${baseUrl}/api/v1/spaces/{spaceId}/webhooks`}
                  title="Example request"
                />
                <CodeExample
                  code={`{\n  "webhook": {\n    "id": "wh_abc",\n    "url": "https://example.com/hooks/krova",\n    "events": ["cube.running", "cube.sleeping", "cube.error", "cube.deleted"],\n    "enabled": true,\n    "secret": "a3f2...deadbeef",\n    "createdAt": "2026-05-04T08:00:00.000Z",\n    "updatedAt": "2026-05-04T08:00:00.000Z"\n  }\n}`}
                  title="Example response"
                />
              </div>
            </EndpointBlock>

            <EndpointBlock
              header={
                <EndpointHeader
                  method="GET"
                  path="/spaces/{spaceId}/webhooks/{endpointId}"
                />
              }
              id="get-webhook"
            >
              <p className="text-muted-foreground">
                Returns the endpoint without the secret.
              </p>
            </EndpointBlock>

            <EndpointBlock
              header={
                <EndpointHeader
                  method="DELETE"
                  path="/spaces/{spaceId}/webhooks/{endpointId}"
                />
              }
              id="delete-webhook"
            >
              <p className="text-muted-foreground">
                Cascade-deletes all delivery records for this endpoint.
              </p>
            </EndpointBlock>

            <EndpointBlock
              header={
                <EndpointHeader
                  method="GET"
                  path="/spaces/{spaceId}/webhooks/{endpointId}/deliveries"
                />
              }
              id="list-deliveries"
            >
              <p className="text-muted-foreground">
                Last delivery attempts. Default 50, max 100 via{" "}
                <code>?limit=</code>. Retained 30 days.
              </p>
              <div className="mt-6 space-y-6">
                <CodeExample
                  code={`{\n  "deliveries": [\n    {\n      "id": "dlv_abc",\n      "event": "cube.running",\n      "status": "delivered",\n      "attempts": 1,\n      "lastAttemptAt": "2026-05-04T08:05:00.000Z",\n      "responseStatus": 200,\n      "createdAt": "2026-05-04T08:05:00.000Z"\n    }\n  ]\n}`}
                  title="Example response"
                />
              </div>
            </EndpointBlock>
          </div>
        </div>
      </section>

      <Separator />

      <section>
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Outbound Webhooks
          </h2>
          <p className="mt-6 text-muted-foreground">
            When a webhook endpoint is enabled, {productName} POSTs a signed
            JSON payload to your URL on every subscribed event. Each request
            carries an HMAC-SHA256 signature you can verify with the secret
            returned at creation.
          </p>

          <h3 className="mt-10 text-lg font-bold">Event types</h3>
          <div className="mt-4 overflow-x-auto border bg-card">
            <table className="w-full min-w-120 text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th className="p-3 font-medium sm:p-4">Event</th>
                  <th className="p-3 font-medium sm:p-4">Fired when</th>
                </tr>
              </thead>
              <tbody>
                <EventRow
                  desc="Cube transitions to running (boot complete, wake, or state-sync detection)"
                  event="cube.running"
                />
                <EventRow
                  desc="Cube transitions to sleeping (user sleep, zero-balance auto-sleep, or unexpected pause)"
                  event="cube.sleeping"
                />
                <EventRow
                  desc="Cube transitions to error (boot failure detected within 5 min of start)"
                  event="cube.error"
                />
                <EventRow desc="Cube is fully deleted" event="cube.deleted" />
              </tbody>
            </table>
          </div>

          <h3 className="mt-10 text-lg font-bold">Payload shape</h3>
          <pre className="mt-4 overflow-x-auto bg-muted/50 p-4 font-mono text-xs leading-relaxed">
            <code>{`{
  "id": "evt_abc123",
  "event": "cube.running",
  "createdAt": "2026-05-04T12:05:00.000Z",
  "spaceId": "sp_xyz",
  "data": {
    "id": "cube_abc",
    "name": "my-cube",
    "state": "running",
    "publicIpv4": "1.2.3.4"
  }
}`}</code>
          </pre>

          <h3 className="mt-10 text-lg font-bold">Headers on every delivery</h3>
          <ul className="mt-4 space-y-2 text-sm text-muted-foreground">
            <li>
              <code>X-Krova-Signature: sha256=&lt;hex&gt;</code> — HMAC-SHA256
              of the raw body, signed with your endpoint secret.
            </li>
            <li>
              <code>X-Krova-Event</code> — event name (e.g.{" "}
              <code>cube.running</code>).
            </li>
            <li>
              <code>X-Krova-Delivery</code> — unique delivery id, useful for
              de-duplication.
            </li>
          </ul>

          <h3 className="mt-10 text-lg font-bold">
            Verifying the signature (Node.js)
          </h3>
          <pre className="mt-4 overflow-x-auto bg-muted/50 p-4 font-mono text-xs leading-relaxed">
            <code>{`import { createHmac, timingSafeEqual } from "crypto"

function verify(secret, rawBody, signatureHeader) {
  const expected =
    "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex")
  return timingSafeEqual(
    Buffer.from(signatureHeader),
    Buffer.from(expected)
  )
}`}</code>
          </pre>
          <p className="mt-3 text-sm text-muted-foreground">
            Always use a constant-time comparison such as{" "}
            <code>timingSafeEqual</code> — a plain <code>===</code> is
            vulnerable to timing attacks.
          </p>

          <h3 className="mt-10 text-lg font-bold">Delivery and retries</h3>
          <p className="mt-4 text-sm text-muted-foreground">
            A delivery is considered successful when your endpoint returns a
            <code> 2xx</code> within 10 seconds. Failed deliveries are retried
            up to 4 times with a 60-second delay. Delivery history is retained
            for 30 days and accessible via the deliveries endpoint above.
          </p>
        </div>
      </section>

      <Separator />

      <section>
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Status Codes &amp; Errors
          </h2>
          <p className="mt-6 text-muted-foreground">
            The API uses standard HTTP status codes. All errors return an{" "}
            <code>error</code> string.
          </p>

          <div className="mt-10 overflow-x-auto border bg-card">
            <table className="w-full min-w-120 text-sm">
              <thead>
                <tr className="border-b bg-muted/50 text-left">
                  <th className="p-3 font-medium sm:p-4">Code</th>
                  <th className="p-3 font-medium sm:p-4">Description</th>
                </tr>
              </thead>
              <tbody>
                <StatusRow code={200} desc="Success" />
                <StatusRow code={201} desc="Resource created" />
                <StatusRow
                  code={400}
                  desc="Invalid request body or parameters"
                />
                <StatusRow code={401} desc="Missing or invalid API key" />
                <StatusRow code={403} desc="Insufficient permissions" />
                <StatusRow code={404} desc="Resource not found" />
                <StatusRow
                  code={409}
                  desc="Conflict (duplicate, already in progress)"
                />
                <StatusRow
                  code={422}
                  desc="Semantic error (cube in wrong state, insufficient credits)"
                />
                <StatusRow code={429} desc="Rate limited" />
                <StatusRow
                  code={500}
                  desc="Internal server error (safe to retry)"
                />
                <StatusRow
                  code={503}
                  desc="Capacity error (no ports available)"
                />
              </tbody>
            </table>
          </div>

          <p className="mt-6 text-sm text-muted-foreground">
            Error responses always follow this shape:
          </p>
          <pre className="mt-2 overflow-x-auto bg-muted/50 p-4 font-mono text-xs">
            <code>{'{ "error": "Human-readable description" }'}</code>
          </pre>
        </div>
      </section>

      <Separator />

      <section>
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Cube States
          </h2>
          <p className="mt-6 text-muted-foreground">
            Cubes transition through these states during their lifecycle:
          </p>

          <div className="mt-10 grid gap-3 sm:grid-cols-2">
            <StateRow desc="Queued for provisioning" state="pending" />
            <StateRow desc="VM is starting up" state="booting" />
            <StateRow desc="VM is live (billing active)" state="running" />
            <StateRow
              desc="VM paused — compute billing stops; only the Cube's disk component continues, billed hourly at the same per-GB rate the running Cube paid"
              state="sleeping"
            />
            <StateRow desc="Deletion in progress" state="stopping" />
            <StateRow desc="Deleted (hidden from API)" state="deleted" />
            <StateRow desc="Something went wrong" state="error" />
          </div>
        </div>
      </section>

      <Separator />

      <section>
        <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Rate Limits
          </h2>
          <p className="mt-6 text-muted-foreground">
            Every mutating endpoint (all <code>POST</code> and{" "}
            <code>DELETE</code> requests) is limited to 10 requests per 60
            seconds, per client IP. Exceeding the limit returns{" "}
            <code>429 Too Many Requests</code> with a <code>Retry-After</code>{" "}
            header indicating how many seconds to wait.
          </p>
          <p className="mt-4 text-muted-foreground">
            Read endpoints (<code>GET</code>) are not rate-limited and are
            suitable for polling.
          </p>
        </div>
      </section>

      <Separator />

      <section className="bg-muted/30">
        <div className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-6 sm:py-24 lg:px-8">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Ready to automate?
          </h2>
          <p className="mt-4 text-lg text-muted-foreground">
            Generate an API key from your Space Settings and start building.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/post-auth">
                <ArrowRightIcon className="mr-2 h-4 w-4" />
                Go to Dashboard
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/">
                <LinkSimpleIcon className="mr-2 h-4 w-4" />
                Back to Home
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function EndpointBlock({
  id,
  children,
  header,
}: {
  id: string;
  children: React.ReactNode;
  header: React.ReactNode;
}) {
  return (
    <section className="scroll-mt-20 border bg-card p-5 sm:p-6" id={id}>
      <div className="flex items-start justify-between gap-4">
        {header}
        <Link
          aria-label={`Permalink to ${id}`}
          className="shrink-0 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
          href={`#${id}`}
        >
          #
        </Link>
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function EndpointHeader({
  method,
  path,
  public: isPublic,
  permission,
}: {
  method: string;
  path: string;
  public?: boolean;
  permission?: string;
}) {
  const colors: Record<string, string> = {
    GET: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
    POST: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
    DELETE: "bg-red-500/10 text-red-700 dark:text-red-400",
  };

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
      <span
        className={`inline-flex shrink-0 px-1.5 py-0.5 font-mono text-[11px] font-bold ${colors[method] ?? "bg-muted"}`}
      >
        {method}
      </span>
      <code className="min-w-0 break-all text-sm">{path}</code>
      {isPublic && (
        <Badge className="shrink-0 text-[10px]" variant="secondary">
          No auth
        </Badge>
      )}
      {permission && (
        <Badge className="shrink-0 text-[10px]" variant="outline">
          {permission}
        </Badge>
      )}
    </div>
  );
}

function CodeExample({ title, code }: { title: string; code: string }) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-muted-foreground">{title}</p>
      <pre className="overflow-x-auto bg-muted/50 p-4 font-mono text-xs leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

function ReqRow({
  name,
  type,
  required,
  desc,
}: {
  name: string;
  type: string;
  required: boolean;
  desc: string;
}) {
  return (
    <tr className="border-b last:border-0">
      <td className="p-3 font-mono text-xs sm:p-4">{name}</td>
      <td className="p-3 text-xs text-muted-foreground sm:p-4">{type}</td>
      <td className="p-3 text-xs sm:p-4">
        {required ? (
          <span className="font-medium text-blue-600 dark:text-blue-400">
            Yes
          </span>
        ) : (
          <span className="text-muted-foreground">No</span>
        )}
      </td>
      <td className="p-3 text-xs text-muted-foreground sm:p-4">{desc}</td>
    </tr>
  );
}

function StatusRow({ code, desc }: { code: number; desc: string }) {
  return (
    <tr className="border-b last:border-0">
      <td className="p-3 font-mono text-xs font-bold text-primary sm:p-4">
        {code}
      </td>
      <td className="p-3 text-xs text-muted-foreground sm:p-4">{desc}</td>
    </tr>
  );
}

function StateRow({ state, desc }: { state: string; desc: string }) {
  return (
    <div className="flex items-center gap-3">
      <Badge className="font-mono text-[10px]" variant="secondary">
        {state}
      </Badge>
      <span className="text-sm text-muted-foreground">{desc}</span>
    </div>
  );
}

function EventRow({ event, desc }: { event: string; desc: string }) {
  return (
    <tr className="border-b last:border-0">
      <td className="p-3 font-mono text-xs sm:p-4">{event}</td>
      <td className="p-3 text-xs text-muted-foreground sm:p-4">{desc}</td>
    </tr>
  );
}
