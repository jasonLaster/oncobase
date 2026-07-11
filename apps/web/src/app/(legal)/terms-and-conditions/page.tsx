import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms and Conditions",
  description: "Terms and conditions for the Diana TNBC Knowledge Base.",
};

const effectiveDate = "July 10, 2026";

export default function TermsAndConditionsPage() {
  return (
    <div className="min-h-dvh bg-[var(--background)] text-[var(--foreground)]">
      <header className="border-b border-[var(--border)] bg-[var(--card)]">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/" className="font-semibold tracking-tight">
            Diana TNBC Knowledge Base
          </Link>
          <span className="text-sm text-[var(--muted-foreground)]">Terms</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
        <article className="prose max-w-none">
          <h1>Terms and Conditions</h1>
          <p className="text-sm text-[var(--muted-foreground)]">
            Effective date: {effectiveDate}
          </p>

          <p>
            These Terms and Conditions (the “Terms”) govern your access to and
            use of the Diana TNBC Knowledge Base (the “Site”). By accessing or
            using the Site, you agree to these Terms. If you do not agree, do
            not use the Site.
          </p>

          <h2>1. Informational and educational use only</h2>
          <p>
            The Site organizes information about triple-negative breast cancer,
            medical research, testing, treatment, and related topics. Its
            content is provided for general informational and educational
            purposes only. It is not medical advice, diagnosis, treatment, or a
            substitute for advice from a qualified health care professional.
          </p>
          <p>
            Do not disregard professional medical advice or delay seeking care
            because of information on the Site. If you believe you may have a
            medical emergency, contact emergency services immediately. Always
            consult an appropriate clinician before making health or treatment
            decisions.
          </p>

          <h2>2. No clinician-patient relationship</h2>
          <p>
            Your use of the Site does not create a clinician-patient,
            researcher-participant, fiduciary, or other professional
            relationship between you and the Site operator, contributors, or
            any person or organization referenced on the Site.
          </p>

          <h2>3. Accuracy, completeness, and artificial intelligence</h2>
          <p>
            Medical and scientific knowledge changes rapidly. Content may be
            incomplete, outdated, inaccurate, or unsuitable for your
            circumstances. Some material or site features may be generated,
            summarized, translated, or assisted by artificial intelligence and
            may contain errors or invented information. You are responsible for
            independently verifying important information with primary sources
            and qualified professionals.
          </p>

          <h2>4. Access and acceptable use</h2>
          <p>
            You may use the Site only for lawful, personal, informational
            purposes. You must not:
          </p>
          <ul>
            <li>attempt to bypass authentication or other access controls;</li>
            <li>
              access, use, disclose, or distribute information you are not
              authorized to receive;
            </li>
            <li>
              interfere with the Site, introduce malicious code, scrape it in a
              manner that burdens its systems, or attempt to discover security
              vulnerabilities without permission;
            </li>
            <li>
              use Site content to make automated clinical decisions or provide
              medical advice; or
            </li>
            <li>violate any applicable law or the rights of another person.</li>
          </ul>
          <p>
            Access may be suspended or terminated at any time, including for a
            violation of these Terms or to protect the Site, its users, or its
            data.
          </p>

          <h2>5. Accounts and confidential information</h2>
          <p>
            If access credentials are provided to you, you are responsible for
            keeping them confidential and for activity under your access. Do
            not share credentials or confidential, personal, or health
            information from restricted portions of the Site unless you are
            authorized to do so. Notify the Site operator promptly if you
            believe access has been compromised.
          </p>

          <h2>6. Intellectual property</h2>
          <p>
            The Site and its original content, design, and software are owned by
            or licensed to the Site operator and are protected by applicable
            intellectual property laws. Third-party names, publications,
            images, trademarks, and other materials remain the property of
            their respective owners. Except as permitted by law or expressly
            authorized, you may not reproduce, modify, publish, sell, or
            distribute Site content.
          </p>

          <h2>7. Third-party content and links</h2>
          <p>
            The Site may cite or link to third-party publications, services,
            clinical trials, laboratories, or other resources. Those resources
            are controlled by third parties. Their inclusion does not imply
            endorsement, and the Site operator is not responsible for their
            availability, accuracy, security, or practices.
          </p>

          <h2>8. Privacy</h2>
          <p>
            Information submitted to or collected through the Site may be used
            to operate, secure, maintain, and improve it. Do not submit personal
            or health information unless you are authorized to do so and the
            Site specifically requests it. Internet transmissions and storage
            systems cannot be guaranteed to be completely secure.
          </p>

          <h2>9. No warranties</h2>
          <p>
            To the fullest extent permitted by law, the Site is provided “as
            is” and “as available,” without warranties of any kind, express or
            implied. The Site operator does not warrant that the Site will be
            accurate, complete, current, uninterrupted, secure, or free of
            errors or harmful components.
          </p>

          <h2>10. Limitation of liability</h2>
          <p>
            To the fullest extent permitted by law, the Site operator and its
            contributors will not be liable for any indirect, incidental,
            special, consequential, exemplary, or punitive damages, or for any
            loss arising from your use of or reliance on the Site. Nothing in
            these Terms excludes liability that cannot lawfully be excluded.
          </p>

          <h2>11. Changes to the Site or these Terms</h2>
          <p>
            The Site and these Terms may be changed at any time. Updated Terms
            become effective when posted with a revised effective date. Your
            continued use of the Site after an update means you accept the
            revised Terms.
          </p>

          <h2>12. Severability and entire agreement</h2>
          <p>
            If any provision of these Terms is found unenforceable, the
            remaining provisions will remain in effect. These Terms constitute
            the entire agreement concerning your use of the Site unless a
            separate written agreement applies to you.
          </p>

          <h2>13. Contact</h2>
          <p>
            Questions about these Terms may be directed to the Site
            administrator through the contact channel by which you received
            access to the Site.
          </p>
        </article>
      </main>
    </div>
  );
}
