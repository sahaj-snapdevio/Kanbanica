import type { Metadata } from "next";
import Link from "next/link";
import {
  LegalList,
  LegalPage,
  LegalSection,
  LegalSubheading,
} from "@/app/(landing)/_components/legal-page";
import {
  BILLING_DISPUTE_WINDOW_DAYS,
  LEGAL_ENTITY,
  PLATFORM_BASE_DOMAIN,
  PLATFORM_EMAILS,
  PRODUCT_NAME,
} from "@/config/platform";
import { pageOpenGraph, pageTwitter } from "@/lib/seo/metadata";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: `The terms that govern your use of ${PRODUCT_NAME}.`,
  alternates: { canonical: "/terms" },
  openGraph: pageOpenGraph({
    url: "/terms",
    title: `Terms of Service — ${PRODUCT_NAME}`,
    description: `The terms that govern your use of ${PRODUCT_NAME}.`,
  }),
  twitter: pageTwitter({
    title: `Terms of Service — ${PRODUCT_NAME}`,
    description: `The terms that govern your use of ${PRODUCT_NAME}.`,
  }),
};

const LAST_UPDATED = "31 May 2026";

export default function TermsPage() {
  return (
    <LegalPage
      intro={
        <p>
          These Terms of Service (the &ldquo;Terms&rdquo;) form a binding
          agreement between you and {LEGAL_ENTITY.name} (&ldquo;{PRODUCT_NAME}
          &rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) and govern your access to
          and use of the {PRODUCT_NAME} platform and services (the
          &ldquo;Service&rdquo;). By creating an account, accessing the Service
          or clicking any acceptance prompt, you confirm that you have read,
          understood and agreed to these Terms, our{" "}
          <Link className="text-primary hover:underline" href="/privacy">
            Privacy Policy
          </Link>
          , our{" "}
          <Link className="text-primary hover:underline" href="/aup">
            Acceptable Use Policy
          </Link>{" "}
          and our{" "}
          <Link className="text-primary hover:underline" href="/cookies">
            Cookie Policy
          </Link>{" "}
          (together, the &ldquo;Agreement&rdquo;). If you do not agree, do not
          access or use the Service.
        </p>
      }
      lastUpdated={LAST_UPDATED}
      title="Terms of Service"
    >
      <LegalSection id="eligibility" title="1. Eligibility and accounts">
        <p>
          You must be at least 18 years old (or the age of legal majority in
          your jurisdiction, if higher) and able to enter into a binding
          contract to use the Service. If you use the Service on behalf of an
          organisation, you represent and warrant that you have authority to
          bind that organisation, and references to &ldquo;you&rdquo; include
          both you personally and that organisation, who are jointly and
          severally liable under these Terms.
        </p>
        <p>
          You are solely responsible for safeguarding your account credentials,
          including any passwords, API keys, SSH keys, magic-link tokens and
          OAuth access. You are responsible for all activity that occurs under
          your account, including all charges, even if that activity was carried
          out by someone else using your credentials, and whether or not you
          authorised it. You must notify us promptly at{" "}
          <a
            className="text-primary hover:underline"
            href={`mailto:${PLATFORM_EMAILS.support}`}
          >
            {PLATFORM_EMAILS.support}
          </a>{" "}
          of any unauthorised access or use, but notice does not retroactively
          relieve you of liability for charges already incurred.
        </p>
        <p>
          We may verify your identity, payment method and contact information at
          any time and may suspend or terminate your account if verification
          fails or if the information you have provided is incomplete,
          inaccurate or out of date.
        </p>
      </LegalSection>

      <LegalSection id="service" title="2. The Service">
        <p>
          {PRODUCT_NAME} provides on-demand virtual machines
          (&ldquo;Cubes&rdquo;) running on dedicated bare-metal infrastructure,
          along with related tooling for billing, networking, custom domains,
          snapshots, backups, team management and an API. The exact features and
          limits available to you depend on your plan and any per-space
          overrides we apply at our discretion.
        </p>
        <p>
          We may add, modify, deprecate, suspend or remove any feature,
          interface, region, plan, limit, rate or other aspect of the Service at
          any time, in our sole discretion, with or without notice. We will use
          reasonable efforts to give advance notice of changes that, in our
          judgement, materially and adversely affect functionality you actively
          use, but no specific notice period is guaranteed.
        </p>
        <p>
          The Service may include features marked as beta, preview, experimental
          or similar. Such features are provided as-is and may be unstable,
          incomplete, modified or withdrawn at any time. You should evaluate the
          Service against your own requirements before relying on it for any
          workload, and especially for any beta feature.
        </p>
      </LegalSection>

      <LegalSection id="customer-content" title="3. Your content and workloads">
        <p>
          You retain all rights in the data, software, configurations and other
          materials you upload to, run on or generate through the Service
          (&ldquo;Customer Content&rdquo;). You grant us a worldwide,
          non-exclusive, royalty-free, sublicensable licence to host, store,
          copy, transmit, route, process, display, modify (only to the extent
          required by the technical operation of the Service) and back up your
          Customer Content solely as needed to provide, secure, monitor,
          troubleshoot, defend and improve the Service for you. This licence
          lasts only for as long as we host the Customer Content and ends when
          the Customer Content is permanently removed.
        </p>
        <p>You are solely responsible for:</p>
        <LegalList>
          <li>
            Choosing the operating system, software, container images,
            configurations and any third-party services you run inside a Cube,
            and for the legality and security of each of them.
          </li>
          <li>
            <strong>
              Maintaining your own independent backups of any data you cannot
              afford to lose.
            </strong>{" "}
            Although we provide redundant storage and optional snapshot and
            backup features, those are convenience tools, not a substitute for
            your own backup strategy.
          </li>
          <li>
            Securing the software you install — including patching, access
            control, secrets management, monitoring and abuse response.
          </li>
          <li>
            Compliance with all laws and third-party agreements applicable to
            your use of the Service and to your Customer Content, including
            export controls, sanctions, intellectual-property and
            data-protection laws.
          </li>
          <li>
            Obtaining and maintaining any licences, registrations,
            authorisations and consents required by the workloads you run
            (including any required by your end users).
          </li>
        </LegalList>
        <p>
          We do not pre-screen or routinely inspect Customer Content, but we may
          access, scan, copy, quarantine or remove Customer Content without
          notice where, in our judgement, doing so is necessary to operate,
          secure, protect or defend the Service, to investigate suspected
          violations of the Agreement, to comply with applicable law or a legal
          request, or to respond to claims of infringement or abuse.
        </p>
      </LegalSection>

      <LegalSection id="acceptable-use" title="4. Acceptable use">
        <p>
          Your use of the Service must comply with our{" "}
          <Link className="text-primary hover:underline" href="/aup">
            Acceptable Use Policy
          </Link>
          , which forms part of these Terms. Violating the AUP is a material
          breach of these Terms and may result in immediate suspension or
          termination of your account and forfeiture of any unused prepaid
          credit, subscription fees and other amounts paid, without refund and
          without prejudice to any other remedy.
        </p>
      </LegalSection>

      <LegalSection id="fees" title="5. Fees, credit and billing">
        <LegalSubheading>5.1 Per-hour metered billing</LegalSubheading>
        <p>
          Running Cubes are billed by the hour based on the resources you
          configure (vCPU, RAM, disk) and any applicable plan multipliers. Rates
          are published on the {PRODUCT_NAME} pricing page and may be updated by
          us at any time; the rates in effect at the start of a billing hour
          apply to that hour. Sleeping Cubes do not accrue per-hour compute
          charges; storage of snapshots, backups and other retained resources
          may still be billed at the applicable rate.
        </p>

        <LegalSubheading>5.2 Prepaid credit and top-ups</LegalSubheading>
        <p>
          Most usage is paid from a prepaid credit balance held against your
          space. You may top up your balance through our payment provider.
          Top-up amounts are charged in full at the time of purchase and a
          payment-processing surcharge is added so that the full base amount you
          select is credited to your space.
        </p>
        <p>
          Prepaid credit is for use on the Service only.{" "}
          <strong>
            All credit is non-refundable, non-transferable, non-exchangeable,
            non-redeemable for cash, and has no monetary value
          </strong>{" "}
          outside the Service, except where a non-waivable consumer right under
          applicable law requires otherwise. Unused credit may be forfeited on
          suspension or termination of your account under Section 8.
        </p>

        <LegalSubheading>5.3 Subscription plans</LegalSubheading>
        <p>
          Paid plans are sold as recurring subscriptions billed in advance by
          our payment provider. Each billing period grants the plan&apos;s
          included credit to your space and unlocks the plan&apos;s feature
          limits.{" "}
          <strong>
            Subscription fees are non-refundable in whole or in part, including
            for partial billing periods, unused features, downtime, downgrades,
            cancellations or unused credit
          </strong>
          , except where a non-waivable consumer right under applicable law
          requires otherwise.
        </p>
        <p>
          You may change or cancel your subscription at any time from your
          dashboard. Upgrades take effect immediately. Downgrades take effect at
          the end of your current billing period and require that your space
          already fits within the lower plan&apos;s limits. Cancellation moves
          your space to the default plan at the end of the current period; Cubes
          that exceed the destination plan&apos;s concurrent-Cube limit will be
          automatically slept (their data is preserved subject to our retention
          practices).
        </p>

        <LegalSubheading>5.4 Postpaid overage (optional)</LegalSubheading>
        <p>
          If your plan allows overage and you opt in, Cubes may continue to run
          after your prepaid balance is exhausted, up to a customer-set cap per
          billing period. Overage usage is billed on your next subscription
          invoice and is payable in full when invoiced. Overage is opt-in and
          you may disable it from your billing settings; the cap is a
          customer-set ceiling that limits further accrual, not a guarantee that
          overage will continue to be available, and we may withdraw or restrict
          overage for any space at any time.
        </p>

        <LegalSubheading>5.5 Low balance and auto-sleep</LegalSubheading>
        <p>
          When your credit balance falls below your low-balance threshold we
          will attempt to send a notification. If your balance reaches zero and
          overage is not enabled (or its cap is reached), running Cubes are
          automatically slept to prevent further charges. We are not liable for
          any service interruption, data loss, lost revenue or other consequence
          arising from insufficient balance, a missed notification, or any
          sleep, suspension or termination resulting from non-payment.
        </p>

        <LegalSubheading>5.6 Taxes</LegalSubheading>
        <p>
          All fees are stated exclusive of taxes. You are responsible for any
          applicable sales, value-added, goods-and-services, withholding,
          excise, customs or similar taxes, duties and levies associated with
          your use of the Service, excluding only taxes based on our net income.
          If we are required to collect any such tax, we may add it to your
          invoice.
        </p>

        <LegalSubheading>5.7 Disputes about charges</LegalSubheading>
        <p>
          You must notify us in writing at{" "}
          <a
            className="text-primary hover:underline"
            href={`mailto:${PLATFORM_EMAILS.support}`}
          >
            {PLATFORM_EMAILS.support}
          </a>{" "}
          of any billing dispute within {BILLING_DISPUTE_WINDOW_DAYS} days of
          the invoice or charge to which the dispute relates. Charges not
          disputed within that period are deemed final, accepted and undisputed.
        </p>

        <LegalSubheading>5.8 Chargebacks and set-off</LegalSubheading>
        <p>
          You agree not to initiate a chargeback, payment reversal or similar
          dispute with your bank or card issuer for any charge without first
          contacting us under Section 5.7 and giving us a reasonable opportunity
          to resolve the issue. We treat chargebacks made in breach of this
          section as a material breach of the Agreement and may suspend or
          terminate your account, invalidate unused credit and recover from you
          our costs (including chargeback fees and reasonable legal costs).
        </p>
        <p>
          You authorise us to set off any unpaid amounts you owe us (including
          overage, taxes, chargebacks and damages) against any credit balance,
          prepaid amounts or refunds otherwise due to you, before issuing any
          remaining balance.
        </p>

        <LegalSubheading>5.9 Price changes</LegalSubheading>
        <p>
          We may change the rates, fees, plan limits, surcharges and credit
          terms applicable to the Service at any time in our sole discretion.
          Changes apply to billing hours starting on or after their effective
          date. Your continued use of the Service after a price change takes
          effect constitutes acceptance of the new prices.
        </p>
      </LegalSection>

      <LegalSection id="payment-provider" title="6. Payment provider">
        <p>
          Payments are processed by our third-party payment provider, Polar (and
          any successor or additional provider we select). By making a payment
          you agree to the terms of the relevant payment provider and you
          authorise us and the provider to charge your chosen payment method for
          the applicable fees, including recurring subscription fees and
          overage. We do not store full payment card details on our systems. We
          are not responsible for any act, omission, outage, error or delay of
          any payment provider.
        </p>
      </LegalSection>

      <LegalSection id="availability" title="7. Service availability">
        <p>
          We work hard to keep the Service available, but we do not offer a
          service-level agreement (SLA) or any uptime, performance or
          availability guarantee, and no such guarantee may be implied. The
          Service is provided on a best-efforts basis. Planned and unplanned
          maintenance, infrastructure failures, third-party outages, network
          events, security incidents, force-majeure events and other factors can
          each cause downtime, degradation, slowdowns or data unavailability.
        </p>
        <p>
          You are responsible for designing your workloads to tolerate the level
          of availability we actually provide and for maintaining your own
          backups, monitoring, redundancy and failover where appropriate.
        </p>
      </LegalSection>

      <LegalSection id="suspension" title="8. Suspension and termination">
        <p>
          We may suspend, throttle, restrict or terminate all or part of your
          access to the Service, your account, your spaces and any associated
          resources (including Cubes, snapshots, backups, domains and API keys),
          immediately and with or without notice, in our sole discretion, if:
        </p>
        <LegalList>
          <li>
            you breach (or we reasonably believe you have breached) these Terms,
            the AUP or any other published policy;
          </li>
          <li>
            your account, your workloads or your end users&apos; activity pose,
            in our judgement, a security, abuse, fraud, legal, reputational or
            stability risk to us, our infrastructure, other customers or any
            third party;
          </li>
          <li>
            we are required or asked to do so by applicable law, a court, a
            regulator, a law-enforcement body, a payment network or another
            competent authority;
          </li>
          <li>
            a payment fails, a chargeback is initiated, your balance is
            insufficient and you have not enabled overage, or you have not paid
            an invoice when due; or
          </li>
          <li>we decide to discontinue the Service or any part of it.</li>
        </LegalList>
        <p>
          You may stop using the Service at any time and delete your account
          from the dashboard. On any suspension, termination, cancellation or
          discontinuation, we may, in our sole discretion and to the extent
          permitted by law, delete your Customer Content (including snapshots,
          backups and any other stored data) after such retention period as we
          may set from time to time, and forfeit any unused credit, top-ups and
          prepaid subscription fees. We strongly recommend exporting anything
          you need to keep before deleting your account or ceasing to use the
          Service.
        </p>
        <p>
          Sections that by their nature should survive termination (including
          Sections 3, 5 (for amounts owed at termination), 8, 9, 10, 11, 13, 14,
          15, 17, 18, 19 and 20) survive any termination or expiration of the
          Agreement.
        </p>
      </LegalSection>

      <LegalSection id="data" title="9. Data, snapshots and backups">
        <LegalSubheading>9.1 Convenience tools, not guarantees</LegalSubheading>
        <p>
          We use redundant storage and offer optional snapshots and backups to
          separate storage. These features are convenience tools and{" "}
          <strong>not a substitute for your own backup strategy</strong>. We do
          not guarantee, warrant or represent that any Customer Content,
          snapshot, backup, configuration, log, metadata or other data will be
          retained, available, recoverable, complete, accurate, durable or free
          from corruption, for any period of time or at all.
        </p>

        <LegalSubheading>
          9.2 Risks you accept (assumption of risk)
        </LegalSubheading>
        <p>
          You expressly acknowledge and agree that, to the maximum extent
          permitted by applicable law, you assume all risk of loss, deletion,
          corruption, unavailability, alteration, exposure or inaccessibility of
          Customer Content arising from any cause, including:
        </p>
        <LegalList>
          <li>
            accidental, mistaken, automated, premature or wrongful deletion,
            overwriting or modification of a Cube, snapshot, backup, volume,
            port mapping, domain, configuration or other resource — whether
            caused by you, your team members, our personnel, our software, our
            automated jobs, a third-party provider, or anyone else;
          </li>
          <li>
            hardware failure of any kind, including disk failure, RAID or array
            failure, simultaneous multi-disk failure, controller failure, memory
            failure, CPU or motherboard failure, power failure or destruction of
            a host;
          </li>
          <li>
            host reboots (planned or unplanned), kernel panics, kernel bugs,
            guest reboots, hypervisor crashes, operating-system errors,
            virtualisation faults, live-migration failures, or failures during
            resize, snapshot, backup, restore, import, export or transfer
            operations;
          </li>
          <li>
            software defects, bugs, regressions, misconfigurations, race
            conditions, data races or operator error in our Service, background
            workers, scripts, automations or migrations;
          </li>
          <li>
            outages, failures, errors, latency, data corruption or data loss at
            any third-party provider on which we rely (including infrastructure,
            storage, networking, payment, DNS, email, analytics and real-time
            messaging providers);
          </li>
          <li>
            network failures, route changes, IP blocking, null-routing, DDoS
            attacks, traffic-mitigation actions, DNS issues or
            customer-domain-provider issues;
          </li>
          <li>
            security incidents, intrusions, ransomware, credential compromise,
            social engineering, abuse-mitigation actions and any responsive
            measures (including suspending, sandboxing, isolating or removing
            Cubes or Customer Content);
          </li>
          <li>
            actions we take to comply with applicable law, a court order,
            regulatory request, sanctions screening, abuse notice or any other
            legal process;
          </li>
          <li>
            forfeiture and deletion of Customer Content following suspension,
            termination, non-payment, expiration of any retention window or your
            own deletion request;
          </li>
          <li>
            errors, omissions or delays in the dashboard, API, server actions or
            any automation, including issuing a destructive operation on the
            wrong resource or at the wrong time; and
          </li>
          <li>force-majeure events as described in Section 16.</li>
        </LegalList>

        <LegalSubheading>
          9.3 No duty to retain, recover or restore
        </LegalSubheading>
        <p>
          We have no obligation to retain, recover, reconstruct, restore,
          replace or provide a copy of any Customer Content, snapshot, backup,
          configuration or other data, whether before, during or after
          suspension or termination of your account. Any recovery assistance we
          provide is a goodwill measure offered at our sole discretion, on a
          best-efforts basis, without warranty and without implying any
          obligation to do so again.
        </p>

        <LegalSubheading>9.4 Your responsibilities</LegalSubheading>
        <p>Without limiting Section 3, you are solely responsible for:</p>
        <LegalList>
          <li>
            maintaining your own up-to-date, independent backups of any Customer
            Content you cannot afford to lose, stored outside the Service;
          </li>
          <li>
            testing your backups regularly to confirm that they are complete and
            restorable;
          </li>
          <li>
            verifying any destructive action (delete, restore, redeploy,
            transfer, resize, factory reset) before confirming it, and ensuring
            that the people you grant access to your spaces do the same; and
          </li>
          <li>
            implementing appropriate redundancy, failover, monitoring and
            disaster-recovery measures for your workloads.
          </li>
        </LegalList>

        <LegalSubheading>9.5 Your sole and exclusive remedy</LegalSubheading>
        <p>
          To the maximum extent permitted by applicable law, your sole and
          exclusive remedy for any loss, deletion, corruption or inaccessibility
          of Customer Content is, at our option, to (a) attempt a best-efforts
          recovery from any backup or snapshot we happen to hold, without
          warranty as to result, or (b) issue a service credit equal to the
          pro-rated portion of the subscription fee (if any) attributable to the
          affected resource for the affected period, applied to future use of
          the Service and not refundable in cash. We have no other liability,
          monetary or otherwise, for any such loss. The limits in Section 14
          apply to any claim that nevertheless arises.
        </p>

        <LegalSubheading>
          9.6 No reliance on the Service for backup
        </LegalSubheading>
        <p>
          You acknowledge that the Service is not a backup product, an archival
          service or a system of record. Snapshots, backups and redundant
          storage features are operational tools provided for convenience and
          may be unavailable, modified, paused or removed at any time. You are
          not entitled to rely on any retention period, snapshot count, backup
          schedule or recovery point we have published, configured or implied.
        </p>

        <LegalSubheading>
          9.7 Waiver and release of data-loss claims
        </LegalSubheading>
        <p>
          To the maximum extent permitted by applicable law, you irrevocably
          waive, release and discharge {LEGAL_ENTITY.name} and its affiliates,
          directors, officers, employees, agents, licensors, suppliers and
          service providers from any and all claims, demands, damages, losses,
          liabilities, costs and expenses (whether known or unknown, present or
          future) arising out of or relating to any loss, deletion, corruption,
          unavailability, alteration, exposure or inaccessibility of Customer
          Content. This waiver applies whether the claim is based in contract,
          tort (including negligence), strict liability, statute or any other
          legal theory, and is in addition to (and does not limit) the
          disclaimers in Section 13 and the liability limits in Section 14.
        </p>
      </LegalSection>

      <LegalSection id="privacy" title="10. Privacy and personal data">
        <p>
          Our handling of personal data is described in our{" "}
          <Link className="text-primary hover:underline" href="/privacy">
            Privacy Policy
          </Link>
          . If your use of the Service involves processing personal data of your
          end users, you act as the controller (or equivalent) of that data and
          we act as your processor (or equivalent); you must have a lawful basis
          for that processing, must inform your end users as required by law,
          and must enter into any data-processing addendum we make available
          where one is required.
        </p>
      </LegalSection>

      <LegalSection id="ip" title="11. Intellectual property">
        <p>
          The Service, the {PRODUCT_NAME} brand, our software, documentation and
          all related intellectual-property rights are and remain the property
          of {LEGAL_ENTITY.name} or our licensors. Subject to your ongoing
          compliance with the Agreement and payment of all fees due, we grant
          you a limited, non-exclusive, non-transferable, non-sublicensable,
          revocable licence to use the Service in accordance with the Agreement.
          No other rights are granted by implication, estoppel or otherwise. All
          rights not expressly granted are reserved.
        </p>
        <p>
          You may not, and must not permit any third party to: (a)
          reverse-engineer, decompile, disassemble, decrypt or attempt to derive
          the source code of any non-open-source component of the Service,
          except to the extent that applicable law expressly permits this
          notwithstanding contractual restriction; (b) copy, modify, create
          derivative works of, sublicense, resell, distribute or otherwise
          commercially exploit the Service; (c) use the Service to build a
          competing product or service; (d) remove or obscure proprietary
          notices; or (e) use the Service in violation of these Terms, the AUP
          or applicable law.
        </p>
      </LegalSection>

      <LegalSection id="feedback" title="12. Feedback">
        <p>
          If you send us feedback, suggestions, ideas, error reports or other
          information about the Service, you grant us a perpetual, irrevocable,
          worldwide, royalty-free, fully paid-up, sublicensable licence to use,
          exploit, modify and incorporate that feedback for any purpose,
          commercial or otherwise, without obligation, attribution or
          compensation to you.
        </p>
      </LegalSection>

      <LegalSection
        id="warranty-disclaimer"
        title="13. Disclaimer of warranties"
      >
        <p>
          To the maximum extent permitted by applicable law, the Service is
          provided <strong>&ldquo;AS IS&rdquo;</strong> and{" "}
          <strong>&ldquo;AS AVAILABLE&rdquo;</strong>, with all faults and
          without warranties of any kind, whether express, implied, statutory or
          otherwise. We disclaim all warranties, including any implied
          warranties of merchantability, fitness for a particular purpose,
          title, non-infringement, accuracy, completeness, quiet enjoyment,
          system integration, uninterrupted operation, freedom from errors,
          viruses or harmful components, and any warranties arising from a
          course of dealing or usage of trade. We do not warrant that the
          Service will meet your requirements, that access will be
          uninterrupted, secure or error-free, that defects will be corrected,
          that any data will be retained or recoverable, or that any results
          obtained from the Service will be accurate or reliable.
        </p>
        <p>
          Any third-party services, software or content accessed through or
          integrated with the Service (including payment, networking, DNS,
          email, analytics and storage providers) are provided by those third
          parties under their own terms. We make no representations or
          warranties about, and accept no responsibility or liability for, any
          third-party service or its availability, performance or security.
        </p>
      </LegalSection>

      <LegalSection id="liability" title="14. Limitation of liability">
        <p>
          To the maximum extent permitted by applicable law, in no event shall{" "}
          {LEGAL_ENTITY.name}, its affiliates, directors, officers, employees,
          agents, licensors, suppliers or service providers be liable for any
          indirect, incidental, special, consequential, exemplary, punitive or
          enhanced damages, or for any loss of profits, revenue, savings,
          business, goodwill, anticipated savings, contracts, customers,
          opportunities, data, content or use of data, in each case whether
          direct or indirect and regardless of the cause of action and even if
          we have been advised of the possibility of such damages.
        </p>
        <p>
          To the maximum extent permitted by applicable law, our total aggregate
          liability arising out of or relating to the Agreement, the Service or
          your use of the Service, whether in contract, tort (including
          negligence), strict liability, statute or any other theory of
          liability, is limited to the <strong>lesser of</strong> (a) the total
          amounts actually paid by you to us for the Service in the{" "}
          <strong>three (3) months</strong> immediately preceding the first
          event giving rise to the claim, and (b) <strong>USD&nbsp;100</strong>.
          Multiple claims do not enlarge this limit.
        </p>
        <p>
          You acknowledge and agree that the disclaimers and limitations in
          Sections 13 and 14 are a fundamental basis of the Agreement and of the
          pricing of the Service, and that without them the Service would not be
          offered to you at the prices charged.
        </p>
        <p>
          Nothing in these Terms limits or excludes any liability that cannot be
          limited or excluded under applicable law, including liability for
          fraud, fraudulent misrepresentation, death or personal injury caused
          by negligence, or gross negligence or wilful misconduct where the law
          does not permit exclusion.
        </p>
      </LegalSection>

      <LegalSection id="indemnity" title="15. Indemnification">
        <p>
          You agree to defend, indemnify and hold harmless {LEGAL_ENTITY.name}{" "}
          and its affiliates, directors, officers, employees, agents, licensors,
          suppliers and service providers (the &ldquo;Indemnified
          Parties&rdquo;) from and against any and all claims, demands, actions,
          investigations, liabilities, damages, losses, judgments, settlements,
          fines, penalties, costs and expenses (including reasonable legal fees
          and disbursements) arising out of or in connection with: (a) your
          Customer Content; (b) your use of the Service in violation of the
          Agreement, the AUP or any applicable law; (c) your violation of any
          third-party right, including any intellectual-property, publicity,
          privacy or data-protection right; (d) any act or omission of your end
          users, employees, contractors or invitees in connection with the
          Service; or (e) any chargeback, payment reversal or unpaid amount
          under your account. We may, at our option, assume the exclusive
          defence and control of any matter subject to indemnification by you,
          in which case you will fully cooperate with us. You may not settle any
          claim that affects an Indemnified Party without that Indemnified
          Party&apos;s prior written consent.
        </p>
      </LegalSection>

      <LegalSection id="force-majeure" title="16. Force majeure">
        <p>
          We are not liable for any delay, failure to perform or interruption of
          the Service caused by events beyond our reasonable control, including
          acts of God, natural disasters, fire, flood, pandemic, epidemic, war,
          terrorism, civil disturbance, labour dispute, governmental action,
          sanctions, embargoes, changes in law, network or telecommunications
          failures, internet outages, third-party provider failures,
          denial-of-service attacks, security incidents, hardware shortages,
          supply-chain disruption, power failures, or other events of force
          majeure. Our obligations under the Agreement are suspended for as long
          as the event continues.
        </p>
      </LegalSection>

      <LegalSection
        id="changes"
        title="17. Changes to the Service or these Terms"
      >
        <p>
          We may update these Terms (and any policy incorporated into them) at
          any time in our sole discretion. The updated Terms take effect on the
          date we post them or on such later effective date as we specify. We
          will use reasonable efforts to notify you of material changes — for
          example, by email, an in-product notice or a banner on our website —
          but we have no obligation to give any specific period of notice and no
          failure to notify makes a change inapplicable. Your continued access
          to or use of the Service on or after the effective date of any updated
          Terms constitutes your binding acceptance of those Terms. If you do
          not agree to any update, you must stop using the Service before the
          effective date and may terminate your account.
        </p>
      </LegalSection>

      <LegalSection
        id="governing-law"
        title="18. Governing law, arbitration and class-action waiver"
      >
        <LegalSubheading>18.1 Governing law and forum</LegalSubheading>
        {LEGAL_ENTITY.governingLaw && LEGAL_ENTITY.forum ? (
          <p>
            The Agreement and any dispute or claim arising out of or in
            connection with it (including non-contractual disputes or claims)
            are governed by, and construed in accordance with, the laws of{" "}
            {LEGAL_ENTITY.governingLaw}, without regard to its conflict-of-law
            rules. Subject to Section 18.2, the courts of {LEGAL_ENTITY.forum}{" "}
            have exclusive jurisdiction to settle any such dispute or claim, and
            you irrevocably submit to that jurisdiction and venue and waive any
            objection based on inconvenient forum.
          </p>
        ) : (
          <p>
            The Agreement and any dispute or claim arising out of or in
            connection with it (including non-contractual disputes or claims)
            are governed by the laws applicable at our principal place of
            business from time to time, without regard to conflict-of-law rules.
            Subject to Section 18.2, you and we agree that any dispute or claim
            must be brought exclusively before a court of competent jurisdiction
            at our principal place of business, and you irrevocably submit to
            that jurisdiction and venue and waive any objection based on
            inconvenient forum. Nothing in this paragraph limits any
            non-waivable right you may have under applicable consumer-protection
            law to bring proceedings in the courts of your place of residence or
            under the law of your residence.
          </p>
        )}
        <p>
          The United Nations Convention on Contracts for the International Sale
          of Goods does not apply to the Agreement.
        </p>
        {LEGAL_ENTITY.arbitrationVenue ? (
          <>
            <LegalSubheading>
              18.2 Binding arbitration and class-action waiver
            </LegalSubheading>
            <p>
              <strong>Please read this section carefully.</strong> Except for
              (a) claims that may be brought in a small-claims court for amounts
              within its jurisdictional limit, (b) claims for injunctive or
              other equitable relief to prevent actual or threatened
              infringement, misappropriation or violation of
              intellectual-property rights or breach of confidentiality, and (c)
              where prohibited by applicable law, any dispute, claim or
              controversy arising out of or relating to the Agreement, the
              Service, the relationship between you and us, or any communication
              between us, whether based in contract, tort, statute, fraud,
              misrepresentation or any other legal theory, and whether the
              claims arose before or after the effective date of these Terms,
              will be resolved by{" "}
              <strong>final and binding individual arbitration</strong> seated
              in {LEGAL_ENTITY.arbitrationVenue}, before a single arbitrator, in
              English, under the then-current rules of an internationally
              recognised arbitral institution selected by us, the award of which
              is final and binding on the parties. Judgment on the award may be
              entered in any court of competent jurisdiction.
            </p>
            <p>
              <strong>Class-action waiver.</strong> You and we each agree that
              any dispute resolution proceeding will be conducted only on an
              individual basis and not in a class, consolidated, collective,
              mass or representative action. The arbitrator may not consolidate
              more than one person&apos;s claims and may not otherwise preside
              over any form of representative or class proceeding. If a court or
              arbitrator decides that this class-action waiver is unenforceable
              as to a particular claim, that claim (and only that claim) must be
              brought in court and the rest of this Section 18.2 remains in
              force.
            </p>
            <p>
              <strong>Jury waiver.</strong> To the maximum extent permitted by
              law, you and we each waive any right to a trial by jury.
            </p>
            <p>
              If you are an EU/UK consumer or another person to whom a
              non-waivable consumer-protection law gives a different right, this
              Section 18.2 applies only to the extent permitted by that law.
            </p>
          </>
        ) : null}
        <LegalSubheading>18.3 Consumer rights</LegalSubheading>
        <p>
          Where applicable consumer-protection law gives you a non-waivable
          right to bring proceedings in the courts of your place of residence or
          under the law of your residence, nothing in this Section 18 limits
          that right.
        </p>
        <LegalSubheading>18.4 Time limit</LegalSubheading>
        <p>
          To the maximum extent permitted by applicable law, any dispute, claim
          or cause of action arising out of or relating to the Agreement or the
          Service must be brought within <strong>one (1) year</strong> after it
          arises, or it is permanently barred.
        </p>
      </LegalSection>

      <LegalSection id="export-sanctions" title="19. Export and sanctions">
        <p>
          You represent and warrant that you are not (and you are not owned,
          controlled by, or acting on behalf of any person who is) located in,
          ordinarily resident in, or organised under the laws of any country or
          region subject to comprehensive sanctions, and that you are not on any
          sanctions, denied-party or restricted- party list maintained by any
          government with jurisdiction over us. You will not use the Service in
          violation of any applicable export-control, sanctions, anti-corruption
          or anti-money- laundering law.
        </p>
      </LegalSection>

      <LegalSection id="miscellaneous" title="20. Miscellaneous">
        <p>
          <strong>Entire agreement.</strong> The Agreement constitutes the
          entire agreement between you and us regarding the Service and
          supersedes any prior agreements, proposals, representations, marketing
          materials and communications on the same subject.
        </p>
        <p>
          <strong>Order of precedence.</strong> If there is any conflict between
          these Terms and any other document that forms part of the Agreement,
          these Terms prevail unless the other document expressly states
          otherwise and is signed by an authorised representative of{" "}
          {LEGAL_ENTITY.name}.
        </p>
        <p>
          <strong>No reliance.</strong> You confirm that, in agreeing to the
          Agreement, you have not relied on any statement, representation,
          warranty or assurance other than those expressly set out in the
          Agreement, and you waive any claim for innocent or negligent
          misrepresentation based on any statement outside it.
        </p>
        <p>
          <strong>Severability.</strong> If any provision of the Agreement is
          held to be unenforceable, that provision will be modified to the
          minimum extent necessary to make it enforceable and the remaining
          provisions will remain in full force and effect.
        </p>
        <p>
          <strong>No waiver.</strong> Our failure or delay to enforce any right
          or provision is not a waiver of that right or provision.
        </p>
        <p>
          <strong>Assignment.</strong> You may not assign, transfer or delegate
          the Agreement or any rights or obligations under it, whether by
          operation of law or otherwise, without our prior written consent. Any
          attempted assignment in breach of this section is void. We may freely
          assign or transfer the Agreement (in whole or in part), including in
          connection with a merger, acquisition, reorganisation, financing or
          sale of assets.
        </p>
        <p>
          <strong>Independent contractors.</strong> The parties are independent
          contractors. The Agreement does not create any partnership, joint
          venture, employment, fiduciary or agency relationship.
        </p>
        <p>
          <strong>No third-party beneficiaries.</strong> The Agreement does not
          confer any right or remedy on any person other than you and us, except
          that the Indemnified Parties may rely on Section 15 and the
          disclaimers and limits in Sections 13 and 14.
        </p>
        <p>
          <strong>Notices.</strong> We may give you notice by email to the
          address associated with your account, by an in-product notice or by
          posting on our website. Notices to us must be sent to{" "}
          <a
            className="text-primary hover:underline"
            href={`mailto:${PLATFORM_EMAILS.support}`}
          >
            {PLATFORM_EMAILS.support}
          </a>
          .
        </p>
        <p>
          <strong>Headings.</strong> Section headings are for convenience only
          and do not affect interpretation.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="21. Contact">
        <p>
          Questions about these Terms — or any other contact — should go to{" "}
          <a
            className="text-primary hover:underline"
            href={`mailto:${PLATFORM_EMAILS.support}`}
          >
            {PLATFORM_EMAILS.support}
          </a>
          .
        </p>
        <p className="text-xs text-muted-foreground/80">
          {`${LEGAL_ENTITY.name} · ${PLATFORM_BASE_DOMAIN}`}
        </p>
      </LegalSection>
    </LegalPage>
  );
}
