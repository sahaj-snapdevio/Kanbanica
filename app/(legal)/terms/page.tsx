import type { Metadata } from "next";
import { PRODUCT_NAME, SUPPORT_EMAIL } from "@/config/platform";

export const metadata: Metadata = {
  title: `Terms of Service — ${PRODUCT_NAME}`,
  description: `The terms that govern your use of ${PRODUCT_NAME}.`,
};

export default function TermsPage() {
  return (
    <article className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Terms of Service</h1>
        <p className="text-sm text-muted-foreground">Last updated: June 2026</p>
      </header>

      <p className="text-sm leading-relaxed text-foreground/80">
        These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and
        use of {PRODUCT_NAME} (the &ldquo;Service&rdquo;). By creating an account
        or using the Service, you agree to be bound by these Terms. If you do not
        agree, do not use the Service.
      </p>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">1. Accounts</h2>
        <p className="text-sm leading-relaxed text-foreground/80">
          You are responsible for the activity that occurs under your account and
          for keeping your sign-in credentials secure. You must provide accurate
          information and notify us promptly of any unauthorized use of your
          account.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">2. Acceptable use</h2>
        <p className="text-sm leading-relaxed text-foreground/80">
          You agree not to misuse the Service, including by interfering with its
          normal operation, attempting to access it using a method other than the
          interfaces we provide, or using it to store or transmit unlawful or
          infringing content.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">3. Your content</h2>
        <p className="text-sm leading-relaxed text-foreground/80">
          You retain ownership of the content you submit to the Service. You grant
          us a limited license to host, store, and display that content solely as
          needed to operate and provide the Service to you and your workspace
          members.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">4. Availability &amp; changes</h2>
        <p className="text-sm leading-relaxed text-foreground/80">
          We may modify, suspend, or discontinue any part of the Service at any
          time. We may also update these Terms; if we make material changes, we
          will provide reasonable notice. Continued use after changes take effect
          constitutes acceptance of the revised Terms.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">5. Termination</h2>
        <p className="text-sm leading-relaxed text-foreground/80">
          You may stop using the Service at any time. We may suspend or terminate
          access if you violate these Terms or if necessary to protect the Service
          or other users.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">6. Disclaimer &amp; liability</h2>
        <p className="text-sm leading-relaxed text-foreground/80">
          The Service is provided &ldquo;as is&rdquo; without warranties of any
          kind. To the maximum extent permitted by law, {PRODUCT_NAME} is not
          liable for any indirect, incidental, or consequential damages arising
          from your use of the Service.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">7. Contact</h2>
        <p className="text-sm leading-relaxed text-foreground/80">
          Questions about these Terms? Email us at{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="font-medium text-primary underline underline-offset-4"
          >
            {SUPPORT_EMAIL}
          </a>
          .
        </p>
      </section>
    </article>
  );
}