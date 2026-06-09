import type { Metadata } from "next";
import Link from "next/link";
import {
  LegalList,
  LegalPage,
  LegalSection,
  LegalSubheading,
} from "@/app/(landing)/_components/legal-page";
import {
  LEGAL_ENTITY,
  PLATFORM_BASE_DOMAIN,
  PLATFORM_EMAILS,
  PRODUCT_NAME,
} from "@/config/platform";
import { pageOpenGraph, pageTwitter } from "@/lib/seo/metadata";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `How ${PRODUCT_NAME} collects, uses, shares and protects your personal data.`,
  alternates: { canonical: "/privacy" },
  openGraph: pageOpenGraph({
    url: "/privacy",
    title: `Privacy Policy — ${PRODUCT_NAME}`,
    description: `How ${PRODUCT_NAME} collects, uses, shares and protects your personal data.`,
  }),
  twitter: pageTwitter({
    title: `Privacy Policy — ${PRODUCT_NAME}`,
    description: `How ${PRODUCT_NAME} collects, uses, shares and protects your personal data.`,
  }),
};

const LAST_UPDATED = "31 May 2026";

export default function PrivacyPage() {
  return (
    <LegalPage
      intro={
        <p>
          This Privacy Policy explains how {LEGAL_ENTITY.name} (&ldquo;
          {PRODUCT_NAME}&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) collects,
          uses, shares and protects personal data when you use our website,
          dashboard, API and related services (together, the
          &ldquo;Service&rdquo;). It applies to people who create or use a{" "}
          {PRODUCT_NAME} account and to visitors of our public website. Personal
          data that you process through your Cubes as part of your own
          application is covered in Section 8 below. This policy is not a
          contract and does not create rights beyond those required by
          applicable law.
        </p>
      }
      lastUpdated={LAST_UPDATED}
      title="Privacy Policy"
    >
      <LegalSection id="who-we-are" title="1. Who we are">
        <p>
          {`${LEGAL_ENTITY.name} is the controller of the personal data described in this policy, unless stated otherwise.${
            LEGAL_ENTITY.registeredAddress
              ? ` Our registered address is ${LEGAL_ENTITY.registeredAddress}.`
              : ""
          } For privacy questions, requests or complaints, please contact us at `}
          <a
            className="text-primary hover:underline"
            href={`mailto:${PLATFORM_EMAILS.support}`}
          >
            {PLATFORM_EMAILS.support}
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection id="data-we-collect" title="2. What data we collect">
        <LegalSubheading>2.1 Account data</LegalSubheading>
        <LegalList>
          <li>
            Email address, name and (if you sign in with Google) the profile
            photo URL associated with that Google account.
          </li>
          <li>
            Authentication identifiers from our authentication system (session
            tokens, magic-link tokens, OAuth account references).
          </li>
          <li>
            Your role within a space (owner, admin, member, viewer) and any
            permissions granted to you.
          </li>
        </LegalList>

        <LegalSubheading>2.2 Authentication and session data</LegalSubheading>
        <LegalList>
          <li>
            IP address and user-agent string of the device used to sign in,
            recorded against each session for security purposes.
          </li>
          <li>
            Magic-link request timestamps, sign-in attempts and session expiry
            information.
          </li>
        </LegalList>

        <LegalSubheading>2.3 Billing data</LegalSubheading>
        <LegalList>
          <li>
            Credit balance, top-up and subscription history, ledger entries and
            invoice metadata.
          </li>
          <li>
            Identifiers issued by our payment provider for your customer record,
            subscriptions, checkouts and orders. We do not store full payment
            card details on our systems; those are held by the payment provider
            under its own privacy notice.
          </li>
        </LegalList>

        <LegalSubheading>2.4 Operational and product data</LegalSubheading>
        <LegalList>
          <li>
            Metadata about the resources you create — spaces, Cubes, snapshots,
            backups, custom domains, port mappings, API keys, SSH public keys.
          </li>
          <li>
            Lifecycle and audit logs capturing the actions you take in the
            dashboard, server actions and API.
          </li>
          <li>
            Job logs and real-time events used to stream status updates back to
            your browser.
          </li>
        </LegalList>

        <LegalSubheading>2.5 Email delivery telemetry</LegalSubheading>
        <p>
          We record delivery events for transactional and marketing emails (e.g.
          delivered, bounced, complained, failed) returned to us by our email
          provider. These records are stored against your user identifier for a
          limited period and pruned periodically.
        </p>

        <LegalSubheading>2.6 Website and product analytics</LegalSubheading>
        <p>
          We use Google Tag Manager to load Google Analytics and may use similar
          analytics, performance and product-telemetry tools to understand how
          visitors and customers interact with our website and dashboard. These
          tools may collect information such as your IP address, device,
          browser, operating system, referrer, pages viewed, links clicked,
          session duration, interaction events, general (city / country)
          location inferred from IP, and a pseudonymous identifier stored in
          cookies or local storage. See our{" "}
          <Link className="text-primary hover:underline" href="/cookies">
            Cookie Policy
          </Link>{" "}
          for details about the specific cookies set.
        </p>

        <LegalSubheading>
          2.7 Customer Content inside your Cubes
        </LegalSubheading>
        <p>
          Anything you install on, upload to or generate within a Cube is
          Customer Content. We do not routinely inspect Customer Content. We may
          access host-level metadata about a Cube (resource usage, boot state,
          network attributes) and, where necessary, the Customer Content itself
          to operate the Service, troubleshoot incidents, enforce our Terms of
          Service or Acceptable Use Policy, investigate suspected abuse, fraud
          or security threats, or comply with applicable law or a legal request.
        </p>
      </LegalSection>

      <LegalSection id="how-we-use" title="3. How we use your data">
        <p>We use personal data to:</p>
        <LegalList>
          <li>
            create and operate your account, authenticate you and provide the
            features of the Service;
          </li>
          <li>
            measure and bill resource usage, process payments, apply surcharges,
            grant or claw back subscription credit, and pursue unpaid amounts;
          </li>
          <li>
            send transactional emails (sign-in links, billing alerts, security
            notices, abuse notifications, service announcements);
          </li>
          <li>
            send service updates and, where permitted, marketing communications
            you can opt out of at any time;
          </li>
          <li>
            secure the Service against abuse, fraud, intrusion and outages,
            including by analysing access logs, rate-limiting behaviour,
            building profiles of suspicious activity and sharing information
            with law-enforcement bodies where appropriate;
          </li>
          <li>
            comply with our legal obligations and enforce our{" "}
            <Link className="text-primary hover:underline" href="/terms">
              Terms of Service
            </Link>{" "}
            and{" "}
            <Link className="text-primary hover:underline" href="/aup">
              Acceptable Use Policy
            </Link>
            ;
          </li>
          <li>
            measure and improve the performance, security and design of the
            Service, including by analysing usage trends and building aggregated
            or de-identified statistics that we may use freely for any purpose;
          </li>
          <li>establish, exercise or defend legal claims.</li>
        </LegalList>
      </LegalSection>

      <LegalSection id="legal-bases" title="4. Legal bases (EEA / UK users)">
        <p>
          If you are in the European Economic Area or the United Kingdom, our
          legal bases for processing your personal data are:
        </p>
        <LegalList>
          <li>
            <strong>Contract:</strong> to create your account, provide the
            Service and process payments under our Terms.
          </li>
          <li>
            <strong>Legitimate interests:</strong> to secure the Service,
            prevent and investigate abuse and fraud, recover unpaid amounts,
            measure and improve our product, and run our business efficiently.
            We balance these interests against your rights and freedoms.
          </li>
          <li>
            <strong>Legal obligation:</strong> to keep records required by tax,
            accounting, sanctions or other applicable laws and to respond to
            lawful requests from authorities.
          </li>
          <li>
            <strong>Consent:</strong> where required, for example for certain
            marketing communications or non-essential cookies. You can withdraw
            consent at any time without affecting the lawfulness of processing
            carried out before withdrawal.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection id="sharing" title="5. Sharing and subprocessors">
        <p>
          We do not sell your personal data for monetary consideration, and we
          do not share personal data with third parties for cross-context
          behavioural advertising. We share personal data only with the
          following categories of recipients and only as needed to provide,
          secure, market or improve the Service or as required by law:
        </p>
        <LegalList>
          <li>
            <strong>Infrastructure providers</strong> — bare-metal server and
            storage providers that host our infrastructure. Customer Content
            sits on infrastructure operated by these providers.
          </li>
          <li>
            <strong>Payment provider</strong> — Polar, for payment processing of
            top-ups and subscriptions. The payment provider receives billing
            identifiers and processes card data under its own privacy notice.
          </li>
          <li>
            <strong>Cloudflare</strong> — DNS, edge networking, bot mitigation
            and Cloudflare for SaaS for customer custom-domain routing and TLS.
          </li>
          <li>
            <strong>Email provider</strong> — EmailIt, for delivery of
            transactional and marketing email and storage of delivery telemetry.
            The provider receives your email address and the content of messages
            we send you.
          </li>
          <li>
            <strong>Real-time messaging</strong> — Pusher or our self-hosted
            Soketi for real-time delivery of UI update events to your browser.
          </li>
          <li>
            <strong>Analytics and product telemetry</strong> — Google (Tag
            Manager, Analytics) and any similar analytics or product- telemetry
            providers we use from time to time. These providers may set cookies
            in your browser; see our{" "}
            <Link className="text-primary hover:underline" href="/cookies">
              Cookie Policy
            </Link>
            .
          </li>
          <li>
            <strong>Google</strong> — if you choose Google as your sign-in
            method, Google receives an authentication request and returns your
            profile information to us under Google&apos;s privacy policy.
          </li>
          <li>
            <strong>Professional advisers and authorities</strong> — lawyers,
            accountants, auditors and law-enforcement or regulatory bodies where
            we determine, in our discretion, that disclosure is appropriate,
            including in response to lawful requests or to protect our or
            others&apos; rights, property or safety.
          </li>
          <li>
            <strong>Corporate transactions</strong> — counterparties, advisers
            and successors in connection with a merger, acquisition, financing,
            reorganisation or sale of all or part of our business or assets. The
            recipient may continue to use your personal data as described in
            this policy or under a replacement policy we make available.
          </li>
        </LegalList>
      </LegalSection>

      <LegalSection id="transfers" title="6. International data transfers">
        <p>
          Our subprocessors operate globally and your personal data may be
          transferred to and processed in countries outside your country of
          residence, including outside the EEA, the United Kingdom and
          Switzerland. Where required, we rely on appropriate safeguards such as
          the European Commission&apos;s Standard Contractual Clauses, the UK
          International Data Transfer Addendum, or other mechanisms permitted by
          applicable law or published by the relevant subprocessor.
        </p>
      </LegalSection>

      <LegalSection id="retention" title="7. Retention">
        <p>
          We keep personal data only for as long as we reasonably need it for
          the purposes described in this policy, and longer where required or
          permitted by applicable law (for example, tax, accounting, anti-fraud,
          audit, dispute-handling and the establishment, exercise or defence of
          legal claims). Indicative retention periods are:
        </p>
        <LegalList>
          <li>
            <strong>Account data:</strong> for the lifetime of your account and
            a reasonable period afterwards for billing, dispute and
            legal-compliance purposes.
          </li>
          <li>
            <strong>Session and authentication data:</strong> for the duration
            of the session, plus a security-forensics window.
          </li>
          <li>
            <strong>Billing records and invoices:</strong> for the period
            required by applicable tax and accounting law (typically up to 10
            years).
          </li>
          <li>
            <strong>Audit and lifecycle logs:</strong> for as long as necessary
            for security, compliance and dispute-handling purposes.
          </li>
          <li>
            <strong>
              Email delivery telemetry, job logs and similar operational
              telemetry:
            </strong>{" "}
            for a limited period and pruned periodically.
          </li>
          <li>
            <strong>Customer Content (Cubes, snapshots, backups):</strong> until
            you delete it or your account is closed or terminated; residual
            copies may persist in backups and operational systems for a
            reasonable rotation period before permanent removal.
          </li>
        </LegalList>
        <p>
          We may retain personal data for longer where necessary to investigate
          or defend against suspected fraud, abuse, security incidents,
          chargebacks or legal claims, or as required by law.
        </p>
      </LegalSection>

      <LegalSection
        id="end-user-data"
        title="8. End-user personal data inside your Cubes"
      >
        <p>
          If your application processes personal data of your own end users
          inside a Cube, you act as the controller (or equivalent) of that data
          and {PRODUCT_NAME} acts as your processor (or equivalent) for that
          processing only. You must have a lawful basis for that processing,
          inform your end users as required by law and implement appropriate
          technical and organisational measures inside your Cube. We process
          such data only on your documented instructions, as described in our
          Terms and any data-processing addendum we make available where one is
          required.
        </p>
      </LegalSection>

      <LegalSection id="rights" title="9. Your rights">
        <p>
          Depending on where you live, you may have the right, subject to
          applicable conditions and exemptions, to:
        </p>
        <LegalList>
          <li>access the personal data we hold about you;</li>
          <li>correct inaccurate or incomplete personal data;</li>
          <li>request deletion of your personal data;</li>
          <li>
            restrict or object to certain processing, including direct
            marketing;
          </li>
          <li>
            receive a portable copy of personal data you provided to us; and
          </li>
          <li>lodge a complaint with your local data-protection authority.</li>
        </LegalList>
        <p>
          You can exercise many of these rights directly from your profile (for
          example by editing your details, exporting your data or deleting your
          account). For anything else, write to us at{" "}
          <a
            className="text-primary hover:underline"
            href={`mailto:${PLATFORM_EMAILS.support}`}
          >
            {PLATFORM_EMAILS.support}
          </a>
          . We will respond within the timeframe required by applicable law. We
          may need to verify your identity, ask for additional information or,
          where permitted by law, decline or charge a reasonable fee for
          manifestly unfounded or excessive requests.
        </p>
      </LegalSection>

      <LegalSection id="marketing" title="10. Marketing communications">
        <p>
          We may send you marketing communications about {PRODUCT_NAME} — for
          example product updates, tips and offers. Where applicable law
          requires prior consent (including in the European Economic Area and
          the United Kingdom), we will only send marketing communications after
          you have given that consent. Elsewhere, we rely on the soft-opt-in or
          the legitimate interest of marketing our own similar products and
          services to existing customers.
        </p>
        <p>You can opt out of marketing communications at any time by:</p>
        <LegalList>
          <li>
            toggling the marketing-email setting in your profile in the
            dashboard; or
          </li>
          <li>clicking the unsubscribe link in any marketing email we send.</li>
        </LegalList>
        <p>
          Opting out of marketing does not stop transactional or service-related
          emails (sign-in links, billing notifications, security alerts, abuse
          notices and service announcements) that are necessary to operate the
          Service.
        </p>
      </LegalSection>

      <LegalSection id="security" title="11. Security">
        <p>
          We use industry-standard administrative, technical and physical
          safeguards designed to protect personal data against unauthorised
          access, alteration, disclosure and destruction, including encryption
          of sensitive secrets, transport-layer encryption, audit logging,
          access controls and isolation between customer environments. No system
          is perfectly secure, however, and we do not guarantee the security of
          any personal data or Customer Content. You are responsible for the
          security of any software and data you put inside your Cubes and on any
          devices you use to access the Service.
        </p>
      </LegalSection>

      <LegalSection id="children" title="12. Children">
        <p>
          The Service is not intended for, and we do not knowingly collect
          personal data from, anyone under 18 (or the age of majority in your
          jurisdiction, if higher). If you believe a child has provided us with
          personal data, please contact us so we can take appropriate action,
          including deleting the account.
        </p>
      </LegalSection>

      <LegalSection id="cookies" title="13. Cookies">
        <p>
          We use a limited set of cookies and similar technologies to operate
          the Service and to measure how it is used. For details, see our{" "}
          <Link className="text-primary hover:underline" href="/cookies">
            Cookie Policy
          </Link>
          .
        </p>
      </LegalSection>

      <LegalSection id="changes" title="14. Changes to this policy">
        <p>
          We may update this policy from time to time. When we make changes, we
          will update the &ldquo;Last updated&rdquo; date above. Where we make
          material changes, we will use reasonable efforts to give additional
          notice — for example, by email or an in-product banner — but no
          specific notice period is guaranteed. Your continued use of the
          Service after the updated policy takes effect constitutes acceptance
          of it.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="15. Contact">
        <p>
          For any privacy question or to exercise your rights, contact us at{" "}
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
