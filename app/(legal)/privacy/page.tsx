import type { Metadata } from "next";
import { PRODUCT_NAME, SUPPORT_EMAIL } from "@/config/platform";

export const metadata: Metadata = {
  title: `Privacy Policy — ${PRODUCT_NAME}`,
  description: `How ${PRODUCT_NAME} collects, uses, and protects your data.`,
};

export default function PrivacyPage() {
  return (
    <article className="space-y-8">
      <header className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Privacy Policy</h1>
        <p className="text-sm text-muted-foreground">Last updated: June 2026</p>
      </header>

      <p className="text-sm leading-relaxed text-foreground/80">
        This Privacy Policy explains how {PRODUCT_NAME} collects, uses, and
        protects your information when you use the Service. By using
        {" "}{PRODUCT_NAME}, you agree to the practices described here.
      </p>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">1. Information we collect</h2>
        <p className="text-sm leading-relaxed text-foreground/80">
          We collect the email address you use to sign in, profile details you
          provide (such as your name and avatar), and the content you create in
          the Service — including workspaces, projects, tasks, comments, and
          attachments. We also collect basic technical data such as log and
          device information needed to operate the Service.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">2. How we use information</h2>
        <p className="text-sm leading-relaxed text-foreground/80">
          We use your information to provide and maintain the Service,
          authenticate you via secure magic links, send transactional emails
          (such as sign-in links and notifications), and improve reliability and
          security. We do not sell your personal information.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">3. Sharing</h2>
        <p className="text-sm leading-relaxed text-foreground/80">
          Content you create is visible to members of the workspaces you belong
          to, according to their permissions. We share data with service
          providers (such as email and hosting) only as needed to run the
          Service, and when required by law.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">4. Data retention</h2>
        <p className="text-sm leading-relaxed text-foreground/80">
          We retain your information for as long as your account is active.
          When you delete your account, we remove your personal data, subject to
          limited retention required for legal or security purposes.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">5. Security</h2>
        <p className="text-sm leading-relaxed text-foreground/80">
          We use industry-standard measures to protect your data in transit and
          at rest. No method of transmission or storage is completely secure, so
          we cannot guarantee absolute security.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">6. Your rights</h2>
        <p className="text-sm leading-relaxed text-foreground/80">
          You can access and update your profile, export your data, and delete
          your account from within the Service. To exercise additional rights
          available under applicable law, contact us using the details below.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-lg font-semibold">7. Contact</h2>
        <p className="text-sm leading-relaxed text-foreground/80">
          Questions about this policy or your data? Email us at{" "}
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