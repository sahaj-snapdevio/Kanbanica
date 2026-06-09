import { PRODUCT_NAME } from "@/config/platform";

export interface FaqEntry {
  answer: string;
  question: string;
}

export function getLandingFaq(creditGrant: number): FaqEntry[] {
  const productName = PRODUCT_NAME;
  return [
    {
      question: "Do I need a credit card to sign up?",
      answer: `No. Every new account gets $${creditGrant} of free credit — enough to run a 1 vCPU / 2 GB starter Cube around the clock for weeks. You can launch Cubes and explore the entire platform without entering any payment information.`,
    },
    {
      question: "Do Cubes share a kernel like containers?",
      answer:
        "No — and this is the core difference. A container shares the host's single Linux kernel with every other tenant on the machine, so one kernel-level bug can expose all of them. Each Cube is a Firecracker microVM that boots its own separate kernel, isolated by the CPU's hardware virtualization (KVM) — the same isolation technology behind AWS Lambda. Cubes never share a kernel with each other or with the host.",
    },
    {
      question: "Does my Cube have a public IP address?",
      answer:
        "No. Unlike a typical VPS — where every instance is handed a public IP the whole internet can scan and probe — a Cube has no public IP of its own. It lives on a private, NAT'd network. Nothing is reachable from outside unless you explicitly map a port, and every port mapping can be locked to an IP allowlist. Web traffic on your custom domains is served through Cloudflare's edge, so your origin server is never exposed directly.",
    },
    {
      question: "Do I actually need a public IP?",
      answer:
        "For almost everything people run on a server, no — and not having one is a security win. What makes your app reachable is your domain and the ports you choose to expose, not a fixed address bolted to the whole machine. Web apps and APIs are reachable worldwide over HTTPS through Cloudflare's edge (with TLS and DDoS protection handled for you), and anything else — SSH, a database, a game server, any TCP service — is reachable through a port mapping you open on demand and can lock to an IP allowlist. You get inbound access to exactly what you expose, without a public address the whole internet can scan, brute-force, and target. Fewer doors, and all of them yours.",
    },
    {
      question: "Is it protected against DDoS attacks?",
      answer:
        "Yes, on two layers. Custom-domain web traffic is proxied through Cloudflare's global edge, which provides always-on, unmetered DDoS mitigation across network and application layers (L3/L4/L7) and absorbs attacks before they ever reach your server. On top of that, every bare-metal host carries provider-grade network-level DDoS mitigation. There is no surge pricing or bandwidth penalty for being attacked.",
    },
    {
      question:
        "How does billing work — what if I only run a Cube for 5 minutes?",
      answer:
        "Rates are quoted per hour, but you're billed by the minute. Run a Cube for 5 minutes and you pay for 5 minutes, not a full hour — there's no rounding up. Sleep a Cube and compute charges (vCPU + RAM) stop immediately; only the disk it occupies on the host keeps billing, at the same per-GB rate. Credit is consumed as you go, and you can watch the balance in real time.",
    },
    {
      question: "Can I create and manage Cubes with an API?",
      answer: `Yes. ${productName} has a full v1 REST API: create a Cube, sleep, wake, snapshot, restore, attach custom domains, open TCP ports, and more — each authenticated with a scoped API key. You create Cubes one request at a time and there's no cap on how many you spin up (concurrency is unlimited on higher plans), so standing up a whole batch is a simple loop. A machine-readable OpenAPI spec is published at /api/v1/openapi.json.`,
    },
    {
      question: "Can I run Docker inside a Cube?",
      answer:
        "Yes. Cubes are full virtual machines with their own kernel. You can install and run Docker, Podman, or any other software you would on a regular Linux server.",
    },
    {
      question: "What happens when I sleep a Cube?",
      answer:
        "The VM's memory and disk state are preserved. Compute charges (vCPU + RAM) stop immediately; only the disk component of the Cube's hourly rate continues, since the rootfs still occupies host disk. When you wake the Cube it resumes in under a second from exactly where it left off.",
    },
    {
      question: "How is this different from AWS EC2?",
      answer: `${productName} is designed for simplicity. There's no VPC to configure, no security groups to set up, no IAM policies to write. You create a Cube, get an SSH connection, and you're done. Billing is transparent and by the minute.`,
    },
    {
      question: "Is my data safe?",
      answer:
        "Each Cube is a hardware-isolated VM with its own kernel — not a container — and its Firecracker process runs inside a per-cube jailer sandbox (its own unprivileged user, chroot, and PID namespace), so even a hypervisor escape lands in an isolated sandbox rather than as root on the host. Your data is fully isolated from other users. Host disks are mirrored in RAID 1, and snapshots and backups live on separate, redundant storage. We still recommend keeping your own regular backups for anything you can't afford to lose.",
    },
    {
      question: "Why not just run Firecracker or containers myself?",
      answer: `Firecracker is open source, so you could — but on its own it's a low-level hypervisor. You'd still have to build provisioning, networking, custom-domain TLS, snapshots, billing, and team access, and operate the bare-metal hosts yourself. ${productName} is that entire platform on top of Firecracker — the same microVM technology behind AWS Lambda and Fargate — so you get VM-grade isolation in one click instead of weeks of plumbing. And unlike a shared-kernel container, where a single kernel bug can expose every tenant on the host, each Cube runs its own kernel behind a hardware-enforced boundary — which is what makes it safe for untrusted, multi-tenant workloads.`,
    },
    {
      question: "What hardware do my Cubes actually run on?",
      answer:
        "Every Cube runs on dedicated bare-metal servers rented from premium infrastructure providers. Those hosts ship with ECC server-grade RAM, enterprise SSDs in RAID 1, a 10 Gbps port with 100 TB of upstream traffic included per server per month (shared across the Cubes on it), and provider-level network DDoS protection. Custom domains route through Cloudflare for SaaS, which adds automatic HTTPS and edge-level DDoS protection at no extra cost.",
    },
    {
      question: `Why is ${productName} cheaper than AWS, DigitalOcean, or Linode?`,
      answer: `We don't operate hyperscale data centers, run a sales team, or maintain a dozen sibling services. We rent bare-metal capacity from premium providers, run lightweight micro VMs on top, and pass the savings on — typically less than half the price of an equivalent VPS. The hardware is the same class — sometimes better. The bill isn't.`,
    },
  ];
}
