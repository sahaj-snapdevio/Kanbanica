import type { Metadata } from "next";
import Link from "next/link";
import {
  LegalList,
  LegalPage,
  LegalSection,
  LegalSubheading,
} from "@/app/(landing)/_components/legal-page";
import { PLATFORM_EMAILS, PRODUCT_NAME } from "@/config/platform";
import { pageOpenGraph, pageTwitter } from "@/lib/seo/metadata";

export const metadata: Metadata = {
  title: "Cookie Policy",
  description: `How ${PRODUCT_NAME} uses cookies and similar technologies.`,
  alternates: { canonical: "/cookies" },
  openGraph: pageOpenGraph({
    url: "/cookies",
    title: `Cookie Policy — ${PRODUCT_NAME}`,
    description: `How ${PRODUCT_NAME} uses cookies and similar technologies.`,
  }),
  twitter: pageTwitter({
    title: `Cookie Policy — ${PRODUCT_NAME}`,
    description: `How ${PRODUCT_NAME} uses cookies and similar technologies.`,
  }),
};

const LAST_UPDATED = "31 May 2026";

export default function CookiesPage() {
  return (
    <LegalPage
      intro={
        <p>
          This Cookie Policy explains how {PRODUCT_NAME} uses cookies and
          similar technologies on our website and dashboard. It supplements our{" "}
          <Link className="text-primary hover:underline" href="/privacy">
            Privacy Policy
          </Link>
          .
        </p>
      }
      lastUpdated={LAST_UPDATED}
      title="Cookie Policy"
    >
      <LegalSection id="what-are-cookies" title="1. What are cookies?">
        <p>
          Cookies are small text files stored on your device by your browser
          when you visit a website. They are widely used to make websites work,
          to remember your preferences, to measure usage and to provide
          information to site operators. Similar technologies include local
          storage, session storage, pixels, tags and software development kits;
          we refer to all of them simply as &ldquo;cookies&rdquo; in this
          policy.
        </p>
      </LegalSection>

      <LegalSection id="what-we-use" title="2. What we use cookies for">
        <p>
          We use cookies for two purposes: to make the Service work (strictly
          necessary cookies) and to measure how it is used (analytics cookies).
          Some of these cookies are set by us; others are set by third-party
          services we integrate with.
        </p>

        <LegalSubheading>2.1 Strictly necessary cookies</LegalSubheading>
        <p>
          These cookies are essential for the Service to work. They cannot be
          disabled without breaking core functionality, so we do not ask for
          consent to use them.
        </p>
        <LegalList>
          <li>
            <strong>Session cookie</strong> set by our authentication system to
            keep you signed in after a successful login or magic-link
            verification.
          </li>
          <li>
            <strong>CSRF token cookie</strong> used to protect server actions
            and API mutations against cross-site request forgery.
          </li>
          <li>
            <strong>Preference cookies</strong> (where applicable) used to
            remember small UI choices such as your selected theme.
          </li>
        </LegalList>

        <LegalSubheading>
          2.2 Analytics and product-telemetry cookies
        </LegalSubheading>
        <p>
          We use Google Tag Manager to load Google Analytics (GA4) so we can
          understand how visitors and customers use our website and dashboard.
          These tools may set cookies (including <code>_ga</code>,{" "}
          <code>_ga_*</code>, <code>_gid</code>, <code>_gat</code> and similar)
          and may use local storage to collect a pseudonymous identifier, the
          pages you view, links you click, time spent, your device, browser,
          operating system, referrer, general (city / country) location inferred
          from your IP address and other interaction data. Google may process
          this information outside your country of residence under its own
          privacy and cookie policies.
        </p>
        <p>
          We use this information in aggregate to understand product usage,
          improve performance and design, debug issues and inform business
          decisions. We do not use it to build advertising profiles, run
          retargeting campaigns or sell personal data to third parties.
        </p>
        <p>
          Analytics cookies are not essential to the Service and stay off until
          you opt in. When you first visit, we ask for your choice through a
          cookie-consent banner and only set analytics cookies after you accept.
          You can change or withdraw your choice at any time via the{" "}
          <strong>Cookie settings</strong> link in the footer, or with your
          browser&apos;s cookie controls and the Google Analytics opt-out add-on
          described in Section 3 below. Where your local law (including the EU
          ePrivacy Directive and the UK Privacy and Electronic Communications
          Regulations) requires prior consent for non-essential cookies, that
          consent is collected through the banner; withdrawing consent does not
          affect the lawfulness of processing carried out before withdrawal.
        </p>

        <LegalSubheading>2.3 Third-party functional cookies</LegalSubheading>
        <p>
          When you interact with certain third-party services we integrate with,
          those services may set their own cookies on your device. We do not
          control these cookies; they are governed by the provider&apos;s own
          privacy and cookie policies.
        </p>
        <LegalList>
          <li>
            <strong>Cloudflare</strong> — security and performance cookies set
            when traffic is routed through Cloudflare&apos;s edge network (for
            example to identify bots or rate-limit attacks).
          </li>
          <li>
            <strong>Polar</strong> — cookies set during a hosted checkout
            session when you top up credit or subscribe to a plan.
          </li>
          <li>
            <strong>Google</strong> — cookies set if you choose Google as your
            sign-in method or when Google Tag Manager loads Google Analytics or
            other tags we have configured.
          </li>
        </LegalList>
        <p>
          We may add, remove or replace third-party tags configured inside
          Google Tag Manager and similar systems from time to time without
          updating this policy for each individual tag, provided the purposes
          remain within the categories described above.
        </p>
      </LegalSection>

      <LegalSection id="manage" title="3. Managing cookies">
        <p>
          Most browsers let you view, manage and delete cookies in their
          settings. Blocking strictly necessary cookies will prevent you from
          signing in or using the dashboard. You can typically choose to:
        </p>
        <LegalList>
          <li>see which cookies are stored and clear them on demand;</li>
          <li>block all cookies, third-party cookies, or specific domains;</li>
          <li>be alerted before a cookie is set.</li>
        </LegalList>
        <p>
          To opt out of Google Analytics specifically, you may also install the
          Google Analytics Opt-Out Browser Add-On (available from Google) or use
          the cookie controls in your browser to block requests to Google&apos;s
          analytics domains. For more general information about cookies, see the
          controls in your browser of choice (Chrome, Safari, Firefox, Edge,
          Brave, etc.) or visit{" "}
          <a
            className="text-primary hover:underline"
            href="https://www.allaboutcookies.org/"
            rel="noopener noreferrer"
            target="_blank"
          >
            allaboutcookies.org
          </a>
          .
        </p>
      </LegalSection>

      <LegalSection id="changes" title="4. Changes to this policy">
        <p>
          We may update this policy as our use of cookies evolves. Material
          changes will be reflected in the &ldquo;Last updated&rdquo; date at
          the top of the page.
        </p>
      </LegalSection>

      <LegalSection id="contact" title="5. Contact">
        <p>
          Questions about how we use cookies? Contact us at{" "}
          <a
            className="text-primary hover:underline"
            href={`mailto:${PLATFORM_EMAILS.support}`}
          >
            {PLATFORM_EMAILS.support}
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  );
}
